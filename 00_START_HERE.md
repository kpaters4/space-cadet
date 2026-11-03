# Preparation-code deliverable

Start with **src/Models/data_preparation.ipynb**. It contains the executed preparation workflow, final-test reservation, supported quality concerns, provenance, and full submission checklist.

## Recommended reading order

1. `src/Models/data_preparation.ipynb` — complete preparation deliverable and execution instructions.
2. `requirements.txt` — pipeline dependencies; the notebook also documents kernel installation and tested core versions.
3. `.env.example` — empty credential/configuration template, not actual credentials.
4. `src/config.py` — paths, eligibility limits, windows, and seed.
5. `src/fetch_spacetrack.py` — catalogue/decay acquisition and shared download/env helpers.
6. `src/b2_storage.py` — B2 and DuckDB connection helpers.
7. `src/fetch_gp_history_b2.py` — resumable orbital-history acquisition and Parquet upload.
8. `src/normalize.py` — canonical source-column names.
9. `src/space_weather.py` — cleaning and solar/geomagnetic feature construction.
10. `src/build_dataset.py` — merges, observation sampling, labels, and chronological splits.
11. `data/processed/feature_groups.json` — exact predictor groups and exclusions consumed by the notebook.
12. `src/SCHEMA.md` — source fields, units, and schema explanations.

This is reading order, not a command to run every script. Preserve the folder structure and original module names: imports depend on them. Shared modules are imported by the acquisition/build scripts.

## Running the notebook

Install dependencies using `python -m pip install -r requirements.txt`, then install a notebook kernel with `python -m pip install ipykernel nbformat nbclient`.
Select that interpreter in VS Code. The notebook records its tested package versions and includes commands to pin those versions.

Provide the matching original `data/processed/panel.csv` separately, then open the notebook and Run All from a fresh kernel. Alternatively set `SPACE_CADET_ROOT` to the original repository that contains the panel and feature manifest. The executed outputs are already included for reading without data access.

The notebook preserves the original method: a 10,000-row target yields 10,028 sampled training observations from 921 objects; 27,196 validation observations stay separate; 3,084 final-test observations remain reserved. It performs no model training or evaluation.

## What is deliberately excluded

No private credentials, original classification/model-training notebook, raw datasets, processed panel, B2 history batches, Supabase export, or deployment/dashboard files are included. The original repository files were copied, not modified.

The code-only package requires the archived panel for direct replay, or the original raw snapshots and authorized B2 access for a full upstream rebuild. Code and seeds alone cannot reproduce a changing live-data snapshot. Follow the notebook's detailed pipeline and reproducibility notes.
