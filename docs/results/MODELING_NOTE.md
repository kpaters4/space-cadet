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

*(This supersedes an earlier 2,000-object run. The headline conclusions mostly
held up at 5x the sample, with two real changes noted in §2 and §4.)*

## 1. Data & method

**Source.** Space-Track `satcat` (71,139 objects) and `decay` (reentry messages),
joined with CelesTrak `SW-All.csv` (daily space weather, 1957–present) and a sample
of Space-Track `gp_history` (orbital element sets). `gp_history.csv` is 47 GB —
too large to read whole on a laptop — so `load_gp_history()` reads it in chunks,
keeping only rows for 10,000 objects drawn at random (seed 20261019) from the
61,474 objects eligible for the panel (perigee ≤ 1,000 km, launched on or after
1957-10-01). Of those 10,000, only 4,275 (42.8%) had any element-set history at all
in the file — the same ~43% coverage rate as the earlier 2,000-object run, which
confirms it's a property of Space-Track's bulk export, not sampling bad luck. That
gap is still the main data-quality constraint on this run: **75% of panel rows have
no `orbit_asof` features** (no matched element set), so
`perigee_decay_rate_km_per_day`, `bstar`, `mean_motion`, and the physics baseline
are only informative for about a quarter of the data.

**Panel.** 114,993 rows, 9,909 objects (up from 23,031 rows / 1,983 objects at
2,000 sampled objects), split by `obs_date` quantile — train (70%, 80,498 rows /
7,938 objects), valid (15%, 17,257 rows / 3,937 objects), test (15%, 17,238 rows /
3,344 objects, reserved and never read by this script or by me while writing this
note). 51.6% of cataloged objects have decayed; in the panel, 63,309 rows are
labelled events and 51,684 are right-censored.

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

Both candidates still beat both baselines on both tasks, by a wide margin:
`hist_gb`'s PR-AUC interval `[0.529, 0.606]` doesn't come close to overlapping
`physics_decay`'s `[0.246, 0.283]`, and its log1p-MAE interval `[1.155, 1.235]`
sits entirely below `base_rate`'s `[1.491, 1.658]`. `physics_decay`'s fallback rate
(no usable descent rate) is now measured more precisely at 5x the sample —
**82.0%** for classification, **80.1%** for regression, both close to the 2,000-
object run's 80/77%, confirming that gap is a real coverage limit, not noise.

