# Space Cadet reentry API (D4)

FastAPI service that answers: **will this piece of space junk reenter the atmosphere
within 365 days?** It serves a fitted scikit-learn Pipeline saved with joblib.

| File | What it is |
|---|---|
| `../src/features/transformers.py` | `OrbitFeatureBuilder`, the custom transformer, plus the physics baseline |
| `../src/Models/build_api_pipeline.py` | Fits the pipeline and saves `api/pipeline.joblib` |
| `serve.py` | The FastAPI app: `/health`, `/pipeline-info`, `/predict`, `/docs` |
| `modal_app.py` | Deploys `serve.py` to Modal |
| `compare_local_deployed.py` | Sends 10 fixed inputs to local and deployed APIs and checks they match |
| `../tests/test_api.py` | 200 / 422 / 503 tests (no real data needed) |
| `../postman/space-cadet.postman_collection.json` | Postman collection with assertions |

## The pipeline

```
OrbitFeatureBuilder  ->  ColumnTransformer (one-hot)  ->  HistGradientBoostingClassifier
```

`OrbitFeatureBuilder` takes the raw fields the API receives and derives the
descent rate, eccentricity, mean altitude, days until perigee reaches 120 km, a
drag x solar interaction (`bstar x F10.7`) and an altitude band. In `fit` it learns
the training medians (to fill gaps) and each field's 1st-99th percentile range; in
`transform` it adds an `out_of_training_range` flag, which the API returns so the
website can warn about what-if inputs the model never saw.

Gradient boosting is the model family selected on validation in D3. This API model
uses only the 10 fields the website asks for, so it is smaller than the 52-feature
D3 notebook model; its own validation metrics are in `/pipeline-info`.

## Rebuild the artifact

The model is fitted on the junk-only snapshot panel (`panel.csv`). That file is
derived from Space-Track data, which may not be redistributed, so neither it nor
`pipeline.joblib` is committed. To rebuild:

```bash
uv sync --group api
uv run --group api python src/Models/build_api_pipeline.py \
    --panel data/processed_plan/panel.csv --out api/pipeline.joblib
```

It reads train and valid rows only (test rows are filtered out as the file is
read), fits on train, scores validation next to the training-rate and physics
baselines, locks the decision threshold on validation (highest recall at a
false-alarm rate of at most 10%), then refits on train + valid (`--fit-on train`
skips the refit). The bundle's metadata records the scikit-learn, pandas, numpy and
Python versions, the panel's SHA-256, row and object counts, training ranges,
validation metrics and the threshold.

No credentials? `python src/make_sample_data.py` and
`python src/build_dataset.py --raw-dir data/sample --out-dir data/sample_out` build
a fake panel; pass `--panel data/sample_out/panel.csv` to test the code path. Its
numbers mean nothing.

## Run locally

```bash
uv run --group api uvicorn api.serve:app --reload        # http://127.0.0.1:8000/docs
uv run --group api pytest tests/test_api.py -v
```

Test the 503 path without touching the live app by pointing the API at a missing file:

```bash
SPACE_CADET_PIPELINE=does-not-exist.joblib uv run --group api uvicorn api.serve:app
```

## Deploy to Modal

```bash
uv run --group api modal token new          # once, opens a browser to log in
uv run --group api modal deploy api/modal_app.py
```

Modal prints the URL; the docs are at `<url>/docs`. The image pins
scikit-learn 1.7.2, pandas 3.0.6 and numpy 2.5.4, the versions the artifact was
saved with. If you refit with different versions, update `modal_app.py` to match
`/pipeline-info`.

Then check that local and deployed outputs match:

```bash
uv run --group api python api/compare_local_deployed.py \
    --local http://127.0.0.1:8000 --deployed <modal url>
```

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{"status": "ok", "loaded": true/false, "error": ...}` |
| GET | `/pipeline-info` | Bundle metadata, or 503 if the artifact is missing |
| POST | `/predict` | Probability, the model's yes/no call at the locked threshold, the physics baseline's call and days to 120 km, the out-of-range flag and fields. 422 on invalid input, 503 if the artifact is missing |

Example request body:

```json
{"perigee_km": 380, "apogee_km": 420, "perigee_km_30d_ago": 392, "inclination_deg": 51.6,
 "bstar": 0.0004, "object_type": "DEBRIS", "rcs_size": "SMALL", "age_days": 1200,
 "f107_81d_mean": 150, "ap_27d_mean": 12}
```
