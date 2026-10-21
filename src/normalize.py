"""Column-name normalisation for the two Space-Track tables.

Space-Track hands out different header spellings depending on how you got the
data (REST API `class/satcat` vs. a CSV export from the website UI vs. older
field names). Everything downstream uses the canonical snake_case names here,
so either source drops in without edits.
"""
from __future__ import annotations

import pandas as pd

SATCAT_ALIASES = {
    "norad_cat_id": ["NORAD_CAT_ID", "OBJECT_NUMBER", "NORAD", "NORAD_NUMBER", "CATALOG_NUMBER"],
    "object_name": ["OBJECT_NAME", "SATNAME", "NAME"],
    "object_id": ["OBJECT_ID", "INTLDES", "INTL_DES", "INTERNATIONAL_DESIGNATOR"],
    "object_type": ["OBJECT_TYPE", "TYPE"],
    "country": ["COUNTRY", "COUNTRY_CODE", "OWNER"],
    "site": ["SITE", "LAUNCH_SITE"],
    "launch_date": ["LAUNCH", "LAUNCH_DATE"],
    "decay_date_satcat": ["DECAY", "DECAY_DATE"],
    "period_min": ["PERIOD", "PERIOD_MIN", "PERIOD_MINUTES"],
    "inclination_deg": ["INCLINATION", "INCLINATION_DEG"],
    "apogee_km": ["APOGEE", "APOGEE_KM"],
    "perigee_km": ["PERIGEE", "PERIGEE_KM"],
    "rcs_size": ["RCS_SIZE", "RCS"],
    "rcs_value": ["RCSVALUE", "RCS_VALUE"],
    "is_current": ["CURRENT"],
}

DECAY_ALIASES = {
    "norad_cat_id": ["NORAD_CAT_ID", "OBJECT_NUMBER", "NORAD"],
    "object_name": ["OBJECT_NAME", "SATNAME", "NAME"],
    "object_id": ["OBJECT_ID", "INTLDES", "INTL_DES"],
    "decay_epoch": ["DECAY_EPOCH", "DECAY_DATE", "DECAY"],
    "msg_epoch": ["MSG_EPOCH", "MESSAGE_EPOCH"],
    "msg_type": ["MSG_TYPE", "MESSAGE_TYPE"],
    "precedence": ["PRECEDENCE"],
    "decay_source": ["SOURCE"],
    "rcs_size": ["RCS_SIZE"],
    "rcs_value": ["RCS", "RCSVALUE"],
    "country": ["COUNTRY", "COUNTRY_CODE"],
}

# Space-Track `class/gp_history` -- one row per orbital element set (TLE-
# equivalent), many per object over its life. This is what lets orbit features
# be taken *as of* an observation epoch instead of satcat's one terminal
# snapshot. APOAPSIS/PERIAPSIS are altitude in km, same convention as satcat's
# APOGEE/PERIGEE.
GP_HISTORY_ALIASES = {
    "norad_cat_id": ["NORAD_CAT_ID", "OBJECT_NUMBER", "NORAD"],
    "epoch": ["EPOCH"],
    "mean_motion": ["MEAN_MOTION"],
    "mean_motion_dot": ["MEAN_MOTION_DOT"],
    "mean_motion_ddot": ["MEAN_MOTION_DDOT"],
    "bstar": ["BSTAR"],
    "eccentricity": ["ECCENTRICITY"],
    "inclination_deg": ["INCLINATION"],
    "semimajor_axis_km": ["SEMIMAJOR_AXIS"],
    "period_min": ["PERIOD"],
    "apogee_km": ["APOAPSIS"],
    "perigee_km": ["PERIAPSIS"],
    "element_set_no": ["ELEMENT_SET_NO"],
    "rev_at_epoch": ["REV_AT_EPOCH"],
}


def _key(name: str) -> str:
    return name.strip().upper().replace(" ", "_").replace("-", "_").replace(".", "_")


def normalize(df: pd.DataFrame, aliases: dict[str, list[str]], *, required: tuple[str, ...]):
    """Rename `df` to canonical names; return (renamed_df, missing_canonical_names)."""
    lookup = {_key(c): c for c in df.columns}
    rename, found = {}, set()
    for canonical, candidates in aliases.items():
        for cand in candidates:
            src = lookup.get(_key(cand))
            # Don't let a later alias steal a column an earlier canonical claimed.
            if src is not None and src not in rename:
                rename[src] = canonical
                found.add(canonical)
                break
    out = df.rename(columns=rename)
    out = out[[c for c in out.columns if c in aliases]]
    missing = tuple(c for c in required if c not in found)
    return out, missing
