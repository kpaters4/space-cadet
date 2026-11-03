"""Read the complete Supabase table with stable, bounded pagination."""
import os
import re
import httpx
import pandas as pd


def fetch_panel(client=None):
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
    table = os.environ.get('SUPABASE_TABLE', 'sample_panel')
    if not url.startswith('https://') or not key:
        raise ValueError('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.')
    if not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', table):
        raise ValueError('Invalid SUPABASE_TABLE name.')
    owned = client is None
    client = client or httpx.Client(timeout=60)
    rows, total = [], None
    try:
        while total is None or len(rows) < total:
            response = client.get(f'{url}/rest/v1/{table}',
                headers={'apikey': key, 'Prefer': 'count=exact'},
                params={'select': '*', 'split': 'in.(train,valid)', 'order': 'norad_cat_id.asc,obs_date.asc',
                        'offset': len(rows), 'limit': 1000})
            if response.status_code >= 400:
                raise RuntimeError(f'Supabase read failed (HTTP {response.status_code}). Check table name, key and SELECT policy.')
            count = response.headers.get('content-range', '').split('/')[-1]
            if not count.isdigit():
                raise RuntimeError('Supabase did not return an exact row count.')
            if total is not None and int(count) != total:
                raise RuntimeError('Table changed while loading; please refresh.')
            total = int(count)
            page = response.json()
            if not page:
                if total == 0:
                    raise RuntimeError('No rows are visible. Check the sample_panel SELECT policy or table contents.')
                raise RuntimeError('Supabase returned an incomplete page; please retry.')
            rows.extend(page)
        frame = pd.DataFrame(rows)
        if len(frame) != total or frame.duplicated(['norad_cat_id', 'obs_date']).any():
            raise RuntimeError('Row count or observation keys changed while loading; please retry.')
        return frame
    except httpx.RequestError as exc:
        raise RuntimeError('Could not reach Supabase. Please retry or check the project status.') from exc
    finally:
        if owned:
            client.close()
