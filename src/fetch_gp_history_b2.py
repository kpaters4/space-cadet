from __future__ import annotations

import argparse
import hashlib
import sys
import tempfile
import time
from pathlib import Path

import duckdb
from botocore.exceptions import BotoCoreError, ClientError
from requests.exceptions import RequestException

from b2_storage import b2_settings, s3_client
import pandas as pd
from build_dataset import build_objects, load_decay, load_satcat
from config import MAX_PERIGEE_KM, MIN_EPOCH


def eligible_ids(satcat_path: Path, decay_path: Path) -> list[int]:
    satcat = load_satcat(satcat_path)
    decay = load_decay(decay_path)
    objects = build_objects(satcat, decay, pd.Timestamp.utcnow().tz_localize(None))
    eligible = objects[
        objects["perigee_km"].le(MAX_PERIGEE_KM)
        & objects["launch_date"].ge(pd.Timestamp(MIN_EPOCH))
    ]
    return sorted(int(value) for value in eligible["norad_cat_id"].dropna().unique())


def chunks(seq: list[int], size: int):
    for index in range(0, len(seq), size):
        yield seq[index : index + size]
from fetch_spacetrack import download, login

BASE = "https://www.space-track.org"


def convert_csv_to_parquet(csv_path: Path, parquet_path: Path) -> int:
    con = duckdb.connect()
    try:
        csv_sql = str(csv_path).replace("'", "''")
        parquet_sql = str(parquet_path).replace("'", "''")
        con.execute(
            f"COPY (SELECT * FROM read_csv_auto('{csv_sql}', all_varchar=true)) "
            f"TO '{parquet_sql}' (FORMAT PARQUET, COMPRESSION ZSTD)"
        )
        return con.execute(
            f"SELECT count(*) FROM read_parquet('{parquet_sql}')"
        ).fetchone()[0]
    finally:
        con.close()


def object_key(batch: list[int]) -> str:
    digest = hashlib.sha256(",".join(map(str, batch)).encode("ascii")).hexdigest()[:20]
    return f"gp_history/batches/{digest}.parquet"


