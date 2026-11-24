"""Compare the local pipeline's answers with the deployed API's, on 10 fixed inputs.

    # deployed service vs the artifact in this checkout
    uv run python scripts/compare_local_deployed.py --deployed-url https://<app>.modal.run

    # a second local server instead of Modal (e.g. to rehearse)
    uv run python scripts/compare_local_deployed.py --deployed-url http://127.0.0.1:8000

"Local" means the FastAPI app in this repo, called in-process with the artifact in
``artifacts/`` (override with ORBIT_PIPELINE_PATH). "Deployed" means real HTTP calls
to the URL you give. The inputs live in ``scripts/fixed_inputs.json``.

Checked for each input: HTTP status, probability (within --tol), baseline, range flag
and field lists, imputed fields. Also checked once: /health, and that /pipeline-info
reports the same model, version and training-data hash, so a match cannot come from
two different artifacts that happen to agree on ten inputs. Exits 1 on any mismatch.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FIXED_INPUTS = Path(__file__).with_name("fixed_inputs.json")
NEGATIVE_PROBES = [
    {"name": "bad_perigee_above_apogee", "input": {"perigee_km": 500, "apogee_km": 450, "inclination_deg": 70, "object_type": "DEBRIS"}, "expect": 422},
    {"name": "bad_enum", "input": {"perigee_km": 400, "apogee_km": 420, "inclination_deg": 70, "object_type": "PAYLOAD"}, "expect": 422},
]


class LocalClient:
    """The repo's API called in-process."""

    def __init__(self) -> None:
        from fastapi.testclient import TestClient

        from api.main import app

        self.client = TestClient(app)

    def get(self, path: str) -> tuple[int, dict]:
        r = self.client.get(path)
        return r.status_code, r.json()

    def post(self, path: str, body: dict) -> tuple[int, dict]:
        r = self.client.post(path, json=body)
        return r.status_code, r.json()


class HttpClient:
    """A running service reached over HTTP (Modal containers can take a while to cold start)."""

    def __init__(self, base_url: str, timeout: float, retries: int) -> None:
        self.base = base_url.rstrip("/")
        self.timeout, self.retries = timeout, retries

    def _call(self, request: urllib.request.Request) -> tuple[int, dict]:
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as resp:
                    return resp.status, json.loads(resp.read())
            except urllib.error.HTTPError as exc:  # 4xx/5xx still carry a JSON body we want to compare
                if exc.code in (502, 504) and attempt < self.retries:  # gateway errors during cold start
                    last = exc
                    time.sleep(3 * (attempt + 1))
                    continue
                try:
                    return exc.code, json.loads(exc.read())
                except Exception:
                    return exc.code, {}
            except (urllib.error.URLError, TimeoutError) as exc:
                last = exc
                time.sleep(3 * (attempt + 1))
        raise SystemExit(f"could not reach {request.full_url}: {last}")

    def get(self, path: str) -> tuple[int, dict]:
        return self._call(urllib.request.Request(self.base + path))

    def post(self, path: str, body: dict) -> tuple[int, dict]:
        data = json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, headers={"content-type": "application/json"})
        return self._call(req)


def close(a, b, tol: float) -> bool:
    if a is None or b is None:
        return a is b
    return abs(a - b) <= tol


