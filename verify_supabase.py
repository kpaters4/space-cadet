"""Verify every uploaded field against the preserved CSV sample."""
import sys
from pathlib import Path
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent / 'dashboard'))
from source import fetch_panel

remote = fetch_panel()
local = pd.read_csv('data/exact_training_sample/sample_panel.csv')
assert set(remote.columns) == set(local.columns), 'Uploaded columns differ'
keys = ['norad_cat_id', 'obs_date']
local = local.sort_values(keys).reset_index(drop=True)
remote = remote[local.columns].sort_values(keys).reset_index(drop=True)
for col in local:
    left, right = local[col], remote[col]
    if pd.api.types.is_numeric_dtype(left):
        right = pd.to_numeric(right, errors='raise')
        pd.testing.assert_series_equal(left, right, check_dtype=False, check_exact=False, rtol=1e-12, atol=1e-12)
    else:
        pd.testing.assert_series_equal(left.fillna('').astype(str), right.fillna('').astype(str), check_dtype=False)
Path('tmp').mkdir(exist_ok=True)
remote.to_pickle('tmp/verified_supabase.pkl')
print(f'Verified all {len(remote):,} rows, {remote.shape[1]} columns, {remote.norad_cat_id.nunique()} objects against original CSV.')
