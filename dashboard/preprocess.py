"""Prepare a sample for display without changing the source table or labels."""
import pandas as pd
from reservation import assert_no_reserved_rows
DEEP_SPACE_KM = 100_000

PANEL_COLS = [
    "norad_cat_id", "obs_date", "split", "object_type", "regime", "country", "rcs_size",
    "age_days", "days_remaining", "log1p_days_remaining", "event_observed",
    "perigee_km", "apogee_km", "mean_alt_km", "inclination_deg", "eccentricity",
    "rcs_value", "f107_adj", "f107_adj_mean_27d", "f107_adj_mean_81d",
    "f107_adj_mean_365d", "f107_trend_81d", "f107_pct_rank_11y",
    "ap_avg", "ap_mean_27d", "ap_mean_81d", "ap_max_27d", "ap_storm_days_81d",
]
LEAKY = {"perigee_km", "apogee_km", "mean_alt_km", "eccentricity", "inclination_deg"}



def prepare(raw):
    required = PANEL_COLS + ['launch_date', 'decay_date']
    missing = sorted(set(required) - set(raw.columns))
    if missing:
        raise ValueError('Missing columns: ' + ', '.join(missing))
    df = raw.copy()
    n_test = int(df['split'].eq('test').sum())
    df = df.loc[df['split'].isin(['train', 'valid'])].copy()
    if df.empty:
        raise ValueError('No training or validation observations are available.')
    for col in ['obs_date', 'launch_date', 'decay_date']:
        df[col] = pd.to_datetime(df[col], errors='coerce')
    if df[['obs_date', 'launch_date']].isna().any().any():
        raise ValueError('Observation and launch dates must be valid.')
    assert_no_reserved_rows(df)
    text_cols = {'norad_cat_id', 'obs_date', 'split', 'object_type', 'regime', 'country', 'rcs_size'}
    for col in set(PANEL_COLS) - text_cols:
        df[col] = pd.to_numeric(df[col], errors='raise')
    for col in ['object_type', 'regime', 'country', 'rcs_size']:
        df[col] = df[col].fillna('UNKNOWN')
    df['deep_space'] = df['apogee_km'].gt(DEEP_SPACE_KM)
    panel = df[PANEL_COLS + ['deep_space']].copy()
    panel['launch_year'] = df['launch_date'].dt.year
    objs = df.sort_values('obs_date').drop_duplicates('norad_cat_id', keep='last').copy()
    objs['event'] = objs['event_observed'].astype(int)
    objs['launch_year'] = objs['launch_date'].dt.year
    # Known sample outcomes are preserved; this is descriptive, not a model evaluation cutoff.
    as_of = max(df['obs_date'].max(), df['decay_date'].max()) if df['decay_date'].notna().any() else df['obs_date'].max()
    log = [('Test rows excluded', n_test, 'Only train/valid observations displayed'),
           ('Sample rows loaded', len(panel), 'Original outcomes preserved; constant columns retained'),
           ('Sample objects', len(objs), 'One latest observation per sampled object; no full catalogue loaded')]
    return panel, objs, as_of, log
