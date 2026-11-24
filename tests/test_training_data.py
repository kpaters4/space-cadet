"""Tests for features/training_data.py and the fit script's helpers.

Run from the repo root:

    uv run python -m unittest discover -s tests -v

Everything here uses tiny hand-built tables, so each expected value can be checked
by eye. The point is the no-peeking rules: "30 days ago" must come from element sets
at or before that date, stale element sets must not be used, and test rows must
never leave the reader.
"""
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "src" / "Models"))

import fit_serving_pipeline as fit  # noqa: E402
from features import training_data as td  # noqa: E402
from features.transformers import RAW_FIELDS  # noqa: E402


def gp_table() -> pd.DataFrame:
    """Object 1: element sets on Jan 1, Feb 5 and Mar 1 (perigee falling). Object 2: one stale set."""
    rows = [
        (1, "2020-01-01", 500.0, 520.0),
        (1, "2020-02-05", 490.0, 510.0),
        (1, "2020-03-01", 470.0, 490.0),
        (2, "2019-06-01", 400.0, 410.0),
    ]
    return pd.DataFrame(
        {
            "norad_cat_id": [r[0] for r in rows],
            "epoch": pd.to_datetime([r[1] for r in rows]),
            "perigee_km": [r[2] for r in rows],
            "apogee_km": [r[3] for r in rows],
        }
    )


class OrbitDaysAgoTests(unittest.TestCase):
    def test_picks_element_set_in_force_30_days_earlier(self):
        panel = pd.DataFrame({"norad_cat_id": [1], "obs_date": pd.to_datetime(["2020-03-02"])})
        ago = td.orbit_days_ago(panel, gp_table())
        # 30 days before Mar 2 is Feb 1; the set in force then is Jan 1's (31 days old -> stale!).
        self.assertTrue(np.isnan(ago["perigee_km_30d_ago"].iloc[0]))

    def test_uses_latest_set_at_or_before_the_earlier_date(self):
        panel = pd.DataFrame({"norad_cat_id": [1], "obs_date": pd.to_datetime(["2020-03-06"])})
        ago = td.orbit_days_ago(panel, gp_table())
        # 30 days before Mar 6 (2020 is a leap year) is Feb 5, exactly Feb 5's epoch.
        self.assertEqual(ago["perigee_km_30d_ago"].iloc[0], 490.0)
        self.assertEqual(ago["apogee_km_30d_ago"].iloc[0], 510.0)

    def test_never_uses_a_set_from_after_the_earlier_date(self):
        # Snapshot Mar 10 -> earlier date Feb 9. Feb 5 is 4 days old and fine; Mar 1 is the future.
        panel = pd.DataFrame({"norad_cat_id": [1], "obs_date": pd.to_datetime(["2020-03-10"])})
        ago = td.orbit_days_ago(panel, gp_table())
        self.assertEqual(ago["perigee_km_30d_ago"].iloc[0], 490.0)

    def test_stale_sets_are_dropped_like_the_snapshot_itself(self):
        panel = pd.DataFrame({"norad_cat_id": [2], "obs_date": pd.to_datetime(["2019-08-01"])})
        ago = td.orbit_days_ago(panel, gp_table())
        self.assertTrue(np.isnan(ago["perigee_km_30d_ago"].iloc[0]))

    def test_objects_do_not_borrow_each_others_history(self):
        panel = pd.DataFrame({"norad_cat_id": [2], "obs_date": pd.to_datetime(["2020-03-06"])})
        ago = td.orbit_days_ago(panel, gp_table())
        self.assertTrue(np.isnan(ago["perigee_km_30d_ago"].iloc[0]))

    def test_alignment_with_unsorted_panel(self):
        panel = pd.DataFrame(
            {
                "norad_cat_id": [1, 2, 1],
                "obs_date": pd.to_datetime(["2020-03-10", "2019-06-20", "2020-03-06"]),
            },
            index=[10, 11, 12],
        )
        ago = td.orbit_days_ago(panel, gp_table())
        self.assertEqual(list(ago.index), [10, 11, 12])
        self.assertEqual(ago.loc[10, "perigee_km_30d_ago"], 490.0)
        self.assertEqual(ago.loc[12, "perigee_km_30d_ago"], 490.0)


