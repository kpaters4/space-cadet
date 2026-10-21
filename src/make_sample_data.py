"""Generate FAKE satcat.csv / decay.csv / gp_history.csv so the pipeline can be
smoke-tested before you have Space-Track credentials.

The numbers are invented. The headers and value formats match what the
Space-Track REST API returns for `class/satcat`, `class/decay`, and
`class/gp_history`, so running build_dataset.py against these exercises
exactly the same code path as the real files.

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
EARTH_RADIUS_KM = 6378.137
HORIZON = pd.Timestamp("2026-10-18")  # matches the real asof used by build_dataset.py


def make(n: int, seed: int = RANDOM_SEED) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(seed)

    launch = pd.Timestamp("1962-01-01") + pd.to_timedelta(
        rng.integers(0, 23000, n), unit="D"
    )
    perigee = rng.gamma(3.0, 130.0, n) + 180          # mostly LEO, a long tail
    apogee = perigee + rng.gamma(1.5, 300.0, n)
    inclination = np.round(rng.uniform(0, 110, n), 2)

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
            "INCLINATION": inclination,
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
    decayed_idx = np.flatnonzero(decayed)
    rows = []
    for i in decayed_idx:
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
    decay = pd.DataFrame(rows)

    gp_history = make_gp_history(
        satcat, launch=launch, perigee=perigee, apogee=apogee, inclination=inclination,
        full_decay_dt=decay_dt, rng=rng,
    )
    return satcat, decay, gp_history


def make_gp_history(
    satcat: pd.DataFrame, *, launch, perigee, apogee, inclination, full_decay_dt, rng,
) -> pd.DataFrame:
    """One element-set-history row per object per epoch, mimicking Space-Track's
    `class/gp_history`: perigee/apogee drift toward each other and shrink over
    time (drag circularizes and lowers an orbit before reentry), with cadence
    that gets denser as the object nears the end of its generated window.

    `full_decay_dt` is launch + the simulated *physical* lifetime, independent
    of whether `decayed` ended up True in `make()` -- it's the natural endpoint
    for a believable decreasing-perigee trend, capped at HORIZON for objects
    whose simulated reentry lies beyond it.
    """
    n = len(satcat)
    gen_end = np.minimum(full_decay_dt.to_numpy(), np.datetime64(HORIZON))
    span_days = (gen_end - launch.to_numpy()).astype("timedelta64[D]").astype(int)

    rows = []
    for i in range(n):
        span = int(span_days[i])
        if span < 2:
            continue
        n_records = int(np.clip(span / 25, 3, 60))
        frac = np.linspace(0.0, 1.0, n_records)
        epochs = launch[i] + pd.to_timedelta(frac * span, unit="D")

        floor_perigee = max(120.0, perigee[i] * 0.3)
        perigee_t = perigee[i] - (perigee[i] - floor_perigee) * frac**1.3
        apogee_t = perigee_t + (apogee[i] - perigee[i]) * (1 - frac)  # circularizes toward perigee
        period_t = 90 + (apogee_t + perigee_t) / 2 * 0.058
        mean_motion_t = 1440.0 / period_t
        sma_t = (apogee_t + perigee_t) / 2 + EARTH_RADIUS_KM
        eccentricity_t = (apogee_t - perigee_t) / (2 * sma_t)
        bstar_t = rng.uniform(1e-5, 5e-4, n_records) * (1 + 2 * frac)  # drag term grows near reentry
        mean_motion_dot_t = 1e-6 * frac**2 + rng.normal(0, 1e-8, n_records)
        inclination_t = inclination[i] + rng.normal(0, 0.02, n_records)

        for k in range(n_records):
            rows.append(
                {
                    "NORAD_CAT_ID": i + 1,
                    "OBJECT_NAME": satcat.loc[i, "OBJECT_NAME"],
                    "EPOCH": epochs[k].strftime("%Y-%m-%dT%H:%M:%S"),
                    "MEAN_MOTION": round(float(mean_motion_t[k]), 8),
                    "MEAN_MOTION_DOT": float(mean_motion_dot_t[k]),
                    "ECCENTRICITY": round(float(eccentricity_t[k]), 7),
                    "INCLINATION": round(float(inclination_t[k]), 4),
                    "BSTAR": float(bstar_t[k]),
                    "SEMIMAJOR_AXIS": round(float(sma_t[k]), 3),
                    "PERIOD": round(float(period_t[k]), 3),
                    "APOAPSIS": round(float(apogee_t[k]), 3),
                    "PERIAPSIS": round(float(perigee_t[k]), 3),
                    "ELEMENT_SET_NO": k + 1,
                    "REV_AT_EPOCH": int(mean_motion_t[k] * frac[k] * span),
                }
            )
    return pd.DataFrame(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-n", type=int, default=4000, help="number of fake objects")
    ap.add_argument("--out-dir", type=Path, default=ROOT / "data" / "sample")
    args = ap.parse_args()

    satcat, decay, gp_history = make(args.n)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    satcat.to_csv(args.out_dir / "satcat.csv", index=False)
    decay.to_csv(args.out_dir / "decay.csv", index=False)
    gp_history.to_csv(args.out_dir / "gp_history.csv", index=False)
    print(f"FAKE data written to {args.out_dir}")
    print(f"  satcat.csv      {len(satcat):,} rows")
    print(f"  decay.csv       {len(decay):,} rows  ({decay['NORAD_CAT_ID'].nunique():,} objects)")
    print(f"  gp_history.csv  {len(gp_history):,} rows  "
          f"({gp_history['NORAD_CAT_ID'].nunique():,} objects)")


if __name__ == "__main__":
    main()
