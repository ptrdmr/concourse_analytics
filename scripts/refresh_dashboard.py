#!/usr/bin/env python3
"""
refresh_dashboard.py

One-command data refresh:
  1. Runs the ETL (export_dashboards.py)
  2. Sanity-checks the generated JSON before anything is published
  3. Commits ONLY public/data/ with a standard message

Usage:
  python scripts/refresh_dashboard.py             # ETL + validate + commit
  python scripts/refresh_dashboard.py --no-etl    # validate + commit existing output
  python scripts/refresh_dashboard.py --no-commit # ETL + validate only

If any check fails, nothing is committed and the problem is printed.
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_ROOT, 'public', 'data')

REQUIRED_FILES = [
    'summary.json',
    'transactions.json',
    'modifiers.json',
    'modifier_transactions.json',
    'bowling_seasonality.json',
    'bowling_forecast.json',
    'holiday_analysis.json',
    'payments.json',
    'packages.json',
    os.path.join('intraday', 'index.json'),
    os.path.join('tickets', 'months.json'),
]

# Data older than this (vs. today) probably means the ETL read stale CSVs.
STALENESS_WARN_DAYS = 14


def fail(msg):
    print(f'\nFAIL: {msg}')
    print('Nothing was committed.')
    sys.exit(1)


def run_etl():
    print('Running ETL (export_dashboards.py)...\n')
    result = subprocess.run(
        [sys.executable, os.path.join(_ROOT, 'scripts', 'export_dashboards.py')],
        cwd=_ROOT,
    )
    if result.returncode != 0:
        fail(f'ETL exited with code {result.returncode}')


def load_json(rel_path):
    path = os.path.join(DATA_DIR, rel_path)
    if not os.path.exists(path):
        fail(f'missing output file: public/data/{rel_path}')
    if os.path.getsize(path) == 0:
        fail(f'empty output file: public/data/{rel_path}')
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        fail(f'invalid JSON in public/data/{rel_path}: {e}')


def previous_max_date():
    """Max date from the last committed summary.json, or None."""
    try:
        out = subprocess.run(
            ['git', 'show', 'HEAD:public/data/summary.json'],
            cwd=_ROOT, capture_output=True, text=True,
        )
        if out.returncode != 0:
            return None
        return json.loads(out.stdout)['dateRange'][1]
    except (json.JSONDecodeError, KeyError, IndexError):
        return None


def validate():
    print('\nValidating output...')

    for rel in REQUIRED_FILES:
        load_json(rel)
    print(f'  {len(REQUIRED_FILES)} required files present and parseable')

    summary = load_json('summary.json')

    date_range = summary.get('dateRange') or []
    if len(date_range) != 2:
        fail('summary.json dateRange is malformed')
    max_date = date_range[1]
    try:
        max_dt = datetime.strptime(max_date, '%Y-%m-%d')
    except (TypeError, ValueError):
        fail(f'summary.json max date is not a date: {max_date!r}')
    print(f'  date range: {date_range[0]} -> {max_date}')

    prev = previous_max_date()
    if prev and max_date < prev:
        fail(f'data went BACKWARDS: new max date {max_date} < committed {prev}. '
             'Check that the CSVs in data/ are complete.')
    if prev:
        print(f'  previous committed max date: {prev} (ok)')

    if max_dt < datetime.now() - timedelta(days=STALENESS_WARN_DAYS):
        print(f'  WARNING: newest data point ({max_date}) is more than '
              f'{STALENESS_WARN_DAYS} days old. Continuing, but double-check '
              'the CSV export if you expected newer data.')

    total = summary.get('totalRevenue') or 0
    if total <= 0:
        fail(f'summary.json totalRevenue is {total}')
    departments = summary.get('departments') or {}
    if not departments:
        fail('summary.json has no departments')
    print(f'  total revenue: ${total:,.0f} across {len(departments)} departments')

    months = load_json(os.path.join('tickets', 'months.json'))
    if max_date[:7] not in months:
        fail(f'tickets/months.json is missing the newest month {max_date[:7]}')
    print(f'  ticket months through {months[-1]} (ok)')

    validate_labor_optional()

    print('Validation passed.')
    return max_date


def validate_labor_optional():
    """Validate labor.json if present; skip silently if missing."""
    labor_path = os.path.join(DATA_DIR, 'labor.json')
    if not os.path.exists(labor_path):
        print('  labor.json not present (optional — run npm run labor to generate)')
        return

    labor = load_json('labor.json')
    days = labor.get('days') or {}
    if not isinstance(days, dict):
        fail('labor.json days field is malformed')

    date_range = labor.get('dateRange') or []
    if len(date_range) == 2:
        print(f'  labor date range: {date_range[0]} -> {date_range[1]}')
    print(f'  labor days: {len(days)}')
    if days:
        total_cost = sum((d.get('laborCost') or 0) for d in days.values())
        print(f'  labor total cost in file: ${total_cost:,.0f}')


def commit(max_date):
    status = subprocess.run(
        ['git', 'status', '--porcelain', '--', 'public/data'],
        cwd=_ROOT, capture_output=True, text=True,
    )
    if not status.stdout.strip():
        print('\nNo changes in public/data - nothing to commit.')
        return

    message = f'Refresh dashboard data through {max_date}'
    subprocess.run(['git', 'add', '--', 'public/data'], cwd=_ROOT, check=True)
    result = subprocess.run(['git', 'commit', '-m', message], cwd=_ROOT)
    if result.returncode != 0:
        fail('git commit failed')
    print(f'\nCommitted: "{message}"')
    print('Review with `git show --stat`, then push to deploy.')


def main():
    parser = argparse.ArgumentParser(description='Refresh, validate, and commit dashboard data.')
    parser.add_argument('--no-etl', action='store_true', help='skip the ETL, validate existing output')
    parser.add_argument('--no-commit', action='store_true', help='run ETL and validate, but do not commit')
    args = parser.parse_args()

    if not args.no_etl:
        run_etl()

    max_date = validate()

    if args.no_commit:
        print('\n--no-commit: skipping commit. public/data is refreshed and valid.')
    else:
        commit(max_date)


if __name__ == '__main__':
    main()
