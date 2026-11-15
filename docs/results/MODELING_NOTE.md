# Phase 4 (D3) Modeling Note

**Status: real data, limited sample, pre-revision panel design.** Every number below
comes from `data/raw/satcat.csv`, `decay.csv`, and a 2,000-object random sample of
the real 47 GB `gp_history.csv` (see Data & Method). It is not synthetic. It is also
not the final panel: `build_panel()` still uses the pre-revision sampling design
(PLAN Decisions 3–6 — calendar snapshots, perigee-at-date filter, junk-types-only,
object-disjoint splits — are not yet implemented), and the gp_history sample covers
3.3% of eligible objects, not all of them. Read this as "does the evaluation
pipeline work, and what does it say on real data so far," not as the group's final
D3 numbers. Full tables, every metric, and raw CSVs are in this directory
(`RESULTS.md`, `results_valid.csv`, `error_by_group.csv`, `run_metadata.json`);
this note is the prose argument built on top of them.

## 1. Data & method

**Source.** Space-Track `satcat` (71,139 objects) and `decay` (reentry messages),
joined with CelesTrak `SW-All.csv` (daily space weather, 1957–present) and a sample
of Space-Track `gp_history` (orbital element sets). `gp_history.csv` is 47 GB —
too large to read whole on a laptop — so `load_gp_history()` reads it in chunks,
keeping only rows for 2,000 objects drawn at random (seed 20261019) from the 61,474
objects eligible for the panel (perigee ≤ 1,000 km, launched on or after
1957-10-01). Of those 2,000, only 859 (43%) had any element-set history at all in
the file — Space-Track's bulk `gp_history` export does not cover every cataloged
object evenly. That gap is the main data-quality constraint on this run: **75% of
panel rows have no `orbit_asof` features** (no matched element set), so
`perigee_decay_rate_km_per_day`, `bstar`, `mean_motion`, and the physics baseline
are only informative for about a quarter of the data.

**Panel.** 23,031 rows, 1,983 objects, split by `obs_date` quantile — train (70%,
16,127 rows / 1,598 objects), valid (15%, 3,452 rows / 789 objects), test (15%,
reserved, never read by this script or by me while writing this note). 51.6% of
cataloged objects have decayed; in the panel, 12,768 rows are labelled events and
10,263 are right-censored.

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

**Metrics.** Classification: PR-AUC (headline — positives are rare, 21.5% of
valid), Brier score, recall at a 10% false-alarm rate (threshold fit on train,
applied to valid), ROC-AUC. Regression: MAE/RMSE in log1p days, MAE and median
absolute error in raw days. All intervals resample **objects**, not rows — one
object contributes several correlated epochs, and resampling rows would make
every interval look far tighter than it is.

## 2. Comparison results

**Classification** (`reenters_within_horizon`, valid: 3,165 rows / 748 objects,
21.5% positive):

| model | feature set | PR-AUC | Brier | recall@10%FAR | ROC-AUC |
|---|---|---|---|---|---|
| base_rate | — | 0.215 [0.175, 0.254] | 0.183 | 1.00 (far_realised=1.00) | 0.500 |
| physics_decay | — | 0.271 [0.221, 0.319] | 0.175 | 0.862 (far_realised=0.80) | 0.564 |
| logistic | no_sun | 0.508 [0.404, 0.602] | 0.143 | 0.166 | 0.753 |
| **hist_gb** | **with_sun** | **0.566 [0.476, 0.640]** | 0.146 | 0.682 | **0.787** |
| hist_gb | no_sun | 0.541 [0.455, 0.614] | 0.154 | 0.474 | 0.778 |

**Regression** (`log1p_days_remaining`, observed reentries only, valid: 915 rows /
160 objects):

| model | feature set | MAE (log1p d) | median AE (days) |
|---|---|---|---|
| base_rate | — | 1.413 [1.239, 1.589] | 352 |
| physics_decay | — | 1.652 [1.488, 1.822] | 396 |
| **ridge** | **no_sun** | **1.221 [1.088, 1.360]** | **194** |
| hist_gb | no_sun | 1.320 [1.173, 1.455] | 313 |

Both candidates beat both baselines on both tasks, and the gap is large relative
to the bootstrap intervals: `hist_gb`'s PR-AUC interval `[0.476, 0.640]` does not
overlap `physics_decay`'s `[0.221, 0.319]`, and `ridge`'s log1p-MAE interval
`[1.088, 1.360]` barely touches `base_rate`'s `[1.239, 1.589]`. The two baselines
are legitimately weak here, and not just because the task is hard: `physics_decay`
had no usable descent rate for **77–80% of valid rows** (no matched element set
inside the trailing window) and fell back to the training prior for those, which
is most of the sample. On the quarter of rows where it had real orbit history, it
still only reaches PR-AUC 0.271 — a useful sanity check that `physics_decay` is a
real, weak-but-better-than-chance baseline, not a hard floor the candidates lose to.

**Does space weather help?** Not detectably at this sample size. `hist_gb`'s
PR-AUC moves from 0.541 (no sun) to 0.566 (with sun), `logistic`'s moves the other
way, from 0.508 to 0.479; both regression candidates get slightly *worse* with sun
features (ridge: 1.221 → 1.336; hist_gb: 1.320 → 1.353). Every one of these deltas
is small compared to the ~0.15–0.2-wide 95% intervals on PR-AUC and log1p-MAE
above. The honest read is: this run neither confirms nor rules out a space-weather
effect — it needs more objects (the valid bootstrap is over 748 objects, which is
not many) and, as section 4 notes, the valid split happens to sit in a single
solar-activity tercile, which removes most of the natural variation the ablation
is supposed to measure.