class ApMeanTests(unittest.TestCase):
    def test_trailing_mean_with_min_observations(self):
        dates = pd.date_range("2020-01-01", periods=40, freq="D")
        daily = pd.DataFrame({"date": dates, "ap_avg": np.arange(40, dtype=float)})
        ap30 = td.ap_mean_30d_by_date(daily)
        self.assertTrue(np.isnan(ap30.iloc[22]))  # 23 days < the 24 required (80% of 30)
        self.assertAlmostEqual(ap30.iloc[23], np.mean(np.arange(24)))
        self.assertAlmostEqual(ap30.iloc[39], np.mean(np.arange(10, 40)))  # window ends on the day itself


class ServingFrameTests(unittest.TestCase):
    def panel(self) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "norad_cat_id": [1],
                "obs_date": pd.to_datetime(["2020-03-06"]),
                "sw_asof_date": pd.to_datetime(["2020-03-05"]),
                "split": ["train"],
                "reenters_within_horizon": [1],
                "perigee_km_asof": [470.0],
                "apogee_km_asof": [490.0],
                "bstar": [0.0003],
                "inclination_deg_asof": [82.0],
                "f107_adj_mean_81d": [140.0],
                "object_type": ["R/B"],
                "rcs_size": ["large"],
            }
        )

    def test_columns_and_mapping(self):
        daily = pd.DataFrame(
            {"date": pd.date_range("2020-01-01", periods=80, freq="D"), "ap_avg": np.full(80, 12.0)}
        )
        out = td.build_serving_frame(self.panel(), gp_table(), daily)
        self.assertEqual(list(out.columns[: len(RAW_FIELDS)]), list(RAW_FIELDS))
        row = out.iloc[0]
        self.assertEqual(row["perigee_km"], 470.0)
        self.assertEqual(row["perigee_km_30d_ago"], 490.0)
        self.assertEqual(row["apogee_km_30d_ago"], 510.0)
        self.assertEqual(row["object_type"], "ROCKET BODY")  # R/B alias folded
        self.assertEqual(row["rcs_size"], "LARGE")
        self.assertEqual(row["ap_mean_30d"], 12.0)
        self.assertEqual(row["reenters_within_horizon"], 1)

    def test_space_weather_is_taken_from_the_day_before(self):
        # Ap jumps on the snapshot day itself; the feature must not see it.
        dates = pd.date_range("2020-01-01", periods=80, freq="D")
        ap = np.full(80, 10.0)
        ap[dates.get_loc(pd.Timestamp("2020-03-06")) :] = 300.0
        out = td.build_serving_frame(self.panel(), gp_table(), pd.DataFrame({"date": dates, "ap_avg": ap}))
        self.assertEqual(out.iloc[0]["ap_mean_30d"], 10.0)


class ReadTrainValidTests(unittest.TestCase):
    def test_test_rows_never_leave_the_reader(self):
        df = pd.DataFrame(
            {
                "norad_cat_id": [1, 2, 3, 4],
                "obs_date": ["2020-01-01", "2022-01-01", "2024-02-01", "2024-03-01"],
                "split": ["train", "valid", "test", " TEST "],
                "secret_feature": [1, 2, 3, 4],
            }
        )
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "panel.csv"
            df.to_csv(path, index=False)
            out, counts = td.read_train_valid(path, chunksize=2)
        self.assertEqual(sorted(out["split"].unique()), ["train", "valid"])
        self.assertNotIn(3, out["norad_cat_id"].tolist())
        self.assertNotIn(4, out["norad_cat_id"].tolist())
        self.assertEqual(counts["test_rows_skipped_unread"], 2)
        self.assertEqual(counts["test_objects_skipped_unread"], 2)
        self.assertEqual((counts["train_rows"], counts["valid_rows"]), (1, 1))


