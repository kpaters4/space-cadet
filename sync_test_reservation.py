"""Record the notebook's exact reserved row keys without exporting test features or targets."""
import hashlib
import json
import argparse
from pathlib import Path
import pandas as pd

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo-root', type=Path, default=Path(__file__).resolve().parent,
                    help='Repository containing the notebook and original processed panel')
parser.add_argument('--sample-csv', type=Path, default=Path('data/exact_training_sample/sample_panel.csv'))
args = parser.parse_args()
REPO = args.repo_root
notebook_path = REPO / 'src/Models/classification_model.ipynb'
source_path = REPO / 'data/processed/panel.csv'
notebook = json.loads(notebook_path.read_text(encoding='utf-8'))
code = '\n'.join(''.join(c.get('source', [])) for c in notebook['cells'] if c['cell_type'] == 'code')
assert 'pd.to_numeric(panel["event_observed"], errors="coerce").eq(1)' in code
assert 'X_test = apply_missing_value_strategy(X_raw.loc[reentered_data["split"].eq("test")])' in code
frame = pd.read_csv(source_path, usecols=['norad_cat_id', 'obs_date', 'event_observed', 'split'])
test = frame.loc[pd.to_numeric(frame.event_observed, errors='coerce').eq(1) & frame['split'].eq('test')]
assert len(test) == 3084, 'Notebook test count has changed; review the updated reservation.'
assert not test.duplicated(['norad_cat_id', 'obs_date']).any()
keys = [[int(row.norad_cat_id), str(row.obs_date)] for row in test.sort_values(['norad_cat_id', 'obs_date']).itertuples()]
sample = pd.read_csv(args.sample_csv, usecols=['norad_cat_id', 'obs_date'])
assert not set(map(tuple, keys)).intersection(map(tuple, sample.itertuples(index=False, name=None)))
with source_path.open('rb') as stream:
    source_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
manifest = {
    'notebook': 'src/Models/classification_model.ipynb',
    'notebook_sha256': hashlib.sha256(notebook_path.read_bytes()).hexdigest(),
    'source_panel_sha256': source_hash,
    'selection': 'event_observed == 1 and split == "test"',
    'rows': len(test), 'objects': int(test.norad_cat_id.nunique()),
    'key_columns': ['norad_cat_id', 'obs_date'], 'keys': keys,
}
Path('dashboard/reserved_test.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({k:v for k,v in manifest.items() if k != 'keys'}, indent=2))
