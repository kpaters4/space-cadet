"""Download the two Space-Track datasets named in the README.

Space-Track requires a free account; there is no anonymous access. Put your
credentials in a .env file at the repo root (see .env.example):

    SPACETRACK_IDENTITY=you@example.com
    SPACETRACK_PASSWORD=...

Then:  python src/fetch_spacetrack.py

If you would rather not script the login, export the two tables from the
website by hand and drop them in data/raw/ as satcat.csv and decay.csv —
build_dataset.py reads whatever is there and normalises the column names
either way.

API etiquette: Space-Track asks for <=30 requests/minute and <=300/hour, and
asks that the full catalogue not be pulled more than a few times a day. This
script makes exactly two requests.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import requests

from config import DECAY, RAW, ROOT, SATCAT

BASE = "https://www.space-track.org"
LOGIN_URL = f"{BASE}/ajaxauth/login"

QUERIES = {
    # Full satellite catalogue: one row per catalogued object.
    SATCAT: f"{BASE}/basicspacedata/query/class/satcat/orderby/NORAD_CAT_ID asc/format/csv",
    # Decay / reentry messages: one or more rows per object that has come down.
    DECAY: f"{BASE}/basicspacedata/query/class/decay/orderby/NORAD_CAT_ID asc/format/csv",
}


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """Minimal .env reader so this has no dependency beyond requests."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def credentials() -> tuple[str, str]:
    load_dotenv()
    identity = os.environ.get("SPACETRACK_IDENTITY")
    password = os.environ.get("SPACETRACK_PASSWORD")
    if not identity or not password:
        sys.exit(
            "No Space-Track credentials found.\n"
            "Either set SPACETRACK_IDENTITY / SPACETRACK_PASSWORD in .env, or export\n"
            "the catalogue and decay tables from space-track.org by hand into\n"
            f"{RAW / 'satcat.csv'} and {RAW / 'decay.csv'}"
        )
    return identity, password


def main() -> None:
    identity, password = credentials()
    RAW.mkdir(parents=True, exist_ok=True)

    with requests.Session() as session:
        resp = session.post(
            LOGIN_URL, data={"identity": identity, "password": password}, timeout=60
        )
        resp.raise_for_status()
        if "Failed" in resp.text or not session.cookies:
            sys.exit("Space-Track login failed -- check the credentials in .env")
        print("logged in to space-track.org")

        for dest, url in QUERIES.items():
            print(f"fetching {dest.name} ...", flush=True)
            with session.get(url, timeout=600, stream=True) as r:
                r.raise_for_status()
                tmp = dest.with_suffix(".part")
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(chunk_size=1 << 16):
                        fh.write(chunk)
                tmp.replace(dest)
            rows = sum(1 for _ in open(dest, encoding="utf-8", errors="replace")) - 1
            print(f"  wrote {dest} ({rows:,} rows, {dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
