"""Exact row reservation from the classification notebook; no test features or labels."""
import json
from pathlib import Path
import pandas as pd

RESERVED_TEST = json.loads(Path(__file__).with_name('reserved_test.json').read_text(encoding='utf-8'))
RESERVED_KEYS = frozenset((int(key), pd.Timestamp(date)) for key, date in RESERVED_TEST['keys'])


def assert_no_reserved_rows(frame):
    keys = zip(frame['norad_cat_id'].astype('int64'), pd.to_datetime(frame['obs_date']))
    if any(key in RESERVED_KEYS for key in keys):
        raise ValueError('Upload contains reserved final-test observations mislabeled as train/valid. Correct the source split before viewing.')
