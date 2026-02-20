#!/usr/bin/env python3
"""
export_dashboards.py  (v2)

ETL: reads ALL POS CSVs, deduplicates, resolves modifiers, and outputs
item x date rows for every department.

Outputs:
  app/data/transactions.json  — one row per item per date (all departments)
  app/data/summary.json       — pre-computed KPIs per department
  app/data/bowling_seasonality.json  — multi-year weekly by year
  app/data/bowling_forecast.json     — seasonal forecast + current year actuals
"""

import csv
import json
import os
import glob
from datetime import datetime, timedelta
from collections import defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(_ROOT, 'public', 'data')
DATA_DIR = os.path.join(_ROOT, 'data')
CATEGORY_OVERRIDES = os.path.join(_ROOT, 'config', 'categories.json')
BOWLING_FORECAST_CSV = os.path.join(_ROOT, 'output', 'bowling_sarima_forecast.csv')
BOWLING_SEASONAL_FORECAST_CSV = os.path.join(_ROOT, 'output', 'bowling_forecast.csv')

NAME_MERGE = {
    'Carne Asada Taco Plate (3)': 'Taco Plate',
    'Carnitas Tacos Plate (3)':   'Taco Plate',
    'Chicken Tacos Plate (3)':    'Taco Plate',
    'Hummus Trio m':              'Hummus Trio',
    'Pretzel Sticks m':           'Pretzel Sticks',
    'Irish Nachos m':             'Irish Nachos',
    'Sliders m':                  'Sliders',
}

CATEGORY_COLORS = {
    'Appetizers & Sides': '#f5a623',
    'Wings & Chicken':    '#ff5252',
    'Pizza':              '#00e676',
    'Burgers & Sliders':  '#00b0ff',
    'Sandwiches':         '#bb86fc',
    'Tacos & Mexican':    '#03dac6',
    'Salads':             '#c6ff00',
    'Kids Menu':          '#ff6eb4',
    'Beverages':          '#64b5f6',
    'Soups':              '#ffd700',
    'Party Platters':     '#ff9100',
    'Draft Beer':         '#f5a623',
    'Liquor':             '#ff5252',
    'Bottle Beer':        '#00e676',
    'Mocktails':          '#03dac6',
    'Drink tickets':      '#bb86fc',
    'Beer Buckets':       '#00b0ff',
    'Game Bowling':       '#f5a623',
    'Time Bowling':       '#00b0ff',
    'Rental Shoes':       '#03dac6',
    'Online Lane Reservations': '#bb86fc',
    'VIP SUITES':         '#ff6eb4',
    'General Parties':    '#ff9100',
    'League Fees':        '#ffd700',
    'League Bowling':     '#c6ff00',
}

YEAR_COLORS = ['#00b0ff', '#f5a623', '#ff5252', '#03dac6', '#ff9100', '#bb86fc']


def normalize_subdepartment(subdept):
    """Strip numbered prefixes from subdepartment names.
    POS naming changed over time: '10. Draft Beer' -> 'Draft Beer'."""
    import re
    if not subdept:
        return subdept
    cleaned = re.sub(r'^\d+\.\s*', '', subdept)
    return cleaned


def load_category_overrides():
    """Load category overrides from config/categories.json."""
    if not os.path.isfile(CATEGORY_OVERRIDES):
        return {}
    with open(CATEGORY_OVERRIDES, 'r', encoding='utf-8') as f:
        data = json.load(f)
    data.pop('_comment', None)
    return data


def find_csv_files():
    """Find all CSVs in data/ (top-level only, no subdirectories)."""
    all_csvs = glob.glob(os.path.join(DATA_DIR, '*.csv'))
    return sorted(
        f for f in all_csvs
        if os.path.dirname(os.path.abspath(f)) == os.path.abspath(DATA_DIR)
    )


# =============================================================================
# PHASE 1: Read all CSVs, deduplicate, yield raw rows
# =============================================================================

