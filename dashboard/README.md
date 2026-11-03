# Space Cadet sample dashboard

Adapted from `kpaters4/space-cadet`, branch `D2`, `dashboard/app.py`.
Reads `public.sample_panel` directly from Supabase with a publishable key and
SELECT access. Pagination retrieves every row in stable `(norad_cat_id, obs_date)`
order, checking counts and duplicate keys. No database columns are added.

The preserved notebook sample has 10,028 rows, 81 original columns and 921 objects.
It contains training observations for reentered objects only. Charts describe
this selected sample, not the full catalogue or population reentry probabilities.
Object summaries are derived from the latest sampled observation per object.
Known outcomes are retained, and constant columns are not dropped.

The Data dictionary tab and its CSV download cover all 81 uploaded columns.
`dashboard/supabase_types.json` records the actual `information_schema.columns.udt_name`
values supplied from Supabase on November 2, 2026. Database storage types are shown
separately from pandas' inferred dtypes: JSON may deserialize whole-valued float8
columns as Python integers. `norad_cat_id` remains int8; the schema also preserves
the actual text and boolean columns. No database types are changed by the app.
After future database schema changes, refresh this file using:

```sql
SELECT jsonb_object_agg(column_name, udt_name) AS column_types
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sample_panel';
```

The final test reservation matches `src/Models/classification_model.ipynb`:
`event_observed == 1` and `split == "test"` in the original processed panel,
which selects 3,084 observations from 1,029 objects. `dashboard/reserved_test.json`
stores only their identifying keys and provenance, not test features or targets.
Supabase queries request only train/valid rows; preparation also rejects exact
reserved keys if they are mislabeled. Earlier training rows of the same objects
remain eligible, matching the notebook's row-based split. The 10,028-row uploaded
sample has no overlap with the reserved rows. Run `sync_test_reservation.py` after
an intentional notebook/source update and review any changed reservation before deploy.

## Run locally

Install `dashboard/requirements.txt` in a Python virtual environment.
Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and optionally `SUPABASE_TABLE`
(default `sample_panel`) as environment variables, then run:

```powershell
python -m streamlit run dashboard/app.py
```

The data cache expires after five minutes. The sidebar's Refresh data button
clears it immediately. No fallback CSV is bundled in deployment.

## Deploy to Modal

Install the Modal CLI and authenticate. Create a Modal secret named
`space-cadet-supabase` with the environment variables above. Then:

```powershell
modal deploy modal_app.py
```

Only the dashboard code is shipped. The data remains in Supabase.
The deployed HTTP endpoint serves Streamlit and supports its WebSocket sessions.
Containers scale down after five idle minutes, with at most two containers.

## Verification

Install `pytest` alongside the dashboard requirements, then run `python -m pytest -q`.
Tests use the original sample CSV when available, or a small synthetic fixture in
a clean checkout. Set `SPACE_CADET_SAMPLE_CSV` to use a sample stored elsewhere.
`verify_supabase.py` compares all uploaded fields with the original sample CSV;
run it separately with the Supabase environment variables set. Tests cover server-limited pagination,
empty read policies, constant-column samples, full Streamlit rendering and filters.

Source CSV: `data/exact_training_sample/sample_panel.csv`.
Dataset provenance and row manifest are alongside the CSV. These files are not
included in the Modal image and are ignored by Git.
