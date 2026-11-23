"""Custom scikit-learn transformer for the Space Cadet reentry API (PLAN Phase 5).

`OrbitFeatureBuilder` turns the raw fields a user (or the API) can supply about
one piece of junk into model features:

    raw input                      derived feature
    -----------------------------  ---------------------------------------------
    perigee now + 30 days ago      descent rate (km/day), days to reach 120 km
    perigee + apogee               eccentricity, mean altitude, altitude band
    bstar x F10.7                  drag x solar interaction
    every raw number               out_of_training_range flag

Learned state (set in `fit`, used in `transform`):
    medians_  training medians, used to fill missing values
    ranges_   each raw field's 1st-99th percentile range in the training data;
              `transform` flags rows that fall outside it, so the API and the
              game can warn when a what-if setting is beyond what the model saw.

The physics baseline the API reports next to the model lives here too, so the
fitting script and the API compute it the same way.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

EARTH_RADIUS_KM = 6378.137

RAW_NUMERIC = [
    "perigee_km",
    "apogee_km",
    "perigee_km_30d_ago",
    "inclination_deg",
    "bstar",
    "age_days",
    "f107_81d_mean",
    "ap_27d_mean",
]
RAW_CATEGORICAL = ["object_type", "rcs_size"]
RAW_FIELDS = RAW_NUMERIC + RAW_CATEGORICAL

# Columns produced by transform(), in order.
NUMERIC_OUT = [
    "perigee_km",
    "apogee_km",
    "inclination_deg",
    "bstar",
    "age_days",
    "f107_81d_mean",
    "ap_27d_mean",
    "descent_km_per_day",
    "eccentricity",
    "mean_alt_km",
    "days_to_reentry_alt",
    "drag_x_solar",
    "out_of_training_range",
]
CATEGORICAL_OUT = ["object_type", "rcs_size", "altitude_band"]

ALTITUDE_BANDS = [(-np.inf, 300, "below 300 km"), (300, 400, "300-400 km"), (400, 500, "400-500 km"),
                  (500, 600, "500-600 km"), (600, np.inf, "above 600 km")]


def descent_km_per_day(perigee_km, perigee_km_30d_ago) -> np.ndarray:
    """Perigee lost per day over the last 30 days (positive = coming down)."""
    now = np.asarray(perigee_km, dtype=float)
    before = np.asarray(perigee_km_30d_ago, dtype=float)
    return (before - now) / 30.0


def physics_baseline(perigee_km, perigee_km_30d_ago, reentry_alt_km: float = 120.0,
                     horizon_days: float = 365.0) -> tuple[np.ndarray, np.ndarray]:
    """PLAN Phase 4 baseline 2, as in the D3 notebooks: predict reentry within the
    horizon if perigee is already at or below 120 km, or if the current descent
    rate brings it there within the horizon. Returns (prediction 0/1, days to 120 km;
    inf when not descending)."""
    perigee = np.asarray(perigee_km, dtype=float)
    rate = descent_km_per_day(perigee_km, perigee_km_30d_ago)
    days = np.full(perigee.shape, np.inf)
    descending = rate > 0
    days[descending] = np.maximum(perigee[descending] - reentry_alt_km, 0.0) / rate[descending]
    pred = (perigee <= reentry_alt_km) | (descending & (days <= horizon_days))
    return pred.astype(int), days


class OrbitFeatureBuilder(BaseEstimator, TransformerMixin):
    """Raw orbit, object and space-weather fields -> engineered model features."""

    def __init__(self, range_quantiles=(0.01, 0.99), reentry_alt_km=120.0, max_days=3650.0):
        self.range_quantiles = range_quantiles
        self.reentry_alt_km = reentry_alt_km
        self.max_days = max_days

    # -- helpers -------------------------------------------------------------
    @staticmethod
    def _frame(X) -> pd.DataFrame:
        if not isinstance(X, pd.DataFrame):
            X = pd.DataFrame(X, columns=RAW_FIELDS)
        missing = [c for c in RAW_FIELDS if c not in X.columns]
        if missing:
            raise ValueError(f"OrbitFeatureBuilder is missing input columns: {missing}")
        out = X[RAW_FIELDS].copy()
        for c in RAW_NUMERIC:
            out[c] = pd.to_numeric(out[c], errors="coerce")
        return out

    def _with_descent(self, raw: pd.DataFrame) -> pd.DataFrame:
        out = raw.copy()
        out["descent_km_per_day"] = descent_km_per_day(out["perigee_km"], out["perigee_km_30d_ago"])
        return out

    # -- sklearn API ---------------------------------------------------------
    def fit(self, X, y=None):
        raw = self._frame(X)
        lo, hi = self.range_quantiles
        self.ranges_ = {c: (float(raw[c].quantile(lo)), float(raw[c].quantile(hi))) for c in RAW_NUMERIC}
        with_descent = self._with_descent(raw)
        cols = RAW_NUMERIC + ["descent_km_per_day"]
        self.medians_ = {c: float(with_descent[c].median()) for c in cols}
        self.categories_seen_ = {c: sorted(raw[c].dropna().astype(str).unique().tolist()) for c in RAW_CATEGORICAL}
        self.n_features_in_ = len(RAW_FIELDS)
        self.feature_names_in_ = np.array(RAW_FIELDS, dtype=object)
        return self

    def out_of_range_fields(self, X) -> list[list[str]]:
        """For each row, the raw numeric fields outside the training range."""
        raw = self._frame(X)
        rows = []
        for _, r in raw.iterrows():
            rows.append([c for c in RAW_NUMERIC
                         if pd.notna(r[c]) and not (self.ranges_[c][0] <= r[c] <= self.ranges_[c][1])])
        return rows

    def transform(self, X) -> pd.DataFrame:
        raw = self._frame(X)
        lo = pd.DataFrame({c: [self.ranges_[c][0]] * len(raw) for c in RAW_NUMERIC}, index=raw.index)
        hi = pd.DataFrame({c: [self.ranges_[c][1]] * len(raw) for c in RAW_NUMERIC}, index=raw.index)
        num = raw[RAW_NUMERIC]
        outside = (num.notna() & ((num < lo) | (num > hi))).any(axis=1)

        df = self._with_descent(raw)
        for c, m in self.medians_.items():
            df[c] = df[c].fillna(m)

        perigee, apogee = df["perigee_km"], np.maximum(df["apogee_km"], df["perigee_km"])
        rp, ra = perigee + EARTH_RADIUS_KM, apogee + EARTH_RADIUS_KM
        rate = df["descent_km_per_day"]
        days = np.where(rate > 0, np.maximum(perigee - self.reentry_alt_km, 0.0) / rate.where(rate > 0, 1.0),
                        self.max_days)

        out = pd.DataFrame(index=raw.index)
        for c in ["perigee_km", "apogee_km", "inclination_deg", "bstar", "age_days", "f107_81d_mean", "ap_27d_mean",
                  "descent_km_per_day"]:
            out[c] = df[c].astype(float)
        out["apogee_km"] = apogee.astype(float)
        out["eccentricity"] = ((ra - rp) / (ra + rp)).astype(float)
        out["mean_alt_km"] = ((perigee + apogee) / 2.0).astype(float)
        out["days_to_reentry_alt"] = np.minimum(days, self.max_days).astype(float)
        out["drag_x_solar"] = (df["bstar"] * df["f107_81d_mean"]).astype(float)
        out["out_of_training_range"] = outside.astype(float)
        out["object_type"] = raw["object_type"].fillna("UNKNOWN").astype(str)
        out["rcs_size"] = raw["rcs_size"].fillna("UNKNOWN").astype(str)
        band = pd.Series("above 600 km", index=raw.index)
        for low, high, name in ALTITUDE_BANDS:
            band[(perigee >= low) & (perigee < high)] = name
        out["altitude_band"] = band
        return out[NUMERIC_OUT + CATEGORICAL_OUT]

    def get_feature_names_out(self, input_features=None):
        return np.array(NUMERIC_OUT + CATEGORICAL_OUT, dtype=object)