def read_all_csvs(csv_files):
    """
    Read all POS CSVs, deduplicate by (Transaction ID, Item ID).
    Yields dicts with parsed fields.
    """
    seen = set()
    total_rows = 0
    dupes = 0

    columns = [
        'Transaction ID', 'Item ID', 'Name', 'Item Type',
        'Department', 'Subdepartment', 'Quantity', 'Unit Amount',
        'Total', 'Transaction Type',
        'Deleted', 'Voided', 'Item Created Date',
    ]

    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)

            idx = {}
            for c in columns:
                if c in header:
                    idx[c] = header.index(c)
            if 'Transaction ID' not in idx or 'Item ID' not in idx:
                continue
            max_idx = max(idx.values())

            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                if 'Transaction Type' in idx and row[idx['Transaction Type']] != 'Sales':
                    continue
                item_type = row[idx['Item Type']]
                if item_type not in ('Product', 'Modifier', 'Package'):
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    dupes += 1
                    continue
                seen.add(key)
                total_rows += 1

                name = row[idx['Name']].strip()
                name = NAME_MERGE.get(name, name)

                qty = float(row[idx['Quantity']] or 0)
                unit_price = float(row[idx['Unit Amount']] or 0)
                item_total = float(row[idx['Total']] or 0) if 'Total' in idx else 0

                yield {
                    'txn_id':       row[idx['Transaction ID']],
                    'item_id':      int(row[idx['Item ID']]),
                    'name':         name,
                    'item_type':    item_type,
                    'department':   row[idx.get('Department', 0)].strip() if 'Department' in idx else '',
                    'subdepartment': normalize_subdepartment(row[idx.get('Subdepartment', 0)].strip()) if 'Subdepartment' in idx else '',
                    'qty':          qty,
                    'unit_price':   unit_price,
                    'item_total':   item_total,
                    'date':         row[idx['Item Created Date']].strip(),
                }

    print(f'  Read {total_rows:,} rows, skipped {dupes:,} duplicates')


# =============================================================================
# PHASE 2: Group by transaction, resolve modifiers
# =============================================================================

def group_by_transaction(rows):
    """Group raw rows by Transaction ID."""
    transactions = defaultdict(list)
    for row in rows:
        transactions[row['txn_id']].append(row)
    return transactions


def resolve_all_products(transactions):
    """
    Walk each transaction, link modifiers to parent products,
    compute true costs. Yields resolved product dicts for ALL departments.
    """
    for rows in transactions.values():
        rows.sort(key=lambda r: r['item_id'])
        current = None
        mod_cost = 0.0

        for r in rows:
            if r['item_type'] == 'Package':
                if current is not None:
                    if current['unit_price'] == 0 and mod_cost > 0:
                        current['unit_price'] = mod_cost
                    yield current
                    current = None
                    mod_cost = 0.0
                yield r
                continue

            if r['item_type'] == 'Product':
                if current is not None:
                    if current['unit_price'] == 0 and mod_cost > 0:
                        current['unit_price'] = mod_cost
                    yield current
                current = r
                mod_cost = 0.0

            elif r['item_type'] == 'Modifier' and current is not None:
                mod_cost += r['unit_price']

        if current is not None:
            if current['unit_price'] == 0 and mod_cost > 0:
                current['unit_price'] = mod_cost
            yield current


# =============================================================================
# PHASE 3: Aggregate to item x date rows
# =============================================================================

