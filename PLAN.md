# PLAN.md — space-cadet (Orbital Janitor)

Decisions with their reasoning, then the build plan from today to the final demo.
Each task has a prompt you can paste into Claude Code and a "done when" check.

**Schedule:** D1 Wed Oct 21 · Go/No Go Mon Oct 26 (revisions Oct 28) · D2 Mon Nov 2 ·
D3 Mon Nov 16 · D4 Mon Nov 23 · D5 Mon Nov 30 · D6 report Wed Dec 2 · demo Dec 4–10.

---

## Decisions

### Open

**Decision 1 — Primary target (group to decide, before D1 is submitted).**
- Option A, recommended: `reenters_within_horizon` — will it reenter within 365 days?
- Option B: `log1p_days_remaining` — how many days are left?
- Why A: recent snapshots only get a days-left label if the object has already
  fallen, so a days-left test set fills up with short-lived objects. In the old
  panel, 76% of test rows were censored versus 29% of training rows. The 365-day
  label is defined for every snapshot that has a year of follow-up, uses objects
  that did not fall, and matches the game's shoot-or-skip decision directly.
- If B is chosen: state in D1 that the target is conditional on reentry, and report
  it alongside A rather than alone.
- To record the choice: set `PRIMARY_TARGET` in `src/config.py`, update the README
  question, and log it here.

### Made (2026-10-21, on review of the original pipeline)

| # | Decision | Reason |
|---|---|---|
| 2 | Orbit features from `gp_history`, element sets with `EPOCH < obs_date` only | satcat's orbit columns are the last values on file, so they leak the answer for decayed objects. The game also needs altitude at the snapshot. |
| 3 | Calendar snapshots (1st of each month), 2015 → as-of minus 365 days | The old epochs were spread between launch and reentry, so sampling used the answer, and age at an epoch carried information about total lifetime. Every snapshot now has a full year of follow-up. |
| 4 | Keep a snapshot only if perigee at that date ≤ 600 km and its element set ≤ 30 days old | The old filter used final perigee, which every decayed object passes by definition. |
| 5 | Junk types only (`DEBRIS`, `ROCKET BODY`, `TBA`, `UNKNOWN`) | Active satellites hold altitude with thrusters, so their reentry is an operator decision, not physics. Trade-off: dead payloads are excluded too. |
| 6 | Splits: train 2015–2020, valid 2022, test 2024 → end, object-disjoint by seeded draw | Gap years stop training labels from resolving inside later periods. 38% of objects used to appear in two splits. Random assignment keeps the test set representative; "earliest split" would fill it with new debris. |
| 7 | Decay table: keep `MSG_TYPE` = Historical only, and dates ≤ as-of | A prediction message could mark an object as decayed on a date that never happened. Confirm real values from the first pull's printed counts. |
| 8 | Space weather from `obs_date - 1`, observed rows only, gaps filled forward | Same-day values may not be complete at prediction time; two-sided interpolation borrowed future values; predicted rows are not observations. |
| 9 | Forward solar features off (`INCLUDE_FORWARD_SW = False`) | They need a forecast at prediction time. The game's solar knob covers the idea. |
| 10 | No survival models | scikit-learn does not support them natively and the course requires a scikit-learn Pipeline. The 365-day label gets most of the benefit. |
| 12 | Neural network candidate (MLP) downgraded from required to optional | Course requirement changed: at least two candidate models vs. baseline is sufficient; a neural net is no longer mandated. Logistic regression + gradient boosting now satisfy D3 on their own. |
| 11 | `uv` + `pyproject.toml` + `uv.lock`; `requirements.txt` removed | Course requirement; one source of truth for dependencies. |

---

## Phase 1 — D1 proposal (due today, Wed Oct 21)

Tasks
- [ ] Decide the target (Decision 1).
- [ ] Each member has a Space-Track account.
- [ ] Run the real satcat + decay pull and record the printed report numbers.
- [ ] Write the six D1 sections. Use the README limitations and Decisions table for
      the risks section.

