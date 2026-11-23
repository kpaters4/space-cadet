"""Fit and save the pipeline the Space Cadet API serves (D4, PLAN Phase 5).

    uv run --group api python src/Models/build_api_pipeline.py \
        --panel data/processed_plan/panel.csv --out api/pipeline.joblib

What it does
------------
1. Reads train and valid rows of panel.csv. Test rows are dropped as the file
   is read, so no test value is ever loaded.
2. Maps panel columns onto the API's raw input fields (see PANEL_TO_API).
3. Fits OrbitFeatureBuilder -> one-hot encoding -> HistGradientBoosting on train,
   scores validation (PR-AUC, ROC AUC, Brier, recall at <=10% false alarms) next
   to the training-rate and physics baselines, and locks the decision threshold
   on validation at a false-alarm rate of at most 10%.
4. Refits the same pipeline on train + valid (PLAN Phase 5) unless
   --fit-on train is given, and saves {pipeline, metadata} with joblib.

This is the API's model, not the 52-feature model in the D3 notebooks: it uses
only the fields a person can type into the website, so its validation numbers
are reported separately in the bundle metadata.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score, roc_curve
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

SRC = Path(__file__).resolve().parents[1]
ROOT = SRC.parent
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from config import HORIZON_DAYS, RANDOM_SEED  # noqa: E402
from features.transformers import (  # noqa: E402
    CATEGORICAL_OUT,
    RAW_CATEGORICAL,
    RAW_FIELDS,
    RAW_NUMERIC,
    OrbitFeatureBuilder,
    physics_baseline,
)

TARGET = "reenters_within_horizon"
MAX_FALSE_ALARM = 0.10
MODEL_VERSION = "space-cadet-reentry-hgb-1"

# panel column -> API field. perigee_km_30d_ago is rebuilt from the descent rate.
PANEL_TO_API = {
    "perigee_km_asof": "perigee_km",
    "apogee_km_asof": "apogee_km",
    "inclination_deg_asof": "inclination_deg",
    "bstar": "bstar",
    "age_days": "age_days",
    "f107_adj_mean_81d": "f107_81d_mean",
    "ap_mean_27d": "ap_27d_mean",
    "object_type": "object_type",
    "rcs_size": "rcs_size",
}
PANEL_COLUMNS = ["norad_cat_id", "split", TARGET, "perigee_decay_rate_km_per_day", *PANEL_TO_API]


def load_panel(path: Path) -> pd.DataFrame:
    """Train and valid rows only; test rows are filtered out chunk by chunk."""
    parts = []
    for chunk in pd.read_csv(path, usecols=PANEL_COLUMNS, chunksize=200_000):
        parts.append(chunk[chunk["split"].isin(["train", "valid"])])
    return pd.concat(parts, ignore_index=True)


def to_api_frame(panel: pd.DataFrame) -> pd.DataFrame:
    """Panel rows -> the raw fields the API receives."""
    X = panel[list(PANEL_TO_API)].rename(columns=PANEL_TO_API)
    # The panel stores perigee change per day (negative while coming down);
    # 30 days ago the perigee was higher by 30 x that loss.
    X["perigee_km_30d_ago"] = panel["perigee_km_asof"] - 30.0 * panel["perigee_decay_rate_km_per_day"]
    return X[RAW_FIELDS]


def make_pipeline(seed: int = RANDOM_SEED) -> Pipeline:
    encode = ColumnTransformer(
        [("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_OUT)],
        remainder="passthrough",
        verbose_feature_names_out=False,
    )
    model = HistGradientBoostingClassifier(
        learning_rate=0.05, max_iter=300, max_leaf_nodes=31, l2_regularization=1.0,
        early_stopping=False, random_state=seed,
    )
    return Pipeline([("features", OrbitFeatureBuilder()), ("encode", encode), ("model", model)])


def recall_at_false_alarm(y, p, max_far=MAX_FALSE_ALARM) -> tuple[float, float]:
    """Best recall with false-alarm rate <= max_far, and the threshold that gives it."""
    fpr, tpr, thr = roc_curve(y, p)
    ok = fpr <= max_far
    i = int(np.argmax(np.where(ok, tpr, -1)))
    return float(tpr[i]), float(min(thr[i], 1.0))


def metrics(y, p) -> dict:
    y = np.asarray(y)
    out = {"pr_auc": float(average_precision_score(y, p)), "brier": float(brier_score_loss(y, p))}
    out["roc_auc"] = float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else float("nan")
    out["recall_at_far_0.10"] = recall_at_false_alarm(y, p)[0] if len(np.unique(y)) > 1 else float("nan")
    return out


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def build_bundle(panel: pd.DataFrame, fit_on: str = "train+valid", seed: int = RANDOM_SEED,
                 panel_path: Path | None = None) -> dict:
    train, valid = panel[panel["split"] == "train"], panel[panel["split"] == "valid"]
    if train.empty or valid.empty:
        raise ValueError("panel needs both train and valid rows")
    X_train, y_train = to_api_frame(train), train[TARGET].astype(int).to_numpy()
    X_valid, y_valid = to_api_frame(valid), valid[TARGET].astype(int).to_numpy()

    # 1. Fit on train, evaluate on validation.
    pipe = make_pipeline(seed).fit(X_train, y_train)
    p_valid = pipe.predict_proba(X_valid)[:, 1]
    _, threshold = recall_at_false_alarm(y_valid, p_valid)
    physics, _ = physics_baseline(X_valid["perigee_km"], X_valid["perigee_km_30d_ago"], horizon_days=HORIZON_DAYS)
    valid_metrics = {
        "model": metrics(y_valid, p_valid),
        "physics_baseline": metrics(y_valid, physics.astype(float)),
        "training_rate_baseline": metrics(y_valid, np.full(len(y_valid), y_train.mean())),
    }

    # 2. Refit for serving.
    if fit_on == "train+valid":
        both = pd.concat([train, valid])
        pipe = make_pipeline(seed).fit(to_api_frame(both), both[TARGET].astype(int).to_numpy())
        fitted = both
    else:
        fitted = train

    features = pipe.named_steps["features"]
    metadata = {
        "model_version": MODEL_VERSION,
        "steps": [name for name, _ in pipe.steps],
        "custom_transformer": "features.transformers.OrbitFeatureBuilder",
        "built_at": datetime.now(timezone.utc).isoformat(),
        "sklearn_version": sklearn.__version__,
        "python_version": platform.python_version(),
        "pandas_version": pd.__version__,
        "numpy_version": np.__version__,
        "target": TARGET,
        "horizon_days": HORIZON_DAYS,
        "input_fields": {"numeric": RAW_NUMERIC, "categorical": RAW_CATEGORICAL},
        "categories_seen": features.categories_seen_,
        "training_ranges": features.ranges_,
        "threshold": threshold,
        "threshold_rule": f"highest recall with false-alarm rate <= {MAX_FALSE_ALARM:.0%} on validation "
                          "(model fitted on train only)",
        "fit_on": fit_on,
        "rows": {"train": int(len(train)), "valid": int(len(valid)), "fitted": int(len(fitted))},
        "objects": {"train": int(train["norad_cat_id"].nunique()), "valid": int(valid["norad_cat_id"].nunique())},
        "positive_rate": {"train": float(y_train.mean()), "valid": float(y_valid.mean())},
        "validation_metrics": valid_metrics,
        "panel_sha256": sha256(panel_path) if panel_path else None,
        "panel_file": panel_path.name if panel_path else None,
        "seed": seed,
        "notes": [
            "Test rows were never read when building this artifact.",
            "This is the API model: it uses only the fields the website asks for, so it is "
            "smaller than the 52-feature D3 notebook model and its validation metrics are its own.",
            "When fit_on is train+valid, the threshold was locked on validation using the "
            "train-only fit and then applied to the refit model.",
        ],
    }
    return {"pipeline": pipe, "metadata": metadata}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--panel", type=Path, default=ROOT / "data" / "processed_plan" / "panel.csv")
    ap.add_argument("--out", type=Path, default=ROOT / "api" / "pipeline.joblib")
    ap.add_argument("--fit-on", choices=["train+valid", "train"], default="train+valid")
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args(argv)

    if not args.panel.exists():
        sys.exit(f"panel not found: {args.panel}")
    panel = load_panel(args.panel)
    bundle = build_bundle(panel, fit_on=args.fit_on, seed=args.seed, panel_path=args.panel)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, args.out)

    m = bundle["metadata"]
    print(f"saved {args.out}  (sklearn {m['sklearn_version']}, fit on {m['fit_on']}, {m['rows']['fitted']:,} rows)")
    print(f"threshold (locked on validation): {m['threshold']:.4f}")
    print("validation metrics:")
    print(json.dumps(m["validation_metrics"], indent=2))


if __name__ == "__main__":
    main()
