"""Space Cadet prediction API (PLAN Phase 5 / D4).

    ORBIT_PIPELINE_PATH=artifacts/orbit_pipeline.joblib \\
        uv run uvicorn api.main:app --reload

Endpoints
---------
GET  /health         process is up; says whether the model artifact is loadable
GET  /pipeline-info  what the model is, what it was trained on, how it scored
POST /predict        probability that an object reenters within 365 days

Status codes
------------
422  the request body is invalid (wrong type, out of physical range, bad enum,
     unknown field, perigee above apogee ...)
503  the model artifact is missing or cannot be loaded (/predict, /pipeline-info)

Configuration (environment variables, read on every request so tests can swap them)
    ORBIT_PIPELINE_PATH   fitted pipeline (joblib). Default: artifacts/orbit_pipeline.joblib
    ORBIT_METADATA_PATH   metadata JSON. Default: next to the pipeline, *_metadata.json
    ORBIT_CORS_ORIGINS    comma-separated origins allowed to call the API. Default: *
"""
from __future__ import annotations

import json
import math
import os
import sys
import threading
from pathlib import Path
from typing import Literal, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))  # joblib needs `features.*` importable to unpickle

import joblib  # noqa: E402
import pandas as pd  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator  # noqa: E402

from features.baselines import (  # noqa: E402
    descent_rate_km_per_day,
    physics_days_to_reentry,
    physics_reenters_within_horizon,
)
from features.transformers import NUMERIC_RAW, RAW_FIELDS  # noqa: E402

DEFAULT_PIPELINE = ROOT / "artifacts" / "orbit_pipeline.joblib"
HORIZON_DAYS = 365

ObjectType = Literal["DEBRIS", "ROCKET BODY", "TBA", "UNKNOWN"]
RcsSize = Literal["SMALL", "MEDIUM", "LARGE"]


# --------------------------------------------------------------------------- #
# request / response schemas
# --------------------------------------------------------------------------- #
class PredictRequest(BaseModel):
    """Raw fields, as a caller (the game) knows them. Ranges are physical limits,
    not training ranges: a value inside them but outside what the model saw is
    answered, with ``out_of_training_range`` set."""

    model_config = ConfigDict(extra="forbid")

    perigee_km: float = Field(..., ge=80, le=2000, allow_inf_nan=False, description="Perigee altitude now (km)")
    apogee_km: float = Field(..., ge=80, le=100_000, allow_inf_nan=False, description="Apogee altitude now (km)")
    perigee_km_30d_ago: Optional[float] = Field(
        None, ge=80, le=2000, allow_inf_nan=False, description="Perigee altitude 30 days ago (km)"
    )
    apogee_km_30d_ago: Optional[float] = Field(
        None, ge=80, le=100_000, allow_inf_nan=False, description="Apogee altitude 30 days ago (km)"
    )
    bstar: Optional[float] = Field(None, ge=-0.1, le=1.0, allow_inf_nan=False, description="BSTAR drag term (1/Earth radii)")
    inclination_deg: float = Field(..., ge=0, le=180, allow_inf_nan=False, description="Orbital inclination (degrees)")
    object_type: ObjectType = Field(..., description="Kind of junk object")
    rcs_size: Optional[RcsSize] = Field(None, description="Radar cross-section size class")
    f107_adj_mean_81d: Optional[float] = Field(
        None, ge=40, le=400, allow_inf_nan=False, description="F10.7 solar flux, 81-day mean (sfu)"
    )
    ap_mean_30d: Optional[float] = Field(
        None, ge=0, le=400, allow_inf_nan=False, description="Geomagnetic Ap index, 30-day mean"
    )

    @field_validator("object_type", "rcs_size", mode="before")
    @classmethod
    def _normalise_enum(cls, v):
        # Be forgiving about case and stray spaces; reject everything else via the Literal.
        return v.strip().upper() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _apogee_not_below_perigee(self):
        if self.apogee_km < self.perigee_km:
            raise ValueError("apogee_km must be >= perigee_km")
        a, p = self.apogee_km_30d_ago, self.perigee_km_30d_ago
        if a is not None and p is not None and a < p:
            raise ValueError("apogee_km_30d_ago must be >= perigee_km_30d_ago")
        return self


class PhysicsBaseline(BaseModel):
    status: Literal["falling", "not_falling", "unknown"]
    days_to_reentry: Optional[float] = Field(
        None, description="Days until perigee reaches 120 km at the current descent rate; null unless falling"
    )
    reenters_within_365d: Optional[int] = Field(None, description="1 if days_to_reentry <= 365; null if unknown")


class Baseline(BaseModel):
    base_rate: float = Field(..., description="Share of training snapshots that reentered within 365 days")
    physics: PhysicsBaseline


class PredictResponse(BaseModel):
    probability_reenters_within_365d: float
    horizon_days: int
    baseline: Baseline
    out_of_training_range: bool
    out_of_range_fields: list[str]
    imputed_fields: list[str] = Field(..., description="Inputs left out by the caller and filled with training medians/modes")
    model: dict


