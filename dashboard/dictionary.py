"""Data dictionary for the cleaned panel table shown in the dashboard.

Type, % missing and range/allowed values are generated from the data; the
description, units and cleaning notes are written by hand below (see also
src/SCHEMA.md for the full column reference).
"""
import json
from pathlib import Path
import pandas as pd


def source_column_types():
    """Storage types exported from information_schema, never inferred from JSON values."""
    path = Path(__file__).with_name('supabase_types.json')
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}

# column -> (description, units, cleaning / notes)
HAND = {
    "norad_cat_id": ("Catalogue number of the tracked object", "id", "Key; with obs_date it identifies a row"),
    "obs_date": ("Observation epoch: the day the features describe", "date", "Only train/valid rows from this upload are displayed"),
    "split": ("Which reserved split the row belongs to", "train / valid", "Test rows are discarded at load time"),
    "object_type": ("PAYLOAD, ROCKET BODY, DEBRIS, TBA or UNKNOWN", "category", "Straight from satcat"),
    "regime": ("Orbit regime from perigee/apogee", "LEO / ELLIPTICAL / MEO / GEO_PLUS / UNKNOWN", "Missing set to UNKNOWN. Built from the satcat last-on-file orbit, so it leaks"),
    "country": ("Owner / launching country code", "category", "Missing set to UNKNOWN in chart preparation"),
    "rcs_size": ("Radar cross-section class (stand-in for object size)", "SMALL / MEDIUM / LARGE / UNKNOWN", "Missing set to UNKNOWN"),
    "age_days": ("Days from launch to obs_date", "days", ""),
    "days_remaining": ("Label: days from obs_date to reentry", "days", "Original uploaded outcome; not recalculated"),
    "log1p_days_remaining": ("log(1 + days_remaining)", "log days", "Same nulls as days_remaining"),
    "event_observed": ("Whether the source records an observed reentry", "0 / 1", "Original uploaded outcome; this sample selected reentered objects"),
    "perigee_km": ("Lowest point of the orbit", "km", "satcat last-on-file value: near-reentry for decayed objects (LEAKY)"),
    "apogee_km": ("Highest point of the orbit", "km", "Same leakage caveat. Above 100,000 km flagged deep_space"),
    "mean_alt_km": ("Mean altitude from perigee and apogee", "km", "Derived; same leakage caveat"),
    "inclination_deg": ("Orbit tilt (0 = equatorial, 90 = polar)", "degrees", "Same leakage caveat"),
    "eccentricity": ("Orbit shape (0 = circular)", "unitless", "Derived from perigee/apogee; same leakage caveat"),
    "f107_adj": ("Daily 10.7 cm solar flux, normalised to 1 AU", "sfu", "From CelesTrak SW-All"),
    "f107_adj_mean_27d": ("Trailing 27-day mean of f107_adj (one solar rotation)", "sfu", ""),
    "f107_adj_mean_81d": ("Trailing 81-day mean of f107_adj", "sfu", ""),
    "f107_adj_mean_365d": ("Trailing 365-day mean of f107_adj", "sfu", ""),
    "f107_trend_81d": ("27-day mean minus 365-day mean: is the Sun ramping up or down", "sfu", ""),
    "f107_pct_rank_11y": ("Where today's flux sits in the last ~11 years (solar-cycle phase)", "0-1", ""),
    "ap_avg": ("Daily planetary geomagnetic index", "nT-scale index", ""),
    "ap_mean_27d": ("Trailing 27-day mean of ap_avg", "index", ""),
    "ap_mean_81d": ("Trailing 81-day mean of ap_avg", "index", ""),
    "ap_max_27d": ("Worst geomagnetic day in the last 27 days", "index", ""),
    "ap_storm_days_81d": ("Days with ap_avg >= 50 in the last 81 days", "days", ""),
    "deep_space": ("True when apogee > 100,000 km", "bool", "Added in cleaning; hidden by default in the dashboard"),
}


def _range(s: pd.Series) -> str:
    if pd.api.types.is_bool_dtype(s):
        return "True / False"
    if pd.api.types.is_numeric_dtype(s):
        return f"{s.min():,.4g} to {s.max():,.4g}" if s.notna().any() else "all missing"
    if pd.api.types.is_datetime64_any_dtype(s):
        return f"{s.min():%Y-%m-%d} to {s.max():%Y-%m-%d}"
    vals = s.dropna().astype(str).value_counts()
    head = ", ".join(vals.index[:6])
    return head + (f", ... ({len(vals)} values)" if len(vals) > 6 else "")


def build_dictionary(df: pd.DataFrame, database_types=None) -> pd.DataFrame:
    """One row per column of the cleaned panel: generated + hand-written fields."""
    database_types = source_column_types() if database_types is None else database_types
    rows = []
    for c in df.columns:
        desc, units, note = HAND.get(c, ("", "", ""))
        storage = database_types.get(c, 'derived in app' if c == 'deep_space' else 'not recorded')
        if storage == 'float8':
            note = (note + '; ' if note else '') + 'Stored as float8 (double precision); accepts decimal-form CSV values such as 46.0. Counts and flags retain their original meaning.'
        rows.append({
            "Column": c,
            "Supabase type": storage,
            "Pandas dtype": str(df[c].dtype),
            "Description": desc,
            "Units / allowed values": units or _range(df[c]),
            "Range / values in data": _range(df[c]),
            "% missing": round(100 * df[c].isna().mean(), 2),
            "Cleaning / notes": note,
        })
    return pd.DataFrame(rows)