Prompt
> Read CLAUDE.md and PLAN.md. Run `uv run python src/fetch_spacetrack.py`, then
> load satcat.csv and decay.csv with the loaders in build_dataset.py and print:
> total objects, decayed objects since 2015 by object type, the decay `msg_type`
> counts, the junk-type objects that are candidates for the gp_history pull, and
> the column names of each file. Do not run the gp_history pull yet.

Done when: D1 has real counts, field names, links, gaps, and the usage-terms note.
D1 risks: gp_history volume and rate limits; bias from tracking improving over time
and from observing only tracked objects; misleading "Sun helps" claims across solar periods.

---

## Phase 2 — Real data (Oct 21 → Oct 28)

Tasks
- [ ] Confirm `DECAY_ACTUAL_MSG_TYPES` against the real `msg_type` counts.
- [ ] Download `SW-All.csv` from CelesTrak into `data/raw/`.
- [ ] Check whether Space-Track offers bulk history files; if so, prefer them.
- [ ] Run `fetch_spacetrack.py --gp` (resumable; at the polite rate, 6,000 objects
      ≈ 120 batches ≈ 0.5 h, longer if batches are big). Start with
      `GP_MAX_OBJECTS = 500` to test.
- [ ] Build the real panel and read the report: rows per split, positive rate per
      split, rows dropped at each step.

Prompt
> Set GP_MAX_OBJECTS to 500 in config.py, run the gp_history pull, then build the
> panel. Report: element sets per object, median gap between element sets, the share
> of snapshots dropped by the perigee and staleness filters, and rows/objects/
> positive rate per split. Flag anything that looks wrong; do not change the split
> design or filters without asking.

Done when: `uv run pytest` passes and the real report looks sane. Then raise
`GP_MAX_OBJECTS` and rerun.

---

## Phase 3 — D2: data note, EDA, dashboard (due Mon Nov 2)

Tasks
- [ ] Data dictionary: `src/SCHEMA.md` (already close) linked from the note.
- [ ] 3–5 interpreted plots, for example: label rate vs perigee at snapshot;
      descent rate vs F10.7 81-day mean; rows and objects per split and solar period;
      element-set staleness; positive rate by object type with counts.
- [ ] Data-quality and sampling concerns (README limitations 1–6).
- [ ] Load `panel.csv` (or a derived, publishable version) to Supabase.
- [ ] Streamlit dashboard in `dashboard/` reading from Supabase, deployed on Modal.
- [ ] Test split reserved: no plot uses test rows except counts.

Prompt
> Create `src/load_supabase.py` that uploads panel.csv (train and valid rows plus
> test counts only) and space_weather_daily.csv to Supabase using SUPABASE_URL and
> SUPABASE_KEY from .env. Then build `dashboard/app.py` in Streamlit with the D2
> plots and one-sentence interpretations, reading from Supabase. Deploy on Modal
> following HW conventions with the key in Modal secrets.

---

## Phase 4 — D3: model evaluation (due Mon Nov 16)

Baselines (same validation split, same metrics as the models)
1. Base rate: predict the training positive rate (or training median days).
2. Physics-flavoured extrapolation: days until perigee reaches ~120 km at the
   current 30-day descent rate; for the 365-day label, predict 1 if that is ≤ 365.

Candidates (each inside a scikit-learn Pipeline) — at least two required, no
neural network mandated anymore
- Logistic regression (or Ridge for days) on scaled features.
- HistGradientBoosting.
- (Optional stretch, not required) MLP, with StandardScaler, if time allows.

Ablation: each candidate on `baseline_no_sun` vs `with_sun_trailing`.

Metrics: for the 365-day label, PR-AUC (positives are rare), Brier score, and recall
at a fixed false-alarm rate; for days, MAE on log1p days. Bootstrap by object for
intervals.

Error analysis: by perigee band, object type, size, and solar-activity tercile,
always with counts.

