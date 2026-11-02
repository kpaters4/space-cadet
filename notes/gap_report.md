# Gap report: plan2.md vs. current repo

Audit date: 2026-11-02. Read-only exploration; no existing files were changed.

Status key: **Done** / **Partial** / **Missing**

## A. Coding work

| Item | Status | Evidence |
|---|---|---|
| Phase 0 layout | Partial | `data/raw`, `data/processed`, `src`, `dashboard` exist. `notes/` did not exist before this file. Raw data is git-ignored and not edited in place. |
| Test-set reservation | Partial | `split` column in `panel.csv` (time-based by `obs_date`): train 493,828 / valid 105,882 / test 105,730 rows (`build_dataset.py` ~line 443). Rule is set in the build step, but it is not an isolated, recorded step, and EDA and the dashboard use all splits. |
| Audit checks (counts) | Partial | `dashboard/preprocess.py` logs some counts (future dates, duplicate ids, constant columns, missing rcs). Run on all splits including test; no missingness-per-column table, sentinel-code or outlier audit, no leakage audit as code. |
| Cleaning pipeline `src/prepare.py` | Missing | No `prepare.py`. Cleaning is spread over `src/build_dataset.py`, `src/normalize.py` and `dashboard/preprocess.py`. No validation checks at the end. |
| Train-only fitting | Partial | Time-split is clean for the panel. But `dashboard/preprocess.py` learns rules (top-12 countries, constant-column drops) from all rows including test. |
| Data dictionary, generated parts | Partial | `src/SCHEMA.md` is a hand-written column reference. No generated CSV with type, % missing, ranges, or cleaning applied. |
| Plot generation | Partial | `dashboard/app.py` has many plotly charts in 6+ tabs (far more than 3-5). Not saved as figures for the note; no before/after cleaning plot confirmed. |
| Supabase tables, load, RLS | Missing | No Supabase code, no `load_supabase.py`, no SQL or RLS. |
| Streamlit dashboard | Partial | `dashboard/app.py` (~711 lines) runs from local CSVs, not Supabase. No `@st.cache_data` on Supabase queries. Shows test rows by default. |
| Modal deployment | Missing | No `modal_app.py`, no Modal secret setup. `dashboard/requirements.txt` exists. |
| Secrets handling | Done (so far) | `.env` and `data/raw/` are git-ignored; `.env.example` is tracked; no tracked `.env`; no hard-coded keys found. Nothing Supabase/Modal-related exists yet. |

## B. Written work

| Item | Status | Evidence |
|---|---|---|
| Data note sections 1-6 | Missing | No draft found. |
| Hand-written dictionary descriptions and notes | Partial | `src/SCHEMA.md` has column meanings and a leakage section; needs to be merged with generated fields. |
| Plot interpretations | Partial | Dashboard has "what this shows / how to read / why it matters" blocks; need to be cut to 3-5 plots of 2-3 sentences. |
| Data-quality concerns | Partial | README limitations and SCHEMA leakage section cover some; not organized per plan2. |
| Sampling concerns | Partial | PLAN.md/README mention tracking bias and censoring; needs its own subsection. |
| Decisions log (`notes/decisions.md`) | Missing | Decisions live in `PLAN.md` (Decisions table), not in `notes/`. |

## Risks

1. **Test data in the dashboard.** `app.py` loads train, valid and test and selects all three by default (sidebar "Panel split").
2. **Object overlap across splits.** 25,552 of 60,816 objects appear in more than one split because the split is by `obs_date`. Fine for "future snapshots", but a group-based split would be needed for a strictly entity-disjoint test.
3. **Test period extends past today.** Test `obs_date` max is 2026-12-07; dashboard drops dates after today. Needs a decision on the intended as-of date.
4. **Rules learned on all data** in `dashboard/preprocess.py` (country top-12, constant-column drops).
5. **Leaky orbit columns.** `dashboard/preprocess.py` `PANEL_COLS` uses the `orbit_terminal` columns (`perigee_km`, `apogee_km`, ...) that SCHEMA.md says leak the answer.
6. **Deployment.** The dashboard reads a ~420 MB `panel.csv` from disk, which is git-ignored and will not exist in a Modal image; Supabase is needed first.
7. **Not rerunnable in one command.** No single command from raw to processed to Supabase.
8. `feature_groups.json` has an uncommitted change (the `_provenance` line was removed), consistent with a real-data rebuild.

## Proposed order (smallest risk first)

1. Create `notes/decisions.md` and move the key decisions in (~20 min).
2. Write `src/prepare.py` with `load_raw/split/clean/save` and validation checks, reusing `build_dataset.py` (~2-3 h).
3. Generate the data dictionary CSV and audit counts from train only (~1-2 h).
4. Fix the dashboard to exclude test rows and use only train/valid; pick 3-5 plots (~1-2 h).
5. Add `src/load_supabase.py`, tables, RLS and an anon read-only policy (~2 h).
6. Point the dashboard at Supabase with `@st.cache_data`, test locally (~2 h).
7. Add `modal_app.py`, Modal Secret, `modal serve` then `modal deploy` (~1-2 h).

## Written work still needed (numbers must come from code)

- Raw row/column counts and sources; panel rows per split and objects per split; split dates.
- Issue to count to action table (missingness % per column, duplicates, out-of-range, sentinels).
- Before/after counts for the cleaned variable; dictionary table (type, % missing, ranges).
- Dashboard URL, repo link, and a statement of whether test data is kept out of Supabase.
