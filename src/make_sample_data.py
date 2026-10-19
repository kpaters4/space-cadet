"""Generate FAKE satcat.csv / decay.csv so the pipeline can be smoke-tested
before you have Space-Track credentials.

The numbers are invented. The headers and value formats match what the
Space-Track REST API returns for `class/satcat` and `class/decay`, so running
build_dataset.py against these exercises exactly the same code path as the real
files.

    python src/make_sample_data.py                  # -> data/sample/
    python src/build_dataset.py --raw-dir data/sample --out-dir data/sample_out

Never commit the output, and never model on it.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from config import RANDOM_SEED, ROOT

OBJECT_TYPES = ["PAYLOAD", "ROCKET BODY", "DEBRIS", "UNKNOWN"]
RCS_SIZES = ["SMALL", "MEDIUM", "LARGE", None]
COUNTRIES = ["US", "CIS", "PRC", "ESA", "JPN"]


def make(n: int, seed: int = RANDOM_SEED) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)

    launch = pd.Timestamp("1962-01-01") + pd.to_timedelta(
        rng.integers(0, 23000, n), unit="D"
    )
    perigee = rng.gamma(3.0, 130.0, n) + 180          # mostly LEO, a long tail
    apogee = perigee + rng.gamma(1.5, 300.0, n)

    # Crude but monotone stand-in for real decay physics: low perigee -> short life.
    scale = np.clip((perigee - 150) / 40.0, 0.4, None) ** 2.1
    lifetime = rng.gamma(2.0, scale)
    decayed = (perigee < 700) & (rng.random(n) < 0.75)

    decay_dt = launch + pd.to_timedelta(np.rint(lifetime), unit="D")
    # Anything whose "reentry" lands in the future is simply still in orbit.
    decayed &= decay_dt < pd.Timestamp("2026-10-01")

    satcat = pd.DataFrame(
        {
            "INTLDES": [f"{d.year}-{i % 999:03d}A" for i, d in enumerate(launch)],
            "NORAD_CAT_ID": np.arange(1, n + 1),
            "OBJECT_TYPE": rng.choice(OBJECT_TYPES, n, p=[0.25, 0.15, 0.55, 0.05]),
            "SATNAME": [f"FAKE OBJECT {i + 1}" for i in range(n)],
            "COUNTRY": rng.choice(COUNTRIES, n),
            "LAUNCH": launch.strftime("%Y-%m-%d"),
            "SITE": rng.choice(["AFETR", "TTMTR", "PLMSC", "FRGUI"], n),
            "DECAY": np.where(decayed, decay_dt.strftime("%Y-%m-%d"), ""),
            "PERIOD": np.round(
                90 + (apogee + perigee) / 2 * 0.058, 2
            ),  # rough, just to populate the column
            "INCLINATION": np.round(rng.uniform(0, 110, n), 2),
            "APOGEE": np.round(apogee).astype(int),
            "PERIGEE": np.round(perigee).astype(int),
            "RCSVALUE": np.round(rng.gamma(1.2, 1.5, n), 4),
            "RCS_SIZE": rng.choice(RCS_SIZES, n, p=[0.5, 0.25, 0.1, 0.15]),
            "CURRENT": "Y",
            "OBJECT_NAME": [f"FAKE OBJECT {i + 1}" for i in range(n)],
            "OBJECT_ID": [f"{d.year}-{i % 999:03d}A" for i, d in enumerate(launch)],
            "OBJECT_NUMBER": np.arange(1, n + 1),
        }
    )

    # Decay table: several messages per reentry, prediction then final, like TIP.
    idx = np.flatnonzero(decayed)
    rows = []
    for i in idx:
        final = decay_dt[i]
        n_msgs = int(rng.integers(1, 4))
        for m in range(n_msgs):
            is_final = m == n_msgs - 1
            slip = 0 if is_final else rng.integers(-6, 7)
            rows.append(
                {
                    "NORAD_CAT_ID": i + 1,
                    "OBJECT_NUMBER": i + 1,
                    "OBJECT_NAME": f"FAKE OBJECT {i + 1}",
                    "OBJECT_ID": satcat.loc[i, "OBJECT_ID"],
                    "RCS": satcat.loc[i, "RCSVALUE"],
                    "RCS_SIZE": satcat.loc[i, "RCS_SIZE"],
                    "COUNTRY": satcat.loc[i, "COUNTRY"],
                    "MSG_EPOCH": (final - pd.Timedelta(days=int(4 * (n_msgs - m)))).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                    "DECAY_EPOCH": (final + pd.Timedelta(days=int(slip))).strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                    "SOURCE": "fake",
                    "MSG_TYPE": "Historical" if is_final else "Prediction",
                    "PRECEDENCE": m + 1,
                }
            )
    return satcat, pd.DataFrame(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-n", type=int, default=4000, help="number of fake objects")
    ap.add_argument("--out-dir", type=Path, default=ROOT / "data" / "sample")
    args = ap.parse_args()

    satcat, decay = make(args.n)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    satcat.to_csv(args.out_dir / "satcat.csv", index=False)
    decay.to_csv(args.out_dir / "decay.csv", index=False)
    print(f"FAKE data written to {args.out_dir}")
    print(f"  satcat.csv  {len(satcat):,} rows")
    print(f"  decay.csv   {len(decay):,} rows  ({decay['NORAD_CAT_ID'].nunique():,} objects)")


if __name__ == "__main__":
    main()
