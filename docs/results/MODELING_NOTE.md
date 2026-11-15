# Phase 4 (D3) Modeling Note

**Status: real data, limited sample, pre-revision panel design.** Every number below
comes from `data/raw/satcat.csv`, `decay.csv`, and a 10,000-object random sample of
the real 47 GB `gp_history.csv` (see Data & Method). It is not synthetic. It is also
not the final panel: `build_panel()` still uses the pre-revision sampling design
(PLAN Decisions 3–6 — calendar snapshots, perigee-at-date filter, junk-types-only,
object-disjoint splits — are not yet implemented), and the gp_history sample covers
16.3% of eligible objects, not all of them. Read this as "does the evaluation
pipeline work, and what does it say on real data so far," not as the group's final
D3 numbers. Full tables, every metric, and raw CSVs are in this directory
(`RESULTS.md`, `results_valid.csv`, `error_by_group.csv`, `run_metadata.json`);
this note is the prose argument built on top of them.

## 1. Data & method

**Source.** Space-Track `satcat` (71,139 objects) and `decay` (reentry messages),
joined with CelesTrak `SW-All.csv` (daily space weather, 1957–present) and a sample
of Space-Track `gp_history` (orbital element sets). `gp_history.csv` is 47 GB —
too large to read whole on a laptop — so `load_gp_history()` reads it in chunks,
keeping only rows for 10,000 objects drawn at random (seed 20261019) from the
61,474 objects eligible for the panel (perigee ≤ 1,000 km, launched on or after
1957-10-01). Of those 10,000, only 4,275 (42.8%) had any element-set history at all
in the file — Space-Track's bulk `gp_history` export does not cover every
cataloged object evenly. That gap is the main data-quality constraint on this run:
**75% of panel rows have no `orbit_asof` features** (no matched element set), so
`perigee_decay_rate_km_per_day`, `bstar`, `mean_motion`, and the physics baseline
are only informative for about a quarter of the data.

**Panel.** 114,993 rows, 9,909 objects, split by `obs_date` quantile — train (70%,
80,498 rows / 7,938 objects), valid (15%, 17,257 rows / 3,937 objects), test (15%,
17,238 rows / 3,344 objects, reserved and never read by this script or by me while
writing this note). 51.6% of cataloged objects have decayed; in the panel, 63,309
rows are labelled events and 51,684 are right-censored.

**Targets.** Two, because the team's primary-target decision (PLAN Decision 1) is
still open:
- `reenters_within_horizon` — reenters within 365 days of the observation epoch.
  Positive = reentry observed inside the horizon; negative = followed a full
  horizon with no reentry; rows censored before the horizon closed are dropped
  (undefined, not a negative).
- `log1p_days_remaining` — on observed reentries only; censored rows have no
  days-left label at all, which is exactly the conditioning bias Decision 1 flags.

**Models**, every one scored identically — fit on `train`, scored on `valid`,
seed 20261019, 1,000 object-level bootstrap replicates for every interval:
- **Baselines**: `base_rate` (training positive rate / median), `physics_decay`
  (days until perigee reaches 120 km at the trailing 30-day descent rate).
- **Candidates**, each a single `sklearn.Pipeline`: `logistic` / `ridge` (median
  impute + indicator, standard-scale, one-hot categoricals) and `hist_gb`
  (`HistGradientBoosting`, native NaN handling, ordinal-coded categoricals).
- **Ablation**: every model on `baseline_no_sun` (20 features: orbit + object) vs.
  `with_sun_trailing` (52 features: + 32 trailing space-weather columns).

**Metrics.** Classification: PR-AUC (headline — positives are rare, 21.8% of
valid), Brier score, recall at a 10% false-alarm rate (threshold fit on train,
applied to valid), ROC-AUC. Regression: MAE/RMSE in log1p days, MAE and median
absolute error in raw days. All intervals resample **objects**, not rows — one
object contributes several correlated epochs, and resampling rows would make
every interval look far tighter than it is.