# --------------------------------------------------------------------------- #
# model store
# --------------------------------------------------------------------------- #
class ModelUnavailable(Exception):
    pass


class ModelStore:
    """Loads the artifact on demand and reloads it if the path or file changes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._key: tuple | None = None
        self._pipeline = None
        self._metadata: dict = {}

    @staticmethod
    def pipeline_path() -> Path:
        return Path(os.environ.get("ORBIT_PIPELINE_PATH") or DEFAULT_PIPELINE)

    @staticmethod
    def metadata_path(pipeline_path: Path) -> Path:
        env = os.environ.get("ORBIT_METADATA_PATH")
        return Path(env) if env else pipeline_path.with_name(pipeline_path.stem + "_metadata.json")

    def get(self) -> tuple[object, dict]:
        path = self.pipeline_path()
        meta_path = self.metadata_path(path)
        try:
            key = (str(path), path.stat().st_mtime_ns, str(meta_path),
                   meta_path.stat().st_mtime_ns if meta_path.exists() else None)
        except FileNotFoundError:
            raise ModelUnavailable(f"model artifact not found at {path}") from None
        with self._lock:
            if key != self._key:
                try:
                    pipeline = joblib.load(path)
                    metadata = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
                except Exception as exc:  # corrupt file, version mismatch, bad JSON ...
                    self._key = None
                    raise ModelUnavailable(f"model artifact at {path} could not be loaded: {exc}") from exc
                self._key, self._pipeline, self._metadata = key, pipeline, metadata
            return self._pipeline, self._metadata


store = ModelStore()


def _require_model() -> tuple[object, dict]:
    try:
        return store.get()
    except ModelUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# --------------------------------------------------------------------------- #
# app
# --------------------------------------------------------------------------- #
app = FastAPI(
    title="Space Cadet orbit-decay API",
    version="1.0.0",
    description="Probability that a piece of orbital junk reenters within 365 days.",
)
_origins = [o.strip() for o in os.environ.get("ORBIT_CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware, allow_origins=_origins, allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["*"]
)


@app.get("/health")
def health() -> dict:
    try:
        _, meta = store.get()
        return {"status": "ok", "model_loaded": True, "pipeline_version": meta.get("pipeline_version")}
    except ModelUnavailable as exc:
        return {"status": "ok", "model_loaded": False, "detail": str(exc)}


@app.get("/pipeline-info")
def pipeline_info() -> dict:
    _, meta = _require_model()
    return {
        "pipeline_version": meta.get("pipeline_version"),
        "created_utc": meta.get("created_utc"),
        "model": meta.get("model"),
        "target": meta.get("target"),
        "horizon_days": meta.get("horizon_days"),
        "output": meta.get("output"),
        "fit_on": meta.get("fit_on"),
        "raw_input_fields": meta.get("raw_input_fields", list(RAW_FIELDS)),
        "input_schema": PredictRequest.model_json_schema(),
        "baselines": meta.get("baselines"),
        "training_data": meta.get("training_data"),
        "validation": meta.get("validation"),
        "feature_builder": meta.get("feature_builder"),
        "environment": meta.get("environment"),
        "git": meta.get("git"),
    }


def _clean(value):
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else value


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    pipeline, meta = _require_model()
    row = req.model_dump()
    X = pd.DataFrame([{k: row[k] for k in RAW_FIELDS}])

    builder = pipeline.named_steps["features"]
    try:
        probability = float(pipeline.predict_proba(X)[0, 1])
        out_of_range = builder.out_of_range_features(X)[0]
    except Exception as exc:  # an artifact that loads but cannot score is not usable
        raise HTTPException(status_code=503, detail=f"model failed to score the input: {exc}") from exc

    perigee, ago = req.perigee_km, req.perigee_km_30d_ago
    rate = descent_rate_km_per_day(perigee, ago)
    days = physics_days_to_reentry(perigee, ago)
    if rate is None:
        status = "unknown"
    else:
        status = "falling" if rate < 0 and days is not None and math.isfinite(days) else "not_falling"
    physics = PhysicsBaseline(
        status=status,
        days_to_reentry=round(days, 1) if status == "falling" else None,
        reenters_within_365d=physics_reenters_within_horizon(perigee, ago, HORIZON_DAYS),
    )
    base_rate = float((meta.get("baselines") or {}).get("base_rate", float("nan")))

    imputed = [k for k in RAW_FIELDS if _clean(row[k]) is None]
    return PredictResponse(
        probability_reenters_within_365d=round(probability, 6),
        horizon_days=HORIZON_DAYS,
        baseline=Baseline(base_rate=round(base_rate, 6), physics=physics),
        out_of_training_range=bool(out_of_range),
        out_of_range_fields=out_of_range,
        imputed_fields=imputed,
        model={"name": meta.get("model"), "pipeline_version": meta.get("pipeline_version")},
    )
