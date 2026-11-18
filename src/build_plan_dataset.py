"""Build the PLAN.md junk-only monthly panel into data/processed_plan/.

Requires satcat.csv, decay.csv, SW-All.csv, and gp_history batches in private B2
storage (or a local gp_history.csv). Does not overwrite data/processed/panel.csv.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import build_dataset as base
import space_weather
from b2_storage import connect_b2_history
from config import RAW, SW_ALL

JUNK_TYPES = {"DEBRIS", "ROCKET BODY", "R/B", "TBA", "UNKNOWN"}
START = pd.Timestamp("2015-01-01")
MAX_PERIGEE_KM = 600.0
MAX_ELEMENT_AGE_DAYS = 30.0
SPLIT_SEED = 20261021


def observed_weather(path: Path) -> tuple[pd.DataFrame, pd.Timestamp]:
    raw = space_weather.load_raw(path)
    daily_raw, _ = space_weather.split_cadence(raw)
    observed = daily_raw[daily_raw["F10.7_DATA_TYPE"].str.strip().str.upper().eq("OBS")]
    if observed.empty:
        raise ValueError("SW-All.csv has no OBS daily records.")
    daily = space_weather.tidy_daily(observed)
    daily = daily.sort_values("date").drop_duplicates("date").set_index("date")
    full_dates = pd.date_range(daily.index.min(), daily.index.max(), freq="D")
    daily = daily.reindex(full_dates).rename_axis("date")
    daily["source"] = daily["source"].fillna("FORWARD_FILLED")
    numeric = daily.select_dtypes(include="number").columns
    daily[numeric] = daily[numeric].ffill()
    daily["is_gap_filled"] = daily["source"].eq("FORWARD_FILLED")
    daily = space_weather.add_trailing_features(daily.reset_index())
    return daily, pd.Timestamp(observed["DATE"].max()).normalize()


def monthly_rows(objects: pd.DataFrame, asof: pd.Timestamp) -> pd.DataFrame:
    end = (asof - pd.Timedelta(days=365)).replace(day=1)
    if end < START:
        raise ValueError(f"As-of date {asof.date()} does not allow a full year after 2015.")
    months = pd.date_range(START, end, freq="MS")
    # PLAN Decision 7: only authoritative Historical decay messages.
    if "msg_type" in objects:
        msg_type = objects["msg_type"].fillna("").astype(str).str.strip().str.upper()
        objects = objects.loc[~objects["is_decayed"] | msg_type.eq("HISTORICAL")].copy()
    objects = objects.dropna(subset=["launch_date"])
    chunks = []
    for month in months:
        eligible = objects.loc[
            objects["launch_date"].le(month)
            & (objects["decay_date"].isna() | objects["decay_date"].gt(month))
        ]
        if eligible.empty:
            continue
        part = eligible[["norad_cat_id"]].copy()
        part["obs_date"] = month
        part["epoch_index"] = int((month.year - START.year) * 12 + month.month - 1)
        chunks.append(part)
    if not chunks:
        raise ValueError("No objects qualify for monthly snapshots in the configured period.")
    return pd.concat(chunks, ignore_index=True)


def assign_splits(panel: pd.DataFrame) -> pd.DataFrame:
    # Seeded hash ensures every object receives one split independent of row order.
    def cohort(norad_id: int) -> str:
        value = hashlib.sha256(f"{SPLIT_SEED}:{int(norad_id)}".encode()).digest()[0] % 100
        return "train" if value < 70 else "valid" if value < 85 else "test"

    panel["object_cohort"] = panel["norad_cat_id"].map(cohort)
    year = panel["obs_date"].dt.year
    keep = (
        (panel["object_cohort"].eq("train") & year.between(2015, 2020))
        | (panel["object_cohort"].eq("valid") & year.eq(2022))
        | (panel["object_cohort"].eq("test") & year.ge(2024))
    )
    panel = panel.loc[keep].copy()
    panel["split"] = panel["object_cohort"]
    return panel.drop(columns="object_cohort")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=RAW)
    parser.add_argument("--sw-all", type=Path, default=SW_ALL)
    parser.add_argument("--out-dir", type=Path, default=Path("data/processed_plan"))
    parser.add_argument("--gp-history-source", choices=["b2", "local"], default="b2")
    parser.add_argument("--gp-history", type=Path, default=None)
    parser.add_argument("--env-file", type=Path, default=Path(r"C:\Users\obele\space-cadet-data\.env"))
    args = parser.parse_args()

    satcat_path, decay_path = args.raw_dir / "satcat.csv", args.raw_dir / "decay.csv"
    required = [satcat_path, decay_path, args.sw_all]
    if args.gp_history_source == "local":
        gp_path = args.gp_history or args.raw_dir / "gp_history.csv"
        required.append(gp_path)
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing inputs: " + ", ".join(missing))

    sw, asof = observed_weather(args.sw_all)
    satcat = base.load_satcat(satcat_path)
    decay = base.load_decay(decay_path)
    objects = base.build_objects(satcat, decay, asof)
    types = objects["object_type"].fillna("").astype(str).str.strip().str.upper()
    objects = objects.loc[types.isin(JUNK_TYPES)].copy()
    snapshots = monthly_rows(objects, asof)
    object_columns = [
        "norad_cat_id", "object_name", "object_id", "object_type", "country", "site",
        "launch_date", "decay_date", "is_decayed", "event_observed", "lifetime_days",
        "inclination_deg", "rcs_size", "rcs_value", "is_debris",
    ]
    panel = snapshots.merge(objects[[c for c in object_columns if c in objects]], on="norad_cat_id", validate="many_to_one")
    panel["age_days"] = (panel["obs_date"] - panel["launch_date"]).dt.total_seconds() / 86400
    panel["days_remaining"] = (panel["decay_date"] - panel["obs_date"]).dt.total_seconds() / 86400
    panel["days_followed"] = np.where(
        panel["is_decayed"], panel["days_remaining"], (asof - panel["obs_date"]).dt.total_seconds() / 86400
    )
    # Snapshots all end at least 365 days before as-of. Thus a missing decay
    # event is a known negative, and any event within the following year is 1.
    panel["reenters_within_horizon"] = (
        panel["is_decayed"] & panel["days_remaining"].gt(0) & panel["days_remaining"].le(365)
    ).astype("int8")
    # Join features at the last fully observed date, one day before the snapshot.
    weather_for_join = sw.copy()
    weather_for_join["date"] = pd.to_datetime(weather_for_join["date"]) + pd.Timedelta(days=1)
    panel = base.attach_space_weather(panel, weather_for_join)
    if args.gp_history_source == "b2":
        conn, parquet_glob = connect_b2_history(args.env_file)
        try:
            panel = base.attach_orbit_history_b2(panel, conn, parquet_glob, max_age_days=MAX_ELEMENT_AGE_DAYS)
        finally:
            conn.close()
    else:
        gp = base.load_gp_history(gp_path)
        panel = base.attach_orbit_history(panel, gp, max_age_days=MAX_ELEMENT_AGE_DAYS)

    eligible_orbit = panel["perigee_km_asof"].le(MAX_PERIGEE_KM) & panel["element_age_days"].le(MAX_ELEMENT_AGE_DAYS)
    panel = panel.loc[eligible_orbit].copy()
    panel = assign_splits(panel)
    if panel.empty:
        raise ValueError("No rows remain after PLAN filters and split periods.")
    if panel.duplicated(["norad_cat_id", "obs_date"]).any():
        raise AssertionError("Duplicate object-month snapshots.")
    assert panel["obs_date"].dt.day.eq(1).all()
    assert panel["obs_date"].max() <= asof - pd.Timedelta(days=365)
    assert panel["perigee_km_asof"].le(MAX_PERIGEE_KM).all()
    assert panel["element_age_days"].between(0, MAX_ELEMENT_AGE_DAYS).all()
    split_ids = {name: set(group.norad_cat_id) for name, group in panel.groupby("split")}
    assert not (split_ids.get("train", set()) & split_ids.get("valid", set()))
    assert not (split_ids.get("train", set()) & split_ids.get("test", set()))
    assert not (split_ids.get("valid", set()) & split_ids.get("test", set()))
    assert set(panel.loc[panel.split.eq("train"), "obs_date"].dt.year).issubset(set(range(2015, 2021)))
    assert panel.loc[panel.split.eq("valid"), "obs_date"].dt.year.eq(2022).all()
    assert panel.loc[panel.split.eq("test"), "obs_date"].dt.year.ge(2024).all()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    objects.to_csv(args.out_dir / "objects_junk.csv", index=False)
    panel.to_csv(args.out_dir / "panel.csv", index=False)
    features = base.feature_groups(panel)
    features["targets"] = {"classification": "reenters_within_horizon", "duration": "days_followed", "event": "event_observed"}
    features["split"] = "split"
    features["plan_constraints"] = {
        "snapshot": "first of month, 2015-01 through observed_asof_minus_365d",
        "object_types": sorted(JUNK_TYPES), "max_asof_perigee_km": MAX_PERIGEE_KM,
        "max_element_age_days": MAX_ELEMENT_AGE_DAYS,
        "splits": "object-disjoint seeded hash; train 2015-2020, valid 2022, test 2024+; omit 2021 and 2023",
        "weather": "OBS records only; forward-filled; trailing features joined at obs_date-1",
        "split_seed": SPLIT_SEED,
    }
    (args.out_dir / "feature_groups.json").write_text(json.dumps(features, indent=2), encoding="utf-8")
    print(f"Observed as-of: {asof.date()}; final eligible snapshot: {(asof - pd.Timedelta(days=365)).date()}")
    print(f"Junk objects: {objects.norad_cat_id.nunique():,}; panel rows: {len(panel):,}")
    print(panel.groupby("split").agg(rows=("norad_cat_id", "size"), objects=("norad_cat_id", "nunique"), positive_rate=("reenters_within_horizon", "mean")).to_string())
    print(f"Wrote PLAN panel to {args.out_dir.resolve()}")


if __name__ == "__main__":
    main()
