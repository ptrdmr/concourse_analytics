#!/usr/bin/env python3
"""
pull_7shifts_labor.py

Pull time punch data from 7shifts and write public/data/labor.json for the dashboard.

Requires .env (gitignored):
  SEVENSHIFTS_TOKEN=...
  SEVENSHIFTS_COMPANY_ID=...

Optional:
  SEVENSHIFTS_TIMEZONE=America/Los_Angeles
  SEVENSHIFTS_PULL_DAYS=365

Usage:
  python scripts/pull_7shifts_labor.py
  python scripts/pull_7shifts_labor.py --days 90
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    print('Missing dependency: pip install requests python-dotenv')
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.path.join(_ROOT, 'public', 'data', 'labor.json')
API_BASE = 'https://api.7shifts.com/v2'
BUSINESS_DAY_CUTOFF_HOUR = 4
DEFAULT_PULL_DAYS = 365
PAGE_LIMIT = 100  # API max page size
MIN_REQUEST_INTERVAL = 0.11  # ~9 req/s, under 10/s limit


def load_env() -> None:
    env_path = os.path.join(_ROOT, '.env')
    if load_dotenv is not None and os.path.exists(env_path):
        load_dotenv(env_path)


def require_env(name: str) -> str:
    value = os.getenv(name, '').strip()
    if not value:
        print(f'FAIL: missing {name} in .env')
        sys.exit(1)
    return value


def parse_iso(dt_str: str) -> datetime:
    if dt_str.endswith('Z'):
        dt_str = dt_str[:-1] + '+00:00'
    return datetime.fromisoformat(dt_str)


def business_date_from_clocked_in(clocked_in_iso: str, tz: ZoneInfo) -> str:
    dt = parse_iso(clocked_in_iso).astimezone(tz)
    if dt.hour < BUSINESS_DAY_CUTOFF_HOUR:
        dt = dt - timedelta(days=1)
    return dt.strftime('%Y-%m-%d')


def unpaid_break_hours(breaks: list | None) -> float:
    total = 0.0
    for br in breaks or []:
        if br.get('paid'):
            continue
        start = br.get('in')
        end = br.get('out')
        if not start or not end:
            continue
        total += (parse_iso(end) - parse_iso(start)).total_seconds() / 3600.0
    return total


def punch_worked_hours(punch: dict) -> float:
    clocked_in = punch.get('clocked_in')
    clocked_out = punch.get('clocked_out')
    if not clocked_in or not clocked_out:
        return 0.0
    gross = (parse_iso(clocked_out) - parse_iso(clocked_in)).total_seconds() / 3600.0
    return max(0.0, gross - unpaid_break_hours(punch.get('breaks')))


class SevenShiftsClient:
    def __init__(self, token: str, company_id: str) -> None:
        self.company_id = company_id
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
        })
        self._last_request_at = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < MIN_REQUEST_INTERVAL:
            time.sleep(MIN_REQUEST_INTERVAL - elapsed)
        self._last_request_at = time.monotonic()

    def get(self, path: str, params: dict | None = None) -> dict:
        url = f'{API_BASE}{path}'
        for attempt in range(5):
            self._throttle()
            resp = self.session.get(url, params=params, timeout=60)
            if resp.status_code == 429:
                wait = min(2 ** attempt, 30)
                print(f'  rate limited, retrying in {wait}s...')
                time.sleep(wait)
                continue
            if resp.status_code == 401:
                print('FAIL: 401 Unauthorized — check SEVENSHIFTS_TOKEN')
                sys.exit(1)
            resp.raise_for_status()
            return resp.json()
        print('FAIL: exceeded retries due to rate limiting')
        sys.exit(1)

    def verify(self) -> None:
        data = self.get('/whoami')
        identity = data.get('data') or data
        print(f'  authenticated as identity_id={identity.get("identity_id", "?")}')

    def list_time_punches(self, business_start: str, business_end: str) -> list[dict]:
        punches: list[dict] = []
        cursor: str | None = None
        page = 0

        while True:
            params: dict = {
                'business_date_start': business_start,
                'business_date_end': business_end,
                'limit': PAGE_LIMIT,
                'include_deleted': 'false',
            }
            if cursor:
                params['cursor'] = cursor

            payload = self.get(
                f'/company/{self.company_id}/time_punches',
                params=params,
            )
            batch = payload.get('data') or []
            punches.extend(batch)
            page += 1
            print(f'  page {page}: +{len(batch)} punches (total {len(punches)})')

            meta = payload.get('meta') or {}
            cursor_meta = meta.get('cursor') or {}
            next_cursor = cursor_meta.get('next')

            if not next_cursor:
                break
            cursor = next_cursor

        return punches


def aggregate_punches(punches: list[dict], tz: ZoneInfo) -> dict[str, dict]:
    days: dict[str, dict] = defaultdict(lambda: {
        'laborCost': 0.0,
        'laborHours': 0.0,
        'punchCount': 0,
        'tips': 0.0,
    })

    skipped = 0
    for punch in punches:
        if punch.get('deleted'):
            skipped += 1
            continue
        clocked_in = punch.get('clocked_in')
        if not clocked_in:
            skipped += 1
            continue

        hours = punch_worked_hours(punch)
        if hours <= 0:
            skipped += 1
            continue

        wage = float(punch.get('hourly_wage') or 0) / 100.0  # API returns cents
        cost = hours * wage
        tips = float(punch.get('tips') or 0)
        day = business_date_from_clocked_in(clocked_in, tz)

        entry = days[day]
        entry['laborCost'] += cost
        entry['laborHours'] += hours
        entry['punchCount'] += 1
        entry['tips'] += tips

    if skipped:
        print(f'  skipped {skipped} punches (deleted, open, or zero hours)')

    return {day: round_values(entry) for day, entry in sorted(days.items())}


def round_values(entry: dict) -> dict:
    return {
        'laborCost': round(entry['laborCost'], 2),
        'laborHours': round(entry['laborHours'], 2),
        'punchCount': int(entry['punchCount']),
        'tips': round(entry['tips'], 2),
    }


def default_date_range(days: int) -> tuple[str, str]:
    tz_name = os.getenv('SEVENSHIFTS_TIMEZONE', 'America/Los_Angeles')
    tz = ZoneInfo(tz_name)
    end = datetime.now(tz).date()
    start = end - timedelta(days=days - 1)
    return start.isoformat(), end.isoformat()


def main() -> None:
    parser = argparse.ArgumentParser(description='Pull 7shifts labor data into public/data/labor.json')
    parser.add_argument('--days', type=int, default=int(os.getenv('SEVENSHIFTS_PULL_DAYS', DEFAULT_PULL_DAYS)),
                        help=f'Number of calendar days to pull (default {DEFAULT_PULL_DAYS})')
    args = parser.parse_args()

    load_env()
    token = require_env('SEVENSHIFTS_TOKEN')
    company_id = require_env('SEVENSHIFTS_COMPANY_ID')
    tz_name = os.getenv('SEVENSHIFTS_TIMEZONE', 'America/Los_Angeles')
    tz = ZoneInfo(tz_name)

    business_start, business_end = default_date_range(args.days)

    print('7shifts labor pull')
    print(f'  company_id={company_id}')
    print(f'  timezone={tz_name}')
    print(f'  business dates: {business_start} -> {business_end}')

    client = SevenShiftsClient(token, company_id)
    print('Verifying token...')
    client.verify()

    print('Fetching time punches...')
    punches = client.list_time_punches(business_start, business_end)
    print(f'  received {len(punches)} punches')

    days = aggregate_punches(punches, tz)
    if not days:
        print('WARNING: no labor days aggregated — check date range and punch data')

    output = {
        'generatedAt': datetime.now(tz).isoformat(),
        'timezone': tz_name,
        'companyId': company_id,
        'dateRange': [business_start, business_end],
        'days': days,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)
        f.write('\n')

    total_cost = sum(d['laborCost'] for d in days.values())
    total_hours = sum(d['laborHours'] for d in days.values())
    print(f'Wrote {OUTPUT_PATH}')
    print(f'  {len(days)} days | ${total_cost:,.2f} labor | {total_hours:,.1f} hours')


if __name__ == '__main__':
    main()
