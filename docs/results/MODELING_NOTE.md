# Phase 4 (D3) Modeling Note

**Status: real data, junk-only snapshot panel (PLAN Decisions 1, 3–6, 8). Test rows
were never read by this analysis.** Every number below comes from
`data/processed/panel.csv` (sha256 `94109f7d5d479706591c345feb356c3719994e51c7d742ec4d81d28c68cf5d97`),
a real panel built from Space-Track + CelesTrak data: junk object types only
(`DEBRIS`, `ROCKET BODY`, `UNKNOWN`), monthly snapshots from 2015-01 through
as-of minus 365 days, orbit measured as of each snapshot, and object-disjoint
chronological splits (train 2015–2020, valid 2022, test 2024+, with 2021/2023
as gap years). This supersedes every earlier run in this directory — the old
pre-revision panel (percentile splits, no junk filter, 72% `PAYLOAD` rows) is
no longer the basis for any number here, and this note does not mix numbers
from the two designs.

**One important caveat on where this file came from**, stated up front because
it affects how much to trust everything else: this `panel.csv` was not built by
a script that lives in this repo. `src/build_plan_dataset.py` — the module a
teammate's notebook (`src/Models/classification_with_PLAN_requirements.ipynb`,
originally added by PR #9, now closed and superseded by the merged PR #10)
expects to have produced it — does not exist on `main`, confirmed by checking
directly rather than assuming (still true after PR #8 and PR #10 merged).
PR #8 (`junk-only-snapshot-build`) has since merged into `main`, so there is
now one agreed `build_dataset.py` design rather than two competing drafts —
but it is a similar, not identical, design to whatever produced this exact
file, and it still isn't what built this specific panel. Confirmed directly
(not just inferred from matching row/object counts): this *is*
`build_plan_dataset.py`'s output, obtained outside git — consistent with the
Space-Track no-redistribution license, and with why `data/raw`/`data/processed`
are gitignored. **The script itself is still not committed anywhere**, so
knowing what produced this file and being able to regenerate it from code in
the repo remain two different things — confirming provenance doesn't close
that gap by itself, and merging PR #8 didn't either. See
Limitations.

## 1. Data & method

**Panel.** 134,734 rows, 4,322 objects, strictly object-disjoint across splits
(verified: zero objects appear in more than one split).

| split | rows | objects | positive rate | years |
|---|---|---|---|---|
| train | 122,859 | 3,202 | 5.2% | 2015–2020 |
| valid | 4,954 | 612 | 29.9% | 2022 only |
| test | 6,921 | 508 | 20.9% | 2024+ (never read) |

Every row has a matched `gp_history` element set (`perigee_km_asof` coverage is
100%, both overall and within train/valid) — a large improvement on the
pre-revision panel's 75% missing rate, because this design's own filters
(perigee ≤ 600 km at the snapshot, element age ≤ 30 days) already drop any row
that wouldn't have had orbit data anyway.

**Targets.** Primary: `reenters_within_horizon` (365 days) — defined for every
row by construction, since every snapshot is sampled at least a full horizon
before the as-of date, so there is no censored-too-early case here (unlike the
old panel). Secondary: `log1p_days_remaining`, conditional on the object having
already reentered.

**Models**, fit on `train`, scored on `valid`, seed 20261019, 1,000
object-level bootstrap replicates: `base_rate`, `physics_decay` (baselines);
`logistic`/`ridge`, `HistGradientBoosting` (candidates, each one
`sklearn.Pipeline`); `baseline_no_sun` (20 features) vs. `with_sun_trailing`
(52 features) ablation. Full metric definitions are in `docs/results/README.md`.

## 2. Comparison results (train → valid)

**Classification** (valid: 4,954 rows / 612 objects, 29.9% positive):

| model | feature set | PR-AUC | Brier | ROC-AUC |
|---|---|---|---|---|
| base_rate | — | 0.299 [0.264, 0.337] | 0.271 | 0.500 |
| physics_decay | — | 0.521 [0.475, 0.569] | 0.235 | 0.648 |
| logistic | no_sun | 0.900 [0.869, 0.925] | 0.110 | 0.947 |
| **hist_gb** | **no_sun** | **0.956 [0.942, 0.967]** | 0.077 | **0.978** |
| hist_gb | with_sun | 0.958 [0.943, 0.969] | 0.088 | 0.978 |

**Regression** (valid: 2,646 rows / 400 objects, observed reentries only):

| model | feature set | MAE (log1p d) | median AE (days) |
|---|---|---|---|
| base_rate | — | 1.841 [1.727, 1.970] | 1,252 |
| physics_decay | — | 2.168 [2.099, 2.245] | 1,449 |
| ridge | no_sun | 1.126 [1.055, 1.209] | 355 |
| **hist_gb** | **no_sun** | **0.583 [0.548, 0.623]** | **209** |
| hist_gb | with_sun | 0.826 [0.783, 0.874] | 449 |

Both candidates clearly beat both baselines on both tasks — `hist_gb`'s
intervals don't come close to overlapping either baseline's on either task.
This is a real, strong result, unlike the earlier pre-revision run, where the
baselines were weak mostly because of missing orbit coverage; here coverage is
complete and the baselines are still far behind.

## 3. Does space weather help? Two different answers, and why

**On the train→valid split above, the picture is murky and partly
contradictory**: for classification, adding sun features barely moves
`hist_gb` (0.956→0.958) and the delta is well inside the bootstrap interval —
a wash. For regression, `hist_gb` gets noticeably *worse* with sun
(0.583→0.826). Before concluding "the Sun doesn't help, and might hurt," I
checked why this specific split is a bad test of that question: **100% of
`valid`'s rows fall in the `3_high` solar-activity tercile** (train cut points
70.7/79.1 sfu — see `run_metadata.json`). Valid is a single calendar year
(2022); it has no low- or mid-activity rows to learn or score against. A
model can't demonstrate a sun effect on a split that never varies the Sun.

