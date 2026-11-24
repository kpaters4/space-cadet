"""Deploy the prediction API to Modal.

    uv run modal deploy modal_app.py     # prints the https://...modal.run URL
    uv run modal serve modal_app.py      # temporary dev URL with live reload

Needs a Modal login (``uv run modal setup``). Fit the pipeline first
(``uv run python src/Models/fit_serving_pipeline.py``) so ``artifacts/`` holds
``orbit_pipeline.joblib`` and ``orbit_pipeline_metadata.json``; both are copied into
the image.

Library versions are pinned to whatever is installed locally when you deploy. A
fitted scikit-learn pipeline is only guaranteed to load under the version that
saved it, and the artifact was saved by this environment.

After deploying, check local and deployed answers agree:

    uv run python scripts/compare_local_deployed.py --deployed-url https://<your-app>.modal.run
"""
from __future__ import annotations

import importlib.metadata as md
import sys
from pathlib import Path

import modal

ROOT = Path(__file__).parent
PYTHON = f"{sys.version_info.major}.{sys.version_info.minor}"
PINNED = ("fastapi", "pydantic", "scikit-learn", "scipy", "numpy", "pandas", "joblib")

image = (
    modal.Image.debian_slim(python_version=PYTHON)
    .pip_install(*[f"{name}=={md.version(name)}" for name in PINNED])
    .env({"PYTHONPATH": "/app", "ORBIT_PIPELINE_PATH": "/app/artifacts/orbit_pipeline.joblib"})
    .add_local_dir(ROOT / "api", "/app/api", ignore=["__pycache__", "*.pyc"])
    .add_local_dir(ROOT / "src" / "features", "/app/src/features", ignore=["__pycache__", "*.pyc"])
    .add_local_dir(ROOT / "artifacts", "/app/artifacts", ignore=["*.part", ".DS_Store"])
)

app = modal.App("space-cadet-api", image=image)


@app.function(scaledown_window=300, timeout=60)
@modal.asgi_app()
def fastapi_app():
    from api.main import app as web

    return web