def aggregate_item_date(products, category_overrides):
    """
    Aggregate resolved products into item x date rows.
    Returns list of dicts, one per (item, date) combination.
    """
    # Key: (name, date, department) -> aggregated values
    agg = defaultdict(lambda: {
        'quantity': 0.0,
        'revenue': 0.0,
        'transactions': 0,
        'subdepartment': '',
    })

    for p in products:
        name = p['name']
        date_str = p['date']
        dept = p['department']
        subdept = p.get('subdepartment', '')
        qty = p['qty']
        unit_price = p['unit_price']
        item_total = p.get('item_total', 0)
        revenue = item_total if item_total != 0 else (unit_price * qty if qty else unit_price)

        key = (name, date_str, dept)
        bucket = agg[key]
        bucket['quantity'] += qty
        bucket['revenue'] += revenue
        bucket['transactions'] += 1
        if subdept:
            bucket['subdepartment'] = subdept

    rows = []
    for (name, date_str, dept), data in agg.items():
        subdept = data['subdepartment']
        category = category_overrides.get(name) or subdept or dept

        rows.append({
            'date': date_str,
            'name': name,
            'department': dept,
            'subdepartment': subdept,
            'category': category,
            'quantity': round(data['quantity']),
            'revenue': round(data['revenue'], 2),
            'transactions': data['transactions'],
        })

    SKIP_DEPARTMENTS = {'', 'TEST DEPARTMENT', 'Parties test'}
    rows = [r for r in rows if r['department'] not in SKIP_DEPARTMENTS]
    rows.sort(key=lambda r: (r['date'], r['department'], r['name']))
    return rows


# =============================================================================
# EXPORT: transactions.json
# =============================================================================

def export_transactions(csv_files, category_overrides):
    """Export item x date rows for all departments."""
    print('  Reading CSVs...')
    raw_rows = list(read_all_csvs(csv_files))

    print('  Grouping by transaction...')
    transactions = group_by_transaction(raw_rows)
    print(f'  {len(transactions):,} unique transactions')

    print('  Resolving modifiers...')
    products = list(resolve_all_products(transactions))
    print(f'  {len(products):,} resolved product rows')

    print('  Aggregating to item x date...')
    rows = aggregate_item_date(products, category_overrides)
    print(f'  {len(rows):,} item x date rows')

    out = os.path.join(OUTPUT_DIR, 'transactions.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'))

    size_kb = os.path.getsize(out) / 1024
    print(f'  -> {out}  ({size_kb:.0f} KB)')
    return rows


# =============================================================================
# EXPORT: summary.json
# =============================================================================