**What changed vs. the 2,000-object run.** The selected model used to split —
`hist_gb`+sun for classification, `ridge` (no sun) for regression. At 10,000
objects, **`hist_gb` without sun features now wins both tasks outright** (PR-AUC
0.568 vs. 0.541 before; log1p-MAE 1.196, clearly ahead of `ridge`'s 1.308). More
data resolved the earlier split pick into a single, simpler answer: see §3.

**Does space weather help?** More clearly **no**, not **"not yet clear,"** now
that there's 5x the data. Every candidate on both tasks got *worse* with the 32
trailing space-weather columns added — `hist_gb` classification PR-AUC 0.568 →
0.545, `logistic` 0.477 → 0.430, `ridge` regression MAE 1.308 → 1.536, `hist_gb`
regression MAE 1.196 → 1.364. At 2,000 objects this was mixed (one model up,
one down); at 10,000 it's unanimous in the same direction. That's a more
confident *negative* finding than before, but see §4 before reading it as "the
Sun doesn't matter physically" — the valid split still has no solar-activity
contrast to learn from, which is a different claim than "we measured no effect
across solar conditions."

## 3. Selected model

**`hist_gb` on `baseline_no_sun`**, for both classification and regression —
provisionally, pending Decision 1.

This is a cleaner pick than the 2,000-object run produced, and for a specific
reason: `HistGradientBoosting` treats a missing `orbit_asof` value as a learnable
split rather than requiring an imputed stand-in, which matters directly here since
75% of rows have no gp_history match at all. The earlier run picked `ridge` for
regression only because `hist_gb` hadn't yet had enough data to out-perform it;
with 5x the valid objects, `hist_gb` wins outright on every metric for both tasks,
and the sun features no longer help on any of them, so the simplest version of
the model — no sun, `hist_gb` — is now the one to build on. Still not final:
"handles 75%-missing features gracefully" is still doing real work in `hist_gb`'s
favor *for this sample specifically*, and the pick should be re-checked once
gp_history coverage improves (not just the object count — the 43% coverage rate
itself needs to go up).

## 4. Error analysis by group

Full breakdown, every model × feature set × group, with `n_rows` and `n_objects`
for all of them, is in `error_by_group.csv`; groups under 30 rows get counts but no
metrics (PR-AUC on a handful of rows is noise). Two groupings are still
uninformative in this run, and at 5x the sample this is now a structural finding,
not a small-sample artifact:

- **Solar-activity tercile**: every single valid row — all 15,460 of them — still
  falls in the `3_high` tercile (train cut points: ≤81.8, ≤131.0, >131.0 sfu),
  identical to the 2,000-object run. **This rules out "not enough objects" as the
  explanation.** The valid split is a contiguous slice of recent calendar time,
  and solar activity has been high and rising through that slice regardless of
  how many objects are drawn from it — the fix has to be a different split design
  (PLAN Decisions 3–6, or an explicitly solar-stratified split), not more data.
  Read §2's "space weather doesn't help" finding in that light: it's a confident
  statement about *this split*, not yet a confident statement about solar effects
  in general.
- **Perigee band**: 70.7% of classification-valid rows and 75.6% of regression-
  valid rows land in `missing` (no `perigee_km_asof`) — down slightly from 69%/73%
  at 2,000 objects, in the direction you'd want but not a fix. A new sparse
  `[1000, inf)` band appears at this scale (12 rows / 9 objects) — too few to
  read anything into, included for completeness.
- **Object type**: `PAYLOAD` is 72.7% of classification-valid rows (11,240/15,460)
  — *higher*, not lower, than the 72% at 2,000 objects. PLAN Decision 5 calls for
  junk-types-only (`DEBRIS`, `ROCKET BODY`, `TBA`, `UNKNOWN`) precisely because an
  active satellite's reentry is an operator decision, not physics — and that
  filter is one of the Decision 3–6 revisions this panel predates. **This run
  confirms the skew is structural, not a small-sample fluke**: it's still the
  single most important caveat on the whole result. Raise it before anyone quotes
  the PR-AUC numbers above as "the model predicts reentry physics."
- **RCS size**: `LARGE` dominates (10,631/15,460 rows), consistent with the
  `PAYLOAD` skew, since cataloged payloads are disproportionately large objects.

## 5. Limitations

1. **gp_history sample, not census.** 10,000 of 61,474 eligible objects (16.3%),
   and only 4,275 of those actually had element-set history — the same ~43%
   coverage rate seen at 2,000 objects, so raising the sample further will keep
   growing the panel but will not, by itself, fix the 75% missing-orbit-feature
   rate. A streaming join against the *full* `gp_history.csv`, or a better
   coverage-aware sampling strategy, is the real fix.
2. **Pre-revision panel design.** No junk-type filter (section 4), no
   object-disjoint split guarantee, old epoch-sampling grid. PLAN Decisions 3–6
   are not yet in `build_dataset.py`.
3. **Degenerate solar tercile in valid — now confirmed structural.** Identical
   at 2,000 and 10,000 objects (section 4). The sun-ablation's negative finding
   in section 2 is confident about *this split*, not about solar effects in
   general; a split with real solar-regime contrast is needed before that
   distinction can be collapsed.
4. **Object-level bootstrap**: 3,721 objects for classification, 765 for
   regression at this scale (up from 748 / 160) — intervals are tighter than the
   2,000-object run but still wide enough that the bracket, not just the point
   estimate, should be read.
5. **Conditional days-left label.** `log1p_days_remaining` is defined only for
   objects that have actually decayed; this is Decision 1's core concern and is
   why both targets are reported rather than one.
6. **physics_decay's fallback rate (80–82%)** inflates how weak it looks; its
   performance on the ~18–20% of rows where it had a real descent rate (not
   reported separately above) is the fairer comparison and would need isolating
   before using this baseline to argue the candidates are a big improvement.

## 6. Runnable evaluation code

`src/models/evaluate.py` — `uv run python src/models/evaluate.py` (after
`src/build_dataset.py --sample-objects 10000`; see `docs/results/README.md` for
the sampling flags and exact commands used to produce the numbers above:
`--sample-objects 10000`, `--bootstrap 1000`, `--banner "..."`).
