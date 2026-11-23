"""API tests: valid requests succeed, invalid input returns 422, a missing
artifact returns 503. A small pipeline is fitted on synthetic rows, so these
tests need no real data.

    uv run --group api pytest tests/test_api.py -v
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "src" / "Models"))
sys.path.insert(0, str(ROOT))

import build_api_pipeline as bap  # noqa: E402

VALID = {
    "perigee_km": 380, "apogee_km": 420, "perigee_km_30d_ago": 392, "inclination_deg": 51.6,
    "bstar": 0.0004, "object_type": "DEBRIS", "rcs_size": "SMALL", "age_days": 1200,
    "f107_81d_mean": 150, "ap_27d_mean": 12,
}


def synthetic_panel(n_objects: int = 120, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for obj in range(n_objects):
        split = "train" if obj < 90 else "valid"
        perigee = rng.uniform(150, 600)
        rate = -rng.uniform(0, 3)
        for k in range(4):
            p = perigee + 30 * rate * k
            rows.append({
                "norad_cat_id": obj, "split": split,
                "reenters_within_horizon": int(p + 365 * rate < 150),
                "perigee_decay_rate_km_per_day": rate, "perigee_km_asof": p,
                "apogee_km_asof": p + rng.uniform(0, 300), "inclination_deg_asof": rng.uniform(0, 100),
                "bstar": rng.uniform(1e-5, 1e-3), "age_days": rng.uniform(10, 5000),
                "f107_adj_mean_81d": rng.uniform(70, 200), "ap_mean_27d": rng.uniform(3, 30),
                "object_type": rng.choice(["DEBRIS", "ROCKET BODY", "UNKNOWN"]),
                "rcs_size": rng.choice(["SMALL", "MEDIUM", "LARGE", None]),
            })
    return pd.DataFrame(rows)


def load_app(monkeypatch, artifact: Path):
    monkeypatch.setenv("SPACE_CADET_PIPELINE", str(artifact))
    sys.modules.pop("api.serve", None)
    return importlib.import_module("api.serve").app


@pytest.fixture(scope="module")
def artifact(tmp_path_factory) -> Path:
    path = tmp_path_factory.mktemp("model") / "pipeline.joblib"
    joblib.dump(bap.build_bundle(synthetic_panel()), path)
    return path


@pytest.fixture
def client(monkeypatch, artifact):
    return TestClient(load_app(monkeypatch, artifact))


def test_health_reports_loaded(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["loaded"] is True


def test_pipeline_info_has_metadata(client):
    body = client.get("/pipeline-info").json()
    assert body["sklearn_version"] and body["custom_transformer"].endswith("OrbitFeatureBuilder")
    assert "threshold" in body and "validation_metrics" in body


def test_valid_predict(client):
    r = client.post("/predict", json=VALID)
    assert r.status_code == 200
    body = r.json()
    assert 0.0 <= body["probability"] <= 1.0
    assert isinstance(body["reenters_within_365d"], bool)
    assert body["physics_baseline"]["days_to_120km"] == pytest.approx((380 - 120) / 0.4, rel=1e-3)


def test_out_of_range_input_is_flagged(client):
    r = client.post("/predict", json={**VALID, "f107_81d_mean": 390})
    assert r.status_code == 200 and "f107_81d_mean" in r.json()["out_of_range_fields"]


@pytest.mark.parametrize("bad", [
    {"perigee_km": 50},                       # below the allowed range
    {"object_type": "SATELLITE"},             # not an allowed type
    {"apogee_km": 300},                       # apogee below perigee
    {"bstar": "lots"},                        # wrong type
    {"extra_field": 1},                       # unknown field
])
def test_invalid_input_returns_422(client, bad):
    assert client.post("/predict", json={**VALID, **bad}).status_code == 422


def test_missing_field_returns_422(client):
    body = {k: v for k, v in VALID.items() if k != "perigee_km"}
    assert client.post("/predict", json=body).status_code == 422


def test_missing_artifact_returns_503(monkeypatch, tmp_path):
    client = TestClient(load_app(monkeypatch, tmp_path / "does-not-exist.joblib"))
    assert client.get("/health").json()["loaded"] is False
    assert client.get("/pipeline-info").status_code == 503
    assert client.post("/predict", json=VALID).status_code == 503
