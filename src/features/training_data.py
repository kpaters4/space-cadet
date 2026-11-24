"""Turn the modelling panel into the raw-field frame the serving pipeline trains on.

The API receives ten raw fields (``features.transformers.RAW_FIELDS``). The panel
built by ``src/build_dataset.py`` has the as-of orbit and trailing space weather,
but not two of them: the perigee/apogee from 30 days earlier, and a 30-day Ap
mean (the panel carries 27-day means). This module adds both, with the same
no-peeking rules the panel uses:

* "30 days ago" is the element set in force on (snapshot date - 30 days), found
  with the same backward as-of join and the same ``MAX_ELEMENT_AGE_DAYS`` staleness
  limit as the snapshot's own orbit. So "now" and "30 days ago" are both defined as
  "the orbit on date X", exactly what an API caller reports.
* ``ap_mean_30d`` is the 30-day trailing mean of daily Ap ending on the day before
  the snapshot (``sw_asof_date``), computed from observed, forward-filled-only
  daily values with the same minimum-observations rule as the other windows.

Test rows are dropped as the panel is read and never reach any later step: only
their counts survive.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_dataset as bd  # noqa: E402
import space_weather  # noqa: E402
from config import SW_ALL  # noqa: E402
from features.transformers import RAW_FIELDS, WINDOW_DAYS  # noqa: E402

AP_WINDOW_DAYS = 30
TARGET = "reenters_within_horizon"

# gp_history/satcat spell rocket bodies two ways; the API enum uses one.
OBJECT_TYPE_ALIASES = {"R/B": "ROCKET BODY"}

# Columns kept alongside the raw fields for grouping, splitting and baselines.
KEEP = ["norad_cat_id", "obs_date", "split", TARGET]


def read_train_valid(path: Path, chunksize: int = 200_000) -> tuple[pd.DataFrame, dict]:
    """Read the panel, discarding test rows chunk by chunk (only their counts survive)."""
    kept, test_rows, test_objects = [], 0, set()
    for chunk in pd.read_csv(path, chunksize=chunksize, low_memory=False):
        if "split" not in chunk.columns:
            raise SystemExit(f"{path} has no `split` column -- rebuild it with src/build_dataset.py")
        split = chunk["split"].astype("string").str.strip().str.lower()
        is_test = split.eq("test")
        test_rows += int(is_test.sum())
        test_objects.update(chunk.loc[is_test, "norad_cat_id"].dropna().unique().tolist())
        kept.append(chunk.loc[~is_test].copy())
    df = pd.concat(kept, ignore_index=True)
    if df.empty:
        raise SystemExit(f"{path} has no train/valid rows")
    df["obs_date"] = pd.to_datetime(df["obs_date"], errors="coerce")
    df["split"] = df["split"].astype("string").str.strip().str.lower()
    counts = {
        "train_rows": int((df["split"] == "train").sum()),
        "valid_rows": int((df["split"] == "valid").sum()),
        "train_objects": int(df.loc[df["split"] == "train", "norad_cat_id"].nunique()),
        "valid_objects": int(df.loc[df["split"] == "valid", "norad_cat_id"].nunique()),
        "test_rows_skipped_unread": test_rows,
        "test_objects_skipped_unread": len(test_objects),
    }
    return df, counts


def orbit_days_ago(panel: pd.DataFrame, gp: pd.DataFrame, days: int = WINDOW_DAYS) -> pd.DataFrame:
    """Perigee/apogee as of (obs_date - days), same join and staleness rule as the snapshot."""
    # Only objects in the panel can match; dropping the rest keeps the join small when
    # gp_history covers many thousands of objects.
    gp = gp[gp["norad_cat_id"].isin(panel["norad_cat_id"].unique())]
    shifted = panel[["norad_cat_id", "obs_date"]].copy()
    shifted["obs_date"] = shifted["obs_date"] - pd.Timedelta(days=days)
    earlier = bd.attach_orbit_history(shifted, gp)
    return pd.DataFrame(
        {
            "perigee_km_30d_ago": earlier["perigee_km_asof"].to_numpy(),
            "apogee_km_30d_ago": earlier["apogee_km_asof"].to_numpy(),
        },
        index=panel.index,
    )


def ap_mean_30d_by_date(daily: pd.DataFrame, window: int = AP_WINDOW_DAYS) -> pd.Series:
    """Trailing mean of daily Ap ending on each date (same min-observations rule as the panel)."""
    s = daily.set_index("date")["ap_avg"].sort_index()
    return s.rolling(window, min_periods=max(1, int(window * 0.8))).mean()


def build_serving_frame(panel: pd.DataFrame, gp: pd.DataFrame, daily: pd.DataFrame) -> pd.DataFrame:
    """One row per panel snapshot, with exactly the raw fields the API will receive."""
    panel = panel.reset_index(drop=True)
    ago = orbit_days_ago(panel, gp)

    ap30 = ap_mean_30d_by_date(daily)
    sw_date = pd.to_datetime(panel["sw_asof_date"])
    ap_mean_30d = ap30.reindex(sw_date).to_numpy()

    object_type = panel["object_type"].astype("string").str.strip().str.upper()
    object_type = object_type.replace(OBJECT_TYPE_ALIASES)

    out = pd.DataFrame(
        {
            "perigee_km": panel["perigee_km_asof"],
            "apogee_km": panel["apogee_km_asof"],
            "perigee_km_30d_ago": ago["perigee_km_30d_ago"],
            "apogee_km_30d_ago": ago["apogee_km_30d_ago"],
            "bstar": panel["bstar"],
            "inclination_deg": panel["inclination_deg_asof"],
            "f107_adj_mean_81d": panel["f107_adj_mean_81d"],
            "ap_mean_30d": ap_mean_30d,
            "object_type": object_type.astype(object),
            "rcs_size": panel["rcs_size"].astype("string").str.strip().str.upper().astype(object),
        }
    )
    out = out[list(RAW_FIELDS)]
    for c in KEEP:
        out[c] = panel[c].to_numpy()
    return out


def load_serving_frame(
    panel_path: Path, gp_path: Path, sw_all: Path = SW_ALL
) -> tuple[pd.DataFrame, dict]:
    """Panel + gp_history + space weather -> (train/valid serving frame, counts)."""
    panel, counts = read_train_valid(panel_path)
    gp = bd.load_gp_history(gp_path)
    daily, _ = space_weather.build(sw_all)
    frame = build_serving_frame(panel, gp, daily)
    counts["history_missing_share"] = float(
        (frame["perigee_km_30d_ago"].isna() | frame["apogee_km_30d_ago"].isna()).mean()
    )
    counts["ap_mean_30d_missing_share"] = float(frame["ap_mean_30d"].isna().mean())
    return frame, counts
