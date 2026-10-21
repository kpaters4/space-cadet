"""Combine the three datasets into a modelling table for the research question:

    Can we predict how many days a piece of space junk has left before it burns
    up, and does knowing what the Sun is doing make the prediction better?

Inputs  (data/raw/)   SW-All.csv, satcat.csv, decay.csv, gp_history.csv (optional)
Outputs (data/processed/)
    objects.csv          one row per catalogued object (the object-level view)
    panel.csv            one row per (object, observation epoch)  <- model on this
    feature_groups.json  which columns are orbit vs. space weather, so the
                         "does the Sun help?" ablation is a one-liner

Why a panel and not one row per object
--------------------------------------
"Days left" is only defined relative to a moment of observation. One row per
object can only carry one such moment, and the space weather on that single day
says little. So each object contributes several observation epochs spread across
its life; the label is the days from that epoch to reentry, and the features are
what the Sun had been doing up to that epoch. That is what makes the Sun's
contribution measurable at all.

Objects still in orbit are kept as right-censored rows (event_observed = 0) so
survival models can use them. Drop them for a plain regression.

Leakage warnings, read before trusting a score
----------------------------------------------
1. satcat's APOGEE / PERIGEE / PERIOD are the LAST values on file, not values
   as of the observation epoch. For a decayed object those describe its final,
   already-decaying orbit, which partly encodes the answer, and they never
   change across that object's epochs. Those columns are isolated in the
   `orbit_terminal` feature group.

   The fix: if data/raw/gp_history.csv is present (run fetch_gp_history.py),
   orbit features are instead taken from the most recent element set *on file
   at or before* each observation epoch -- the `orbit_asof` feature group.
   These are real, epoch-accurate orbit features (actual perigee decay rate,
   actual mean-motion derivative), not a leaky endpoint snapshot. Without
   gp_history.csv the panel still builds, just without orbit_asof, and the
   default ablation falls back to the leaky orbit_terminal columns.
2. Forward-looking space weather (`fwd_*`) uses days AFTER the epoch. That is
   legitimate only if a forecast is fed in at inference time (the CelesTrak file
   ships one). It sits in its own feature group so both ways can be tested.
3. F10.7_*_CENTER81 from the raw file is dropped entirely -- it averages 40 days
   of the future and is not forecastable.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import space_weather
from config import (
    DECAY,
    EPOCHS_PER_OBJECT,
    GP_HISTORY,
    MAX_ELEMENT_AGE_DAYS,
    MAX_PERIGEE_KM,
    MIN_EPOCH,
    OBJECTS,
    PANEL,
    PERIGEE_DECAY_WINDOW_DAYS,
    PROCESSED,
    RANDOM_SEED,
    SATCAT,
    SW_ALL,
)
from normalize import DECAY_ALIASES, GP_HISTORY_ALIASES, SATCAT_ALIASES, normalize

EARTH_RADIUS_KM = 6378.137


# --------------------------------------------------------------------------- #
# load + clean the two Space-Track tables
# --------------------------------------------------------------------------- #
def load_satcat(path=SATCAT) -> pd.DataFrame:
    raw = pd.read_csv(path, low_memory=False)
    df, missing = normalize(
        raw,
        SATCAT_ALIASES,
        required=("norad_cat_id", "launch_date", "apogee_km", "perigee_km"),
    )
    if missing:
        sys.exit(
            f"{Path(path).name} is missing required column(s): {missing}\n"
            f"columns seen: {list(raw.columns)}"
        )

    df["norad_cat_id"] = pd.to_numeric(df["norad_cat_id"], errors="coerce").astype("Int64")
    for col in ("launch_date", "decay_date_satcat"):
        if col in df:
            df[col] = pd.to_datetime(df[col], errors="coerce", utc=True).dt.tz_localize(None)
    for col in ("period_min", "inclination_deg", "apogee_km", "perigee_km", "rcs_value"):
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ("object_type", "rcs_size", "country", "site"):
        if col in df:
            df[col] = df[col].astype("string").str.strip().str.upper()

    df = df.dropna(subset=["norad_cat_id"])
    # Keep the most informative record per object if the export has duplicates.
    df["_completeness"] = df.notna().sum(axis=1)
    df = (
        df.sort_values(["norad_cat_id", "_completeness"])
        .drop_duplicates("norad_cat_id", keep="last")
        .drop(columns="_completeness")
    )
    return df


def load_decay(path=DECAY) -> pd.DataFrame:
    """Collapse the decay message stream to one authoritative reentry per object.

    Space-Track emits several messages per reentry (successive TIP predictions,
    then the final determination), so this keeps the latest message per object
    and records how far the predictions moved -- that spread is a useful measure
    of how hard a given reentry was to call.
    """
    raw = pd.read_csv(path, low_memory=False)
    df, missing = normalize(raw, DECAY_ALIASES, required=("norad_cat_id", "decay_epoch"))
    if missing:
        sys.exit(
            f"{Path(path).name} is missing required column(s): {missing}\n"
            f"columns seen: {list(raw.columns)}"
        )

    df["norad_cat_id"] = pd.to_numeric(df["norad_cat_id"], errors="coerce").astype("Int64")
    for col in ("decay_epoch", "msg_epoch"):
        if col in df:
            df[col] = pd.to_datetime(df[col], errors="coerce", utc=True).dt.tz_localize(None)
    df = df.dropna(subset=["norad_cat_id", "decay_epoch"])

    if "msg_epoch" not in df:
        df["msg_epoch"] = pd.NaT
    df = df.sort_values(["norad_cat_id", "msg_epoch", "decay_epoch"])

    grouped = df.groupby("norad_cat_id", sort=False)
    latest = grouped.tail(1).set_index("norad_cat_id")
    stats = grouped.agg(
        n_decay_msgs=("decay_epoch", "size"),
        decay_pred_spread_days=(
            "decay_epoch",
            lambda s: (s.max() - s.min()).total_seconds() / 86400,
        ),
    )
    out = latest.join(stats)
    wanted = (
        "decay_epoch",
        "msg_epoch",
        "msg_type",
        "decay_source",
        "n_decay_msgs",
        "decay_pred_spread_days",
    )
    return out[[c for c in wanted if c in out.columns]].reset_index()


def load_gp_history(path=GP_HISTORY) -> pd.DataFrame | None:
    """Orbital element history (TLE-equivalent), one row per element set.

    Optional: returns None if the file hasn't been fetched (see
    fetch_gp_history.py). Everything downstream degrades gracefully without
    it -- the panel just keeps the leaky satcat snapshot instead.
    """
    path = Path(path)
    if not path.exists():
        return None

    raw = pd.read_csv(path, low_memory=False)
    df, missing = normalize(
        raw, GP_HISTORY_ALIASES, required=("norad_cat_id", "epoch", "apogee_km", "perigee_km")
    )
    if missing:
        sys.exit(f"{path.name} is missing required column(s): {missing}\ncolumns seen: {list(raw.columns)}")

    df["norad_cat_id"] = pd.to_numeric(df["norad_cat_id"], errors="coerce").astype("Int64")
    df["epoch"] = pd.to_datetime(df["epoch"], errors="coerce", utc=True).dt.tz_localize(None)
    numeric_cols = (
        "mean_motion", "mean_motion_dot", "mean_motion_ddot", "bstar", "eccentricity",
        "inclination_deg", "semimajor_axis_km", "period_min", "apogee_km", "perigee_km",
        "element_set_no", "rev_at_epoch",
    )
    for col in numeric_cols:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["norad_cat_id", "epoch", "perigee_km"])
    # Plain int64, not nullable Int64 -- merge_asof's `by` key must match
    # panel's norad_cat_id dtype exactly, and no NA survives the dropna above.
    df["norad_cat_id"] = df["norad_cat_id"].astype("int64")
    df = (
        df.sort_values(["norad_cat_id", "epoch"])
        .drop_duplicates(["norad_cat_id", "epoch"], keep="last")
        .reset_index(drop=True)
    )
    return add_perigee_decay_rate(df)


def add_perigee_decay_rate(gp: pd.DataFrame, window_days: float = PERIGEE_DECAY_WINDOW_DAYS) -> pd.DataFrame:
    """Trailing slope of perigee altitude over the prior `window_days`, per object.

    Only uses element sets strictly earlier than the current one, so this is a
    legitimate as-of-epoch feature -- a real decay rate, not the
    launch-to-reentry average that only exists after the fact. Negative values
    mean perigee is falling (the object is decaying); near zero means a stable
    orbit. Null where there's no earlier element set within the window.
    """
    gp = gp.sort_values(["norad_cat_id", "epoch"]).reset_index(drop=True)
    epoch_ns = gp["epoch"].to_numpy().astype("datetime64[ns]").astype(np.int64)
    perigee = gp["perigee_km"].to_numpy()
    rate = np.full(len(gp), np.nan)
    window_ns = np.int64(window_days) * 86_400_000_000_000

    for _, idx in gp.groupby("norad_cat_id", sort=False).indices.items():
        idx = np.asarray(idx)
        e, p = epoch_ns[idx], perigee[idx]
        j = np.searchsorted(e, e - window_ns, side="left")
        valid = j < np.arange(len(idx))  # must land strictly before the current record
        dt_days = (e - e[j]) / 86_400_000_000_000
        with np.errstate(invalid="ignore", divide="ignore"):
            slope = (p - p[j]) / dt_days
        rate[idx[valid]] = slope[valid]

    gp["perigee_decay_rate_km_per_day"] = rate
    return gp


# --------------------------------------------------------------------------- #
# object-level table
# --------------------------------------------------------------------------- #
def classify_regime(perigee: pd.Series, apogee: pd.Series) -> pd.Series:
    regime = pd.Series("UNKNOWN", index=perigee.index, dtype="object")
    known = perigee.notna() & apogee.notna()
    regime[known & (apogee < 2000)] = "LEO"
    regime[known & (perigee < 2000) & (apogee >= 2000)] = "ELLIPTICAL"
    regime[known & (perigee >= 2000) & (apogee < 35000)] = "MEO"
    regime[known & (perigee >= 35000)] = "GEO_PLUS"
    return regime.astype("string")


def build_objects(satcat: pd.DataFrame, decay: pd.DataFrame, asof: pd.Timestamp) -> pd.DataFrame:
    df = satcat.merge(decay, on="norad_cat_id", how="left", validate="one_to_one")

    # Prefer the decay message epoch (carries a time of day); fall back to satcat.
    satcat_decay = (
        df["decay_date_satcat"]
        if "decay_date_satcat" in df
        else pd.Series(pd.NaT, index=df.index)
    )
    df["decay_date"] = df["decay_epoch"].fillna(satcat_decay)
    df["decay_date_provenance"] = np.select(
        [df["decay_epoch"].notna(), satcat_decay.notna()],
        ["decay_dataset", "satcat"],
        default="none",
    )
    df["is_decayed"] = df["decay_date"].notna()

    df["lifetime_days"] = (df["decay_date"] - df["launch_date"]).dt.total_seconds() / 86400
    df["age_at_asof_days"] = (asof - df["launch_date"]).dt.total_seconds() / 86400

    # Orbit geometry
    df["sma_km"] = (df["apogee_km"] + df["perigee_km"]) / 2 + EARTH_RADIUS_KM
    df["eccentricity"] = (df["apogee_km"] - df["perigee_km"]) / (2 * df["sma_km"])
    df["mean_alt_km"] = (df["apogee_km"] + df["perigee_km"]) / 2
    df["regime"] = classify_regime(df["perigee_km"], df["apogee_km"])
    # satcat elements are the last on file, so for a decayed object they describe
    # the near-reentry orbit -- a predictor that has already seen the answer.
    df["orbit_snapshot_is_terminal"] = df["is_decayed"]

    object_type = df["object_type"] if "object_type" in df else pd.Series("", index=df.index)
    df["is_debris"] = object_type.isin(["DEBRIS", "ROCKET BODY", "R/B", "TBA"]).fillna(False)

    # A handful of catalogue rows carry a decay date before the launch date.
    bad = df["lifetime_days"].notna() & (df["lifetime_days"] < 0)
    if bad.any():
        df.loc[bad, "decay_date"] = pd.NaT
        df.loc[bad, "lifetime_days"] = np.nan
        df.loc[bad, "is_decayed"] = False
        df.loc[bad, "decay_date_provenance"] = "dropped_decay_before_launch"

    df["event_observed"] = df["is_decayed"].astype(int)
    return df.sort_values("norad_cat_id").reset_index(drop=True)


# --------------------------------------------------------------------------- #
# observation epochs
# --------------------------------------------------------------------------- #
def sample_epochs(objects: pd.DataFrame, asof: pd.Timestamp, n: int, rng) -> pd.DataFrame:
    """Spread `n` observation epochs across each object's observed window.

    Decayed objects: epochs between launch and reentry, label = days to reentry.
    Still in orbit:  epochs between launch and `asof`, right-censored.
    Fractions are an even grid plus small jitter, so labels span short and long
    horizons for every object rather than clustering at one age.
    """
    df = objects.dropna(subset=["launch_date"]).copy()
    end = df["decay_date"].where(df["is_decayed"], asof)
    span_days = (end - df["launch_date"]).dt.total_seconds() / 86400
    keep = span_days > 1
    df, span_days = df.loc[keep], span_days.loc[keep]
    if df.empty:
        return pd.DataFrame(columns=["norad_cat_id", "epoch_index", "obs_date"])

    base = (np.arange(n) + 0.5) / n
    jitter = rng.uniform(-0.5 / n, 0.5 / n, size=(len(df), n))
    fractions = np.clip(base[None, :] + jitter, 0.0, 0.999)

    offset_ns = (fractions * span_days.to_numpy()[:, None] * 86400 * 1e9).astype("timedelta64[ns]")
    epochs = df["launch_date"].to_numpy()[:, None] + offset_ns

    rows = pd.DataFrame(
        {
            "norad_cat_id": np.repeat(df["norad_cat_id"].to_numpy(), n),
            "epoch_index": np.tile(np.arange(n), len(df)),
            "obs_date": pd.Series(epochs.reshape(-1)).dt.floor("D"),
        }
    )
    return rows.drop_duplicates(["norad_cat_id", "obs_date"])


def attach_space_weather(panel: pd.DataFrame, sw: pd.DataFrame) -> pd.DataFrame:
    """Join trailing features at the epoch, plus forward-looking forecast features."""
    sw = sw.copy()
    sw["date"] = pd.to_datetime(sw["date"])

    # Forward windows: mean F10.7 / ap over the days AFTER the epoch. Computed by
    # rolling over the reversed series, so window `w` at date d covers (d, d+w].
    rev = sw.set_index("date")[["f107_adj", "ap_avg"]].iloc[::-1]
    for w in (90, 365):
        min_p = max(1, int(w * 0.8))
        for src, name in (("f107_adj", f"fwd_f107_adj_mean_{w}d"), ("ap_avg", f"fwd_ap_mean_{w}d")):
            sw[name] = (
                rev[src].shift(1).rolling(w, min_periods=min_p).mean().iloc[::-1].to_numpy()
            )

    drop = [c for c in ("source", "is_gap_filled") if c in sw.columns]
    return panel.merge(
        sw.drop(columns=drop), left_on="obs_date", right_on="date", how="left"
    ).drop(columns="date")


# Renamed so these never collide with satcat's terminal-snapshot columns of
# the same physical quantity already sitting in the panel.
_GP_FEATURE_RENAME = {
    "apogee_km": "apogee_km_asof",
    "perigee_km": "perigee_km_asof",
    "period_min": "period_min_asof",
    "eccentricity": "eccentricity_asof",
    "inclination_deg": "inclination_deg_asof",
    "mean_motion": "mean_motion",
    "mean_motion_dot": "mean_motion_dot",
    "bstar": "bstar",
    "perigee_decay_rate_km_per_day": "perigee_decay_rate_km_per_day",
    "regime_asof": "regime_asof",
    "sma_km_asof": "sma_km_asof",
    "mean_alt_km_asof": "mean_alt_km_asof",
}


def attach_orbit_history(
    panel: pd.DataFrame, gp: pd.DataFrame, max_age_days: float = MAX_ELEMENT_AGE_DAYS
) -> pd.DataFrame:
    """As-of join: the orbit as described by the most recent element set on
    file at or before each observation epoch -- never a value from the future.

    This is the fix for leakage warning #1 above: unlike satcat's one terminal
    snapshot, these columns vary correctly across an object's epochs and never
    describe an orbit the object hadn't reached yet.
    """
    gp = gp.copy()
    gp["regime_asof"] = classify_regime(gp["perigee_km"], gp["apogee_km"])
    gp["sma_km_asof"] = (gp["apogee_km"] + gp["perigee_km"]) / 2 + EARTH_RADIUS_KM
    gp["mean_alt_km_asof"] = (gp["apogee_km"] + gp["perigee_km"]) / 2

    cols = ["norad_cat_id", "epoch"] + [c for c in _GP_FEATURE_RENAME if c in gp.columns]
    right = gp[cols].rename(columns=_GP_FEATURE_RENAME).sort_values("epoch")
    right["epoch"] = right["epoch"].astype("datetime64[ns]")
    left = panel.reset_index(names="_panel_row").sort_values("obs_date")
    left["obs_date"] = left["obs_date"].astype("datetime64[ns]")

    merged = pd.merge_asof(
        left, right, left_on="obs_date", right_on="epoch", by="norad_cat_id", direction="backward"
    )
    merged["element_age_days"] = (merged["obs_date"] - merged["epoch"]).dt.total_seconds() / 86400

    # An element set older than this is stale enough that trusting it as "the
    # orbit on obs_date" would be a guess, not a measurement -- null it out
    # rather than quietly feed a model a stretched-thin snapshot.
    stale = merged["element_age_days"].gt(max_age_days)
    asof_cols = sorted(set(_GP_FEATURE_RENAME.values()) & set(merged.columns)) + ["element_age_days"]
    merged.loc[stale, asof_cols] = np.nan

    return (
        merged.drop(columns="epoch")
        .set_index("_panel_row")
        .rename_axis(None)
        .sort_index()
    )


def build_panel(
    objects: pd.DataFrame, sw: pd.DataFrame, asof: pd.Timestamp, gp: pd.DataFrame | None = None
) -> pd.DataFrame:
    rng = np.random.default_rng(RANDOM_SEED)

    eligible = objects[
        objects["perigee_km"].le(MAX_PERIGEE_KM)
        & objects["launch_date"].ge(pd.Timestamp(MIN_EPOCH))
    ]
    epochs = sample_epochs(eligible, asof, EPOCHS_PER_OBJECT, rng)

    object_cols = [
        c
        for c in (
            "norad_cat_id", "object_name", "object_id", "object_type", "country", "site",
            "launch_date", "decay_date", "is_decayed", "event_observed", "lifetime_days",
            "apogee_km", "perigee_km", "period_min", "inclination_deg", "sma_km",
            "eccentricity", "mean_alt_km", "regime", "rcs_size", "rcs_value", "is_debris",
            "orbit_snapshot_is_terminal", "n_decay_msgs", "decay_pred_spread_days",
        )
        if c in objects.columns
    ]
    panel = epochs.merge(objects[object_cols], on="norad_cat_id", how="left")

    panel["age_days"] = (panel["obs_date"] - panel["launch_date"]).dt.total_seconds() / 86400
    # The label.
    panel["days_remaining"] = (panel["decay_date"] - panel["obs_date"]).dt.total_seconds() / 86400
    # For censored rows: how long we watched after the epoch without a reentry.
    panel["days_followed"] = np.where(
        panel["is_decayed"],
        panel["days_remaining"],
        (asof - panel["obs_date"]).dt.total_seconds() / 86400,
    )
    panel["log1p_days_remaining"] = np.log1p(panel["days_remaining"].clip(lower=0))

    panel = attach_space_weather(panel, sw)
    if gp is not None:
        panel = attach_orbit_history(panel, gp)
    panel = panel[panel["obs_date"] >= pd.Timestamp(MIN_EPOCH)].copy()

    # A time-ordered split: holding out by epoch date is the only honest test of
    # "would this have worked on junk we had not seen yet".
    cut_train, cut_valid = panel["obs_date"].quantile([0.70, 0.85])
    panel["split"] = np.select(
        [panel["obs_date"] <= cut_train, panel["obs_date"] <= cut_valid],
        ["train", "valid"],
        default="test",
    )
    return panel.sort_values(["obs_date", "norad_cat_id"]).reset_index(drop=True)


# --------------------------------------------------------------------------- #
# feature manifest + report
# --------------------------------------------------------------------------- #
def feature_groups(panel: pd.DataFrame) -> dict:
    cols = set(panel.columns)
    sw_trailing = sorted(
        c
        for c in cols
        if c.startswith(("f107", "ap_", "kp_", "cp", "c9", "sunspot"))
        and not c.startswith("fwd_")
    )
    sw_forward = sorted(c for c in cols if c.startswith("fwd_"))
    orbit_terminal = [
        # `regime` lives here, not in orbit_static: it's classify_regime() run on
        # satcat's terminal perigee/apogee in build_objects(), so it carries the
        # exact same leak -- `regime_asof` below is the clean substitute.
        c
        for c in (
            "apogee_km", "perigee_km", "period_min", "sma_km", "eccentricity",
            "mean_alt_km", "regime",
        )
        if c in cols
    ]
    orbit_asof = [
        c
        for c in (
            "apogee_km_asof", "perigee_km_asof", "period_min_asof", "eccentricity_asof",
            "inclination_deg_asof", "sma_km_asof", "mean_alt_km_asof", "regime_asof",
            "mean_motion", "mean_motion_dot", "bstar", "perigee_decay_rate_km_per_day",
            "element_age_days",
        )
        if c in cols
    ]
    orbit_static = [
        c
        for c in ("inclination_deg", "rcs_size", "rcs_value", "object_type",
                  "is_debris", "country")
        if c in cols
    ]
    have_asof = bool(orbit_asof)

    # Prefer the epoch-accurate orbit (gp_history) for the default ablation;
    # fall back to the leaky satcat snapshot only if gp_history wasn't fetched.
    base_clean = orbit_static + ["age_days"] + (orbit_asof if have_asof else orbit_terminal)
    base_leaky = orbit_static + orbit_terminal + ["age_days"]

    ablation = {
        "baseline_no_sun": base_clean,
        "with_sun_trailing": base_clean + sw_trailing,
        "with_sun_and_forecast": base_clean + sw_trailing + sw_forward,
    }
    if have_asof:
        # Kept for comparison -- this is the leaky version from before
        # fetch_gp_history.py was run. The gap between this and the
        # baseline_no_sun score above is roughly how much the old satcat
        # snapshot was quietly helping for the wrong reason.
        ablation["baseline_no_sun_leaky_orbit"] = base_leaky
        ablation["with_sun_trailing_leaky_orbit"] = base_leaky + sw_trailing

    notes = [
        "space_weather_forward requires a solar forecast at inference time.",
        "Drop event_observed == 0 rows for plain regression; keep them for "
        "survival models.",
    ]
    if have_asof:
        notes.insert(
            0,
            "orbit_asof comes from gp_history: the orbit as of each epoch, taken "
            "only from element sets already on file at or before obs_date, so it "
            "never leaks the future. orbit_terminal is satcat's one terminal "
            "snapshot -- leaky for decayed objects -- kept only for the "
            "*_leaky_orbit ablation comparison.",
        )
        notes.insert(
            1,
            "perigee_decay_rate_km_per_day is negative while an object is losing "
            "altitude. element_age_days says how stale the matched element set "
            "was; rows past MAX_ELEMENT_AGE_DAYS have orbit_asof nulled out "
            "rather than guessed.",
        )
    else:
        notes.insert(
            0,
            "orbit_terminal columns are satcat's LAST elements on file; for decayed "
            "objects they leak the answer. Run fetch_gp_history.py and rebuild to "
            "replace them with real, epoch-accurate orbit_asof features instead.",
        )

    return {
        "keys": ["norad_cat_id", "obs_date", "epoch_index"],
        "targets": {
            "regression": "days_remaining",
            "regression_log": "log1p_days_remaining",
            "survival": {"duration": "days_followed", "event": "event_observed"},
        },
        "split": "split",
        "features": {
            "orbit_static": orbit_static,
            "orbit_terminal": orbit_terminal,
            "orbit_asof": orbit_asof,
            "object_age": ["age_days"],
            "space_weather_trailing": sw_trailing,
            "space_weather_forward": sw_forward,
        },
        "ablation": ablation,
        # Carried in panel.csv for inspection and joins, but each one is known
        # only after the reentry happened. Never fit on these.
        "leakage_never_use_as_features": [
            c
            for c in (
                "lifetime_days", "decay_date", "is_decayed", "days_followed",
                "days_remaining", "log1p_days_remaining", "n_decay_msgs",
                "decay_pred_spread_days", "object_name", "object_id",
            )
            if c in cols
        ],
        "notes": notes,
    }


def report(objects: pd.DataFrame, panel: pd.DataFrame, asof: pd.Timestamp) -> None:
    dec = objects["is_decayed"]
    print(f"\nas-of date: {asof.date()}")
    print(f"\nobjects.csv   {len(objects):>9,} rows x {objects.shape[1]:>3} cols")
    print(f"  decayed                 {dec.sum():>9,}  ({dec.mean():.1%})")
    print(f"  still in orbit          {(~dec).sum():>9,}")
    print(f"  missing launch date     {objects['launch_date'].isna().sum():>9,}")
    print(f"  missing perigee         {objects['perigee_km'].isna().sum():>9,}")
    print("  by regime:")
    for k, v in objects["regime"].value_counts(dropna=False).items():
        print(f"    {str(k):<12} {v:>9,}")
    if dec.any():
        lt = objects.loc[dec, "lifetime_days"].dropna()
        print(
            f"  lifetime_days (decayed): median {lt.median():,.0f}  "
            f"p10 {lt.quantile(.1):,.0f}  p90 {lt.quantile(.9):,.0f}  max {lt.max():,.0f}"
        )

    print(f"\npanel.csv     {len(panel):>9,} rows x {panel.shape[1]:>3} cols")
    print(f"  distinct objects        {panel['norad_cat_id'].nunique():>9,}")
    ev = panel["event_observed"].eq(1)
    print(f"  labelled (decay seen)   {ev.sum():>9,}")
    print(f"  right-censored          {(~ev).sum():>9,}")
    print(
        f"  epoch range             {panel['obs_date'].min().date()} -> "
        f"{panel['obs_date'].max().date()}"
    )
    if ev.any():
        dr = panel.loc[ev, "days_remaining"]
        print(
            f"  days_remaining: median {dr.median():,.0f}  "
            f"p10 {dr.quantile(.1):,.0f}  p90 {dr.quantile(.9):,.0f}"
        )
    print("  split sizes:", panel["split"].value_counts().to_dict())

    sw_cols = [c for c in panel.columns if c.startswith(("f107", "ap_mean", "kp_"))]
    if sw_cols:
        print(f"  worst space-weather null rate {panel[sw_cols].isna().mean().max():.2%}")

    if "perigee_km_asof" in panel.columns:
        have = panel["perigee_km_asof"].notna()
        print(f"  orbit_asof (gp_history) coverage {have.mean():.1%} of rows "
              f"({have.sum():,}/{len(panel):,})")
        if have.any():
            age = panel.loc[have, "element_age_days"]
            print(f"  element_age_days where matched: median {age.median():.1f}d  "
                  f"p90 {age.quantile(.9):.1f}d")
    else:
        print("  orbit_asof: not built (no gp_history.csv) -- orbit features are "
              "satcat's leaky terminal snapshot")

    # Sanity checks that would otherwise rot silently.
    assert (panel.loc[ev, "days_remaining"] >= 0).all(), "negative days_remaining"
    assert panel["age_days"].min() >= 0, "epoch before launch"
    assert not panel.duplicated(["norad_cat_id", "obs_date"]).any(), "duplicate epochs"
    if "element_age_days" in panel.columns:
        age = panel["element_age_days"].dropna()
        assert (age >= 0).all(), "orbit_asof matched a FUTURE element set"
        assert (age <= MAX_ELEMENT_AGE_DAYS).all(), "stale element set was not nulled out"
    print("\nsanity checks passed")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Build objects.csv and panel.csv.")
    ap.add_argument(
        "--raw-dir",
        type=Path,
        default=None,
        help="directory holding satcat.csv and decay.csv (default: data/raw)",
    )
    ap.add_argument(
        "--out-dir", type=Path, default=None, help="output directory (default: data/processed)"
    )
    ap.add_argument("--sw-all", type=Path, default=SW_ALL, help="CelesTrak SW-All.csv")
    ap.add_argument(
        "--gp-history",
        type=Path,
        default=None,
        help="gp_history.csv (default: <raw-dir>/gp_history.csv; optional -- "
        "orbit_asof features are skipped if it's missing)",
    )
    args = ap.parse_args(argv)

    satcat_path = (args.raw_dir / "satcat.csv") if args.raw_dir else SATCAT
    decay_path = (args.raw_dir / "decay.csv") if args.raw_dir else DECAY
    gp_path = args.gp_history or ((args.raw_dir / "gp_history.csv") if args.raw_dir else GP_HISTORY)
    out_dir = args.out_dir or PROCESSED
    objects_path = (out_dir / "objects.csv") if args.out_dir else OBJECTS
    panel_path = (out_dir / "panel.csv") if args.out_dir else PANEL

    missing = [p.name for p in (satcat_path, decay_path) if not p.exists()]
    if missing:
        sys.exit(
            f"missing raw input(s) in {satcat_path.parent}: {', '.join(missing)}\n"
            "Run `python src/fetch_spacetrack.py` (needs a Space-Track account), or\n"
            "export the catalogue and decay tables from space-track.org by hand.\n"
            "To smoke-test the pipeline on fake data instead:\n"
            "  python src/make_sample_data.py\n"
            "  python src/build_dataset.py --raw-dir data/sample --out-dir data/sample_out"
        )

    sw_daily, _ = space_weather.build(args.sw_all)
    satcat = load_satcat(satcat_path)
    decay = load_decay(decay_path)
    gp = load_gp_history(gp_path)
    if gp is None:
        print(f"no gp_history at {gp_path} -- orbit features will use satcat's leaky "
              "terminal snapshot. Run fetch_gp_history.py for epoch-accurate orbit features.")

    # Anchor censoring on the last OBSERVED space weather day, not on "today" and
    # not on the end of the file -- the file's tail is forecast, and following a
    # censored object into forecast days would claim we had watched it survive
    # dates that have not happened. Keeps the table reproducible too.
    asof = pd.Timestamp(sw_daily.loc[sw_daily["source"].isin(["OBS", "INT"]), "date"].max()).normalize()

    objects = build_objects(satcat, decay, asof)
    panel = build_panel(objects, sw_daily, asof, gp)

    out_dir.mkdir(parents=True, exist_ok=True)
    objects.to_csv(objects_path, index=False)
    panel.to_csv(panel_path, index=False)
    (out_dir / "feature_groups.json").write_text(
        json.dumps(feature_groups(panel), indent=2), encoding="utf-8"
    )

    report(objects, panel, asof)
    print(f"\nwrote {objects_path}\n      {panel_path}\n      {out_dir / 'feature_groups.json'}")


if __name__ == "__main__":
    main()
