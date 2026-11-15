"""Phase 4 (D3) model evaluation: baselines vs. candidates, with and without the Sun.

    uv run python src/Models/evaluate.py

Trains on the `train` split, scores on `valid` only, and writes a results table
plus error-by-group tables (always with counts) to `docs/results/`.

What gets compared
------------------
Two baselines and two candidate families, each on two feature sets
(`baseline_no_sun` vs `with_sun_trailing` from feature_groups.json), so the
"does knowing what the Sun is doing help?" question is answered by a difference
between two rows of the same table:

    base_rate          predict the training positive rate / training median
    physics_decay      days until perigee reaches ~120 km at the trailing
                       30-day descent rate (PLAN Phase 4 baseline 2)
    logistic / ridge   linear model on imputed + scaled features
    hist_gb            HistGradientBoosting

Baselines ignore the feature set by construction; they are still reported once
per feature set so every column of the table has a like-for-like comparison.

Two tasks are reported because Decision 1 in PLAN.md is still open:

    classification  reenters_within_horizon (365 days)  -- PR-AUC, Brier,
                    recall at a fixed false-alarm rate. Derived here, not
                    stored in the panel: positive = reentry observed within the
                    horizon; negative = followed for a full horizon with no
                    reentry; rows followed for less than a horizon without a
                    reentry have no defined label and are dropped.
    regression      log1p_days_remaining -- MAE in log1p days, on event rows
                    only (censored rows have no days-left label at all).

Honesty rules this script enforces
----------------------------------
* Test rows are dropped chunk by chunk as the panel is read, so no test feature
  value is ever materialised; only test row/object *counts* reach the metadata.
* Any overlap between a feature set and `leakage_never_use_as_features` is a
  hard error, not a warning.
* Every threshold and cut point that could peek -- the fixed-false-alarm-rate
  threshold, the solar-activity terciles, imputation medians, scalers -- is
  fitted on train and applied to valid.
* Intervals are a bootstrap over *objects*, not rows: an object contributes
  several correlated epochs, so resampling rows would make the intervals look
  far tighter than they are.
* Seeds are fixed (config.RANDOM_SEED) and recorded in run_metadata.json along
  with library versions and a hash of the panel, so a number in docs/results/
  can be traced back to the exact inputs that produced it.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    mean_absolute_error,
    roc_auc_score,
)
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler

from config import PANEL, PROCESSED, RANDOM_SEED, ROOT

RESULTS_DIR = ROOT / "docs" / "results"
FEATURE_GROUPS = PROCESSED / "feature_groups.json"

HORIZON_DAYS = 365.0
# The altitude at which a decaying object is effectively gone, for the physics
# baseline's linear extrapolation.
REENTRY_PERIGEE_KM = 120.0
# "Recall at a fixed false-alarm rate": how many reentries we catch if we accept
# this false-positive rate. 10% is the shoot-or-skip budget the game implies.
FIXED_FAR = 0.10
N_BOOTSTRAP = 1000

FEATURE_SETS = ("baseline_no_sun", "with_sun_trailing")

PERIGEE_BANDS = [0, 300, 400, 500, 600, 800, 1000, np.inf]

# Columns needed for labels, grouping, splitting and the physics baseline --
# never used as model features (the feature sets come from feature_groups.json).
SUPPORT_COLS = [
    "norad_cat_id",
    "obs_date",
    "epoch_index",
    "split",
    "event_observed",
    "is_decayed",
    "days_remaining",
    "days_followed",
    "log1p_days_remaining",
    "perigee_km_asof",
    "perigee_decay_rate_km_per_day",
    "f107_adj_mean_81d",
    "object_type",
    "rcs_size",
]


# --------------------------------------------------------------------------- #
# load
# --------------------------------------------------------------------------- #
def load_train_valid(path: Path, chunksize: int = 200_000) -> tuple[pd.DataFrame, dict]:
    """Read the panel, discarding test rows as they are read.

    Phase 4 is not allowed to look at test. Filtering per chunk means test
    feature values never exist in this process -- the only thing that survives
    is how many rows and objects were skipped, which the report needs.
    """
    kept, test_rows, test_objects = [], 0, set()
    for chunk in pd.read_csv(path, chunksize=chunksize, low_memory=False):
        if "split" not in chunk.columns:
            sys.exit(f"{path} has no `split` column -- rebuild it with src/build_dataset.py")
        is_test = chunk["split"].astype("string").str.strip().str.lower().eq("test")
        test_rows += int(is_test.sum())
        test_objects.update(chunk.loc[is_test, "norad_cat_id"].dropna().unique().tolist())
        kept.append(chunk.loc[~is_test].copy())
        del chunk

    df = pd.concat(kept, ignore_index=True) if kept else pd.DataFrame()
    if df.empty:
        sys.exit(f"{path} has no train/valid rows")

    for col in ("obs_date", "launch_date", "decay_date"):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors="coerce")
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


def load_feature_sets(path: Path, available: set[str]) -> tuple[dict[str, dict], list[str]]:
    """Resolve the ablation feature sets, and refuse to run on a leaky one."""
    manifest = json.loads(Path(path).read_text(encoding="utf-8"))
    banned = set(manifest.get("leakage_never_use_as_features", []))
    ablation = manifest.get("ablation", {})

    resolved, notes = {}, []
    for name in FEATURE_SETS:
        if name not in ablation:
            sys.exit(f"{path} has no ablation entry `{name}`")
        wanted = list(dict.fromkeys(ablation[name]))
        leaky = sorted(set(wanted) & banned)
        if leaky:
            sys.exit(
                f"feature set `{name}` contains leakage columns {leaky} -- "
                "fix feature_groups.json before trusting any score"
            )
        present = [c for c in wanted if c in available]
        missing = [c for c in wanted if c not in available]
        if not present:
            sys.exit(f"feature set `{name}` has no columns present in the panel")
        if missing:
            notes.append(f"{name}: {len(missing)} declared column(s) absent from the panel: {missing}")
        resolved[name] = {"columns": present, "declared": wanted, "missing": missing}
    return resolved, notes


# --------------------------------------------------------------------------- #
# labels
# --------------------------------------------------------------------------- #
def add_horizon_label(df: pd.DataFrame, horizon: float) -> pd.DataFrame:
    """`reenters_within_horizon`: did this object come down within `horizon` days?

    Defined only where the answer is actually known on the data we have:
      positive -- reentry observed at or before obs_date + horizon
      negative -- watched for a full horizon after obs_date, no reentry
      undefined -- censored before the horizon closed (dropped; keeping these as
                   negatives would label "we stopped looking" as "it survived")
    """
    df = df.copy()
    event = df["event_observed"].fillna(0).astype(int).eq(1)
    days_remaining = pd.to_numeric(df["days_remaining"], errors="coerce")
    days_followed = pd.to_numeric(df["days_followed"], errors="coerce")

    positive = event & days_remaining.le(horizon)
    negative = (event & days_remaining.gt(horizon)) | (~event & days_followed.ge(horizon))

    label = pd.Series(pd.NA, index=df.index, dtype="Int64")
    label[positive] = 1
    label[negative] = 0
    df["reenters_within_horizon"] = label
    return df


def classification_frame(df: pd.DataFrame, horizon: float) -> pd.DataFrame:
    df = add_horizon_label(df, horizon)
    out = df[df["reenters_within_horizon"].notna()].copy()
    out["y"] = out["reenters_within_horizon"].astype(int)
    return out


def regression_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Days-left rows: only objects whose reentry was actually observed.

    feature_groups.json says it outright -- a censored row has no days-left
    label, so plain regression has to drop it. That is also exactly why PLAN's
    Decision 1 prefers the horizon label: what is left here is conditional on
    having come down.
    """
    out = df[df["event_observed"].fillna(0).astype(int).eq(1)].copy()
    out = out[pd.to_numeric(out["days_remaining"], errors="coerce").notna()]
    out["y"] = np.log1p(out["days_remaining"].clip(lower=0))
    out["days_true"] = out["days_remaining"].clip(lower=0)
    return out