**So I ran a supplementary check that doesn't have that problem**: a
time-ordered, object-grouped walk-forward cross-validation entirely inside
`train` (5 folds, `train` objects sorted by their earliest snapshot and cut
into 6 chronological, object-disjoint blocks; fold *k* trains on the blocks
before it, scores on the next one). `train` spans 2015–2020 and genuinely
varies in F10.7 (per-fold train/valid means range from ~71 to ~88 sfu across
the 5 folds) — a real before/after to test against. **Full per-fold numbers in
`docs/results/junk_only_run/CV_SUN_CHECK.md` and `cv_sun_check.csv`.**

Result: **`hist_gb` improves with sun features in every one of the 5 folds**,
on both tasks — classification PR-AUC +0.019 on average (every fold positive,
e.g. fold 3: 0.892→0.928), regression MAE -0.133 on average (every fold
improved, e.g. fold 4: 0.351→0.204, a ~42% reduction). `logistic` shows no
consistent direction (classification mean -0.013, sign flips by fold).

**My read, stated plainly: the Sun helps `hist_gb`, on both tasks, and the
train→valid split's contrary regression result is the one to distrust, not
the CV result.** Five independent folds agreeing is stronger evidence than one
confounded, 400-object validation slice. That said, this is one CV run at one
fold count — it should be re-checked with a different fold count or seed
before being stated as settled, and `logistic`'s null result is a reminder
that "the Sun helps" is model-specific here, not universal.

## 4. Selected model

**`hist_gb` on `with_sun_trailing`**, for both classification and regression —
provisionally, pending Decision 1 (which PLAN.md's own text still marks
"Open," even though this panel and this note both already treat
`reenters_within_horizon` as primary, matching where the team has actually
converged).

