"""Cleaning and preprocessing for the Space Cadet EDA.

Everything the dashboard does to the raw files lives here; the source CSVs and
the rest of the repo are never modified. Pure pandas, no Streamlit, so it can be
run on its own:

    uv run python dashboard/preprocess.py     # prints the cleaning log

Uses every row (train, valid and test). Each step is recorded in a log of
(step, rows/columns affected, what happened).
"""
from pathlib import Path

import numpy as np
import pandas as pd

PROCESSED = Path(__file__).resolve().parents[1] / "data" / "processed"
RAW = PROCESSED.parent / "raw"

PANEL_COLS = [
    "norad_cat_id", "obs_date", "split", "object_type", "regime", "country", "rcs_size",
    "age_days", "days_remaining", "log1p_days_remaining", "event_observed",
    "perigee_km", "apogee_km", "mean_alt_km", "inclination_deg", "eccentricity",
    "rcs_value", "f107_adj", "f107_adj_mean_27d", "f107_adj_mean_81d",
    "f107_adj_mean_365d", "f107_trend_81d", "f107_pct_rank_11y",
    "ap_avg", "ap_mean_27d", "ap_mean_81d", "ap_max_27d", "ap_storm_days_81d",
]
LEAKY = {"perigee_km", "apogee_km", "mean_alt_km", "eccentricity", "inclination_deg"}


AS_OF = pd.Timestamp.today().normalize()
DEEP_SPACE_KM = 100_000  # apogee beyond this is lunar/solar-transfer territory, not an Earth-orbit regime


def top_or_other(col, n=12):
    keep = col.value_counts().head(n).index
    return col.where(col.isin(keep), "OTHER")


def load_panel():
    cols = PANEL_COLS + ["decay_date"]
    df = pd.read_csv(PROCESSED / "panel.csv", usecols=cols, low_memory=False,
                     parse_dates=["obs_date"])
    df["decay_date"] = pd.to_datetime(df["decay_date"], errors="coerce")
    log = [("panel: rows loaded", len(df), "all splits kept: train, valid and test")]

    n = int((df["obs_date"] > AS_OF).sum())
    df = df[df["obs_date"] <= AS_OF]
    log.append(("panel: observations dated after today dropped", n, "an observation can't be in the future"))

    unconfirmed = df["decay_date"] > AS_OF
    n = int(unconfirmed.sum())
    df.loc[unconfirmed, ["event_observed", "days_remaining", "log1p_days_remaining"]] = [0, np.nan, np.nan]
    log.append(("panel: predicted-but-future reentries reset to 'not fallen'", n,
                "label becomes censored instead of a date that hasn't happened"))
    df = df.drop(columns="decay_date")

    const = [c for c in df.columns if c not in ("event_observed",) and df[c].nunique(dropna=True) <= 1]
    df = df.drop(columns=const)
    log.append(("panel: constant columns dropped", len(const), ", ".join(const) or "none"))

    df["regime"] = df["regime"].fillna("UNKNOWN")
    df["rcs_size"] = df["rcs_size"].fillna("UNKNOWN")
    df["country"] = top_or_other(df["country"].fillna("UNKNOWN"))
    df["deep_space"] = df["apogee_km"] > DEEP_SPACE_KM
    log.append(("panel: rows flagged deep-space (apogee > 100,000 km)", int(df["deep_space"].sum()),
                "kept, hidden by default from the sidebar toggle"))
    split_rows = df["split"].value_counts().to_dict()
    split_objs = df.groupby("split", observed=True)["norad_cat_id"].nunique().to_dict()
    for c in ("object_type", "regime", "country", "split"):
        df[c] = df[c].astype("category")
    return df, split_rows, split_objs, log