# --------------------------------------------------------------------------- #
# models
# --------------------------------------------------------------------------- #
def split_feature_types(df: pd.DataFrame, columns: list[str]) -> tuple[list[str], list[str]]:
    categorical, numeric = [], []
    for col in columns:
        s = df[col]
        if pd.api.types.is_bool_dtype(s) or pd.api.types.is_numeric_dtype(s):
            numeric.append(col)
        else:
            categorical.append(col)
    return numeric, categorical


def make_linear_pipeline(estimator, numeric: list[str], categorical: list[str]) -> Pipeline:
    """Impute + scale numerics, one-hot the categoricals. Course requirement:
    every candidate is a scikit-learn Pipeline, nothing fitted by hand."""
    pre = ColumnTransformer(
        [
            (
                "num",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
                        ("scale", StandardScaler()),
                    ]
                ),
                numeric,
            ),
            (
                "cat",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        (
                            "onehot",
                            OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=20),
                        ),
                    ]
                ),
                categorical,
            ),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )
    return Pipeline([("pre", pre), ("model", estimator)])


def make_tree_pipeline(estimator, numeric: list[str], categorical: list[str]) -> Pipeline:
    """HistGradientBoosting handles NaN natively and wants no scaling, so the
    only preprocessing is an ordinal code for the string columns. Categoricals
    come first in the ColumnTransformer so their positions are known."""
    pre = ColumnTransformer(
        [
            (
                "cat",
                OrdinalEncoder(
                    handle_unknown="use_encoded_value",
                    unknown_value=np.nan,
                    encoded_missing_value=np.nan,
                ),
                categorical,
            ),
            ("num", "passthrough", numeric),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )
    estimator.set_params(
        categorical_features=[True] * len(categorical) + [False] * len(numeric)
    )
    return Pipeline([("pre", pre), ("model", estimator)])


def candidates(task: str, numeric: list[str], categorical: list[str], seed: int, with_mlp: bool):
    """The candidate models for one task, each inside a Pipeline."""
    out = {}
    if task == "classification":
        out["logistic"] = make_linear_pipeline(
            LogisticRegression(max_iter=5000, random_state=seed), numeric, categorical
        )
        out["hist_gb"] = make_tree_pipeline(
            HistGradientBoostingClassifier(random_state=seed), numeric, categorical
        )
        if with_mlp:
            out["mlp"] = make_linear_pipeline(
                MLPClassifier(
                    hidden_layer_sizes=(64, 32), max_iter=600, early_stopping=True,
                    random_state=seed,
                ),
                numeric,
                categorical,
            )
    else:
        out["ridge"] = make_linear_pipeline(Ridge(alpha=1.0, random_state=seed), numeric, categorical)
        out["hist_gb"] = make_tree_pipeline(
            HistGradientBoostingRegressor(random_state=seed), numeric, categorical
        )
        if with_mlp:
            out["mlp"] = make_linear_pipeline(
                MLPRegressor(
                    hidden_layer_sizes=(64, 32), max_iter=600, early_stopping=True,
                    random_state=seed,
                ),
                numeric,
                categorical,
            )
    return out


# --------------------------------------------------------------------------- #
# baselines
# --------------------------------------------------------------------------- #
def physics_days_to_reentry(df: pd.DataFrame) -> pd.Series:
    """Days until perigee hits ~120 km at the trailing 30-day descent rate.

    `perigee_decay_rate_km_per_day` is negative while an object is losing
    altitude (see SCHEMA.md). A non-negative or missing rate means this
    baseline has nothing to say -- those rows come back as NaN and the caller
    falls back to the training prior rather than inventing a number.
    """
    perigee = pd.to_numeric(df.get("perigee_km_asof"), errors="coerce")
    rate = pd.to_numeric(df.get("perigee_decay_rate_km_per_day"), errors="coerce")
    descending = rate.notna() & rate.lt(0) & perigee.notna()
    days = (perigee - REENTRY_PERIGEE_KM) / rate.abs()
    return days.where(descending).clip(lower=0)


def baseline_predictions(task: str, train: pd.DataFrame, valid: pd.DataFrame) -> dict:
    """Both PLAN baselines, as (prediction, extras) per name.

    Classification predictions are probabilities. The physics baseline's
    decision is a hard "will it be down inside the horizon", so for ranking
    metrics (PR-AUC, recall at fixed FAR) it is turned into a monotone score --
    sooner reentry, higher score -- which is the same decision rule, just not
    collapsed to 0/1 before the curve is drawn.
    """
    preds = {}
    if task == "classification":
        base_rate = float(train["y"].mean())
        preds["base_rate"] = {
            "score": np.full(len(valid), base_rate),
            "train_score": np.full(len(train), base_rate),
            "note": f"constant training positive rate = {base_rate:.4f}",
        }

        def to_score(frame: pd.DataFrame) -> np.ndarray:
            days = physics_days_to_reentry(frame)
            # exp(-days/horizon): 1 at reentry-now, ~0.37 at exactly the
            # horizon, decaying after -- monotone in the extrapolated date.
            score = np.exp(-days.to_numpy(dtype=float) / HORIZON_DAYS)
            return np.where(np.isnan(score), base_rate, score)

        fallback = float(physics_days_to_reentry(valid).isna().mean())
        preds["physics_decay"] = {
            "score": to_score(valid),
            "train_score": to_score(train),
            "note": (
                f"exp(-days_to_{REENTRY_PERIGEE_KM:.0f}km / {HORIZON_DAYS:.0f}d); "
                f"{fallback:.1%} of valid rows had no usable descent rate and fell back "
                "to the training positive rate"
            ),
        }
    else:
        median_log = float(train["y"].median())
        preds["base_rate"] = {
            "score": np.full(len(valid), median_log),
            "train_score": np.full(len(train), median_log),
            "note": f"constant training median log1p(days) = {median_log:.4f}",
        }

        def to_log_days(frame: pd.DataFrame) -> np.ndarray:
            days = physics_days_to_reentry(frame).to_numpy(dtype=float)
            out = np.log1p(days)
            return np.where(np.isnan(out), median_log, out)

        fallback = float(physics_days_to_reentry(valid).isna().mean())
        preds["physics_decay"] = {
            "score": to_log_days(valid),
            "train_score": to_log_days(train),
            "note": (
                f"log1p(days until perigee reaches {REENTRY_PERIGEE_KM:.0f} km); "
                f"{fallback:.1%} of valid rows fell back to the training median"
            ),
        }
    return preds


# --------------------------------------------------------------------------- #
# metrics
# --------------------------------------------------------------------------- #
def threshold_at_far(y_train: np.ndarray, train_score: np.ndarray, far: float) -> float:
    """Score threshold whose false-alarm rate on TRAIN is <= `far`.

    Picked on train and then applied to valid; choosing it on valid would tune
    the operating point on the split being reported.
    """
    negatives = train_score[y_train == 0]
    if negatives.size == 0:
        return float("inf")
    return float(np.quantile(negatives, 1.0 - far))


def classification_metrics(y: np.ndarray, score: np.ndarray, threshold: float) -> dict:
    if y.size == 0 or y.min() == y.max():
        return {"pr_auc": np.nan, "roc_auc": np.nan, "brier": np.nan, f"recall_at_far_{FIXED_FAR:g}": np.nan}
    flagged = score >= threshold
    positives = y == 1
    return {
        "pr_auc": float(average_precision_score(y, score)),
        "roc_auc": float(roc_auc_score(y, score)),
        "brier": float(brier_score_loss(y, np.clip(score, 0.0, 1.0))),
        f"recall_at_far_{FIXED_FAR:g}": float((flagged & positives).sum() / positives.sum()),
        "far_realised": float((flagged & ~positives).sum() / max((~positives).sum(), 1)),
    }


def regression_metrics(y_log: np.ndarray, pred_log: np.ndarray, days_true: np.ndarray) -> dict:
    if y_log.size == 0:
        return {"mae_log1p_days": np.nan, "rmse_log1p_days": np.nan, "mae_days": np.nan, "median_ae_days": np.nan}
    days_pred = np.expm1(np.clip(pred_log, 0, 30))
    err_days = np.abs(days_pred - days_true)
    return {
        "mae_log1p_days": float(mean_absolute_error(y_log, pred_log)),
        "rmse_log1p_days": float(np.sqrt(np.mean((y_log - pred_log) ** 2))),
        "mae_days": float(np.mean(err_days)),
        "median_ae_days": float(np.median(err_days)),
    }


def bootstrap_by_object(
    metric_fn, groups: np.ndarray, n_boot: int, seed: int
) -> dict[str, tuple[float, float]]:
    """Percentile CIs from resampling OBJECTS with replacement.

    One object contributes several epochs whose errors move together, so a
    row-level bootstrap would understate the interval. Replicates where a
    metric is undefined (e.g. one class only) are discarded and counted.
    """
    rng = np.random.default_rng(seed)
    unique = np.unique(groups)
    # Row indices per object, so a replicate is a concatenation of whole objects.
    order = np.argsort(groups, kind="stable")
    sorted_groups = groups[order]
    starts = np.searchsorted(sorted_groups, unique, side="left")
    ends = np.searchsorted(sorted_groups, unique, side="right")
    blocks = [order[s:e] for s, e in zip(starts, ends)]

    collected: dict[str, list[float]] = {}
    for _ in range(n_boot):
        pick = rng.integers(0, len(blocks), len(blocks))
        idx = np.concatenate([blocks[i] for i in pick])
        for key, value in metric_fn(idx).items():
            if np.isfinite(value):
                collected.setdefault(key, []).append(value)

    return {
        key: (float(np.quantile(vals, 0.025)), float(np.quantile(vals, 0.975)), len(vals))
        for key, vals in collected.items()
    }


# --------------------------------------------------------------------------- #
# error analysis groups
# --------------------------------------------------------------------------- #
def group_assignments(
    train: pd.DataFrame, valid: pd.DataFrame
) -> tuple[dict[str, pd.Series], dict]:
    """The four error-analysis cuts from PLAN Phase 4, computed for valid rows.

    The solar terciles use cut points from TRAIN, so the bands mean the same
    thing in both splits and nothing about valid's solar distribution leaks in.
    The cut points go to run_metadata.json rather than into the band label: the
    two tasks train on different row subsets, so baking the numbers into the
    label would give the same band two names and split it across the tables.
    """
    groups: dict[str, pd.Series] = {}
    info: dict = {}

    perigee = pd.to_numeric(valid.get("perigee_km_asof"), errors="coerce")
    band = pd.cut(perigee, PERIGEE_BANDS, right=False)
    groups["perigee_band_km"] = band.astype("string").fillna("missing")

    for col, name in (("object_type", "object_type"), ("rcs_size", "rcs_size")):
        if col in valid.columns:
            groups[name] = valid[col].astype("string").fillna("missing")

    solar_col = "f107_adj_mean_81d"
    if solar_col in valid.columns and solar_col in train.columns:
        cuts = pd.to_numeric(train[solar_col], errors="coerce").quantile([1 / 3, 2 / 3]).to_numpy()
        values = pd.to_numeric(valid[solar_col], errors="coerce")
        tercile = pd.Series("missing", index=valid.index, dtype="object")
        tercile[values.le(cuts[0])] = "1_low"
        tercile[values.gt(cuts[0]) & values.le(cuts[1])] = "2_mid"
        tercile[values.gt(cuts[1])] = "3_high"
        groups["solar_tercile_f107_81d"] = tercile.astype("string")
        info["solar_tercile_cuts_sfu"] = [round(float(c), 1) for c in cuts]
        info["solar_tercile_source"] = f"train terciles of {solar_col}"

    return groups, info


def error_by_group(
    task: str,
    valid: pd.DataFrame,
    score: np.ndarray,
    threshold: float,
    groups: dict[str, pd.Series],
    min_rows: int,
) -> list[dict]:
    rows = []
    y = valid["y"].to_numpy()
    objects = valid["norad_cat_id"].to_numpy()
    for kind, assignment in groups.items():
        labels = assignment.to_numpy()
        for value in sorted(pd.unique(labels), key=str):
            mask = labels == value
            n = int(mask.sum())
            record = {
                "group_kind": kind,
                "group": str(value),
                "n_rows": n,
                "n_objects": int(pd.unique(objects[mask]).size),
            }
            if task == "classification":
                record["n_positive"] = int((y[mask] == 1).sum())
                record["positive_rate"] = float(y[mask].mean()) if n else np.nan
                record.update(
                    classification_metrics(y[mask], score[mask], threshold)
                    if n >= min_rows
                    else {"pr_auc": np.nan, "roc_auc": np.nan, "brier": np.nan,
                          f"recall_at_far_{FIXED_FAR:g}": np.nan, "far_realised": np.nan}
                )
            else:
                days_true = valid["days_true"].to_numpy()
                record["mean_days_true"] = float(np.mean(days_true[mask])) if n else np.nan
                record.update(
                    regression_metrics(y[mask], score[mask], days_true[mask])
                    if n >= min_rows
                    else {"mae_log1p_days": np.nan, "rmse_log1p_days": np.nan,
                          "mae_days": np.nan, "median_ae_days": np.nan}
                )
            rows.append(record)
    return rows


# --------------------------------------------------------------------------- #
# the run
# --------------------------------------------------------------------------- #
def run_task(
    task: str,
    frame: pd.DataFrame,
    feature_sets: dict[str, dict],
    args,
) -> tuple[list[dict], list[dict], list[dict]]:
    train = frame[frame["split"] == "train"].reset_index(drop=True)
    valid = frame[frame["split"] == "valid"].reset_index(drop=True)
    if train.empty or valid.empty:
        return [], [], [{"task": task, "problem": "train or valid is empty after labelling"}]
    if task == "classification" and (train["y"].nunique() < 2 or valid["y"].nunique() < 2):
        return [], [], [{"task": task, "problem": "only one class present in train or valid"}]

    groups, group_info = group_assignments(train, valid)
    objects_valid = valid["norad_cat_id"].to_numpy()
    results, error_rows, notes = [], [], []

    def score_one(name: str, feature_set: str, valid_score: np.ndarray, train_score: np.ndarray, note: str):
        if task == "classification":
            threshold = threshold_at_far(train["y"].to_numpy(), train_score, args.far)
            point = classification_metrics(valid["y"].to_numpy(), valid_score, threshold)

            def metric_fn(idx):
                return classification_metrics(valid["y"].to_numpy()[idx], valid_score[idx], threshold)
        else:
            threshold = np.nan
            point = regression_metrics(
                valid["y"].to_numpy(), valid_score, valid["days_true"].to_numpy()
            )

            def metric_fn(idx):
                return regression_metrics(
                    valid["y"].to_numpy()[idx], valid_score[idx], valid["days_true"].to_numpy()[idx]
                )

        ci = bootstrap_by_object(metric_fn, objects_valid, args.bootstrap, args.seed)
        row = {
            "task": task,
            "model": name,
            "feature_set": feature_set,
            "kind": "baseline" if name in ("base_rate", "physics_decay") else "candidate",
            "n_valid_rows": int(len(valid)),
            "n_valid_objects": int(pd.unique(objects_valid).size),
            "n_train_rows": int(len(train)),
            "n_train_objects": int(train["norad_cat_id"].nunique()),
        }
        if task == "classification":
            row["valid_positive_rate"] = float(valid["y"].mean())
            row["threshold_at_far_from_train"] = float(threshold)
        for key, value in point.items():
            row[key] = value
            if key in ci:
                lo, hi, n_ok = ci[key]
                row[f"{key}_lo95"], row[f"{key}_hi95"] = lo, hi
                row[f"{key}_boot_n"] = n_ok
        row["note"] = note
        results.append(row)

        for rec in error_by_group(task, valid, valid_score, threshold, groups, args.min_group_rows):
            error_rows.append({"task": task, "model": name, "feature_set": feature_set, **rec})

    for feature_set, spec in feature_sets.items():
        columns = spec["columns"]
        numeric, categorical = split_feature_types(train, columns)
        notes.append(
            {
                "task": task,
                "feature_set": feature_set,
                "n_features": len(columns),
                "n_numeric": len(numeric),
                "n_categorical": len(categorical),
                "missing_declared": spec["missing"],
                **group_info,
            }
        )

        for name, spec_pred in baseline_predictions(task, train, valid).items():
            score_one(name, feature_set, spec_pred["score"], spec_pred["train_score"], spec_pred["note"])

        for name, pipe in candidates(task, numeric, categorical, args.seed, args.with_mlp).items():
            X_train, X_valid = train[columns], valid[columns]
            pipe.fit(X_train, train["y"])
            if task == "classification":
                valid_score = pipe.predict_proba(X_valid)[:, 1]
                train_score = pipe.predict_proba(X_train)[:, 1]
            else:
                valid_score = pipe.predict(X_valid)
                train_score = pipe.predict(X_train)
            score_one(
                name,
                feature_set,
                np.asarray(valid_score, dtype=float),
                np.asarray(train_score, dtype=float),
                f"sklearn Pipeline, {len(columns)} features, seed {args.seed}",
            )

    return results, error_rows, notes


# --------------------------------------------------------------------------- #
# output
# --------------------------------------------------------------------------- #
def to_markdown(df: pd.DataFrame, float_fmt: str = "{:.4g}") -> str:
    """Small markdown table writer -- avoids adding a tabulate dependency."""
    if df.empty:
        return "_(no rows)_\n"
    shown = df.copy()
    for col in shown.columns:
        if pd.api.types.is_float_dtype(shown[col]):
            shown[col] = shown[col].map(lambda v: "" if pd.isna(v) else float_fmt.format(v))
        else:
            shown[col] = shown[col].astype("string").fillna("")
    header = "| " + " | ".join(shown.columns) + " |"
    rule = "| " + " | ".join("---" for _ in shown.columns) + " |"
    body = "\n".join("| " + " | ".join(r) + " |" for r in shown.to_numpy().tolist())
    return "\n".join([header, rule, body]) + "\n"


def with_ci(df: pd.DataFrame, metrics: list[str]) -> pd.DataFrame:
    """Collapse point estimate + bootstrap bounds into one readable column."""
    out = df.copy()
    for metric in metrics:
        if metric not in out.columns:
            continue
        lo, hi = f"{metric}_lo95", f"{metric}_hi95"
        if lo in out.columns:
            out[metric] = [
                "" if pd.isna(p) else (
                    f"{p:.4g}" if pd.isna(l) else f"{p:.4g} [{l:.4g}, {h:.4g}]"
                )
                for p, l, h in zip(out[metric], out[lo], out[hi])
            ]
    return out


CLASSIFICATION_HEADLINE = ["pr_auc", "brier", f"recall_at_far_{FIXED_FAR:g}", "far_realised", "roc_auc"]
REGRESSION_HEADLINE = ["mae_log1p_days", "rmse_log1p_days", "median_ae_days", "mae_days"]


def write_outputs(results: pd.DataFrame, errors: pd.DataFrame, meta: dict, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []

    banner = meta.get("provenance_banner")
    if banner:
        results = results.assign(provenance=banner)
        errors = errors.assign(provenance=banner)

    results.to_csv(out_dir / "results_valid.csv", index=False)
    errors.to_csv(out_dir / "error_by_group.csv", index=False)
    (out_dir / "run_metadata.json").write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    written += [out_dir / "results_valid.csv", out_dir / "error_by_group.csv", out_dir / "run_metadata.json"]

    lines = [
        "# Phase 4 — model evaluation on the validation split",
        "",
        f"Generated by `src/Models/evaluate.py` on {meta['generated_at']}. "
        "Trained on `train`, scored on `valid`. Test rows were never read.",
        "",
    ]
    if banner:
        lines += [f"> **{banner}**", ""]
    lines += [
        f"Panel: `{meta['panel_path']}` (sha256 `{meta['panel_sha256'][:12]}`), "
        f"seed {meta['seed']}, {meta['bootstrap']} object-level bootstrap replicates.",
        "",
        "Square brackets are 95% percentile intervals from resampling **objects** "
        "(not rows) with replacement.",
        "",
    ]

    for task, headline in (("classification", CLASSIFICATION_HEADLINE), ("regression", REGRESSION_HEADLINE)):
        part = results[results["task"] == task]
        if part.empty:
            continue
        if task == "classification":
            lines += [
                f"## Will it reenter within {meta['horizon_days']:.0f} days? (`reenters_within_horizon`)",
                "",
                "PR-AUC is the headline (positives are rare), Brier scores the probabilities, "
                f"and `recall_at_far_{FIXED_FAR:g}` is how many reentries are caught at a "
                f"{FIXED_FAR:.0%} false-alarm rate — threshold chosen on train, applied to valid. "
                "`far_realised` is the false-alarm rate that threshold actually produced on "
                "valid: a constant-score baseline only \"catches everything\" by flagging "
                "everything, and that column is where it shows.",
                "",
                f"Valid rows: {int(part['n_valid_rows'].iloc[0]):,} "
                f"({int(part['n_valid_objects'].iloc[0]):,} objects), "
                f"positive rate {part['valid_positive_rate'].iloc[0]:.3f}.",
                "",
            ]
            cols = ["model", "feature_set", "kind"] + headline
        else:
            lines += [
                "## How many days are left? (`log1p_days_remaining`, observed reentries only)",
                "",
                "Conditional on the object having come down — censored rows carry no days-left "
                "label, which is the bias PLAN Decision 1 warns about.",
                "",
                f"Valid rows: {int(part['n_valid_rows'].iloc[0]):,} "
                f"({int(part['n_valid_objects'].iloc[0]):,} objects).",
                "",
            ]
            cols = ["model", "feature_set", "kind"] + headline
        lines.append(to_markdown(with_ci(part, headline)[cols]))
        lines.append("")

        sun_delta = ablation_delta(part, headline[0], task)
        if sun_delta is not None:
            lines += [
                "### Does space weather help?",
                "",
                f"`with_sun_trailing` minus `baseline_no_sun`, on {headline[0]} "
                "(baselines ignore features, so their delta is 0 by construction).",
                "",
                to_markdown(sun_delta),
                "",
            ]

    lines += [
        "## Error by group",
        "",
        "Full tables in `error_by_group.csv` (every model × feature set × cut, with counts). "
        f"Groups with fewer than {meta['min_group_rows']} valid rows get counts but no metrics — "
        "a PR-AUC over a handful of rows is noise, and PLAN asks for counts alongside every "
        "subgroup claim.",
        "",
    ]
    for kind in sorted(errors["group_kind"].dropna().unique()):
        part = errors[errors["group_kind"] == kind]
        counts = (
            part.drop_duplicates(["task", "group"])[["task", "group", "n_rows", "n_objects"]]
            .sort_values(["task", "group"])
        )
        lines += [f"### {kind}", "", to_markdown(counts), ""]

    for note in meta.get("warnings", []):
        lines += [f"- warning: {note}"]

    (out_dir / "RESULTS.md").write_text("\n".join(lines), encoding="utf-8")
    written.append(out_dir / "RESULTS.md")
    return written


def ablation_delta(part: pd.DataFrame, metric: str, task: str) -> pd.DataFrame | None:
    if metric not in part.columns:
        return None
    wide = part.pivot_table(index=["model", "kind"], columns="feature_set", values=metric)
    if not {"baseline_no_sun", "with_sun_trailing"}.issubset(wide.columns):
        return None
    wide = wide.reset_index()
    wide[f"delta_{metric}"] = wide["with_sun_trailing"] - wide["baseline_no_sun"]
    better = "lower is better" if task == "regression" or metric == "brier" else "higher is better"
    wide["direction"] = better
    return wide


def sha256(path: Path, limit_bytes: int = 256 * 1024 * 1024) -> str:
    h = hashlib.sha256()
    read = 0
    with open(path, "rb") as fh:
        while chunk := fh.read(1024 * 1024):
            h.update(chunk)
            read += len(chunk)
            if read >= limit_bytes:
                h.update(b"TRUNCATED")
                break
    return h.hexdigest()


def parse_args(argv: list[str] | None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--panel", type=Path, default=PANEL, help="panel.csv (default: data/processed/panel.csv)")
    ap.add_argument("--feature-groups", type=Path, default=FEATURE_GROUPS, help="feature_groups.json")
    ap.add_argument("--out", type=Path, default=RESULTS_DIR, help="output directory (default: docs/results)")
    ap.add_argument(
        "--task", choices=("classification", "regression", "both"), default="both",
        help="which label to evaluate (default: both, because PLAN Decision 1 is open)",
    )
    ap.add_argument("--horizon-days", type=float, default=HORIZON_DAYS)
    ap.add_argument("--far", type=float, default=FIXED_FAR, help="fixed false-alarm rate for recall")
    ap.add_argument("--bootstrap", type=int, default=N_BOOTSTRAP, help="object-level bootstrap replicates")
    ap.add_argument("--min-group-rows", type=int, default=30, help="smallest subgroup that gets metrics")
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    ap.add_argument("--with-mlp", action="store_true", help="also fit the optional MLP candidate")
    ap.add_argument(
        "--banner", default=None,
        help="provenance warning stamped on every output (use it when the panel is not real data)",
    )
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    if not args.panel.exists():
        sys.exit(
            f"no panel at {args.panel}\n"
            "Phase 4 needs the modelling table built first:\n"
            "  uv run python src/build_dataset.py\n"
            "or, to smoke-test this script on fake data:\n"
            "  uv run python src/make_sample_data.py\n"
            "  uv run python src/build_dataset.py --raw-dir data/sample --out-dir data/sample_out\n"
            "  uv run python src/Models/evaluate.py --panel data/sample_out/panel.csv \\\n"
            "      --feature-groups data/sample_out/feature_groups.json --out /tmp/fixture_results \\\n"
            "      --banner 'SYNTHETIC FIXTURE -- NOT RESULTS'"
        )

    df, counts = load_train_valid(args.panel)
    missing_support = [c for c in SUPPORT_COLS if c not in df.columns]
    feature_sets, fs_notes = load_feature_sets(args.feature_groups, set(df.columns))

    warnings = list(fs_notes)
    if missing_support:
        warnings.append(f"panel is missing expected support column(s): {missing_support}")

    tasks = ("classification", "regression") if args.task == "both" else (args.task,)
    all_results, all_errors, all_notes = [], [], []
    for task in tasks:
        frame = (
            classification_frame(df, args.horizon_days)
            if task == "classification"
            else regression_frame(df)
        )
        dropped = len(df) - len(frame)
        all_notes.append({"task": task, "rows_used": int(len(frame)), "rows_without_label": int(dropped)})
        print(f"[{task}] {len(frame):,} labelled train+valid rows ({dropped:,} without a usable label)")
        results, errors, notes = run_task(task, frame, feature_sets, args)
        all_results += results
        all_errors += errors
        for note in notes:
            if "problem" in note:
                warnings.append(f"{task}: {note['problem']}")
            else:
                all_notes.append(note)

    if not all_results:
        sys.exit("nothing could be evaluated:\n  " + "\n  ".join(warnings))

    results = pd.DataFrame(all_results)
    errors = pd.DataFrame(all_errors)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "panel_path": str(args.panel),
        "panel_sha256": sha256(args.panel),
        "feature_groups_path": str(args.feature_groups),
        "seed": args.seed,
        "bootstrap": args.bootstrap,
        "horizon_days": args.horizon_days,
        "fixed_far": args.far,
        "min_group_rows": args.min_group_rows,
        "reentry_perigee_km": REENTRY_PERIGEE_KM,
        "with_mlp": bool(args.with_mlp),
        "split_counts": counts,
        "task_notes": all_notes,
        "warnings": warnings,
        "provenance_banner": args.banner,
        "versions": {
            "python": platform.python_version(),
            "scikit-learn": sklearn.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
        },
    }

    written = write_outputs(results, errors, meta, args.out)
    print("\nwrote:")
    for path in written:
        print(f"  {path}")
    for note in warnings:
        print(f"  warning: {note}")


if __name__ == "__main__":
    main()