Both candidates clear both baselines by a wide margin on the real train/valid
split; `hist_gb` beats `logistic`/`ridge` outright on both tasks. The feature-set
pick leans on §3's CV evidence over the single valid split's contradictory
regression number, since the CV check is the one that actually varies solar
conditions. Re-run this pick once the panel-provenance issue in §5 is settled
and ideally once the sun-ablation CV has been checked at a second fold count.

## 5. Error analysis by group

Full tables, every model × feature set × group, with counts: `error_by_group.csv`.

- **Object type**: `DEBRIS` 3,691 rows/491 objects, `ROCKET BODY` 937/83,
  `UNKNOWN` 326/38 (classification valid). No `PAYLOAD` rows at all — the
  junk-type filter is doing its job this time, unlike the pre-revision panel.
- **Perigee band**: coverage is complete now (§1), so every band has real
  counts instead of a `missing` bucket dominating, as it did before.
- **RCS size**: `MEDIUM` is the largest group (2,711/369 objects); no group is
  too sparse to score.
- **Solar-activity tercile**: still 100% `3_high` for both tasks on `valid` —
  this is §3's finding, not a new one, and it's why the CV check in §3 exists
  at all rather than trusting this table's own sun-vs-no-sun columns.

## 6. Limitations

1. **Panel provenance is unresolved.** This file isn't reproducible from
   committed code (see the note at the top). PR #8 merging into `main` closed
   one gap (one agreed `build_dataset.py` instead of competing drafts) but not
   this one: the team still needs to either commit `src/build_plan_dataset.py`,
   or confirm `main`'s now-merged builder reproduces this exact file, rather
   than treating a file that arrived outside git as the source of truth.
2. **Two non-identical "junk-only" builder implementations existed** (PR #8
   vs. whatever produced this file vs. PR #9's missing module); PR #8 is now
   merged, so this is down to one committed design vs. one still-uncommitted
   one, not two competing committed ones — an improvement, not a resolution.
3. **Test has already been looked at.** The merged test notebook
   (`src/Models/classification_with_PLAN_requirements_test.ipynb`, from PR
   #10, which replaced PR #9) explicitly says an earlier notebook version
   already reported test scores and performed test error analysis, so its own
   numbers are "descriptive," not an untouched final check. This run never
   read test, but if test is needed as a genuinely blind check later, that
   decision — burn it and move on, or draw a fresh one — needs to be made
   explicitly by the team, not left implicit.
4. **The sun-vs-no-sun train→valid comparison and the CV check disagree on
   regression for `hist_gb`** (§3). I've given my read on which to trust and
   why, but it's a real, stated disagreement, not quietly resolved.
5. **The CV fold boundaries are object-level, not strictly per-row.** Each
   object moves as a whole unit to its earliest-snapshot block, so an object
   whose snapshots span two blocks' calendar ranges still counts entirely in
   the earlier one. This is the price of a true walk-forward split with no
   object ever leaking across a fold boundary, but it means a fold's quoted
   F10.7 mean is not a perfectly clean calendar-year figure.
6. **Regression sample is modest**: 400 valid objects, 2,646 rows — the
   bootstrap intervals in §2 are real intervals, not small-sample noise
   dressed up, but they're wide enough that the point estimate alone
   shouldn't be over-read.
7. **Conditional days-left label.** `log1p_days_remaining` is defined only for
   objects that have reentered; report it alongside the primary target, never
   alone.

## 7. Runnable evaluation code

```bash
uv run python src/Models/evaluate.py \
  --panel data/processed/panel.csv \
  --feature-groups data/processed/feature_groups.json \
  --out docs/results/junk_only_run \
  --bootstrap 1000 \
  --time-cv-folds 6
```

`add_horizon_label()` now trusts a panel's own `reenters_within_horizon` column
when `days_followed` isn't present (this design never needs it — see the
docstring), rather than raising a `KeyError`. `--time-cv-folds N` runs §3's
supplementary check; omit it to skip straight to the train/valid comparison.
