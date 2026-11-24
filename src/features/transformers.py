"""Custom scikit-learn transformer shared by training and the prediction API.

``OrbitFeatureBuilder`` is the first step of the serving pipeline. It takes the
raw fields the API receives (see ``RAW_FIELDS``) and turns them into the
columns the model learned from, so training and serving run the very same
feature code and cannot drift apart.

What ``transform`` computes
---------------------------
* mean altitude and eccentricity, from perigee and apogee altitude;
* perigee and apogee descent rates (km/day) over the last ``WINDOW_DAYS`` days;
* a drag x solar interaction (BSTAR times the F10.7 81-day mean);
* an altitude band (index into ``ALTITUDE_BAND_EDGES_KM``);
* ``history_missing``: 1 when the "30 days ago" values were not supplied, so the
  model can tell a measured descent rate from an imputed one;
* ``out_of_training_range``: 1 when any supplied value falls outside the range
  seen in training (the game uses it to warn in extreme what-if settings).

What ``fit`` learns (training data only)
----------------------------------------
* the median of every numeric feature, used to impute fields the caller left out;
* the most frequent value of each categorical field, used the same way;
* the training range of every continuous feature (the ``range_quantiles`` bounds,
  0.1%-99.9% by default, so one corrupt element set cannot widen the range);
* the set of categories seen for each categorical field.

Only values the caller actually supplied can trigger the range flag: an imputed
median is by construction in range.
"""
from __future__ import annotations

from typing import Sequence

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.utils.validation import check_is_fitted

EARTH_RADIUS_KM = 6378.137  # same constant as src/build_dataset.py

# Span between "now" and the earlier reading, in days. Training builds the earlier
# reading as the element set in force on (snapshot date - WINDOW_DAYS).
WINDOW_DAYS = 30

# The raw fields the API receives, in a fixed order.
NUMERIC_RAW: tuple[str, ...] = (
    "perigee_km",
    "apogee_km",
    "perigee_km_30d_ago",
    "apogee_km_30d_ago",
    "bstar",
    "inclination_deg",
    "f107_adj_mean_81d",
    "ap_mean_30d",
)
CATEGORICAL_RAW: tuple[str, ...] = ("object_type", "rcs_size")
RAW_FIELDS: tuple[str, ...] = NUMERIC_RAW + CATEGORICAL_RAW

# Perigee altitude bands (km). Decay is strongly non-linear in altitude, so the
# band is a feature in its own right. The last band is open-ended.
ALTITUDE_BAND_EDGES_KM: tuple[float, ...] = (250, 300, 350, 400, 450, 500, 550, 600)

# Engineered numeric features, in the order they are emitted.
NUMERIC_FEATURES: tuple[str, ...] = (
    "perigee_km",
    "apogee_km",
    "mean_alt_km",
    "eccentricity",
    "perigee_descent_km_per_day",
    "apogee_descent_km_per_day",
    "history_missing",
    "bstar",
    "inclination_deg",
    "f107_adj_mean_81d",
    "ap_mean_30d",
    "drag_x_solar",
    "altitude_band",
)
CATEGORICAL_FEATURES: tuple[str, ...] = CATEGORICAL_RAW
FLAG_COLUMN = "out_of_training_range"
OUTPUT_COLUMNS: tuple[str, ...] = NUMERIC_FEATURES + CATEGORICAL_FEATURES + (FLAG_COLUMN,)

# Features whose training range is checked (continuous ones; the band, the
# missing-history indicator and the categoricals are not ranges).
RANGE_CHECKED: tuple[str, ...] = (
    "perigee_km",
    "apogee_km",
    "mean_alt_km",
    "eccentricity",
    "perigee_descent_km_per_day",
    "apogee_descent_km_per_day",
    "bstar",
    "inclination_deg",
    "f107_adj_mean_81d",
    "ap_mean_30d",
    "drag_x_solar",
)

# Placeholder used when a categorical value was never seen in training.
UNSEEN_CATEGORY = "UNSEEN"


