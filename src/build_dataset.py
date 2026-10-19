"""Combine the three datasets into a modelling table for the research question:

    Can we predict how many days a piece of space junk has left before it burns
    up, and does knowing what the Sun is doing make the prediction better?

Inputs  (data/raw/)   SW-All.csv, satcat.csv, decay.csv
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
1. satcat's APOGEE / PERIGEE / PERIOD are the LAST values on file, not values as
   of the observation epoch. For a decayed object those describe its final,
   already-decaying orbit, which partly encodes the answer. Those columns are
   flagged by `orbit_snapshot_is_terminal` and isolated in the `orbit_terminal`
   feature group. For an honest model, pull Space-Track `gp_history` and take
   elements at each epoch instead -- see README.
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
    MAX_PERIGEE_KM,
    MIN_EPOCH,
    OBJECTS,
    PANEL,
    PROCESSED,
    RANDOM_SEED,
    SATCAT,
    SW_ALL,
)
from normalize import DECAY_ALIASES, SATCAT_ALIASES, normalize

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


def build_panel(objects: pd.DataFrame, sw: pd.DataFrame, asof: pd.Timestamp) -> pd.DataFrame:
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
        c
        for c in ("apogee_km", "perigee_km", "period_min", "sma_km", "eccentricity", "mean_alt_km")
        if c in cols
    ]
    orbit_static = [
        c
        for c in ("inclination_deg", "regime", "rcs_size", "rcs_value", "object_type",
                  "is_debris", "country")
        if c in cols
    ]
    base = orbit_static + orbit_terminal + ["age_days"]
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
            "object_age": ["age_days"],
            "space_weather_trailing": sw_trailing,
            "space_weather_forward": sw_forward,
        },
        "ablation": {
            "baseline_no_sun": base,
            "with_sun_trailing": base + sw_trailing,
            "with_sun_and_forecast": base + sw_trailing + sw_forward,
        },
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
        "notes": [
            "orbit_terminal columns are satcat's LAST elements on file; for decayed "
            "objects they leak the answer. Exclude them, or replace them with "
            "gp_history elements at each epoch, for an honest score.",
            "space_weather_forward requires a solar forecast at inference time.",
            "Drop event_observed == 0 rows for plain regression; keep them for "
            "survival models.",
        ],
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

    # Sanity checks that would otherwise rot silently.
    assert (panel.loc[ev, "days_remaining"] >= 0).all(), "negative days_remaining"
    assert panel["age_days"].min() >= 0, "epoch before launch"
    assert not panel.duplicated(["norad_cat_id", "obs_date"]).any(), "duplicate epochs"
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
    args = ap.parse_args(argv)

    satcat_path = (args.raw_dir / "satcat.csv") if args.raw_dir else SATCAT
    decay_path = (args.raw_dir / "decay.csv") if args.raw_dir else DECAY
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

    # Anchor censoring on the last OBSERVED space weather day, not on "today" and
    # not on the end of the file -- the file's tail is forecast, and following a
    # censored object into forecast days would claim we had watched it survive
    # dates that have not happened. Keeps the table reproducible too.
    asof = pd.Timestamp(sw_daily.loc[sw_daily["source"].isin(["OBS", "INT"]), "date"].max()).normalize()

    objects = build_objects(satcat, decay, asof)
    panel = build_panel(objects, sw_daily, asof)

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
