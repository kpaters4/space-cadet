"""The two PLAN baselines, written once so training and the API agree.

* base rate: the share of training snapshots whose object reentered within the
  horizon. It ignores the inputs entirely.
* physics extrapolation: keep falling at the current perigee descent rate until
  perigee reaches ``REENTRY_PERIGEE_KM`` and predict "reenters within the
  horizon" if that happens inside 365 days.

The physics baseline needs the 30-days-ago perigee. When the caller did not
supply it there is no descent rate, so the baseline is undefined (``None``), not
zero: a missing rate must not read as "not falling".
"""
from __future__ import annotations

import math

from .transformers import WINDOW_DAYS

# The altitude at which a decaying object is effectively gone.
REENTRY_PERIGEE_KM = 120.0
HORIZON_DAYS = 365.0


def descent_rate_km_per_day(perigee_km: float | None, perigee_km_30d_ago: float | None) -> float | None:
    """Signed change in perigee per day (negative = falling); None if either reading is missing."""
    if perigee_km is None or perigee_km_30d_ago is None:
        return None
    if any(isinstance(v, float) and math.isnan(v) for v in (perigee_km, perigee_km_30d_ago)):
        return None
    return (perigee_km - perigee_km_30d_ago) / WINDOW_DAYS


def physics_days_to_reentry(perigee_km: float | None, perigee_km_30d_ago: float | None) -> float | None:
    """Days until perigee hits REENTRY_PERIGEE_KM at the current rate.

    ``None`` when the rate is unknown; ``math.inf`` when the perigee is not falling.
    """
    rate = descent_rate_km_per_day(perigee_km, perigee_km_30d_ago)
    if rate is None:
        return None
    if perigee_km <= REENTRY_PERIGEE_KM:
        return 0.0
    if rate >= 0:
        return math.inf
    return (perigee_km - REENTRY_PERIGEE_KM) / -rate


def physics_reenters_within_horizon(
    perigee_km: float | None, perigee_km_30d_ago: float | None, horizon_days: float = HORIZON_DAYS
) -> int | None:
    days = physics_days_to_reentry(perigee_km, perigee_km_30d_ago)
    if days is None:
        return None
    return int(days <= horizon_days)