## 2. Comparison results

**Classification** (`reenters_within_horizon`, valid: 15,460 rows / 3,721 objects,
21.8% positive):

| model | feature set | PR-AUC | Brier | recall@10%FAR | ROC-AUC |
|---|---|---|---|---|---|
| base_rate | — | 0.218 [0.201, 0.237] | 0.180 | 1.00 (far_realised=1.00) | 0.500 |
| physics_decay | — | 0.264 [0.246, 0.283] | 0.174 | 0.875 (far_realised=0.82) | 0.554 |
| **hist_gb** | **no_sun** | **0.568 [0.529, 0.606]** | 0.138 | 0.627 | **0.784** |
| hist_gb | with_sun | 0.545 [0.506, 0.581] | 0.143 | 0.626 | 0.770 |
| logistic | no_sun | 0.477 [0.434, 0.519] | 0.150 | 0.133 | 0.726 |
| logistic | with_sun | 0.430 [0.391, 0.472] | 0.154 | 0.113 | 0.689 |

**Regression** (`log1p_days_remaining`, observed reentries only, valid: 4,341 rows
/ 765 objects):

| model | feature set | MAE (log1p d) | median AE (days) |
|---|---|---|---|
| base_rate | — | 1.573 [1.491, 1.658] | 428 |
| physics_decay | — | 1.858 [1.778, 1.938] | 474 |
| **hist_gb** | **no_sun** | **1.196 [1.155, 1.235]** | **226** |
| ridge | no_sun | 1.308 [1.240, 1.379] | 223 |

Both candidates beat both baselines on both tasks, by a wide margin: `hist_gb`'s
PR-AUC interval `[0.529, 0.606]` doesn't come close to overlapping
`physics_decay`'s `[0.246, 0.283]`, and its log1p-MAE interval `[1.155, 1.235]`
sits entirely below `base_rate`'s `[1.491, 1.658]`. `physics_decay` had no usable
descent rate for **82.0%** of valid rows (classification) and **80.1%**
(regression) — it fell back to the training prior for most of the sample, and its
weak score reflects that coverage gap as much as the extrapolation itself.

**`HistGradientBoosting` without sun features wins both tasks outright** — best
PR-AUC (0.568) and best log1p-MAE (1.196) of every model tested, beating even its
own `with_sun_trailing` variant and beating `logistic`/`ridge` on either feature
set.

**Does space weather help? No — every candidate on both tasks got *worse* with
the 32 trailing space-weather columns added**: `hist_gb` classification PR-AUC
0.568 → 0.545, `logistic` 0.477 → 0.430, `ridge` regression MAE 1.308 → 1.536,
`hist_gb` regression MAE 1.196 → 1.364. Unanimous, across every model and both
tasks. See §4 before reading this as "the Sun doesn't matter physically," though:
the validation split has no solar-activity contrast to learn from, which makes
this a confident statement about *this split*, not yet a confident statement
about solar effects in general.

## 3. Selected model

**`hist_gb` on `baseline_no_sun`**, for both classification and regression —
provisionally, pending Decision 1.

`HistGradientBoosting` treats a missing `orbit_asof` value as a learnable split
rather than requiring an imputed stand-in, which matters directly here since 75%
of rows have no gp_history match at all. It wins outright on every metric for
both tasks, and the sun features don't help on any of them, so the simplest
version of the model — no sun, `hist_gb` — is the one to build on. Still not
final: "handles 75%-missing features gracefully" is doing real work in
`hist_gb`'s favor *for this sample specifically*, and the pick should be
re-checked once gp_history coverage improves (not just the object count — the
43% coverage rate itself needs to go up).

## 4. Error analysis by group

Full breakdown, every model × feature set × group, with `n_rows` and `n_objects`
for all of them, is in `error_by_group.csv`; groups under 30 rows get counts but no
metrics (PR-AUC on a handful of rows is noise). Two groupings are structurally
uninformative in this run:

- **Solar-activity tercile**: every single valid row — all 15,460 of them —
  falls in the `3_high` tercile (train cut points: ≤81.8, ≤131.0, >131.0 sfu).
  The valid split is a contiguous slice of recent calendar time, and solar
  activity has been high and rising through that slice, so there's no low- or
  mid-activity data to compare against. **This is a property of the split
  design, not of how much data was sampled** — the fix has to be a different
  split (PLAN Decisions 3–6, or an explicitly solar-stratified split), not more
  objects. Read §2's "space weather doesn't help" finding in that light: it's a
  confident statement about *this split*, not yet a confident statement about
  solar effects in general.
- **Perigee band**: 70.7% of classification-valid rows and 75.6% of regression-
  valid rows land in `missing` (no `perigee_km_asof`) — the direct downstream
  effect of the 75% `orbit_asof` coverage gap in §1. A new sparse `[1000, inf)`
  band appears at this scale (12 rows / 9 objects) — too few to read anything
  into, included for completeness.
- **Object type**: `PAYLOAD` is 72.7% of classification-valid rows (11,240/15,460),
  not `DEBRIS` or `ROCKET BODY`. PLAN Decision 5 calls for junk-types-only
  (`DEBRIS`, `ROCKET BODY`, `TBA`, `UNKNOWN`) precisely because an active
  satellite's reentry is an operator decision, not physics — and that filter is
  one of the Decision 3–6 revisions this panel predates. This is the single most
  important caveat on the whole result: raise it before anyone quotes the PR-AUC
  numbers above as "the model predicts reentry physics." This run is, in part,
  learning when satellite operators choose to deorbit, which is a different and
  easier problem than predicting debris physics.
- **RCS size**: `LARGE` dominates (10,631/15,460 rows), consistent with the
  `PAYLOAD` skew, since cataloged payloads are disproportionately large objects.

## 5. Limitations

1. **gp_history sample, not census.** 10,000 of 61,474 eligible objects (16.3%),
   and only 4,275 of those actually had element-set history (42.8%) — raising the
   sample further will keep growing the panel but will not, by itself, fix the
   75% missing-orbit-feature rate. A streaming join against the *full*
   `gp_history.csv`, or a better coverage-aware sampling strategy, is the real
   fix.
2. **Pre-revision panel design.** No junk-type filter (§4), no object-disjoint
   split guarantee, old epoch-sampling grid. PLAN Decisions 3–6 are not yet in
   `build_dataset.py`.
3. **Degenerate solar tercile in valid.** All 15,460 classification-valid rows
   fall in a single solar-activity tercile — a property of the time-ordered
   split itself (§4), not of sample size. The sun-ablation's negative finding in
   §2 is confident about *this split*, not about solar effects in general; a
   split with real solar-regime contrast is needed before that distinction can
   be collapsed.
4. **Object-level bootstrap**: 3,721 objects for classification, 765 for
   regression — intervals are honestly wide at this object count; read the
   bracket, not just the point estimate.
5. **Conditional days-left label.** `log1p_days_remaining` is defined only for
   objects that have actually decayed; this is Decision 1's core concern and is
   why both targets are reported rather than one.
6. **physics_decay's fallback rate (80–82%)** inflates how weak it looks; its
   performance on the ~18–20% of rows where it had a real descent rate (not
   reported separately above) is the fairer comparison and would need isolating
   before using this baseline to argue the candidates are a big improvement.

## 6. Runnable evaluation code

`src/Models/evaluate.py` — `uv run python src/Models/evaluate.py` (after
`src/build_dataset.py`, which now defaults to a 10,000-object `gp_history`
sample; see `docs/results/README.md` for the sampling flags and exact commands
used to produce the numbers above: `--sample-objects 10000`, `--bootstrap 1000`,
`--banner "..."`).