def load_objects():
    o = pd.read_csv(PROCESSED / "objects.csv", low_memory=False)
    log = [("objects: rows loaded", len(o), "one row per catalogued object")]
    for c in ("launch_date", "decay_date"):
        o[c] = pd.to_datetime(o[c], errors="coerce")
    n = int(o["launch_date"].isna().sum())
    o = o.dropna(subset=["launch_date"])
    log.append(("objects: no launch date dropped", n, ""))
    dup = int(o["norad_cat_id"].duplicated().sum())
    o = o.drop_duplicates("norad_cat_id")
    log.append(("objects: duplicate ids dropped", dup, ""))

    # A reentry only counts if it has happened. Future dates are predictions: treat as still in orbit.
    fell = o["decay_date"].notna() & (o["decay_date"] <= AS_OF)
    n_future = int((o["decay_date"] > AS_OF).sum())
    n_pred = int((o["msg_type"] == "Prediction").sum())
    o["decay_predicted"] = o["msg_type"].eq("Prediction")
    o["decay_date"] = o["decay_date"].where(fell)
    o["event"] = fell.astype(int)
    log.append(("objects: reentry dates in the future set to 'in orbit'", n_future, "predicted dates not yet reached"))
    log.append(("objects: reentries that rest on a 'Prediction' message", n_pred,
                "kept (flagged `decay_predicted`); dates already passed"))

    end = o["decay_date"].fillna(AS_OF)
    o["life_days"] = (end - o["launch_date"]).dt.days.clip(lower=0)
    n0 = int(((o["life_days"] == 0) & (o["event"] == 1)).sum())
    log.append(("objects: same-day reentries (life = 0 d)", n0,
                "kept for survival curves; excluded from log-lifetime plots"))

    o["launch_year"] = o["launch_date"].dt.year
    o["decay_year"] = o["decay_date"].dt.year
    o["launch_decade"] = (o["launch_year"] // 10 * 10).astype(str) + "s"

    n_rcs = int(o["rcs_size"].isna().sum())
    o["rcs_size"] = o["rcs_size"].fillna("UNKNOWN")
    log.append(("objects: missing radar-size class labelled UNKNOWN", n_rcs, ""))
    o["country_raw"] = o["country"]
    o["country"] = top_or_other(o["country"].fillna("UNKNOWN"))
    log.append(("objects: rare country codes grouped as OTHER", int((o["country"] == "OTHER").sum()),
                "top 12 owners kept"))
    const = [c for c in o.columns if o[c].nunique(dropna=True) <= 1]
    o = o.drop(columns=const)
    log.append(("objects: constant columns dropped", len(const), ", ".join(const) or "none"))

    no_orbit = o[["apogee_km", "perigee_km", "inclination_deg"]].isna().any(axis=1)
    o["orbit_valid"] = ~no_orbit
    log.append(("objects: missing orbit elements", int(no_orbit.sum()), "kept; left out of orbit plots only"))
    o["deep_space"] = o["apogee_km"] > DEEP_SPACE_KM
    log.append(("objects: deep-space orbits (apogee > 100,000 km)", int(o["deep_space"].sum()),
                "kept, hidden by default from the sidebar toggle"))
    return o, log


def solar_monthly():
    """Monthly mean of the 81-day flux, from panel rows up to today."""
    s_ = pd.read_csv(PROCESSED / "panel.csv", usecols=["obs_date", "f107_adj_mean_81d"], low_memory=False,
                     parse_dates=["obs_date"]).dropna()
    s_ = s_[s_["obs_date"] <= AS_OF]
    m = s_.groupby(s_["obs_date"].dt.to_period("M"))["f107_adj_mean_81d"].mean()
    m.index = m.index.to_timestamp()
    return m.sort_index()


def gp_coverage():
    g = pd.read_csv(RAW / "gp_history.csv", usecols=["NORAD_CAT_ID", "EPOCH"])
    return g["NORAD_CAT_ID"].nunique(), len(g), g["EPOCH"].min()[:10], g["EPOCH"].max()[:10]


if __name__ == "__main__":
    _, _, _, plog = load_panel()
    _, olog = load_objects()
    print(pd.DataFrame(plog + olog, columns=["step", "affected", "what happened"]).to_string(index=False))
