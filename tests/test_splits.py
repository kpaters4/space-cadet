"""Tests for the object-to-split rule in src/build_dataset.py.

Run from the repo root (no extra packages needed beyond pandas):

    python3 -m unittest discover -s tests -v

The expected splits below were computed independently from the reference rule
(first byte of SHA-256("20261021:<id>") % 100, cut at 70 and 85), the rule the
D3 panel was built with. If one of these fails, objects are landing in different
splits than the panel the results were computed on, so every result would need
rerunning.
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import build_dataset as bd  # noqa: E402

GOLDEN = {
    "train": [25544, 43013, 48274, 49044],
    "valid": [2, 21, 24, 25],
    "test": [35174, 3, 8, 9],
}


class SplitRuleTests(unittest.TestCase):
    def test_golden_ids_match_the_reference_rule(self):
        for expected, ids in GOLDEN.items():
            for norad_id in ids:
                self.assertEqual(bd.split_of_id(norad_id), expected, f"object {norad_id}")

    def test_assignment_depends_only_on_the_id(self):
        ids = pd.Series(range(1, 2001))
        forward = bd.assign_object_splits(ids)
        shuffled = ids.sample(frac=1.0, random_state=7)
        back = bd.assign_object_splits(shuffled).reindex(shuffled.index)
        self.assertTrue((forward.loc[shuffled.index] == back).all())
        # adding objects never reshuffles existing ones
        more = bd.assign_object_splits(pd.Series(range(1, 4001)))
        self.assertTrue((more.iloc[:2000].to_numpy() == forward.to_numpy()).all())

    def test_documented_shares(self):
        """The real shares are 196/256, 30/256, 30/256 (modulo bias), NOT 70/15/15.
        This fails loudly if someone 'fixes' the rule without rerunning results."""
        split = bd.assign_object_splits(pd.Series(range(1, 50001)))
        share = split.value_counts(normalize=True)
        self.assertAlmostEqual(share["train"], 196 / 256, delta=0.01)
        self.assertAlmostEqual(share["valid"], 30 / 256, delta=0.01)
        self.assertAlmostEqual(share["test"], 30 / 256, delta=0.01)

    def test_every_id_gets_exactly_one_known_split(self):
        split = bd.assign_object_splits(pd.Series(range(1, 1001)))
        self.assertEqual(set(split.unique()), {"train", "valid", "test"})


class SplitWindowTests(unittest.TestCase):
    def test_gap_years_belong_to_no_split(self):
        for year in (2021, 2023):
            dates = pd.Series(pd.to_datetime([f"{year}-06-01"] * 3))
            for name in ("train", "valid", "test"):
                kept = bd.in_split_window(pd.Series([name] * 3), dates)
                self.assertFalse(kept.any(), f"{name} should not keep {year}")

    def test_windows_match_the_plan(self):
        d = lambda y: pd.Series(pd.to_datetime([f"{y}-01-01"]))
        self.assertTrue(bd.in_split_window(pd.Series(["train"]), d(2015)).iloc[0])
        self.assertTrue(bd.in_split_window(pd.Series(["train"]), d(2020)).iloc[0])
        self.assertFalse(bd.in_split_window(pd.Series(["train"]), d(2022)).iloc[0])
        self.assertTrue(bd.in_split_window(pd.Series(["valid"]), d(2022)).iloc[0])
        self.assertTrue(bd.in_split_window(pd.Series(["test"]), d(2024)).iloc[0])
        self.assertFalse(bd.in_split_window(pd.Series(["test"]), d(2022)).iloc[0])


if __name__ == "__main__":
    unittest.main()