def diff_prediction(local: dict, remote: dict, tol: float) -> list[str]:
    problems = []
    if not close(local["probability_reenters_within_365d"], remote["probability_reenters_within_365d"], tol):
        problems.append(
            f"probability {local['probability_reenters_within_365d']} vs {remote['probability_reenters_within_365d']}"
        )
    for key in ("horizon_days", "out_of_training_range", "out_of_range_fields", "imputed_fields", "model"):
        if local[key] != remote[key]:
            problems.append(f"{key}: {local[key]!r} vs {remote[key]!r}")
    lb, rb = local["baseline"], remote["baseline"]
    if not close(lb["base_rate"], rb["base_rate"], tol):
        problems.append(f"base_rate {lb['base_rate']} vs {rb['base_rate']}")
    lp, rp = lb["physics"], rb["physics"]
    for key in ("status", "reenters_within_365d"):
        if lp[key] != rp[key]:
            problems.append(f"physics.{key}: {lp[key]!r} vs {rp[key]!r}")
    if not close(lp["days_to_reentry"], rp["days_to_reentry"], tol):
        problems.append(f"physics.days_to_reentry {lp['days_to_reentry']} vs {rp['days_to_reentry']}")
    return problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--deployed-url", required=True, help="base URL of the deployed API")
    ap.add_argument("--tol", type=float, default=1e-6, help="allowed absolute difference in numbers (default 1e-6)")
    ap.add_argument("--timeout", type=float, default=90.0, help="seconds per request (cold starts are slow)")
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--inputs", type=Path, default=FIXED_INPUTS)
    args = ap.parse_args(argv)

    cases = json.loads(args.inputs.read_text(encoding="utf-8"))
    if len(cases) != 10:
        print(f"warning: expected 10 fixed inputs, found {len(cases)}", file=sys.stderr)

    local, remote = LocalClient(), HttpClient(args.deployed_url, args.timeout, args.retries)
    failures: list[str] = []

    # -- service-level checks --------------------------------------------------
    (ls, lh), (rs, rh) = local.get("/health"), remote.get("/health")
    print(f"/health         local {ls} loaded={lh.get('model_loaded')}   deployed {rs} loaded={rh.get('model_loaded')}")
    if ls != 200 or rs != 200 or not lh.get("model_loaded") or not rh.get("model_loaded"):
        failures.append("/health: both services must be up with the model loaded")

    (ls, li), (rs, ri) = local.get("/pipeline-info"), remote.get("/pipeline-info")
    if ls == 200 and rs == 200:
        same = (
            li["model"] == ri["model"]
            and li["pipeline_version"] == ri["pipeline_version"]
            and li["training_data"]["panel_sha256"] == ri["training_data"]["panel_sha256"]
            and li["created_utc"] == ri["created_utc"]
        )
        print(f"/pipeline-info  model={ri['model']} version={ri['pipeline_version']} created={ri['created_utc']}  "
              f"{'same artifact' if same else 'DIFFERENT ARTIFACT'}")
        if not same:
            failures.append("/pipeline-info: local and deployed report different artifacts")
    else:
        print(f"/pipeline-info  local {ls}, deployed {rs}")
        failures.append("/pipeline-info did not return 200 on both")

    # -- the 10 fixed inputs -----------------------------------------------------
    print(f"\n{'input':<34}{'local':>10}{'deployed':>10}{'|diff|':>10}  result")
    for case in cases:
        name, body = case["name"], case["input"]
        (lc, lj), (rc, rj) = local.post("/predict", body), remote.post("/predict", body)
        if lc != 200 or rc != 200:
            print(f"{name:<34}{lc:>10}{rc:>10}{'':>10}  FAIL (status)")
            failures.append(f"{name}: status local {lc}, deployed {rc}")
            continue
        problems = diff_prediction(lj, rj, args.tol)
        d = abs(lj["probability_reenters_within_365d"] - rj["probability_reenters_within_365d"])
        print(f"{name:<34}{lj['probability_reenters_within_365d']:>10.4f}{rj['probability_reenters_within_365d']:>10.4f}"
              f"{d:>10.1e}  {'ok' if not problems else 'FAIL'}")
        failures += [f"{name}: {p}" for p in problems]

    # -- error behaviour --------------------------------------------------------
    print()
    for probe in NEGATIVE_PROBES:
        (lc, _), (rc, _) = local.post("/predict", probe["input"]), remote.post("/predict", probe["input"])
        ok = lc == rc == probe["expect"]
        print(f"{probe['name']:<34} local {lc}  deployed {rc}  expected {probe['expect']}  {'ok' if ok else 'FAIL'}")
        if not ok:
            failures.append(f"{probe['name']}: expected {probe['expect']}, got local {lc} / deployed {rc}")

    print()
    if failures:
        print(f"{len(failures)} mismatch(es):")
        for f in failures:
            print("  -", f)
        return 1
    print(f"all {len(cases)} fixed inputs agree within {args.tol:g}; status codes and artifact match.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
