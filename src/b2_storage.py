from __future__ import annotations

import os
from pathlib import Path

import boto3
import duckdb
from botocore.config import Config

from fetch_spacetrack import load_dotenv


def b2_settings(env_file: Path | None = None) -> dict[str, str]:
    if env_file is not None:
        load_dotenv(env_file)
    required = {
        "B2_BUCKET": os.environ.get("B2_BUCKET"),
        "B2_ENDPOINT": os.environ.get("B2_ENDPOINT"),
        "B2_REGION": os.environ.get("B2_REGION"),
        "B2_KEY_ID": os.environ.get("B2_KEY_ID"),
        "B2_APPLICATION_KEY": os.environ.get("B2_APPLICATION_KEY"),
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise RuntimeError(
            "Missing B2 settings in the private env file: " + ", ".join(missing)
        )
    return {key: str(value) for key, value in required.items()}


def s3_client(settings: dict[str, str]):
    return boto3.client(
        "s3",
        endpoint_url=settings["B2_ENDPOINT"],
        region_name=settings["B2_REGION"],
        aws_access_key_id=settings["B2_KEY_ID"],
        aws_secret_access_key=settings["B2_APPLICATION_KEY"],
        config=Config(signature_version="s3v4", retries={"max_attempts": 8, "mode": "standard"}),
    )


def _sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def connect_b2_history(env_file: Path | None = None):
    """Open DuckDB with authenticated, read-only access to B2 Parquet objects."""
    settings = b2_settings(env_file)
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs")
    conn.execute("LOAD httpfs")
    conn.execute(
        "CREATE SECRET b2_history (TYPE S3, KEY_ID "
        + _sql_string(settings["B2_KEY_ID"])
        + ", SECRET "
        + _sql_string(settings["B2_APPLICATION_KEY"])
        + ", REGION "
        + _sql_string(settings["B2_REGION"])
        + ", ENDPOINT "
        + _sql_string(settings["B2_ENDPOINT"].removeprefix("https://").removeprefix("http://"))
        + ", URL_STYLE 'path')"
    )
    pattern = (
        "s3://"
        + settings["B2_BUCKET"]
        + "/gp_history/batches/*.parquet"
    )
    return conn, pattern
