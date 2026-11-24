"""Phase 5 (D4): fit the serving pipeline and save it for the API.

    uv run python src/Models/fit_serving_pipeline.py

What this does
--------------
1. Reads the panel (test rows are dropped as they are read and never used) and
   builds the exact raw-field frame the API will receive (features/training_data.py).
2. Compares serving candidates on the VALID split only, each fit on train only:
       base_rate, physics_decay          (baselines)
       logistic, hist_gb                 (each = OrbitFeatureBuilder -> prep -> model)
   plus ``hist_gb_full_panel`` -- a D3-style model on the panel's 20 baseline_no_sun
   columns -- as a reference, so the cost of serving only the 9 API fields is
   measured, not assumed. The reference is never served.
3. Picks the serving candidate with the best valid PR-AUC (rule fixed up front).
4. Refits the winner on train + valid and saves it with joblib, plus a metadata JSON
   (versions, data hashes, counts, metrics, schema, learned ranges) next to it.

Honesty rules: the test split is never read; every threshold, median and range is
learned from training rows only; seeds are fixed (config.RANDOM_SEED); intervals are
bootstrapped over OBJECTS, not rows, because one object contributes many snapshots.
The metrics in the metadata come from the train-only fits. The shipped model is
refit on train + valid, so it has no held-out score of its own.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score, roc_curve
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

import build_dataset as bd  # noqa: E402
import space_weather  # noqa: E402
from config import GP_HISTORY, HORIZON_DAYS, PANEL, RANDOM_SEED, ROOT, SW_ALL  # noqa: E402
from features import training_data as td  # noqa: E402
from features.baselines import physics_reenters_within_horizon  # noqa: E402
from features.transformers import (  # noqa: E402
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
    RAW_FIELDS,
    OrbitFeatureBuilder,
)

ARTIFACT_DIR = ROOT / "artifacts"
RESULTS_DIR = ROOT / "docs" / "results" / "d4"
PIPELINE_FILE = "orbit_pipeline.joblib"
METADATA_FILE = "orbit_pipeline_metadata.json"
PIPELINE_VERSION = "1.0.0"

SERVING_CANDIDATES = ("logistic", "hist_gb")
FIXED_FAR = 0.10
N_BOOTSTRAP = 1000
TARGET = td.TARGET


# --------------------------------------------------------------------------- #
# pipelines
# --------------------------------------------------------------------------- #
def make_serving_pipeline(kind: str, seed: int = RANDOM_SEED) -> Pipeline:
    """OrbitFeatureBuilder -> column prep (flag column dropped) -> classifier."""
    if kind == "logistic":
        numeric = StandardScaler()
        model = LogisticRegression(max_iter=5000, random_state=seed)
    elif kind == "hist_gb":
        numeric = "passthrough"
        model = HistGradientBoostingClassifier(random_state=seed)
    else:
        raise ValueError(f"unknown serving model {kind!r}")
    prep = ColumnTransformer(
        [
            ("num", numeric, list(NUMERIC_FEATURES)),
            ("cat", OneHotEncoder(handle_unknown="ignore"), list(CATEGORICAL_FEATURES)),
        ],
        remainder="drop",  # drops out_of_training_range: it is an output, not a feature
    )
    return Pipeline([("features", OrbitFeatureBuilder()), ("prep", prep), ("model", model)])


def make_reference_pipeline(numeric: list[str], categorical: list[str], seed: int = RANDOM_SEED) -> Pipeline:
    """D3-style model on the panel's own columns. Reference only; never served."""
    prep = ColumnTransformer(
        [
            ("num", SimpleImputer(strategy="median"), numeric),
            (
                "cat",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical,
            ),
        ]
    )
    return Pipeline([("prep", prep), ("model", HistGradientBoostingClassifier(random_state=seed))])


