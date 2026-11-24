"""Tests for features.transformers.OrbitFeatureBuilder.

Run from the repo root:

    uv run python -m unittest discover -s tests -v
"""
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sklearn.base import clone  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402

from features import transformers as t  # noqa: E402


def training_frame(n: int = 400, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    perigee = rng.uniform(300, 580, n)
    apogee = perigee + rng.uniform(0, 200, n)
    return pd.DataFrame(
        {
            "perigee_km": perigee,
            "apogee_km": apogee,
            "perigee_km_30d_ago": perigee + rng.uniform(0, 20, n),
            "apogee_km_30d_ago": apogee + rng.uniform(0, 20, n),
            "bstar": rng.uniform(1e-5, 1e-3, n),
            "inclination_deg": rng.uniform(50, 100, n),
            "f107_adj_mean_81d": rng.uniform(70, 200, n),
            "ap_mean_30d": rng.uniform(4, 20, n),
            "object_type": rng.choice(["DEBRIS", "ROCKET BODY"], n),
            "rcs_size": rng.choice(["SMALL", "MEDIUM", "LARGE"], n),
        }
    )


def one_row(**overrides) -> pd.DataFrame:
    row = {
        "perigee_km": 410.0,
        "apogee_km": 430.0,
        "perigee_km_30d_ago": 425.0,
        "apogee_km_30d_ago": 445.0,
        "bstar": 0.0002,
        "inclination_deg": 70.0,
        "f107_adj_mean_81d": 150.0,
        "ap_mean_30d": 10.0,
        "object_type": "DEBRIS",
        "rcs_size": "SMALL",
    }
    row.update(overrides)
    return pd.DataFrame([row])


class DerivedFeatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = t.OrbitFeatureBuilder().fit(training_frame())

    def test_hand_checked_example(self):
        out = self.builder.transform(one_row()).iloc[0]
        self.assertAlmostEqual(out["perigee_descent_km_per_day"], (410 - 425) / 30)
        self.assertAlmostEqual(out["apogee_descent_km_per_day"], (430 - 445) / 30)
        self.assertAlmostEqual(out["mean_alt_km"], 420.0)
        self.assertAlmostEqual(out["eccentricity"], 20 / (410 + 430 + 2 * t.EARTH_RADIUS_KM))
        self.assertAlmostEqual(out["drag_x_solar"], 0.0002 * 150.0)
        self.assertEqual(out["altitude_band"], 4)  # 400 <= 410 < 450 is the fifth band
        self.assertEqual(out["history_missing"], 0)
        self.assertEqual(out[t.FLAG_COLUMN], 0)

    def test_altitude_band_edges(self):
        for perigee, band in [(100, 0), (249.9, 0), (250, 1), (399.9, 3), (400, 4), (599.9, 7), (600, 8), (900, 8)]:
            row = one_row(perigee_km=perigee, apogee_km=perigee + 10)
            self.assertEqual(self.builder.transform(row).iloc[0]["altitude_band"], band, perigee)

    def test_output_columns_and_order(self):
        out = self.builder.transform(one_row())
        self.assertEqual(list(out.columns), list(t.OUTPUT_COLUMNS))
        self.assertEqual(list(self.builder.get_feature_names_out()), list(t.OUTPUT_COLUMNS))

    def test_eccentricity_never_negative(self):
        # A caller bug (apogee below perigee) must not produce a negative eccentricity.
        out = self.builder.transform(one_row(perigee_km=500.0, apogee_km=490.0)).iloc[0]
        self.assertEqual(out["eccentricity"], 0.0)

    def test_categories_are_normalised(self):
        out = self.builder.transform(one_row(object_type=" debris ", rcs_size="small")).iloc[0]
        self.assertEqual(out["object_type"], "DEBRIS")
        self.assertEqual(out["rcs_size"], "SMALL")
        self.assertEqual(out[t.FLAG_COLUMN], 0)

    def test_does_not_mutate_input(self):
        frame = one_row()
        before = frame.copy()
        self.builder.transform(frame)
        pd.testing.assert_frame_equal(frame, before)

    def test_accepts_records_and_dicts(self):
        record = one_row().iloc[0].to_dict()
        from_records = self.builder.transform([record])
        from_frame = self.builder.transform(one_row())
        pd.testing.assert_frame_equal(from_records, from_frame)

    def test_missing_column_is_an_error(self):
        with self.assertRaises(ValueError):
            self.builder.transform(one_row().drop(columns=["bstar"]))


class MissingValueTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frame = training_frame()
        cls.builder = t.OrbitFeatureBuilder().fit(cls.frame)

    def test_missing_history_is_imputed_and_marked(self):
        row = one_row(perigee_km_30d_ago=np.nan, apogee_km_30d_ago=np.nan)
        out = self.builder.transform(row).iloc[0]
        self.assertEqual(out["history_missing"], 1)
        self.assertEqual(
            out["perigee_descent_km_per_day"], self.builder.numeric_medians_["perigee_descent_km_per_day"]
        )
        self.assertEqual(out[t.FLAG_COLUMN], 0, "an imputed value must never trigger the range flag")

    def test_one_missing_history_field_marks_it_missing(self):
        out = self.builder.transform(one_row(apogee_km_30d_ago=np.nan)).iloc[0]
        self.assertEqual(out["history_missing"], 1)

    def test_none_is_treated_as_missing(self):
        out = self.builder.transform(one_row(bstar=None, rcs_size=None)).iloc[0]
        self.assertEqual(out["bstar"], self.builder.numeric_medians_["bstar"])
        self.assertEqual(out["rcs_size"], self.builder.categorical_modes_["rcs_size"])
        self.assertFalse(out.isna().any())

    def test_no_nans_in_output(self):
        blank = one_row()
        for c in t.NUMERIC_RAW + t.CATEGORICAL_RAW:
            blank[c] = np.nan
        out = self.builder.transform(blank)
        self.assertFalse(out.isna().any().any())

    def test_medians_come_from_training_only(self):
        rate = (self.frame["perigee_km"] - self.frame["perigee_km_30d_ago"]) / t.WINDOW_DAYS
        self.assertAlmostEqual(
            self.builder.numeric_medians_["perigee_descent_km_per_day"], float(rate.median())
        )


class RangeFlagTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.builder = t.OrbitFeatureBuilder().fit(training_frame())

    def test_in_range_row_is_not_flagged(self):
        self.assertEqual(self.builder.transform(one_row()).iloc[0][t.FLAG_COLUMN], 0)
        self.assertEqual(self.builder.out_of_range_features(one_row()), [[]])

    def test_extreme_solar_activity_is_flagged(self):
        row = one_row(f107_adj_mean_81d=400.0)
        self.assertEqual(self.builder.transform(row).iloc[0][t.FLAG_COLUMN], 1)
        flagged = self.builder.out_of_range_features(row)[0]
        self.assertIn("f107_adj_mean_81d", flagged)
        # Only the field that is actually out of range is named: the drag x solar
        # product (0.0002 * 400) is still inside what training saw.
        self.assertNotIn("drag_x_solar", flagged)

    def test_extreme_altitude_is_flagged(self):
        flagged = self.builder.out_of_range_features(one_row(perigee_km=900.0, apogee_km=950.0))[0]
        self.assertIn("perigee_km", flagged)

    def test_unseen_category_is_flagged(self):
        row = one_row(object_type="PAYLOAD")
        out = self.builder.transform(row).iloc[0]
        self.assertEqual(out[t.FLAG_COLUMN], 1)
        self.assertEqual(out["object_type"], t.UNSEEN_CATEGORY)
        self.assertIn("object_type", self.builder.out_of_range_features(row)[0])

    def test_ranges_are_quantile_bounds_not_outliers(self):
        frame = training_frame(5000)
        frame.loc[0, "bstar"] = 5.0  # one corrupt element set among 5,000
        builder = t.OrbitFeatureBuilder().fit(frame)
        self.assertLess(builder.feature_ranges_["bstar"][1], 0.01)

    def test_rows_are_flagged_independently(self):
        rows = pd.concat([one_row(), one_row(f107_adj_mean_81d=400.0), one_row()], ignore_index=True)
        self.assertEqual(list(self.builder.transform(rows)[t.FLAG_COLUMN]), [0, 1, 0])


class SklearnContractTests(unittest.TestCase):
    def test_unfitted_transform_raises(self):
        from sklearn.exceptions import NotFittedError

        with self.assertRaises(NotFittedError):
            t.OrbitFeatureBuilder().transform(one_row())

    def test_clone_and_params(self):
        builder = t.OrbitFeatureBuilder(range_quantiles=(0.01, 0.99))
        self.assertEqual(clone(builder).range_quantiles, (0.01, 0.99))

    def test_invalid_quantiles_rejected(self):
        with self.assertRaises(ValueError):
            t.OrbitFeatureBuilder(range_quantiles=(0.9, 0.1)).fit(training_frame())

    def test_works_as_a_pipeline_step(self):
        from sklearn.compose import ColumnTransformer
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import OneHotEncoder

        frame = training_frame()
        y = (frame["perigee_km"] < 420).astype(int)
        prep = ColumnTransformer(
            [
                ("num", "passthrough", list(t.NUMERIC_FEATURES)),
                ("cat", OneHotEncoder(handle_unknown="ignore"), list(t.CATEGORICAL_FEATURES)),
            ]
        )
        pipe = Pipeline(
            [("features", t.OrbitFeatureBuilder()), ("prep", prep), ("model", LogisticRegression(max_iter=2000))]
        ).fit(frame, y)
        proba = pipe.predict_proba(one_row())
        self.assertEqual(proba.shape, (1, 2))

    def test_describe_is_json_serialisable(self):
        import json

        info = t.OrbitFeatureBuilder().fit(training_frame()).describe()
        json.dumps(info)
        self.assertIn("perigee_km", info["feature_ranges"])


class TrainServeConsistencyTests(unittest.TestCase):
    def test_row_by_row_equals_batch(self):
        frame = training_frame(50, seed=3)
        builder = t.OrbitFeatureBuilder().fit(training_frame())
        batch = builder.transform(frame).reset_index(drop=True)
        single = pd.concat([builder.transform(frame.iloc[[i]]) for i in range(len(frame))], ignore_index=True)
        pd.testing.assert_frame_equal(batch, single)


if __name__ == "__main__":
    unittest.main()