def export_summary(rows):
    """Export pre-computed KPIs per department."""
    departments = defaultdict(lambda: {
        'revenue': 0.0, 'quantity': 0, 'transactions': 0,
        'items': set(), 'categories': set(), 'dates': set(),
    })

    for r in rows:
        dept = r['department']
        d = departments[dept]
        d['revenue'] += r['revenue']
        d['quantity'] += r['quantity']
        d['transactions'] += r['transactions']
        d['items'].add(r['name'])
        d['categories'].add(r['category'])
        d['dates'].add(r['date'])

    all_dates = set()
    for d in departments.values():
        all_dates |= d['dates']

    dept_summary = {}
    for dept, d in sorted(departments.items()):
        dates_sorted = sorted(d['dates'])
        dept_summary[dept] = {
            'revenue': round(d['revenue'], 2),
            'quantity': d['quantity'],
            'transactions': d['transactions'],
            'uniqueItems': len(d['items']),
            'categories': sorted(d['categories']),
            'dateRange': [dates_sorted[0], dates_sorted[-1]] if dates_sorted else [],
        }

    all_dates_sorted = sorted(all_dates)
    summary = {
        'generatedAt': datetime.now().isoformat(),
        'dateRange': [all_dates_sorted[0], all_dates_sorted[-1]] if all_dates_sorted else [],
        'totalRevenue': round(sum(d['revenue'] for d in departments.values()), 2),
        'departments': dept_summary,
        'categoryColors': CATEGORY_COLORS,
    }

    out = os.path.join(OUTPUT_DIR, 'summary.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)
    print(f'  -> {out}')
    return summary


# =============================================================================
# EXPORT: bowling_seasonality.json (multi-year, from all CSVs)
# =============================================================================

def export_bowling_seasonality(csv_files):
    """Export bowling weekly revenue grouped by year for seasonality chart."""
    daily = defaultdict(float)
    all_dates = []
    seen = set()

    columns = [
        'Transaction ID', 'Item ID', 'Transaction Type', 'Item Type',
        'Department', 'Item Created Date', 'Total', 'Quantity',
        'Unit Amount', 'Deleted', 'Voided',
    ]

    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {}
            for c in columns:
                if c in header:
                    idx[c] = header.index(c)
            required = {'Transaction ID', 'Item ID', 'Transaction Type',
                        'Item Type', 'Department', 'Item Created Date',
                        'Deleted', 'Voided'}
            if not required.issubset(idx.keys()):
                continue
            max_idx = max(idx.values())

            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                if row[idx['Transaction Type']] != 'Sales':
                    continue
                if row[idx['Item Type']] != 'Product':
                    continue
                if row[idx['Department']].strip() != 'Bowling':
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)

                date_str = row[idx['Item Created Date']].strip()
                total_val = float(row[idx.get('Total', 0)] or 0) if 'Total' in idx else 0
                qty = float(row[idx['Quantity']] or 0) if 'Quantity' in idx else 0
                unit = float(row[idx['Unit Amount']] or 0) if 'Unit Amount' in idx else 0
                revenue = total_val if total_val != 0 else (qty * unit if qty else unit)

                try:
                    dt = datetime.strptime(date_str, '%Y-%m-%d')
                except ValueError:
                    continue

                daily[date_str] += revenue
                all_dates.append(dt)

    if not daily:
        print('  WARNING: No bowling data found!')
        return

    weekly = defaultdict(float)
    for date_str, rev in daily.items():
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        ws = dt - timedelta(days=dt.weekday())
        weekly[ws] += rev

    by_year_week = defaultdict(lambda: defaultdict(float))
    for ws, rev in weekly.items():
        iso = ws.isocalendar()
        year, week_num = iso[0], min(iso[1], 52)
        by_year_week[year][week_num] += rev

    by_year_json = {}
    for year in sorted(by_year_week.keys()):
        weeks = by_year_week[year]
        by_year_json[str(year)] = [
            {'week': w, 'revenue': round(rev, 2)}
            for w, rev in sorted(weeks.items())
        ]

    min_d, max_d = min(all_dates), max(all_dates)
    total_rev = sum(daily.values())

    data = {
        'byYearWeek': by_year_json,
        'dateRange': {
            'start': min_d.strftime('%b %d, %Y'),
            'end': max_d.strftime('%b %d, %Y'),
        },
        'totalRevenue': round(total_rev, 2),
        'yearColors': YEAR_COLORS,
        'years': sorted(by_year_week.keys()),
    }

    out = os.path.join(OUTPUT_DIR, 'bowling_seasonality.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(f'  -> {out}  ({len(by_year_week)} years, ${total_rev:,.0f})')


# =============================================================================
# EXPORT: bowling_forecast.json
# =============================================================================

def _load_bowling_weekly(csv_files):
    """Load bowling weekly revenue from POS CSVs. Returns dict: week_start -> revenue."""
    daily = defaultdict(float)
    columns = [
        'Transaction ID', 'Item ID', 'Transaction Type', 'Item Type',
        'Department', 'Item Created Date', 'Total', 'Quantity',
        'Unit Amount', 'Deleted', 'Voided',
    ]
    seen = set()

    for csv_path in csv_files:
        if not os.path.isfile(csv_path):
            continue
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: header.index(c) for c in columns if c in header}
            required = {'Transaction ID', 'Item ID', 'Transaction Type',
                        'Item Type', 'Department', 'Item Created Date',
                        'Deleted', 'Voided'}
            if not required.issubset(idx.keys()):
                continue
            max_idx = max(idx.values())

            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                if row[idx['Transaction Type']] != 'Sales':
                    continue
                if row[idx['Item Type']] != 'Product':
                    continue
                if row[idx['Department']].strip() != 'Bowling':
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)

                date_str = row[idx['Item Created Date']].strip()
                total_val = float(row[idx.get('Total', 0)] or 0) if 'Total' in idx else 0
                qty = float(row[idx['Quantity']] or 0) if 'Quantity' in idx else 0
                unit = float(row[idx['Unit Amount']] or 0) if 'Unit Amount' in idx else 0
                revenue = total_val if total_val != 0 else (qty * unit if qty else unit)

                try:
                    dt = datetime.strptime(date_str, '%Y-%m-%d')
                except ValueError:
                    continue

                daily[date_str] += revenue

    weekly = defaultdict(float)
    for date_str, rev in daily.items():
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        ws = dt - timedelta(days=dt.weekday())
        weekly[ws] += rev
    return weekly