# --------------------------------------------------------------------------- #
# metrics
# --------------------------------------------------------------------------- #
def recall_at_far(y: np.ndarray, p: np.ndarray, far: float = FIXED_FAR) -> float:
    """Share of reentries caught when the false-alarm rate is held at `far` (ROC interpolation)."""
    if len(np.unique(y)) < 2:
        return float("nan")
    fpr, tpr, _ = roc_curve(y, p)
    return float(np.interp(far, fpr, tpr))


def metric_row(y: np.ndarray, p: np.ndarray) -> dict:
    two_classes = len(np.unique(y)) == 2
    return {
        "pr_auc": float(average_precision_score(y, p)) if two_classes else float("nan"),
        "brier": float(brier_score_loss(y, p)),
        "roc_auc": float(roc_auc_score(y, p)) if two_classes else float("nan"),
        "recall_at_10pct_far": recall_at_far(y, p),
    }


def bootstrap_by_object(
    y: np.ndarray, p: np.ndarray, objects: np.ndarray, n: int = N_BOOTSTRAP, seed: int = RANDOM_SEED
) -> dict:
    """95% intervals from resampling whole OBJECTS (their snapshots are correlated)."""
    rng = np.random.default_rng(seed)
    order = np.argsort(objects, kind="stable")
    y, p, objects = y[order], p[order], objects[order]
    uniq, starts, counts = np.unique(objects, return_index=True, return_counts=True)
    stats = {"pr_auc": [], "brier": [], "roc_auc": [], "recall_at_10pct_far": []}
    for _ in range(n):
        pick = rng.integers(0, len(uniq), len(uniq))
        idx = np.concatenate([np.arange(starts[i], starts[i] + counts[i]) for i in pick])
        yy, pp = y[idx], p[idx]
        if len(np.unique(yy)) < 2:
            continue
        for k, v in metric_row(yy, pp).items():
            stats[k].append(v)
    return {
        k: [float(np.nanpercentile(v, 2.5)), float(np.nanpercentile(v, 97.5))] if v else [float("nan")] * 2
        for k, v in stats.items()
    }