class OrbitFeatureBuilder(BaseEstimator, TransformerMixin):
    """Raw orbit/space-weather fields in, model features plus a range flag out."""

    def __init__(self, range_quantiles: tuple[float, float] = (0.001, 0.999)):
        self.range_quantiles = range_quantiles

    # ------------------------------------------------------------------ #
    # helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _as_frame(X) -> pd.DataFrame:
        """Accept a DataFrame, a dict of columns, or a list of record dicts."""
        if isinstance(X, pd.DataFrame):
            frame = X
        elif isinstance(X, dict):
            frame = pd.DataFrame(X)
        else:
            frame = pd.DataFrame(list(X))
        missing = [c for c in RAW_FIELDS if c not in frame.columns]
        if missing:
            raise ValueError(f"missing input column(s): {missing}")
        return frame

    @staticmethod
    def _derive(frame: pd.DataFrame) -> pd.DataFrame:
        """Compute every engineered column from the raw fields. NaN stays NaN."""
        num = frame[list(NUMERIC_RAW)].apply(pd.to_numeric, errors="coerce")
        out = pd.DataFrame(index=frame.index)

        perigee, apogee = num["perigee_km"], num["apogee_km"]
        out["perigee_km"] = perigee
        out["apogee_km"] = apogee
        out["mean_alt_km"] = (perigee + apogee) / 2
        # e = (ra - rp) / (ra + rp), with radii measured from Earth's centre.
        denom = perigee + apogee + 2 * EARTH_RADIUS_KM
        out["eccentricity"] = ((apogee - perigee) / denom).clip(lower=0)

        out["perigee_descent_km_per_day"] = (perigee - num["perigee_km_30d_ago"]) / WINDOW_DAYS
        out["apogee_descent_km_per_day"] = (apogee - num["apogee_km_30d_ago"]) / WINDOW_DAYS
        out["history_missing"] = (
            num["perigee_km_30d_ago"].isna() | num["apogee_km_30d_ago"].isna()
        ).astype(float)

        out["bstar"] = num["bstar"]
        out["inclination_deg"] = num["inclination_deg"]
        out["f107_adj_mean_81d"] = num["f107_adj_mean_81d"]
        out["ap_mean_30d"] = num["ap_mean_30d"]
        out["drag_x_solar"] = num["bstar"] * num["f107_adj_mean_81d"]

        band = np.digitize(perigee.to_numpy(dtype=float), ALTITUDE_BAND_EDGES_KM).astype(float)
        band[np.isnan(perigee.to_numpy(dtype=float))] = np.nan
        out["altitude_band"] = band
        return out

    @staticmethod
    def _clean_categories(frame: pd.DataFrame) -> pd.DataFrame:
        cats = frame[list(CATEGORICAL_RAW)].astype("object")
        cats = cats.apply(lambda s: s.astype("string").str.strip().str.upper())
        return cats.astype("object").where(cats.notna(), np.nan)

    # ------------------------------------------------------------------ #
    # sklearn API
    # ------------------------------------------------------------------ #
    def fit(self, X, y=None):
        frame = self._as_frame(X)
        lo_q, hi_q = self.range_quantiles
        if not 0.0 <= lo_q < hi_q <= 1.0:
            raise ValueError(f"range_quantiles must satisfy 0 <= lo < hi <= 1, got {self.range_quantiles}")

        derived = self._derive(frame)
        cats = self._clean_categories(frame)
        if len(frame) == 0:
            raise ValueError("cannot fit on an empty frame")

        self.numeric_medians_ = {
            c: float(derived[c].median()) for c in NUMERIC_FEATURES if derived[c].notna().any()
        }
        absent = [c for c in NUMERIC_FEATURES if c not in self.numeric_medians_]
        if absent:
            raise ValueError(f"no training values for numeric feature(s): {absent}")

        self.categorical_modes_ = {}
        self.categories_seen_ = {}
        for c in CATEGORICAL_FEATURES:
            vals = cats[c].dropna()
            if vals.empty:
                raise ValueError(f"no training values for categorical feature {c!r}")
            self.categorical_modes_[c] = str(vals.mode().iloc[0])
            self.categories_seen_[c] = sorted(str(v) for v in vals.unique())

        self.feature_ranges_ = {}
        for c in RANGE_CHECKED:
            col = derived[c].dropna()
            self.feature_ranges_[c] = (float(col.quantile(lo_q)), float(col.quantile(hi_q)))

        self.n_training_rows_ = int(len(frame))
        self.feature_names_in_ = np.array(RAW_FIELDS, dtype=object)
        return self

    def _transform_parts(self, X):
        check_is_fitted(self, ["numeric_medians_", "feature_ranges_", "categorical_modes_"])
        frame = self._as_frame(X)
        derived = self._derive(frame)
        cats = self._clean_categories(frame)

        # Which supplied values fall outside the training range?
        outside = pd.DataFrame(False, index=frame.index, columns=list(RANGE_CHECKED))
        for c, (lo, hi) in self.feature_ranges_.items():
            v = derived[c]
            outside[c] = v.notna() & ((v < lo) | (v > hi))
        for c in CATEGORICAL_FEATURES:
            seen = set(self.categories_seen_[c])
            unseen = cats[c].notna() & ~cats[c].isin(seen)
            outside[c] = unseen
            cats[c] = cats[c].where(~unseen, UNSEEN_CATEGORY)

        # Impute whatever the caller left out.
        for c, med in self.numeric_medians_.items():
            derived[c] = derived[c].fillna(med)
        for c, mode in self.categorical_modes_.items():
            cats[c] = cats[c].fillna(mode)
        # The band is a function of perigee; recompute it if perigee was imputed.
        derived["altitude_band"] = np.digitize(
            derived["perigee_km"].to_numpy(dtype=float), ALTITUDE_BAND_EDGES_KM
        ).astype(float)

        return derived, cats, outside

    def transform(self, X) -> pd.DataFrame:
        derived, cats, outside = self._transform_parts(X)
        out = pd.concat([derived[list(NUMERIC_FEATURES)], cats[list(CATEGORICAL_FEATURES)]], axis=1)
        out[FLAG_COLUMN] = outside.any(axis=1).astype(int)
        return out[list(OUTPUT_COLUMNS)]

    def out_of_range_features(self, X) -> list[list[str]]:
        """For each row, the names of the supplied fields outside the training range."""
        _, _, outside = self._transform_parts(X)
        return [list(outside.columns[row]) for row in outside.to_numpy()]

    def get_feature_names_out(self, input_features: Sequence[str] | None = None):
        return np.array(OUTPUT_COLUMNS, dtype=object)

    def describe(self) -> dict:
        """JSON-friendly summary of what ``fit`` learned (for /pipeline-info)."""
        check_is_fitted(self, ["numeric_medians_", "feature_ranges_"])
        return {
            "window_days": WINDOW_DAYS,
            "altitude_band_edges_km": list(ALTITUDE_BAND_EDGES_KM),
            "range_quantiles": list(self.range_quantiles),
            "n_training_rows": self.n_training_rows_,
            "numeric_medians": self.numeric_medians_,
            "categorical_modes": self.categorical_modes_,
            "categories_seen": self.categories_seen_,
            "feature_ranges": {k: list(v) for k, v in self.feature_ranges_.items()},
        }
