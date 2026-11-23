"""FastAPI app serving the Space Cadet reentry pipeline (D4).

Run locally from the repo root:

    uv run --group api uvicorn api.serve:app --reload

The pipeline bundle is loaded ONCE, when this module is imported, from
$SPACE_CADET_PIPELINE (default: api/pipeline.joblib next to this file). If it
cannot be loaded the app still starts: /health reports the error and the
model endpoints return 503. Point SPACE_CADET_PIPELINE at a missing file to
test that locally without touching the deployed app.
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, model_validator

HERE = Path(__file__).resolve().parent
# Locally the transformer lives in ../src; on Modal it is on PYTHONPATH already.
if (HERE.parent / "src").is_dir() and str(HERE.parent / "src") not in sys.path:
    sys.path.insert(0, str(HERE.parent / "src"))

# Required so joblib can resolve the custom transformer when unpickling.
from features.transformers import RAW_FIELDS, physics_baseline  # noqa: E402,F401

PIPELINE_PATH = Path(os.environ.get("SPACE_CADET_PIPELINE", HERE / "pipeline.joblib"))

_bundle: dict | None = None
_load_error: str | None = None
try:
    _bundle = joblib.load(PIPELINE_PATH)
except Exception as exc:  # noqa: BLE001 - any load failure should degrade to 503, not crash
    _load_error = f"{type(exc).__name__}: {exc}"

app = FastAPI(
    title="Space Cadet reentry API",
    description="Will a piece of space junk reenter the atmosphere within 365 days? "
                "Serves the team's fitted scikit-learn pipeline.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    # The Vercel site (production and preview URLs) and local development on any port.
    allow_origin_regex=r"https://.*\.vercel\.app|http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    """One piece of junk, described by what is known on the prediction date."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "perigee_km": 380, "apogee_km": 420, "perigee_km_30d_ago": 392,
                "inclination_deg": 51.6, "bstar": 0.0004, "object_type": "DEBRIS",
                "rcs_size": "SMALL", "age_days": 1200, "f107_81d_mean": 150, "ap_27d_mean": 12,
            }
        },
    )

    perigee_km: float = Field(..., ge=100, le=2000, description="Lowest point of the orbit now (km).")
    apogee_km: float = Field(..., ge=100, le=50000, description="Highest point of the orbit now (km).")
    perigee_km_30d_ago: float = Field(..., ge=100, le=2000, description="Perigee 30 days earlier (km).")
    inclination_deg: float = Field(..., ge=0, le=180, description="Orbit tilt from the equator (degrees).")
    bstar: float = Field(..., ge=-1, le=1, description="Drag term from the element set (1/Earth radii).")
    object_type: Literal["DEBRIS", "ROCKET BODY", "UNKNOWN", "TBA"]
    rcs_size: Literal["SMALL", "MEDIUM", "LARGE", "UNKNOWN"] = Field(..., description="Radar cross-section class.")
    age_days: float = Field(..., ge=0, le=30000, description="Days since launch.")
    f107_81d_mean: float = Field(..., ge=50, le=400, description="Solar flux F10.7, 81-day mean (sfu).")
    ap_27d_mean: float = Field(..., ge=0, le=400, description="Geomagnetic Ap index, 27-day mean.")

    @model_validator(mode="after")
    def apogee_not_below_perigee(self):
        if self.apogee_km < self.perigee_km:
            raise ValueError("apogee_km must be greater than or equal to perigee_km")
        return self


class Baseline(BaseModel):
    reenters_within_365d: bool
    days_to_120km: float | None = Field(None, description="At the current descent rate; null if not descending.")


class PredictResponse(BaseModel):
    probability: float = Field(..., description="Model probability of reentry within 365 days.")
    reenters_within_365d: bool = Field(..., description="Model call at the validation-locked threshold.")
    threshold: float
    physics_baseline: Baseline
    out_of_training_range: bool
    out_of_range_fields: list[str]
    model_version: str


def _require_bundle() -> dict:
    if _bundle is None:
        raise HTTPException(status_code=503, detail="Model artifact is not available.")
    return _bundle


@app.get("/health")
def health():
    """Liveness plus whether the pipeline artifact loaded."""
    return {"status": "ok", "loaded": _bundle is not None, "error": _load_error}


@app.get("/pipeline-info")
def pipeline_info():
    """Bundle metadata: versions, steps, input fields, ranges, validation metrics."""
    return _require_bundle()["metadata"]


@app.post("/predict", response_model=PredictResponse)
def predict(request: PredictRequest):
    bundle = _require_bundle()
    pipeline, meta = bundle["pipeline"], bundle["metadata"]
    X = pd.DataFrame([request.model_dump()])[RAW_FIELDS]

    probability = float(pipeline.predict_proba(X)[0, 1])
    outside = pipeline.named_steps["features"].out_of_range_fields(X)[0]
    pred, days = physics_baseline([request.perigee_km], [request.perigee_km_30d_ago],
                                  horizon_days=meta.get("horizon_days", 365))
    days_value = float(days[0])
    return PredictResponse(
        probability=probability,
        reenters_within_365d=probability >= meta["threshold"],
        threshold=meta["threshold"],
        physics_baseline=Baseline(
            reenters_within_365d=bool(pred[0]),
            days_to_120km=None if math.isinf(days_value) else round(days_value, 1),
        ),
        out_of_training_range=bool(outside),
        out_of_range_fields=outside,
        model_version=meta["model_version"],
    )
