"""Download Space-Track's orbital element history (gp_history) for the
objects the modelling panel actually needs it for.

This is the fix build_dataset.py's leakage notes point at: satcat only gives
one, *terminal* snapshot of each object's orbit. gp_history has one row per
element set (TLE-equivalent) across an object's life, which lets build_dataset
look up the orbit *as of* each observation epoch instead.

Why this is a separate script from fetch_spacetrack.py
-------------------------------------------------------
gp_history for the *whole* catalogue is enormous (every tracked object, every
element set, back to the 1960s) and would mean hammering Space-Track for data
on 40,000+ objects that never decay and were never going to be in the panel
anyway. So this script:

  1. loads the satcat + decay tables fetched by fetch_spacetrack.py,
  2. applies the exact same eligibility filter build_dataset.py uses for the
     panel (perigee <= MAX_PERIGEE_KM, launched on/after MIN_EPOCH),
  3. queries gp_history only for those NORAD_CAT_IDs, in chunks, sleeping
     between requests to stay well under Space-Track's <=30/min, <=300/hour
     limits.

Run after fetch_spacetrack.py:

    python src/fetch_gp_history.py

This is still a large, slow download (one or more requests per chunk of
objects, each returning every element set that object ever had) -- expect it
to take a while for the full eligible set. Use --limit while testing.

gp_history.csv is required: build_dataset.py checks for it right alongside
satcat.csv and decay.csv and will not build the panel without it.
"""
from __future__ import annotations

import argparse
import sys
import time

from build_dataset import build_objects, load_decay, load_satcat
from config import DECAY, GP_HISTORY, MAX_PERIGEE_KM, MIN_EPOCH, SATCAT
from fetch_spacetrack import download, login

BASE = "https://www.space-track.org"
CHUNK_SIZE = 300          # NORAD_CAT_IDs per request; keeps the URL a sane length
SLEEP_BETWEEN_REQUESTS_S = 3.0


def eligible_ids() -> list[int]:
    """Same filter build_dataset.py uses to decide which objects enter the panel."""
    satcat = load_satcat(SATCAT)
    decay = load_decay(DECAY)
    import pandas as pd

    objects = build_objects(satcat, decay, pd.Timestamp.utcnow().tz_localize(None))
    eligible = objects[
        objects["perigee_km"].le(MAX_PERIGEE_KM) & objects["launch_date"].ge(pd.Timestamp(MIN_EPOCH))
    ]
    return sorted(int(x) for x in eligible["norad_cat_id"].dropna().unique())


def chunks(seq: list[int], size: int):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--limit", type=int, default=None, help="only fetch the first N eligible objects (testing)"
    )
    ap.add_argument("--chunk-size", type=int, default=CHUNK_SIZE)
    ap.add_argument(
        "--sleep", type=float, default=SLEEP_BETWEEN_REQUESTS_S, help="seconds between requests"
    )
    args = ap.parse_args(argv)

    for path in (SATCAT, DECAY):
        if not path.exists():
            sys.exit(f"missing {path} -- run `python src/fetch_spacetrack.py` first")

    ids = eligible_ids()
    if args.limit:
        ids = ids[: args.limit]
    if not ids:
        sys.exit("no eligible objects found (check MAX_PERIGEE_KM / MIN_EPOCH in config.py)")
    print(f"{len(ids):,} eligible objects (perigee <= {MAX_PERIGEE_KM:.0f} km, "
          f"launched >= {MIN_EPOCH})")

    session = login()
    print("logged in to space-track.org")

    GP_HISTORY.parent.mkdir(parents=True, exist_ok=True)
    header_written = False
    total_rows = 0
    batches = list(chunks(ids, args.chunk_size))
    with open(GP_HISTORY, "w", encoding="utf-8", newline="") as out:
        for i, batch in enumerate(batches, start=1):
            id_list = ",".join(str(n) for n in batch)
            url = (
                f"{BASE}/basicspacedata/query/class/gp_history/NORAD_CAT_ID/{id_list}"
                f"/orderby/NORAD_CAT_ID,EPOCH asc/format/csv"
            )
            print(f"  batch {i}/{len(batches)} ({len(batch)} objects) ...", flush=True)
            tmp = GP_HISTORY.with_suffix(f".part{i}")
            rows = download(session, url, tmp)
            with open(tmp, encoding="utf-8", errors="replace") as fh:
                lines = fh.readlines()
            tmp.unlink()
            if not lines:
                continue
            if not header_written:
                out.writelines(lines)
                header_written = True
            else:
                out.writelines(lines[1:])  # drop repeated header
            total_rows += rows
            if i < len(batches):
                time.sleep(args.sleep)

    print(f"wrote {GP_HISTORY} ({total_rows:,} element sets, "
          f"{GP_HISTORY.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
