"""Deploys the Space Cadet reentry API (api/serve.py) to Modal.

From the repo root:

    uv run --group api modal deploy api/modal_app.py

Versions are pinned to the ones recorded in api/pipeline.joblib's metadata
(scikit-learn must match exactly, or joblib cannot safely unpickle the pipeline).
"""
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]

SKLEARN_VERSION = "1.7.2"
PANDAS_VERSION = "3.0.6"
NUMPY_VERSION = "2.5.4"

app = modal.App("space-cadet-reentry-api")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(
        "fastapi[standard]",
        "pydantic",
        "joblib",
        f"numpy=={NUMPY_VERSION}",
        f"pandas=={PANDAS_VERSION}",
        f"scikit-learn=={SKLEARN_VERSION}",
    )
    .env({"PYTHONPATH": "/root/src", "SPACE_CADET_PIPELINE": "/root/pipeline.joblib"})
    .add_local_dir(ROOT / "src" / "features", remote_path="/root/src/features")
    .add_local_file(ROOT / "api" / "serve.py", remote_path="/root/serve.py")
    .add_local_file(ROOT / "api" / "pipeline.joblib", remote_path="/root/pipeline.joblib")
)


@app.function(image=image)
@modal.asgi_app()
def fastapi_app():
    import sys

    sys.path.insert(0, "/root")
    from serve import app as web_app

    return web_app
