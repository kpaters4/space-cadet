"""Tests for api/main.py.

Run from the repo root:

    uv run python -m unittest discover -s tests -v

The tests build a small synthetic artifact in a temp directory, so they need neither
the real data nor a trained model. The artifact path is passed through the same
environment variable the deployed service uses.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "src" / "Models"))
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import fit_serving_pipeline as fit  # noqa: E402
from api import main as api_main  # noqa: E402
from features.transformers import RAW_FIELDS  # noqa: E402


def synthetic_training(n: int = 600, seed: int = 1) -> tuple[pd.DataFrame, pd.Series]:
    rng = np.random.default_rng(seed)
    perigee = rng.uniform(250, 590, n)
    apogee = perigee + rng.uniform(0, 300, n)
    drop = rng.uniform(0, 20, n)
    frame = pd.DataFrame(
        {
            "perigee_km": perigee,
            "apogee_km": apogee,
            "perigee_km_30d_ago": perigee + drop,
            "apogee_km_30d_ago": apogee + drop,
            "bstar": rng.uniform(1e-5, 1e-3, n),
            "inclination_deg": rng.uniform(40, 100, n),
            "f107_adj_mean_81d": rng.uniform(70, 200, n),
            "ap_mean_30d": rng.uniform(4, 20, n),
            "object_type": rng.choice(["DEBRIS", "ROCKET BODY"], n),
            "rcs_size": rng.choice(["SMALL", "MEDIUM", "LARGE"], n),
        }
    )
    # Lower and faster-falling objects reenter: a simple, learnable rule.
    y = ((perigee < 400) | (drop > 14)).astype(int)
    return frame, pd.Series(y)


VALID = {
    "perigee_km": 410.0,
    "apogee_km": 430.0,
    "perigee_km_30d_ago": 425.0,
    "apogee_km_30d_ago": 445.0,
    "bstar": 0.0002,
    "inclination_deg": 70.0,
    "object_type": "DEBRIS",
    "rcs_size": "SMALL",
    "f107_adj_mean_81d": 150.0,
    "ap_mean_30d": 10.0,
}
REQUIRED = ("perigee_km", "apogee_km", "inclination_deg", "object_type")


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        X, y = synthetic_training()
        pipe = fit.make_serving_pipeline("hist_gb").fit(X, y)
        cls.pipeline_path = cls.dir / "orbit_pipeline.joblib"
        joblib.dump(pipe, cls.pipeline_path)
        metadata = {
            "pipeline_version": "test-1",
            "model": "hist_gb",
            "target": "reenters_within_horizon",
            "horizon_days": 365,
            "baselines": {"base_rate": float(y.mean())},
            "raw_input_fields": list(RAW_FIELDS),
            "validation": {"results": []},
        }
        (cls.dir / "orbit_pipeline_metadata.json").write_text(json.dumps(metadata))
        cls.client = TestClient(api_main.app)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in ("ORBIT_PIPELINE_PATH", "ORBIT_METADATA_PATH")}
        os.environ["ORBIT_PIPELINE_PATH"] = str(self.pipeline_path)
        os.environ.pop("ORBIT_METADATA_PATH", None)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def post(self, **overrides):
        body = {**VALID, **overrides}
        body = {k: v for k, v in body.items() if v is not ...}  # `...` removes a field
        return self.client.post("/predict", json=body)


class HealthAndInfoTests(ApiTestCase):
    def test_health_reports_loaded_model(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"status": "ok", "model_loaded": True, "pipeline_version": "test-1"})

    def test_pipeline_info(self):
        r = self.client.get("/pipeline-info")
        self.assertEqual(r.status_code, 200)
        info = r.json()
        self.assertEqual(info["model"], "hist_gb")
        self.assertEqual(info["horizon_days"], 365)
        self.assertEqual(info["raw_input_fields"], list(RAW_FIELDS))
        self.assertIn("perigee_km", info["input_schema"]["properties"])

    def test_health_stays_up_without_artifact(self):
        os.environ["ORBIT_PIPELINE_PATH"] = str(self.dir / "nope.joblib")
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["model_loaded"])

    def test_pipeline_info_503_without_artifact(self):
        os.environ["ORBIT_PIPELINE_PATH"] = str(self.dir / "nope.joblib")
        self.assertEqual(self.client.get("/pipeline-info").status_code, 503)


class PredictTests(ApiTestCase):
    def test_valid_request(self):
        r = self.post()
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(0.0 <= body["probability_reenters_within_365d"] <= 1.0)
        self.assertEqual(body["horizon_days"], 365)
        self.assertFalse(body["out_of_training_range"])
        self.assertEqual(body["out_of_range_fields"], [])
        self.assertEqual(body["imputed_fields"], [])
        self.assertEqual(body["model"], {"name": "hist_gb", "pipeline_version": "test-1"})

    def test_deterministic(self):
        self.assertEqual(self.post().json(), self.post().json())

    def test_lower_orbit_is_not_less_likely_to_fall(self):
        low = self.post(perigee_km=260.0, apogee_km=280.0, perigee_km_30d_ago=290.0, apogee_km_30d_ago=310.0)
        high = self.post(perigee_km=580.0, apogee_km=600.0, perigee_km_30d_ago=580.5, apogee_km_30d_ago=600.5)
        self.assertGreater(
            low.json()["probability_reenters_within_365d"], high.json()["probability_reenters_within_365d"]
        )

    def test_only_required_fields(self):
        body = {k: VALID[k] for k in REQUIRED}
        r = self.client.post("/predict", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        imputed = r.json()["imputed_fields"]
        self.assertEqual(
            sorted(imputed),
            sorted(set(RAW_FIELDS) - set(REQUIRED)),
        )
        self.assertEqual(r.json()["baseline"]["physics"]["status"], "unknown")

    def test_explicit_null_means_missing(self):
        r = self.post(bstar=None, rcs_size=None)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(sorted(r.json()["imputed_fields"]), ["bstar", "rcs_size"])

    def test_enum_case_and_spaces_are_normalised(self):
        r = self.post(object_type=" rocket body ", rcs_size="medium")
        self.assertEqual(r.status_code, 200, r.text)

    def test_out_of_training_range_flag(self):
        r = self.post(f107_adj_mean_81d=400.0)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["out_of_training_range"])
        self.assertIn("f107_adj_mean_81d", body["out_of_range_fields"])

    def test_unseen_object_type_is_flagged_not_rejected(self):
        # TBA is a legal API value but this artifact never saw it.
        r = self.post(object_type="TBA")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("object_type", r.json()["out_of_range_fields"])

    def test_physics_baseline_falling(self):
        body = self.post().json()["baseline"]
        self.assertEqual(body["physics"]["status"], "falling")
        # (410 - 120) km at 0.5 km/day = 580 days: beyond the 365-day horizon.
        self.assertAlmostEqual(body["physics"]["days_to_reentry"], 580.0, places=1)
        self.assertEqual(body["physics"]["reenters_within_365d"], 0)

    def test_physics_baseline_fast_fall_predicts_reentry(self):
        body = self.post(perigee_km=300.0, apogee_km=320.0, perigee_km_30d_ago=330.0, apogee_km_30d_ago=350.0)
        physics = body.json()["baseline"]["physics"]
        self.assertEqual(physics["reenters_within_365d"], 1)

    def test_physics_baseline_not_falling(self):
        body = self.post(perigee_km_30d_ago=405.0, apogee_km_30d_ago=425.0).json()  # rising
        physics = body["baseline"]["physics"]
        self.assertEqual(physics["status"], "not_falling")
        self.assertIsNone(physics["days_to_reentry"])
        self.assertEqual(physics["reenters_within_365d"], 0)

    def test_base_rate_comes_from_metadata(self):
        body = self.post().json()
        meta = json.loads((self.dir / "orbit_pipeline_metadata.json").read_text())
        self.assertAlmostEqual(body["baseline"]["base_rate"], meta["baselines"]["base_rate"], places=5)

    def test_cors_header(self):
        r = self.client.options(
            "/predict",
            headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(r.headers.get("access-control-allow-origin"), "*")


class ValidationTests(ApiTestCase):
    def assert_422(self, response, field=None):
        self.assertEqual(response.status_code, 422, response.text)
        if field:
            self.assertIn(field, json.dumps(response.json()["detail"]))

    def test_each_required_field_is_required(self):
        for field in REQUIRED:
            with self.subTest(field=field):
                self.assert_422(self.post(**{field: ...}), field)

    def test_null_for_required_field(self):
        for field in REQUIRED:
            with self.subTest(field=field):
                self.assert_422(self.post(**{field: None}), field)

    def test_out_of_physical_range(self):
        cases = {
            "perigee_km": [10.0, 5000.0, -1.0],
            "apogee_km": [10.0, 1e6],
            "perigee_km_30d_ago": [10.0, 5000.0],
            "apogee_km_30d_ago": [10.0, 1e6],
            "bstar": [-5.0, 50.0],
            "inclination_deg": [-1.0, 181.0],
            "f107_adj_mean_81d": [0.0, 1000.0],
            "ap_mean_30d": [-1.0, 1000.0],
        }
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    self.assert_422(self.post(**{field: value}), field)

    def test_wrong_types(self):
        for field, value in [("perigee_km", "high"), ("bstar", [1]), ("inclination_deg", {}), ("object_type", 7)]:
            with self.subTest(field=field):
                self.assert_422(self.post(**{field: value}), field)

    def test_nan_and_infinity_rejected(self):
        for value in ("nan", "inf", "-inf", "Infinity"):
            with self.subTest(value=value):
                self.assert_422(self.post(perigee_km=value))

    def test_bad_enums(self):
        self.assert_422(self.post(object_type="PAYLOAD"), "object_type")
        self.assert_422(self.post(rcs_size="HUGE"), "rcs_size")

    def test_perigee_above_apogee(self):
        self.assert_422(self.post(perigee_km=500.0, apogee_km=450.0), "apogee_km")

    def test_earlier_perigee_above_earlier_apogee(self):
        self.assert_422(self.post(perigee_km_30d_ago=500.0, apogee_km_30d_ago=450.0), "30d_ago")

    def test_unknown_field_rejected(self):
        self.assert_422(self.post(perigee=410.0), "perigee")

    def test_non_json_and_empty_bodies(self):
        self.assert_422(self.client.post("/predict", content=b"not json", headers={"content-type": "application/json"}))
        self.assert_422(self.client.post("/predict", json={}))
        self.assert_422(self.client.post("/predict", json=[VALID]))

    def test_validation_errors_do_not_need_a_model(self):
        # 422 wins over 503: a bad request is the caller's problem whatever the artifact state.
        os.environ["ORBIT_PIPELINE_PATH"] = str(self.dir / "nope.joblib")
        self.assert_422(self.post(perigee_km=-5.0))


class ArtifactTests(ApiTestCase):
    def test_missing_artifact_gives_503(self):
        os.environ["ORBIT_PIPELINE_PATH"] = str(self.dir / "nope.joblib")
        r = self.post()
        self.assertEqual(r.status_code, 503)
        self.assertIn("not found", r.json()["detail"])

    def test_corrupt_artifact_gives_503(self):
        bad = self.dir / "corrupt.joblib"
        bad.write_bytes(b"this is not a joblib file")
        os.environ["ORBIT_PIPELINE_PATH"] = str(bad)
        r = self.post()
        self.assertEqual(r.status_code, 503)
        self.assertIn("could not be loaded", r.json()["detail"])

    def test_recovers_when_artifact_appears(self):
        missing = self.dir / "later.joblib"
        os.environ["ORBIT_PIPELINE_PATH"] = str(missing)
        self.assertEqual(self.post().status_code, 503)
        missing.write_bytes(self.pipeline_path.read_bytes())
        self.assertEqual(self.post().status_code, 200)

    def test_missing_metadata_still_serves(self):
        alone = self.dir / "alone" / "orbit_pipeline.joblib"
        alone.parent.mkdir(exist_ok=True)
        alone.write_bytes(self.pipeline_path.read_bytes())
        os.environ["ORBIT_PIPELINE_PATH"] = str(alone)
        r = self.post()
        self.assertEqual(r.status_code, 200, r.text)

    def test_metadata_path_override(self):
        other = self.dir / "other_meta.json"
        other.write_text(json.dumps({"pipeline_version": "override", "model": "x", "baselines": {"base_rate": 0.5}}))
        os.environ["ORBIT_METADATA_PATH"] = str(other)
        self.assertEqual(self.client.get("/health").json()["pipeline_version"], "override")


if __name__ == "__main__":
    unittest.main()