def upload_batch(
    batch: list[int],
    session,
    client,
    settings: dict[str, str],
    temp_dir: Path,
    min_interval: float,
    last_request: list[float | None],
    failed_ids: list[int],
    record_ids: bool = False,
) -> None:
    """Fetch and upload one batch; split persistent Space-Track 500s recursively."""
    key = object_key(batch)
    stem = key.rsplit("/", 1)[-1].removesuffix(".parquet")
    csv_path, parquet_path = temp_dir / f"{stem}.csv", temp_dir / f"{stem}.parquet"
    id_list = ",".join(map(str, batch))
    url = (
        f"{BASE}/basicspacedata/query/class/gp_history/NORAD_CAT_ID/{id_list}"
        "/orderby/NORAD_CAT_ID,EPOCH asc/format/csv"
    )
    rows = None
    for attempt in range(1, 9):
        if last_request[0] is not None:
            wait = min_interval - (time.monotonic() - last_request[0])
            if wait > 0:
                time.sleep(wait)
        last_request[0] = time.monotonic()
        try:
            rows = download(session, url, csv_path)
            break
        except RequestException as exc:
            csv_path.with_suffix(".part").unlink(missing_ok=True)
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status == 500 and len(batch) == 1 and attempt >= 2:
                failed_ids.append(batch[0])
                print(f"  Space-Track still returns HTTP 500 for NORAD ID {batch[0]}; will retry on a later resume and continue", flush=True)
                return
            if status == 500 and len(batch) > 1 and attempt >= 2:
                midpoint = (len(batch) + 1) // 2
                print(f"  persistent Space-Track HTTP 500; splitting {len(batch)} IDs into smaller requests", flush=True)
                upload_batch(batch[:midpoint], session, client, settings, temp_dir, min_interval, last_request, failed_ids, True)
                upload_batch(batch[midpoint:], session, client, settings, temp_dir, min_interval, last_request, failed_ids, True)
                return
            if attempt == 8:
                raise
            delay = min(90, attempt * 15)
            print(f"  request failed ({type(exc).__name__}); retrying in {delay}s (attempt {attempt + 1}/8)", flush=True)
            time.sleep(delay)

    if rows:
        converted = convert_csv_to_parquet(csv_path, parquet_path)
        for upload_attempt in range(1, 6):
            try:
                client.upload_file(str(parquet_path), settings["B2_BUCKET"], key)
                break
            except (BotoCoreError, ClientError) as exc:
                if upload_attempt == 5:
                    raise
                delay = min(60, upload_attempt * 10)
                print(f"  B2 upload failed ({type(exc).__name__}); retrying in {delay}s (attempt {upload_attempt + 1}/5)", flush=True)
                time.sleep(delay)
        print(f"  uploaded {converted:,} rows to {key}", flush=True)
    else:
        empty_key = key.removesuffix(".parquet") + ".empty"
        client.put_object(Bucket=settings["B2_BUCKET"], Key=empty_key, Body=b"")
        print("  no history rows; saved an empty-batch marker", flush=True)
    if record_ids:
        ids_key = key.removesuffix(".parquet") + ".ids"
        client.put_object(Bucket=settings["B2_BUCKET"], Key=ids_key, Body=",".join(map(str, batch)).encode("ascii"))
    csv_path.unlink(missing_ok=True)
    parquet_path.unlink(missing_ok=True)

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Fetch eligible gp_history batches and store them as Parquet in private Backblaze B2."
    )
    parser.add_argument("--raw-dir", type=Path, default=None, help="folder containing satcat.csv and decay.csv")
    parser.add_argument("--env-file", type=Path, required=True, help="private env file with Space-Track and B2 credentials")
    parser.add_argument("--limit", type=int, help="only fetch the first N eligible objects")
    parser.add_argument("--batch-size", type=int, default=10, choices=range(1, 301), metavar="1..300")
    parser.add_argument("--sleep", type=float, default=12.1, help="seconds between Space-Track requests")
    parser.add_argument("--temp-dir", type=Path, default=None, help="temporary batch files folder (default: env file sibling _tmp)")
    args = parser.parse_args(argv)

    settings = b2_settings(args.env_file)
    raw_dir = args.raw_dir
    repo_root = Path(__file__).resolve().parents[1]
    raw_dir = raw_dir or repo_root / "data" / "raw"
    satcat_path, decay_path = raw_dir / "satcat.csv", raw_dir / "decay.csv"
    for path in (satcat_path, decay_path):
        if not path.exists():
            sys.exit(f"missing {path}; run fetch_spacetrack.py first")

    ids = eligible_ids(satcat_path, decay_path)
    if args.limit is not None:
        ids = ids[:args.limit]
    if not ids:
        sys.exit("no eligible NORAD IDs found")

    client = s3_client(settings)
    try:
        response = client.list_objects_v2(Bucket=settings["B2_BUCKET"], Prefix="gp_history/batches/")
        completed = {item["Key"] for item in response.get("Contents", [])}
        if response.get("IsTruncated"):
            paginator = client.get_paginator("list_objects_v2")
            completed = {
                item["Key"]
                for page in paginator.paginate(Bucket=settings["B2_BUCKET"], Prefix="gp_history/batches/")
                for item in page.get("Contents", [])
            }
    except Exception as exc:
        sys.exit(f"Could not list B2 bucket objects ({type(exc).__name__}); check B2 key scope and settings")

    # Recognize batches uploaded with earlier chunk sizes so changing batch size
    # does not cause those NORAD IDs to be fetched and stored again.
    completed_ids: set[int] = set()
    for old_size in {5, 10, 25, 50, 300, args.batch_size}:
        for old_batch in chunks(ids, old_size):
            key = object_key(old_batch)
            if key in completed or (key.removesuffix(".parquet") + ".empty") in completed:
                completed_ids.update(old_batch)
    # Split-on-error batches record their exact IDs in small sidecar objects.
    for ids_key in (key for key in completed if key.endswith(".ids")):
        try:
            body = client.get_object(Bucket=settings["B2_BUCKET"], Key=ids_key)["Body"].read()
            completed_ids.update(int(value) for value in body.decode("ascii").split(",") if value)
        except Exception as exc:
            sys.exit(f"Could not read B2 batch manifest ({type(exc).__name__})")
    # Earlier runs may have formed batches from a filtered pending-ID list,
    # shifting boundaries relative to the full eligible-ID list. Match those too.
    sizes_to_match = {5, 10, 25, 50, 300, args.batch_size}
    changed = True
    while changed:
        changed = False
        remaining_for_match = [norad_id for norad_id in ids if norad_id not in completed_ids]
        for old_size in sizes_to_match:
            for old_batch in chunks(remaining_for_match, old_size):
                key = object_key(old_batch)
                if key in completed or (key.removesuffix(".parquet") + ".empty") in completed:
                    before = len(completed_ids)
                    completed_ids.update(old_batch)
                    changed = changed or len(completed_ids) > before
    pending_ids = [norad_id for norad_id in ids if norad_id not in completed_ids]
    pending = list(enumerate(chunks(pending_ids, args.batch_size), 1))
    print(f"Eligible IDs in scope: {len(ids):,}; already uploaded: {len(completed_ids):,} IDs; remaining: {len(pending_ids):,} IDs in {len(pending):,} batches of up to {args.batch_size}.")
    if not pending:
        print("Nothing to upload; all selected objects are already in B2.")
        return

    session = login(args.env_file)
    print("Authenticated to Space-Track. B2 upload destination is private.")
    temp_root = args.temp_dir or (args.env_file.resolve().parent / "_space_cadet_gp_tmp")
    temp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="space_cadet_gp_", dir=temp_root) as temp:
        temp_dir = Path(temp)
        failed_ids: list[int] = []
        last_request: list[float | None] = [None]
        for position, (_, batch) in enumerate(pending, 1):
            print(f"Batch {position}/{len(pending)} ({len(batch)} objects) ...", flush=True)
            upload_batch(batch, session, client, settings, temp_dir, args.sleep, last_request, failed_ids)
        if failed_ids:
            print(f"Transfer continued, but {len(failed_ids)} individual NORAD IDs still returned HTTP 500: {failed_ids}", flush=True)
    print("B2 import complete for selected IDs.")


if __name__ == "__main__":
    main()

