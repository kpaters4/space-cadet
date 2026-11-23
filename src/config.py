"""Shared paths and tunables for the space-cadet data pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"

# Raw inputs (see README for how each is obtained)
SW_ALL = RAW / "SW-All.csv"          # CelesTrak space weather, daily 1957-present + forecast
SATCAT = RAW / "satcat.csv"          # Space-Track satellite catalogue
DECAY = RAW / "decay.csv"            # Space-Track decay / reentry messages
GP_HISTORY = RAW / "gp_history.csv"  # Space-Track orbital element history

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
MAX_ELEMENT_AGE_DAYS = 30

RANDOM_SEED = 20261019

# --- Modelling targets and panel design (PLAN.md Decisions 1-9) ------------
# Primary target: will the object reenter within HORIZON_DAYS of the snapshot?
# Secondary target: log1p days to reentry, only for objects that have reentered
# by the as-of date (conditional on reentry -- always report next to the primary).
PRIMARY_TARGET = "reenters_within_horizon"
SECONDARY_TARGET = "log1p_days_remaining"
HORIZON_DAYS = 365

# Decay messages that record a reentry that actually happened. Space-Track also
# emits "Prediction" messages with future dates; those must never mark an
# object as decayed. Real msg_type values seen in the first pull: Historical, Prediction.
DECAY_ACTUAL_MSG_TYPES = ("historical",)

# gp_history.csv is a full orbital-element history export and can be tens of
# GB -- too big to read in one pd.read_csv on a laptop. This sets both: how
# many objects fetch_gp_history.py pulls per resumable run, and how many
# eligible objects build_dataset.py's chunked load_gp_history() samples and
# streams when building the panel (see sample_eligible_object_ids). Test
# small first, then raise; None reads every object's history (needs a
# machine that can hold it).
GP_MAX_OBJECTS: int | None = 500
GP_CHUNKSIZE = 500_000

# Forward-looking solar means need a forecast at prediction time -- off.
INCLUDE_FORWARD_SW = False

# --- Snapshot panel design (PLAN.md Decisions 3-6) ----------------------------
# One row per (object, snapshot): the 1st of every month from SNAPSHOT_START to
# as-of minus HORIZON_DAYS, so every snapshot has a full year of follow-up.
SNAPSHOT_START = "2015-01-01"
# A snapshot is kept only if the perigee on that date (from the as-of element
# set, NOT satcat's terminal value) is at or below this.
SNAPSHOT_MAX_PERIGEE_KM = 600.0
# Junk only: active satellites hold altitude with thrusters (operator decision).
JUNK_TYPES = ("DEBRIS", "ROCKET BODY", "R/B", "TBA", "UNKNOWN")

# Chronological windows with gap years (2021, 2023) so no training label's
# 365-day look-ahead resolves inside a later split's period.
TRAIN_YEARS = (2015, 2020)
VALID_YEARS = (2022, 2022)
TEST_FROM_YEAR = 2024
# Each OBJECT is assigned to exactly one split by a seeded hash of its id, then
# contributes only snapshots inside that split's window (object-disjoint splits).
SPLIT_FRACTIONS = {"train": 0.60, "valid": 0.20, "test": 0.20}