## 3. Selected model

**`hist_gb` on `with_sun_trailing`**, for classification; **`ridge` on
`baseline_no_sun`**, for regression — provisionally, pending Decision 1.

`hist_gb` is the only model that handles missing data the way this panel actually
needs it handled: three-quarters of rows have no `orbit_asof` features at all, and
HistGradientBoosting treats "missing" as a learnable split rather than requiring
an imputed stand-in. It has the best PR-AUC and ROC-AUC of any model on either
feature set, and — because it can use the sun features without them needing to be
median-imputed over 75% of rows — it's the one candidate where adding the sun
features didn't hurt. For regression, `ridge` wins on every metric; `hist_gb`
regression is competitive but not better, so there's no reason to prefer the more
complex model there. Neither choice is final: it should be re-run once the real
coverage problem (section 4) is fixed, since right now "handles 75%-missing
features gracefully" is doing a lot of the work in `hist_gb`'s favor, for a reason
specific to this sample rather than to the physics.

## 4. Error analysis by group

Full breakdown, every model × feature set × group, with `n_rows` and `n_objects`
for all of them, is in `error_by_group.csv`; groups under 30 rows get counts but no
metrics (PR-AUC on a handful of rows is noise). Two groupings turned out to be
uninformative in this particular run, for reasons worth stating plainly:

- **Solar-activity tercile**: every single valid row — all 3,165 of them — falls
  in the `3_high` tercile (cut points fit on train: ≤82.3, ≤131.2, >131.2 sfu).
  The valid split is a contiguous slice of recent calendar time, and solar
  activity has been high and rising through that slice, so the time-ordered split
  has accidentally produced a valid set with no low- or mid-activity rows at all.
  This specific ablation table cannot be read as "errors are flat across solar
  conditions" — there's only one condition to look at.
- **Perigee band**: 69% of classification-valid rows and 73% of regression-valid
  rows land in `missing` (no `perigee_km_asof`), the direct downstream effect of
  the 75% `orbit_asof` coverage gap in section 1. The bands that do have rows
  (`[500,600)` km is the largest, with 521 rows) don't show an obvious trend, but
  there isn't enough non-missing data in most of them to say much.
- **Object type**: `PAYLOAD` is 72% of classification-valid rows (2,284/3,165), not
  `DEBRIS` or `ROCKET BODY`. PLAN Decision 5 explicitly calls for junk-types-only
  (`DEBRIS`, `ROCKET BODY`, `TBA`, `UNKNOWN`) precisely because an active
  satellite's reentry is an operator decision, not physics — and that filter is
  one of the Decision 3–6 revisions this panel predates. This run is, in part,
  learning when satellite operators choose to deorbit, which is a different and
  easier problem than predicting debris physics. This is the single most
  important caveat on the whole result, more than the sample size: raise it before
  anyone quotes the PR-AUC numbers above as "the model predicts reentry physics."
- **RCS size**: `LARGE` dominates (2,144/3,165 rows) — consistent with the
  `PAYLOAD` skew, since cataloged payloads are disproportionately large objects.

## 5. Limitations

1. **gp_history sample, not census.** 2,000 of 61,474 eligible objects (3.3%), and
   only 859 of those actually had element-set history. Rerunning with more objects
   (`--sample-objects`, or a proper streaming join) will change these numbers,
   likely a lot, and should be treated as a required next step, not a nice-to-have.
2. **Pre-revision panel design.** No junk-type filter (section 4), no
   object-disjoint split guarantee, old epoch-sampling grid. PLAN Decisions 3–6
   are not yet in `build_dataset.py`.
3. **Degenerate solar tercile in valid.** Section 4 — the sun-ablation comparison
   in section 2 is likely underpowered for a structural reason (one solar regime
   in the scoring split), not just sample size.
4. **Object-level bootstrap on a small number of objects.** 748 objects for
   classification, 160 for regression — wide intervals are honestly wide, not a
   bug; don't read a point estimate without its bracket.
5. **Conditional days-left label.** `log1p_days_remaining` is defined only for
   objects that have actually decayed; this is Decision 1's core concern and is
   why both targets are reported rather than one.
6. **Three rows (test split) have obs_date past the space-weather file's last
   observed day**, landing in CelesTrak's forecast tail instead of real
   observations. All three are in `test`, which Phase 4 never reads, so this run
   is unaffected — but it should be fixed in `attach_space_weather` before test is
   ever unlocked.
7. **physics_decay's fallback rate (77–80%)** inflates how weak it looks; its
   performance on the ~20–23% of rows where it had a real descent rate (not
   reported separately above) is the fairer comparison and would need isolating
   before using this baseline to argue the candidates are a big improvement.

## 6. Runnable evaluation code

`src/models/evaluate.py` — `uv run python src/models/evaluate.py` (after
`src/build_dataset.py`; see `docs/results/README.md` for the sampling flags and
exact commands used to produce the numbers above:
`--sample-objects 2000`, `--bootstrap 1000`, `--banner "..."`).
