"""Check that the local API and the deployed Modal API give the same answers (D4).

Start the local API first (uv run --group api uvicorn api.serve:app --port 8000), then:

    uv run --group api python api/compare_local_deployed.py \
        --local http://127.0.0.1:8000 --deployed https://<workspace>--space-cadet-reentry-api-fastapi-app.modal.run

Sends the same 10 fixed inputs to both, and exits non-zero if any response differs
(probabilities must agree to within 1e-9).
"""
from __future__ import annotations

import argparse
import sys

import httpx

BASE = {"perigee_km": 380, "apogee_km": 420, "perigee_km_30d_ago": 392, "inclination_deg": 51.6, "bstar": 0.0004,
        "object_type": "DEBRIS", "rcs_size": "SMALL", "age_days": 1200, "f107_81d_mean": 150, "ap_27d_mean": 12}
CASES = [
    {},
    {"perigee_km": 180, "apogee_km": 230, "perigee_km_30d_ago": 215},
    {"perigee_km": 550, "apogee_km": 600, "perigee_km_30d_ago": 551, "object_type": "ROCKET BODY", "rcs_size": "LARGE"},
    {"perigee_km": 300, "apogee_km": 1200, "perigee_km_30d_ago": 305, "rcs_size": "MEDIUM"},
    {"f107_81d_mean": 70, "ap_27d_mean": 4},
    {"f107_81d_mean": 220, "ap_27d_mean": 30},
    {"object_type": "UNKNOWN", "rcs_size": "UNKNOWN", "age_days": 30},
    {"perigee_km": 450, "apogee_km": 470, "perigee_km_30d_ago": 450, "bstar": 0.00005},
    {"perigee_km": 250, "apogee_km": 260, "perigee_km_30d_ago": 290, "bstar": 0.002, "inclination_deg": 98},
    {"object_type": "TBA", "age_days": 9000, "inclination_deg": 7},
]


def call(base_url: str, body: dict) -> dict:
    r = httpx.post(f"{base_url.rstrip('/')}/predict", json=body, timeout=120)
    r.raise_for_status()
    return r.json()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--local", required=True)
    ap.add_argument("--deployed", required=True)
    args = ap.parse_args()

    failures = 0
    print(f"{'case':>4}  {'local p':>12}  {'deployed p':>12}  match")
    for i, change in enumerate(CASES, 1):
        body = {**BASE, **change}
        a, b = call(args.local, body), call(args.deployed, body)
        same = abs(a["probability"] - b["probability"]) <= 1e-9 and {k: v for k, v in a.items() if k != "probability"} \
            == {k: v for k, v in b.items() if k != "probability"}
        failures += not same
        print(f"{i:>4}  {a['probability']:>12.8f}  {b['probability']:>12.8f}  {'yes' if same else 'NO'}")
    print("all 10 match" if not failures else f"{failures} of 10 differ")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