def export_bowling_forecast(csv_files):
    """Export bowling forecast: seasonal model + current year actuals (replaces SARIMA)."""
    forecasts = {}

    # Seasonal forecast from CSV
    if os.path.isfile(BOWLING_SEASONAL_FORECAST_CSV):
        rows = []
        with open(BOWLING_SEASONAL_FORECAST_CSV, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                rows.append({
                    'weekStart': row['week_start'],
                    'weekOfYear': int(row['week_of_year']),
                    'year': int(row['year']),
                    'predictedRevenue': round(float(row['predicted_revenue']), 2),
                })
        if rows:
            forecasts['seasonal'] = rows
            print(f'  Loaded seasonal: {len(rows)} weeks')

    # Current year actuals from POS data
    weekly = _load_bowling_weekly(csv_files)
    if weekly:
        max_year = max(ws.year for ws in weekly.keys())
        actual_rows = []
        for ws, rev in sorted(weekly.items()):
            if ws.year == max_year:
                iso = ws.isocalendar()
                actual_rows.append({
                    'weekStart': ws.strftime('%Y-%m-%d'),
                    'weekOfYear': min(iso[1], 52),
                    'year': ws.year,
                    'predictedRevenue': round(rev, 2),
                })
        if actual_rows:
            forecasts['actual'] = actual_rows
            print(f'  Loaded actual ({max_year}): {len(actual_rows)} weeks')

    if not forecasts:
        print('  WARNING: No forecast data found!')
        return

    data = {
        'forecasts': forecasts,
        'generatedAt': datetime.now().isoformat(),
    }

    out = os.path.join(OUTPUT_DIR, 'bowling_forecast.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(f'  -> {out}')


# =============================================================================
# MAIN
# =============================================================================

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print('=' * 60)
    print('EXPORT DASHBOARDS v2 -> JSON')
    print('=' * 60)

    csv_files = find_csv_files()
    if not csv_files:
        print('ERROR: No CSV files found in data/')
        return 1

    file_names = [os.path.basename(f) for f in csv_files]
    print(f'\nCSV files: {", ".join(file_names)}')

    category_overrides = load_category_overrides()
    print(f'Category overrides: {len(category_overrides)} entries')

    print('\n[1/4] Transactions...')
    rows = export_transactions(csv_files, category_overrides)

    print('\n[2/4] Summary...')
    summary = export_summary(rows)
    for dept, info in summary['departments'].items():
        print(f'  {dept}: ${info["revenue"]:,.0f}  '
              f'({info["uniqueItems"]} items, {info["transactions"]:,} txns)')

    print('\n[3/4] Bowling Seasonality...')
    export_bowling_seasonality(csv_files)

    print('\n[4/4] Bowling Forecast...')
    export_bowling_forecast(csv_files)

    print('\n' + '=' * 60)
    print(f'Done! {len(rows):,} transaction rows written to {OUTPUT_DIR}')
    print('=' * 60)
    return 0


if __name__ == '__main__':
    exit(main())
