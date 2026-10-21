"""Shared paths and tunables for the space-cadet data pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

# Raw inputs (see README for how each is obtained)
SW_ALL = RAW / "SW-All.csv"          # CelesTrak space weather, daily 1957-present + forecast
SATCAT = RAW / "satcat.csv"          # Space-Track satellite catalogue
DECAY = RAW / "decay.csv"            # Space-Track decay / reentry messages
GP_HISTORY = RAW / "gp_history.csv"  # Space-Track orbital element history (optional; see below)

# Processed outputs
SW_DAILY = PROCESSED / "space_weather_daily.csv"
SW_MONTHLY_FORECAST = PROCESSED / "space_weather_monthly_forecast.csv"
OBJECTS = PROCESSED / "objects.csv"
PANEL = PROCESSED / "panel.csv"

# --- Dataset construction knobs -------------------------------------------
# Only low-perigee objects decay on human timescales; above this they are
# kept in objects.csv but excluded from the modelling panel by default.
MAX_PERIGEE_KM = 1000.0

# Observation epochs sampled per object for the days-remaining panel.
EPOCHS_PER_OBJECT = 12

# Trailing windows (days) used for space weather features.
TRAILING_WINDOWS = (1, 3, 7, 27, 81, 365)

# Objects whose decay predates reliable daily space weather are dropped.
MIN_EPOCH = "1957-10-01"

# gp_history (orbital element history) features -- see SCHEMA.md "orbit_asof".
# Window used for the trailing perigee-decay-rate feature.
PERIGEE_DECAY_WINDOW_DAYS = 30
# An as-of element older than this is too stale to trust; attach_orbit_history
# leaves the *_asof columns null rather than use it.
MAX_ELEMENT_AGE_DAYS = 45

RANDOM_SEED = 20261019