Prompt
> Implement Phase 4 in `src/models/evaluate.py`. Train on train, score on valid only,
> for both baselines and all candidates, with and without space weather. Write a
> results table and error-by-group tables (with counts) to `docs/results/`. Fixed
> seeds. Do not read test rows.

---

## Phase 5 — D4: pipeline + API (due Mon Nov 23)

- Custom transformer `OrbitFeatureBuilder` in `src/features/transformers.py`:
  input = the raw fields the API receives; computes descent rates, eccentricity, a
  drag × solar interaction, and an altitude band. Learned state in `fit`: training
  medians for imputation and per-feature training ranges; `transform` adds an
  `out_of_training_range` flag, which the game uses to warn in extreme what-if settings.
- API input (Pydantic, with ranges and enums): perigee and apogee now and 30 days
  ago, BSTAR, inclination, object type, size class, F10.7 81-day mean, Ap 30-day mean.
- Output: probability (and/or days), baseline prediction, out-of-range flag.

Prompt
> Implement Phase 5. Fit the selected pipeline on train+valid, save with joblib plus
> HW4-style metadata, build `api/main.py` with /health, /pipeline-info, /predict
> (422 on invalid input, 503 when the artifact is missing, testable locally with an
> env var). Deploy to Modal and add a script comparing local and deployed outputs on
> 10 fixed inputs.

---

## Phase 6 — Simulator for the game (parallel, after Phase 2)

- `sim/decay_sim.py`: drag-driven perigee/apogee decay with atmosphere density from
  `pymsis` driven by F10.7 and Ap; calibrate one scale factor on training objects.
- Generates game missions and what-if scenarios (solar activity, object mix).
- Never used for model selection or final testing; simulated results always labelled.
- Report where simulator and model disagree at extreme settings.

---

## Phase 7 — D5: game + tests (due Mon Nov 30)

- Design kit first (fonts, colours, buttons, spacing as shadcn tokens in one file);
  same kit for site, slides, and video. Playwright snapshots of reference sites.
- Pages: Play, Leaderboard, Insights (D3 charts with takeaway titles), Method & limits.
- Game: ~5-minute runs, 5 missions × 3–5 shots, fast-forward + debrief; knobs for
  solar activity, object mix, ammo; Auto-gunner calls `/predict`.
- Live API via `NEXT_PUBLIC_API_URL`; skeleton loading (Modal cold starts); friendly
  422/503 messages; reduced-motion support; lazy-loaded 3D.
- Leaderboard: anonymous handles, no personal data; Supabase row-level security
  (insert-only) or writes through the API.
- Postman: health, pipeline-info, valid predict, invalid predict (422) against the
  deployed URL, with assertions and screenshots.

---

## Phase 8 — D6: final report + demo (Dec 2; demo Dec 4–10)

- Unlock test once; run frozen model and baselines; record results.
- Answer the question: does the model beat the baselines, and how much does space
  weather add? Include human-vs-model results from player logs, with counts.
- At least two bias/fallacy risks with checks: tracking bias over time; solar-period
  shift; conditional days-left label; correlation vs causation; small subgroups.
- Video: people playing, each member explaining their part, same design kit.
- Disclose AI assistance and contributions (`docs/ai-usage.md`).

---

## Roles

| Role | Owns |
|---|---|
| Orbital + space weather lead | domain notes, debrief text, review of feature logic |
| Data engineer | Space-Track pulls, Supabase, tests, simulator |
| Modeler | baselines, candidates, ablation, error analysis, pipeline |
| Frontend + 3D | game, design-kit implementation, Postman |
| Presentation + video | design kit, slides, video, report editing |

## Reusable prompts

- **Leakage review:** "Review the diff for any feature that could use information
  from on or after obs_date, or anything that breaks object-disjoint splits. List
  issues by severity; don't fix yet."
- **Explain it:** "Explain `orbit_features.py` as if to our instructor, then give
  three questions they might ask about it."
- **Honesty check:** "Read README and docs/results. Flag any claim the numbers don't
  support, especially causal wording."
- **Pre-commit:** "Run `uv run pytest`, summarise what changed, and suggest a commit
  message."