class MetricTests(unittest.TestCase):
    def test_recall_at_far(self):
        y = np.array([0] * 90 + [1] * 10)
        perfect = np.r_[np.zeros(90), np.ones(10)]
        self.assertEqual(fit.recall_at_far(y, perfect, 0.10), 1.0)
        # A constant score carries no signal: recall equals the false-alarm rate.
        self.assertAlmostEqual(fit.recall_at_far(y, np.zeros(100), 0.10), 0.10)

    def test_recall_at_far_needs_both_classes(self):
        self.assertTrue(np.isnan(fit.recall_at_far(np.zeros(5), np.linspace(0, 1, 5))))

    def test_metric_row_known_values(self):
        y = np.array([0, 0, 1, 1])
        p = np.array([0.1, 0.2, 0.8, 0.9])
        m = fit.metric_row(y, p)
        self.assertEqual(m["pr_auc"], 1.0)
        self.assertEqual(m["roc_auc"], 1.0)
        self.assertAlmostEqual(m["brier"], np.mean([0.01, 0.04, 0.04, 0.01]))

    def test_bootstrap_resamples_objects_and_is_reproducible(self):
        rng = np.random.default_rng(0)
        objects = np.repeat(np.arange(30), 5)
        y = np.repeat(rng.integers(0, 2, 30), 5)
        p = np.clip(y * 0.6 + rng.uniform(0, 0.4, 150), 0, 1)
        a = fit.bootstrap_by_object(y, p, objects, n=60, seed=3)
        b = fit.bootstrap_by_object(y, p, objects, n=60, seed=3)
        self.assertEqual(a, b)
        lo, hi = a["pr_auc"]
        self.assertLessEqual(lo, hi)

    def test_calibration_table_counts_add_up(self):
        rng = np.random.default_rng(1)
        p = rng.uniform(0, 1, 205)
        y = (rng.uniform(0, 1, 205) < p).astype(int)
        table = fit.calibration_table(y, p, bins=10)
        self.assertEqual(sum(r["n"] for r in table), 205)
        self.assertEqual(len(table), 10)

    def test_selection_rule_picks_best_valid_pr_auc_among_servable(self):
        table = pd.DataFrame(
            {
                "model": ["base_rate", "logistic", "hist_gb", "hist_gb_full_panel"],
                "pr_auc": [0.3, 0.80, 0.90, 0.99],
            }
        )
        # The reference model scores highest but must never be selected.
        self.assertEqual(fit.select_serving_model(table), "hist_gb")


class PipelineStructureTests(unittest.TestCase):
    def test_flag_column_is_not_a_model_feature(self):
        rng = np.random.default_rng(0)
        n = 300
        perigee = rng.uniform(300, 580, n)
        X = pd.DataFrame(
            {
                "perigee_km": perigee,
                "apogee_km": perigee + 20,
                "perigee_km_30d_ago": perigee + rng.uniform(0, 10, n),
                "apogee_km_30d_ago": perigee + 20 + rng.uniform(0, 10, n),
                "bstar": rng.uniform(1e-5, 1e-3, n),
                "inclination_deg": rng.uniform(50, 100, n),
                "f107_adj_mean_81d": rng.uniform(70, 200, n),
                "ap_mean_30d": rng.uniform(4, 20, n),
                "object_type": rng.choice(["DEBRIS", "ROCKET BODY"], n),
                "rcs_size": rng.choice(["SMALL", "LARGE"], n),
            }
        )
        y = (perigee < 420).astype(int)
        for kind in fit.SERVING_CANDIDATES:
            with self.subTest(kind=kind):
                pipe = fit.make_serving_pipeline(kind).fit(X, y)
                names = pipe.named_steps["prep"].get_feature_names_out()
                self.assertFalse(any("out_of_training_range" in str(n) for n in names))
                self.assertEqual(pipe.predict_proba(X.head(3)).shape, (3, 2))

    def test_unknown_model_kind_rejected(self):
        with self.assertRaises(ValueError):
            fit.make_serving_pipeline("mlp")


if __name__ == "__main__":
    unittest.main()
