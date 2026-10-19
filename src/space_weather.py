"""Clean CelesTrak SW-All.csv and derive drag-relevant solar/geomagnetic features.

The raw file mixes two cadences in one table, distinguished by F10.7_DATA_TYPE:

    OBS / INT / PRD  -> one row per DAY   (observed, interpolated, predicted)
    PRM              -> one row per MONTH (monthly-mean long-range prediction)

Treating them as a single daily series silently turns the tail of the file into
85 bogus "days", so they are split here into two outputs.

Feature-leakage note: the file ships both centred and trailing 81-day averages
of F10.7. The centred ones (F10.7_*_CENTER81) average 40 days of the FUTURE and
must not be used to predict anything. Only the trailing (*_LAST81) and
explicitly-trailing rolling features built below are safe as predictors.
"""
from __future__ import annotations

import pandas as pd

from config import MIN_EPOCH, SW_ALL, SW_DAILY, SW_MONTHLY_FORECAST, TRAILING_WINDOWS

# Kp is stored multiplied by 10 (e.g. 43 means Kp = 4.3).
KP_COLS = [f"KP{i}" for i in range(1, 9)]
AP_COLS = [f"AP{i}" for i in range(1, 9)]

DAILY_TYPES = {"OBS", "INT", "PRD"}
MONTHLY_TYPES = {"PRM"}


def load_raw(path=SW_ALL) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["DATE"])
    df.columns = [c.strip() for c in df.columns]
    return df


def split_cadence(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    kind = df["F10.7_DATA_TYPE"].str.strip().str.upper()
    unknown = sorted(set(kind.dropna()) - DAILY_TYPES - MONTHLY_TYPES)
    if unknown:
        raise ValueError(f"unrecognised F10.7_DATA_TYPE values: {unknown}")
    return df[kind.isin(DAILY_TYPES)].copy(), df[kind.isin(MONTHLY_TYPES)].copy()


def tidy_daily(daily: pd.DataFrame) -> pd.DataFrame:
    """Reindex to a gap-free daily calendar and rename to snake_case."""
    out = pd.DataFrame({"date": daily["DATE"]})
    out["ap_avg"] = pd.to_numeric(daily["AP_AVG"], errors="coerce")
    out["ap_max_3h"] = daily[AP_COLS].apply(pd.to_numeric, errors="coerce").max(axis=1)
    out["kp_avg"] = pd.to_numeric(daily["KP_SUM"], errors="coerce") / 8.0 / 10.0
    out["kp_max_3h"] = daily[KP_COLS].apply(pd.to_numeric, errors="coerce").max(axis=1) / 10.0
    out["f107_obs"] = pd.to_numeric(daily["F10.7_OBS"], errors="coerce")
    out["f107_adj"] = pd.to_numeric(daily["F10.7_ADJ"], errors="coerce")
    out["f107_adj_last81"] = pd.to_numeric(daily["F10.7_ADJ_LAST81"], errors="coerce")
    out["sunspot_number"] = pd.to_numeric(daily["ISN"], errors="coerce")
    out["cp"] = pd.to_numeric(daily["CP"], errors="coerce")
    out["c9"] = pd.to_numeric(daily["C9"], errors="coerce")
    out["source"] = daily["F10.7_DATA_TYPE"].str.strip().str.upper()

    out = out.sort_values("date").drop_duplicates("date")
    full = pd.date_range(out["date"].min(), out["date"].max(), freq="D")
    out = out.set_index("date").reindex(full).rename_axis("date")
    # Mark reconstructed days before filling so they stay auditable.
    out["is_gap_filled"] = out["source"].isna()
    numeric = out.select_dtypes("number").columns
    out[numeric] = out[numeric].interpolate(limit_direction="both")
    out["source"] = out["source"].fillna("GAP")
    return out.reset_index()


def add_trailing_features(daily: pd.DataFrame, windows=TRAILING_WINDOWS) -> pd.DataFrame:
    """Rolling means (and storm maxima) over windows ending at, and including, each day.

    These are the honest predictors: everything in a window labelled `date` was
    already measurable on `date`.
    """
    out = daily.set_index("date").copy()
    for w in windows:
        min_p = max(1, int(w * 0.8))
        out[f"f107_adj_mean_{w}d"] = out["f107_adj"].rolling(w, min_periods=min_p).mean()
        out[f"ap_mean_{w}d"] = out["ap_avg"].rolling(w, min_periods=min_p).mean()
        if w >= 7:
            out[f"ap_max_{w}d"] = out["ap_avg"].rolling(w, min_periods=min_p).max()
            out[f"ap_storm_days_{w}d"] = (
                out["ap_avg"].ge(50).rolling(w, min_periods=min_p).sum()
            )
    # Where in the ~11-year solar cycle are we, and which way is it heading?
    out["f107_trend_81d"] = out["f107_adj_mean_27d"] - out["f107_adj_mean_365d"]
    out["f107_pct_rank_11y"] = (
        out["f107_adj_mean_81d"].rolling(4015, min_periods=365).rank(pct=True)
    )
    return out.reset_index()


def tidy_monthly_forecast(monthly: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame(
        {
            "month_start": monthly["DATE"],
            "f107_adj_monthly_mean": pd.to_numeric(monthly["F10.7_ADJ"], errors="coerce"),
            "f107_obs_monthly_mean": pd.to_numeric(monthly["F10.7_OBS"], errors="coerce"),
            "sunspot_number_monthly_mean": pd.to_numeric(monthly["ISN"], errors="coerce"),
        }
    )
    return out.sort_values("month_start").reset_index(drop=True)


def build(path=SW_ALL) -> tuple[pd.DataFrame, pd.DataFrame]:
    raw = load_raw(path)
    daily_raw, monthly_raw = split_cadence(raw)
    daily = add_trailing_features(tidy_daily(daily_raw))
    daily = daily[daily["date"] >= pd.Timestamp(MIN_EPOCH)]
    return daily, tidy_monthly_forecast(monthly_raw)


def main() -> None:
    daily, monthly = build()
    SW_DAILY.parent.mkdir(parents=True, exist_ok=True)
    daily.to_csv(SW_DAILY, index=False)
    monthly.to_csv(SW_MONTHLY_FORECAST, index=False)
    print(f"daily   {daily.shape[0]:>7,} rows x {daily.shape[1]:>3} cols  "
          f"{daily['date'].min().date()} -> {daily['date'].max().date()}  -> {SW_DAILY.name}")
    print(f"monthly {monthly.shape[0]:>7,} rows x {monthly.shape[1]:>3} cols  "
          f"{monthly['month_start'].min().date()} -> {monthly['month_start'].max().date()}"
          f"  -> {SW_MONTHLY_FORECAST.name}")
    print(f"gap-filled days: {int(daily['is_gap_filled'].sum())}")


if __name__ == "__main__":
    main()
