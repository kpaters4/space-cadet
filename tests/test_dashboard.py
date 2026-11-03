import os
import sys
from pathlib import Path
import httpx
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'dashboard'))
from source import fetch_panel
from preprocess import prepare, PANEL_COLS
from reservation import RESERVED_TEST
from dictionary import build_dictionary, source_column_types


def test_verified_supabase_schema():
    types = source_column_types()
    assert len(types) == 81
    assert types['norad_cat_id'] == 'int8'
    assert types['epoch_index'] == types['event_observed'] == 'float8'
    assert types['obs_date'] == types['decay_pred_spread_days'] == 'text'
    assert types['is_debris'] == 'bool'


def test_dictionary_uses_database_types_not_inferred_json_types():
    frame = pd.DataFrame({'norad_cat_id': [10], 'age_days': [46], 'event_observed': [1]})
    result = build_dictionary(frame, {'norad_cat_id': 'int8', 'age_days': 'float8', 'event_observed': 'float8'}).set_index('Column')
    assert result.loc['norad_cat_id', 'Supabase type'] == 'int8'
    assert result.loc['age_days', 'Supabase type'] == 'float8'
    assert result.loc['age_days', 'Pandas dtype'] == 'int64'
    assert 'double precision' in result.loc['event_observed', 'Cleaning / notes']


@pytest.fixture
def sample_frame():
    path = Path(os.environ.get('SPACE_CADET_SAMPLE_CSV', ROOT / 'data/exact_training_sample/sample_panel.csv'))
    if path.exists():
        frame = pd.read_csv(path)
        assert len(frame) == 10028 and frame.norad_cat_id.nunique() == 921
        return frame
    # Portable fixture for a checkout without the privately stored source CSV.
    rows = []
    for i in range(2):
        row = dict.fromkeys(PANEL_COLS, 1.0)
        row.update(norad_cat_id=900001+i, obs_date=f'{2000+i}-01-01',
                   launch_date=f'{1990+i}-01-01', decay_date=f'{2000+i}-04-10',
                   split='train', object_type='DEBRIS', regime='LEO', country='US',
                   rcs_size='SMALL', age_days=3652, days_remaining=100,
                   apogee_km=300, perigee_km=200, mean_alt_km=250)
        rows.append(row)
    return pd.DataFrame(rows)


def test_pagination_under_server_limit(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://example.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'test')
    calls = []
    def handler(request):
        assert request.url.params['split'] == 'in.(train,valid)'
        offset = int(request.url.params['offset'])
        calls.append(offset)
        rows = [{'norad_cat_id': n, 'obs_date': '2000-01-01'} for n in range(offset, min(offset+400, 1005))]
        return httpx.Response(200, json=rows, headers={'content-range': f'{offset}-{offset+len(rows)-1}/1005'})
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert len(fetch_panel(client)) == 1005
    assert calls == [0, 400, 800]


def test_no_visible_rows(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://example.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'test')
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json=[], headers={'content-range': '*/0'}))) as client:
        with pytest.raises(RuntimeError, match='No rows are visible'):
            fetch_panel(client)


def test_sample_and_single_object(sample_frame):
    raw = sample_frame
    before = raw.copy(deep=True)
    panel, objs, cutoff, log = prepare(raw)
    assert len(panel) == len(raw) and len(objs) == raw.norad_cat_id.nunique()
    assert panel['split'].eq('train').all()
    assert panel['event_observed'].eq(1).all()
    pd.testing.assert_frame_equal(raw, before)
    one = raw[raw.norad_cat_id.eq(raw.norad_cat_id.iloc[0])]
    small, objects, _, _ = prepare(one)
    assert len(small) == len(one) and len(objects) == 1
    assert 'regime' in small and 'split' in small


def test_notebook_final_test_reservation(sample_frame):
    assert RESERVED_TEST['rows'] == len(RESERVED_TEST['keys']) == 3084
    raw = sample_frame.head(1).copy()
    raw['norad_cat_id'], raw['obs_date'] = RESERVED_TEST['keys'][0]
    raw['split'] = 'train'
    with pytest.raises(ValueError, match='reserved final-test'):
        prepare(raw)
    raw['split'] = 'test'
    with pytest.raises(ValueError, match='No training or validation'):
        prepare(raw)


def test_streamlit_render_and_filters(monkeypatch, sample_frame):
    import source
    from streamlit.testing.v1 import AppTest
    import streamlit as st
    st.cache_data.clear()
    raw = sample_frame
    monkeypatch.setattr(source, 'fetch_panel', lambda: raw.copy())
    app = AppTest.from_file(str(ROOT / 'dashboard/app.py'), default_timeout=60).run()
    assert not app.exception, [e.message for e in app.exception]
    assert not app.error
    assert len(app.tabs) == 4
    app.multiselect[0].set_value([]).run()
    assert not app.exception
    assert any('No data matches' in x.value for x in app.info)
