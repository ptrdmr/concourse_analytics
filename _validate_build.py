#!/usr/bin/env python3
"""Local validation of the pipeline (no DB required)."""
import csv
import os
import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'scripts'))
os.chdir(ROOT)

from pull_journal import CSV_HEADER, load_enum_map, row_to_csv, years_to_export
import pull_journal as pj

errors = []
warnings = []


def ok(msg):
    print(f'  OK: {msg}')


def fail(msg):
    errors.append(msg)
    print(f'  FAIL: {msg}')


def warn(msg):
    warnings.append(msg)
    print(f'  WARN: {msg}')


print('=== 1. Required files ===')
required = [
    'README.md', 'requirements.txt', '.env.example', '.gitignore',
    'run_nightly.ps1', 'register_task.ps1',
    'config/enum_map.json', 'config/categories.json',
    'config/service_charges.json', 'config/specialty_cocktails.txt',
    'scripts/db.py', 'scripts/pull_journal.py', 'scripts/reconcile_pull.py',
    'scripts/derive_enums.py', 'scripts/export_dashboards.py',
    'scripts/generate_specialty_cocktails_json.py',
    'data/.gitkeep', 'logs/.gitkeep', 'public/data/.gitkeep', 'output/.gitkeep',
]
for rel in required:
    if (ROOT / rel).exists():
        ok(rel)
    else:
        fail(f'missing {rel}')

print('\n=== 2. CSV header matches Office export ===')
ref_csv = ROOT / 'comparison_data' / '2026.csv'
if ref_csv.exists():
    with open(ref_csv, 'r', encoding='utf-8') as f:
        ref_header = next(csv.reader(f, delimiter=';'))
    # Office header may include trailing empty from final semicolon
    ref_trim = [c for c in ref_header if c]
    if CSV_HEADER == ref_trim:
        ok('CSV_HEADER matches comparison_data/2026.csv (35 columns)')
    else:
        fail(f'header mismatch: bundle={len(CSV_HEADER)} ref={len(ref_trim)}')
        for i, (a, b) in enumerate(zip(CSV_HEADER, ref_trim)):
            if a != b:
                fail(f'  col {i}: {a!r} vs {b!r}')
else:
    warn('comparison_data/2026.csv not found for header compare (server-local fixture, not in git; GitHub rejects 100MB+ files)')

print('\n=== 3. Enum map completeness ===')
maps = load_enum_map()
for label in ('Product', 'Modifier', 'Package', 'Adjustment', 'Sales', 'Refund', 'NoSale', 'Cancel'):
    found = label in maps['item_type'].values() or label in maps['transaction_type'].values()
    if found:
        ok(f'label {label!r} present')
    else:
        fail(f'label {label!r} missing from enum map')

print('\n=== 4. row_to_csv formatting (mock rows) ===')
# NoSale -> EmptyTransaction
nosale = (
    708359, 3255076,
    datetime(2026, 1, 1, 10, 6, 32), datetime(2026, 1, 1, 10, 6, 32),
    datetime(2026, 1, 1, 17, 11, 44), datetime(2026, 1, 1),
    'FRONTCOUNTER1', 'Peter D', 12809, 0.0,
    0, '', 0, datetime(2026, 1, 1, 10, 6, 32),
    '', '', None, None, None, 0, 0, None, None, '', '', 0, 0, 0, 0, '', ''
)
r = row_to_csv(maps, nosale)
if r[13] == 'NoSale' and r[14] == 'EmptyTransaction':
    ok('NoSale blank name -> EmptyTransaction')
else:
    fail(f'NoSale formatting: type={r[13]!r} name={r[14]!r}')

product = (
    708369, 3255099,
    datetime(2026, 1, 1, 11, 0, 22), datetime(2026, 1, 1, 11, 2, 35),
    datetime(2026, 1, 1, 17, 11, 44), datetime(2026, 1, 1),
    'FRONTCOUNTER1', 'Peter D', 12809, 132.0,
    1, 'Time Bowling', 7, datetime(2026, 1, 1, 11, 0, 22),
    'FRONTCOUNTER1', 'Peter D', 120.0, 45.0, 90.0, 0, 0,
    None, None, 'Bowling', 'Time Bowling', 0, 0, 0, 1, 'Hourly Rate - Holiday Rates $45', ''
)
r = row_to_csv(maps, product)
if r[20] == '120.0000' and r[21] == '45.0000' and r[22] == '90.0000' and r[33] == 'Time':
    ok('Product qty/unit/total and Sold By=Time')
else:
    fail(f'Product row: qty={r[20]} unit={r[21]} total={r[22]} soldby={r[33]}')

refund = (
    708588, 3256370,
    datetime(2026, 1, 1, 15, 18, 38), datetime(2026, 1, 1, 15, 19, 2),
    datetime(2026, 1, 1, 22, 39, 11), datetime(2026, 1, 1),
    'CAFE1', 'Peter D', 12815, -7.0,
    2, 'State Tax', 5, datetime(2026, 1, 1, 15, 18, 38),
    'CAFE1', 'Peter D', None, None, -0.5, 0, 0, None, None, '', '', 0, 0, 0, 0, '', ''
)
r = row_to_csv(maps, refund)
if r[13] == 'Refund' and r[22] == '-0.5000' and r[12] == '-7.0000':
    ok('Refund negative totals')
else:
    fail(f'Refund row: txn={r[13]} total={r[22]} txn_total={r[12]}')

print('\n=== 5. Year export logic ===')
from unittest.mock import patch
with patch('pull_journal.date') as mock_date:
    mock_date.today.return_value = date(2026, 1, 15)
    jan = years_to_export('nightly', '2023-01-01', None)
    if jan == [2025, 2026]:
        ok('January nightly exports prior + current year')
    else:
        fail(f'January nightly years: {jan}')

bulk = years_to_export('bulk', '2023-01-01', None)
if bulk == [2023, 2024, 2025, 2026]:
    ok(f'bulk years in 2026: {bulk}')
else:
    fail(f'unexpected bulk years: {bulk}')

print('\n=== 6. ETL path resolution from repo root ===')
etl = ROOT / 'scripts' / 'export_dashboards.py'
text = etl.read_text(encoding='utf-8')
if "_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))" in text:
    ok('ETL resolves _ROOT to repo root (public/data, data/)')
else:
    fail('ETL _ROOT pattern unexpected')

print('\n=== 7. Plan gaps ===')
if 'BOWLING_SEASONAL_FORECAST_CSV' in text:
    warn('export_dashboards.py still references bowling_forecast.csv (should compute in-process)')
if 'DASHBOARD_REPO_PATH' in (ROOT / 'run_nightly.ps1').read_text(encoding='utf-8'):
    fail('run_nightly.ps1 still references DASHBOARD_REPO_PATH')
else:
    ok('run_nightly.ps1 has no second-repo copy step')
if 'pyodbc' not in (ROOT / 'requirements.txt').read_text():
    fail('pyodbc missing from requirements.txt')
else:
    ok('requirements.txt includes pyodbc')

print('\n=== SUMMARY ===')
print(f'Errors: {len(errors)}')
print(f'Warnings: {len(warnings)}')
if errors:
    for e in errors:
        print(f'  - {e}')
if warnings:
    for w in warnings:
        print(f'  - {w}')
sys.exit(1 if errors else 0)