def calibration_table(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    """Observed rate vs mean predicted probability in score-ranked bins (with counts)."""
    df = pd.DataFrame({"y": y, "p": p})
    df["bin"] = pd.qcut(df["p"].rank(method="first"), q=min(bins, len(df)), labels=False)
    out = df.groupby("bin").agg(n=("y", "size"), mean_predicted=("p", "mean"), observed_rate=("y", "mean"))
    return [
        {"bin": int(i), "n": int(r.n), "mean_predicted": float(r.mean_predicted), "observed_rate": float(r.observed_rate)}
        for i, r in out.iterrows()
    ]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def sha256_of(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while block := fh.read(chunk):
            h.update(block)
    return h.hexdigest()


def git_state() -> dict:
    def run(*args: str) -> str:
        try:
            return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        except Exception:
            return ""

    return {"commit": run("rev-parse", "HEAD") or None, "dirty": bool(run("status", "--porcelain"))}


def positive_rate(y: pd.Series) -> float:
    return float(np.mean(y)) if len(y) else float("nan")


# --------------------------------------------------------------------------- #
# main work
# --------------------------------------------------------------------------- #
def compare_candidates(
    frame: pd.DataFrame, panel: pd.DataFrame, feature_cols: tuple[list[str], list[str]], seed: int
) -> tuple[pd.DataFrame, dict, dict]:
    """Fit each candidate on train, score on valid. Returns (table, valid predictions, intervals)."""
    is_train = frame["split"].eq("train").to_numpy()
    is_valid = frame["split"].eq("valid").to_numpy()
    y = frame[TARGET].astype(int).to_numpy()
    y_tr, y_va = y[is_train], y[is_valid]
    objects_va = frame.loc[is_valid, "norad_cat_id"].to_numpy()
    X_tr, X_va = frame.loc[is_train, list(RAW_FIELDS)], frame.loc[is_valid, list(RAW_FIELDS)]

    preds: dict[str, np.ndarray] = {}
    base = positive_rate(pd.Series(y_tr))
    preds["base_rate"] = np.full(len(y_va), base)

    # physics baseline: a hard 0/1 call (undefined rows fall back to the base rate)
    phys = [
        physics_reenters_within_horizon(a, b) for a, b in zip(X_va["perigee_km"], X_va["perigee_km_30d_ago"])
    ]
    preds["physics_decay"] = np.array([base if v is None else float(v) for v in phys])

    for kind in SERVING_CANDIDATES:
        pipe = make_serving_pipeline(kind, seed).fit(X_tr, y_tr)
        preds[kind] = pipe.predict_proba(X_va)[:, 1]

    numeric, categorical = feature_cols
    ref = make_reference_pipeline(numeric, categorical, seed).fit(panel.loc[is_train, numeric + categorical], y_tr)
    preds["hist_gb_full_panel"] = ref.predict_proba(panel.loc[is_valid, numeric + categorical])[:, 1]

    rows, intervals = [], {}
    notes = {
        "base_rate": "baseline: training positive rate",
        "physics_decay": "baseline: perigee reaches 120 km within 365 days at the 30-day descent rate",
        "logistic": "serving candidate (9 API fields)",
        "hist_gb": "serving candidate (9 API fields)",
        "hist_gb_full_panel": f"REFERENCE ONLY: D3-style, {len(numeric) + len(categorical)} panel columns, not servable",
    }
    for name, p in preds.items():
        m = metric_row(y_va, p)
        iv = bootstrap_by_object(y_va, p, objects_va, seed=seed)
        intervals[name] = iv
        rows.append(
            {
                "model": name,
                **{k: round(v, 4) for k, v in m.items()},
                **{f"{k}_ci95": f"[{iv[k][0]:.3f}, {iv[k][1]:.3f}]" for k in m},
                "valid_rows": int(len(y_va)),
                "valid_objects": int(len(np.unique(objects_va))),
                "note": notes[name],
            }
        )
    return pd.DataFrame(rows), preds, intervals


def select_serving_model(table: pd.DataFrame) -> str:
    """Rule fixed in advance: best valid PR-AUC among the servable candidates."""
    pool = table[table["model"].isin(SERVING_CANDIDATES)]
    return str(pool.sort_values("pr_auc", ascending=False).iloc[0]["model"])


def reference_columns(panel: pd.DataFrame, feature_groups_path: Path) -> tuple[list[str], list[str]]:
    """The D3 `baseline_no_sun` columns that exist in this panel, split by dtype."""
    manifest = json.loads(Path(feature_groups_path).read_text(encoding="utf-8"))
    banned = set(manifest.get("leakage_never_use_as_features", []))
    cols = [c for c in manifest["ablation"]["baseline_no_sun"] if c in panel.columns]
    leaky = sorted(set(cols) & banned)
    if leaky:
        sys.exit(f"reference feature set contains leakage columns {leaky}")
    # Anything that is not a plain number (strings of any pandas dtype, booleans) is categorical.
    categorical = [
        c
        for c in cols
        if pd.api.types.is_bool_dtype(panel[c]) or not pd.api.types.is_numeric_dtype(panel[c])
    ]
    numeric = [c for c in cols if c not in categorical]
    return numeric, categorical


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--panel", type=Path, default=PANEL)
    ap.add_argument("--gp-history", type=Path, default=GP_HISTORY)
    ap.add_argument("--sw-all", type=Path, default=SW_ALL)
    ap.add_argument("--feature-groups", type=Path, default=None, help="default: next to the panel")
    ap.add_argument("--out-dir", type=Path, default=ARTIFACT_DIR)
    ap.add_argument("--results-dir", type=Path, default=RESULTS_DIR)
    ap.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = ap.parse_args(argv)

    for path in (args.panel, args.gp_history, args.sw_all):
        if not path.exists():
            sys.exit(f"missing {path}")
    groups_path = args.feature_groups or args.panel.with_name("feature_groups.json")

    panel, counts = td.read_train_valid(args.panel)
    gp = bd.load_gp_history(args.gp_history)
    daily, _ = space_weather.build(args.sw_all)
    frame = td.build_serving_frame(panel, gp, daily)
    counts["history_missing_share"] = float(
        (frame["perigee_km_30d_ago"].isna() | frame["apogee_km_30d_ago"].isna()).mean()
    )
    counts["ap_mean_30d_missing_share"] = float(frame["ap_mean_30d"].isna().mean())
    numeric, categorical = reference_columns(panel, groups_path)

    print(f"train rows {counts['train_rows']:,} ({counts['train_objects']:,} objects) | "
          f"valid rows {counts['valid_rows']:,} ({counts['valid_objects']:,} objects) | "
          f"test skipped unread: {counts['test_rows_skipped_unread']:,} rows")

    table, preds, intervals = compare_candidates(frame, panel, (numeric, categorical), args.seed)
    chosen = select_serving_model(table)
    print(table.drop(columns=["note"]).to_string(index=False))
    print(f"\nselected serving model: {chosen} (best valid PR-AUC among {SERVING_CANDIDATES})")

    # ---- refit the winner on train + valid and save --------------------------
    y = frame[TARGET].astype(int)
    final = make_serving_pipeline(chosen, args.seed).fit(frame[list(RAW_FIELDS)], y)

    is_valid = frame["split"].eq("valid").to_numpy()
    y_va = y.to_numpy()[is_valid]
    calib = calibration_table(y_va, preds[chosen])

    args.out_dir.mkdir(parents=True, exist_ok=True)
    args.results_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(final, args.out_dir / PIPELINE_FILE, compress=3)
    table.to_csv(args.results_dir / "serving_model_comparison.csv", index=False)

    metadata = {
        "pipeline_version": PIPELINE_VERSION,
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": chosen,
        "target": TARGET,
        "horizon_days": HORIZON_DAYS,
        "output": "probability that the object reenters within horizon_days of the snapshot",
        "fit_on": "train + valid (test split never read)",
        "seed": args.seed,
        "raw_input_fields": list(RAW_FIELDS),
        "numeric_features": list(NUMERIC_FEATURES),
        "categorical_features": list(CATEGORICAL_FEATURES),
        "baselines": {
            "base_rate": positive_rate(y),
            "physics": "days until perigee reaches 120 km at the 30-day perigee descent rate; "
            "reenters_within_horizon if <= horizon_days",
        },
        "training_data": {
            **counts,
            "train_valid_positive_rate": positive_rate(y),
            "train_positive_rate": positive_rate(y[frame["split"].eq("train")]),
            "valid_positive_rate": positive_rate(y[frame["split"].eq("valid")]),
            "panel_sha256": sha256_of(args.panel),
            "gp_history_sha256": sha256_of(args.gp_history),
            "sw_all_sha256": sha256_of(args.sw_all),
        },
        "validation": {
            "protocol": "each candidate fit on train only, scored on valid only; 95% intervals "
            f"from {N_BOOTSTRAP} bootstrap resamples of valid OBJECTS",
            "results": json.loads(table.to_json(orient="records")),
            "calibration_selected_model": calib,
            "caveat": "the shipped model is refit on train + valid, so these scores describe the "
            "train-only fit; the shipped model has no held-out score of its own",
        },
        "feature_builder": final.named_steps["features"].describe(),
        "environment": {
            "python": platform.python_version(),
            "scikit_learn": sklearn.__version__,
            "pandas": pd.__version__,
            "numpy": np.__version__,
            "joblib": joblib.__version__,
        },
        "git": git_state(),
    }
    (args.out_dir / METADATA_FILE).write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")
    print(f"\nwrote {args.out_dir / PIPELINE_FILE}\n      {args.out_dir / METADATA_FILE}\n"
          f"      {args.results_dir / 'serving_model_comparison.csv'}")


if __name__ == "__main__":
    main()
