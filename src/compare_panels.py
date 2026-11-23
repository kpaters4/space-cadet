"""Compare two panel.csv files and report how they differ.

Why this exists: the project has two builds of the junk-only snapshot panel
(src/build_dataset.py on main, and the separate builder behind
data/processed_plan/panel.csv). This script answers "are they the same panel?"
and, if not, exactly where they differ.

    python3 src/compare_panels.py A/panel.csv B/panel.csv \
        --label-a main --label-b jonathan --out compare_report.md

Output is AGGREGATE COUNTS ONLY: no panel rows are printed or written, so the
report is safe to paste into a PR or chat. (The Space-Track data itself is
under a no-redistribution license and must never be committed.)

What it checks
  1. Shape: rows, objects, positive rate per split, snapshot year range.
  2. Columns: present in only one panel.
  3. Key overlap: (norad_cat_id, obs_date) pairs in both / only one.
  4. Object overlap and split assignment: for objects in both panels, which
     split each panel put them in. This is the check that exposes different
     split methods (e.g. 60/20/20 seeded draw vs 70/15/15 stratified).
  5. Label agreement on the keys both panels share.
  6. Object-type mix (e.g. whether TBA / R/B are included).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

KEY_ID = "norad_cat_id"
KEY_DATE = "obs_date"
SPLIT = "split"
LABEL = "reenters_within_horizon"
OBJECT_TYPE = "object_type"
WANTED = [KEY_ID, KEY_DATE, SPLIT, LABEL, OBJECT_TYPE, "perigee_km_asof"]


def load(path: Path) -> tuple[pd.DataFrame, list[str]]:
    header = pd.read_csv(path, nrows=0).columns.tolist()
    use = [c for c in WANTED if c in header]
    missing_core = [c for c in (KEY_ID, KEY_DATE, SPLIT) if c not in header]
    if missing_core:
        sys.exit(f"{path}: missing required column(s) {missing_core}")
    df = pd.read_csv(path, usecols=use)
    df[KEY_ID] = pd.to_numeric(df[KEY_ID], errors="coerce").astype("Int64")
    df[KEY_DATE] = pd.to_datetime(df[KEY_DATE], errors="coerce").dt.normalize()
    df[SPLIT] = df[SPLIT].astype(str).str.strip().str.lower()
    return df, header


def fmt_pct(x: float) -> str:
    return "n/a" if pd.isna(x) else f"{100 * x:.1f}%"


def md_table(df: pd.DataFrame) -> str:
    cols = [df.index.name or ""] + [str(c) for c in df.columns]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for idx, row in df.iterrows():
        lines.append("| " + " | ".join([str(idx)] + [str(v) for v in row.tolist()]) + " |")
    return "\n".join(lines)


def shape_table(df: pd.DataFrame) -> pd.DataFrame:
    g = df.groupby(SPLIT)
    out = pd.DataFrame({"rows": g.size(), "objects": g[KEY_ID].nunique()})
    if LABEL in df.columns:
        out["positive_rate"] = g[LABEL].apply(lambda s: fmt_pct(pd.to_numeric(s, errors="coerce").mean()))
    years = g[KEY_DATE].agg(["min", "max"])
    out["first_snapshot"] = years["min"].dt.strftime("%Y-%m")
    out["last_snapshot"] = years["max"].dt.strftime("%Y-%m")
    out.index.name = "split"
    total = pd.DataFrame(
        {"rows": [len(df)], "objects": [df[KEY_ID].nunique()]}, index=["ALL"]
    )
    total.index.name = "split"
    out = pd.concat([out, total]).fillna("")
    n_obj = df[KEY_ID].nunique()
    out["object_share"] = [
        fmt_pct(out.loc[i, "objects"] / n_obj) if i != "ALL" else "100%" for i in out.index
    ]
    return out


def compare(a: pd.DataFrame, b: pd.DataFrame, ha: list[str], hb: list[str], la: str, lb: str) -> str:
    out: list[str] = [f"# Panel comparison: {la} vs {lb}", ""]
    out.append("Aggregate counts only. No panel rows are included.")
    out.append("")

    # 1. shape
    out += [f"## 1. Shape of {la}", "", md_table(shape_table(a)), ""]
    out += [f"## 1. Shape of {lb}", "", md_table(shape_table(b)), ""]

    # 2. columns
    only_a = sorted(set(ha) - set(hb))
    only_b = sorted(set(hb) - set(ha))
    out += ["## 2. Columns", ""]
    out.append(f"- In both: {len(set(ha) & set(hb))}")
    out.append(f"- Only in {la} ({len(only_a)}): {', '.join(only_a) if only_a else 'none'}")
    out.append(f"- Only in {lb} ({len(only_b)}): {', '.join(only_b) if only_b else 'none'}")
    out.append("")

    # 3. key overlap
    ka = a[[KEY_ID, KEY_DATE]].dropna().drop_duplicates()
    kb = b[[KEY_ID, KEY_DATE]].dropna().drop_duplicates()
    merged = ka.merge(kb, on=[KEY_ID, KEY_DATE], how="outer", indicator=True)
    both = int((merged["_merge"] == "both").sum())
    only_ka = int((merged["_merge"] == "left_only").sum())
    only_kb = int((merged["_merge"] == "right_only").sum())
    union = both + only_ka + only_kb
    out += [
        "## 3. Row keys (object, snapshot date)",
        "",
        f"- In both: {both:,}",
        f"- Only in {la}: {only_ka:,}",
        f"- Only in {lb}: {only_kb:,}",
        f"- Overlap (Jaccard): {fmt_pct(both / union if union else float('nan'))}",
        "",
    ]
    dup_a = int(a.duplicated([KEY_ID, KEY_DATE]).sum())
    dup_b = int(b.duplicated([KEY_ID, KEY_DATE]).sum())
    out.append(f"- Duplicate keys: {la} {dup_a:,}, {lb} {dup_b:,}")
    out.append("")

    # 4. objects and split assignment
    sa = a.groupby(KEY_ID)[SPLIT].agg(lambda s: "/".join(sorted(set(s))))
    sb = b.groupby(KEY_ID)[SPLIT].agg(lambda s: "/".join(sorted(set(s))))
    shared = sa.index.intersection(sb.index)
    out += ["## 4. Objects and split assignment", ""]
    out.append(f"- Objects in {la}: {len(sa):,}; in {lb}: {len(sb):,}; in both: {len(shared):,}")
    out.append(f"- Only in {la}: {len(sa.index.difference(sb.index)):,}; only in {lb}: {len(sb.index.difference(sa.index)):,}")
    multi_a = int(sa.str.contains("/").sum())
    multi_b = int(sb.str.contains("/").sum())
    out.append(f"- Objects appearing in more than one split (should be 0): {la} {multi_a:,}, {lb} {multi_b:,}")
    out.append("")
    if len(shared):
        ct = pd.crosstab(sa.loc[shared].rename(f"{la} split"), sb.loc[shared].rename(f"{lb} split"))
        agree = int(sum(ct.loc[i, i] for i in ct.index if i in ct.columns))
        out.append(f"For the {len(shared):,} objects in both, split agreement: {fmt_pct(agree / len(shared))}")
        out.append("")
        out.append(f"Rows = {la} split, columns = {lb} split (object counts):")
        out.append("")
        out.append(md_table(ct))
        out.append("")
    else:
        out += ["No objects in common, so split assignment cannot be compared.", ""]

    # 5. label agreement
    out += ["## 5. Label agreement on shared keys", ""]
    if LABEL in a.columns and LABEL in b.columns and both:
        j = a[[KEY_ID, KEY_DATE, LABEL]].merge(b[[KEY_ID, KEY_DATE, LABEL]], on=[KEY_ID, KEY_DATE], suffixes=("_a", "_b"))
        la_, lb_ = pd.to_numeric(j[f"{LABEL}_a"], errors="coerce"), pd.to_numeric(j[f"{LABEL}_b"], errors="coerce")
        ok = la_.notna() & lb_.notna()
        out.append(f"- Shared keys with a label in both: {int(ok.sum()):,}")
        out.append(f"- Labels agree: {fmt_pct((la_[ok] == lb_[ok]).mean())}")
        out.append(f"- Positive in {la} only: {int(((la_ == 1) & (lb_ == 0)).sum()):,}; positive in {lb} only: {int(((la_ == 0) & (lb_ == 1)).sum()):,}")
    else:
        out.append(f"Skipped: needs `{LABEL}` in both panels and at least one shared key.")
    out.append("")

    # 6. object types
    out += ["## 6. Object types (rows / objects)", ""]
    if OBJECT_TYPE in a.columns or OBJECT_TYPE in b.columns:
        def types(df: pd.DataFrame) -> pd.Series:
            if OBJECT_TYPE not in df.columns:
                return pd.Series(dtype=str)
            g = df.groupby(OBJECT_TYPE, dropna=False)
            return g.size().astype(str) + " / " + g[KEY_ID].nunique().astype(str)

        t = pd.concat([types(a).rename(la), types(b).rename(lb)], axis=1).fillna("-")
        t.index.name = "object_type"
        out.append(md_table(t))
    else:
        out.append("Skipped: no `object_type` column in either panel.")
    out.append("")

    # verdict
    same_keys = only_ka == 0 and only_kb == 0
    out += ["## Verdict", ""]
    if same_keys:
        out.append("- Row keys are identical.")
    else:
        out.append(f"- Row keys differ ({only_ka:,} only in {la}, {only_kb:,} only in {lb}), so these are not the same panel.")
    if len(shared):
        out.append(f"- Split assignment agrees for {fmt_pct(agree / len(shared))} of shared objects.")
    return "\n".join(out) + "\n"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("panel_a", type=Path)
    p.add_argument("panel_b", type=Path)
    p.add_argument("--label-a", default="A")
    p.add_argument("--label-b", default="B")
    p.add_argument("--out", type=Path, help="also write the report to this file")
    args = p.parse_args()

    a, ha = load(args.panel_a)
    b, hb = load(args.panel_b)
    report = compare(a, b, ha, hb, args.label_a, args.label_b)
    print(report)
    if args.out:
        args.out.write_text(report, encoding="utf-8")


if __name__ == "__main__":
    main()
