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
from collections import Counter, defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(_ROOT, 'public', 'data')
DATA_DIR = os.path.join(_ROOT, 'data')
CATEGORY_OVERRIDES = os.path.join(_ROOT, 'config', 'categories.json')
SERVICE_CHARGES_CONFIG = os.path.join(_ROOT, 'config', 'service_charges.json')
EMPLOYEES_POS_OUTPUT = os.path.join(OUTPUT_DIR, '_employees_pos.json')
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
    'Pizza':              '#38bdf8',
    'Burgers & Sliders':  '#00b0ff',
    'Sandwiches':         '#bb86fc',
    'Tacos & Mexican':    '#0ea5e9',
    'Salads':             '#93c5fd',
    'Kids Menu':          '#ff6eb4',
    'Beverages':          '#64b5f6',
    'Soups':              '#ffd700',
    'Party Platters':     '#ff9100',
    'Draft Beer':         '#f5a623',
    'Liquor':             '#ff5252',
    'Bottle Beer':        '#0ea5e9',
    'Mocktails':          '#0ea5e9',
    'Drink tickets':      '#bb86fc',
    'Beer Buckets':       '#00b0ff',
    'Game Bowling':       '#f5a623',
    'Time Bowling':       '#00b0ff',
    'Rental Shoes':       '#0ea5e9',
    'Online Lane Reservations': '#bb86fc',
    'VIP SUITES':         '#ff6eb4',
    'General Parties':    '#ff9100',
    'Parties':            '#ff9100',
    'League Fees':        '#ffd700',
    'League Bowling':     '#60a5fa',
    'Summer Specials':    '#22c55e',
    # Modifiers subdepartments
    'Food Mods':           '#2563eb',
    'Food':                '#60a5fa',
    'N/A Bev':             '#7dd3fc',
    'Catering':            '#1d4ed8',
}

YEAR_COLORS = ['#00b0ff', '#f5a623', '#ff5252', '#0ea5e9', '#ff9100', '#bb86fc']


BUSINESS_DAY_CUTOFF_HOUR = 4
SKIP_DEPARTMENTS = {'', 'TEST DEPARTMENT', 'Parties test'}
INTRADAY_DIR = os.path.join(OUTPUT_DIR, 'intraday')


def parse_time_fields(time_raw):
    """Parse Item Created Time into hour, minute, and 30-min slot (0-47)."""
    if not time_raw or ':' not in time_raw:
        return None, None, None
    parts = time_raw.split(':')
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except (ValueError, IndexError):
        return None, None, None
    slot = hour * 2 + (1 if minute >= 30 else 0)
    return hour, minute, slot


def resolve_item_category(name, dept, subdept, category_overrides):
    """Shared category + department resolution for all aggregations."""
    category = category_overrides.get(name) or subdept or dept
    if category in ('Parties', 'Catering'):
        department = 'Parties'
    elif category == 'Mocktails':
        department = 'Bar'
    else:
        department = dept
    return department, category


def business_day(date_str, time_str):
    """Adjust date for business day: activity before 4 AM belongs to the previous day."""
    if not time_str or not date_str or len(date_str) < 10:
        return date_str
    try:
        hour = int(time_str.split(':')[0])
    except (ValueError, IndexError):
        return date_str
    if hour < BUSINESS_DAY_CUTOFF_HOUR:
        try:
            dt = datetime.strptime(date_str, '%Y-%m-%d')
            dt -= timedelta(days=1)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            return date_str
    return date_str


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
# DEDUCTIONS: Adjustments + Refunds (to align with POS Total Sale)
# =============================================================================

def read_deductions(csv_files):
    """
    Read Adjustments (Transaction Type=Sales, Item Type=Adjustment) and
    Refunds (Transaction Type=Refund, Product/Modifier/Package).
    Yields (date, department, amount) where amount reduces sales.
    """
    columns = [
        'Transaction ID', 'Item ID', 'Transaction Type', 'Item Type',
        'Department', 'Quantity', 'Unit Amount', 'Total',
        'Item Created Date', 'Item Created Time', 'Deleted', 'Voided',
    ]
    seen = set()
    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: i for i, c in enumerate(header) if c in columns}
            if 'Item Created Date' not in idx or 'Item Type' not in idx:
                continue
            if 'Transaction ID' not in idx or 'Item ID' not in idx:
                continue
            max_idx = max(idx.values())
            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                # Dedupe like every other reader: overlapping exports would
                # otherwise count the same adjustment or refund once per file.
                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)
                txn_type = row[idx.get('Transaction Type', 0)].strip() if 'Transaction Type' in idx else 'Sales'
                item_type = row[idx['Item Type']].strip()
                date_str = business_day(
                    row[idx['Item Created Date']].strip(),
                    row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else '',
                )
                dept = row[idx.get('Department', 0)].strip() if 'Department' in idx else ''
                total = float(row[idx.get('Total', 0)] or 0) if 'Total' in idx else 0
                qty = float(row[idx.get('Quantity', 0)] or 0) if 'Quantity' in idx else 0
                unit = float(row[idx.get('Unit Amount', 0)] or 0) if 'Unit Amount' in idx else 0
                amount = total if total != 0 else (unit * qty if qty else unit)
                if not date_str or len(date_str) < 10:
                    continue
                # Adjustments: Sales txn, Adjustment item (discounts, comps - reduce sales)
                if txn_type == 'Sales' and item_type == 'Adjustment':
                    yield (date_str, dept or '(blank)', amount)
                # Refunds: Refund txn, Product/Modifier/Package (money back - reduce sales)
                elif txn_type == 'Refund' and item_type in ('Product', 'Modifier', 'Package'):
                    # Amount may be positive or negative in CSV; we need to subtract from sales
                    yield (date_str, dept or '(blank)', -abs(amount) if amount != 0 else 0)


def aggregate_deductions_by_date_dept(csv_files):
    """Aggregate deductions to (date, department) -> total amount to subtract."""
    agg = defaultdict(float)
    for date_str, dept, amount in read_deductions(csv_files):
        agg[(date_str, dept)] += amount
    return agg


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
        'Deleted', 'Voided', 'Item Created Date', 'Item Created Time',
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

                time_raw = row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else ''
                hour, minute, slot = parse_time_fields(time_raw)

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
                    'date':         business_day(
                                        row[idx['Item Created Date']].strip(),
                                        time_raw,
                                    ),
                    'hour':         hour,
                    'minute':       minute,
                    'slot':         slot,
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
                    if mod_cost > 0:
                        current['item_total'] = current.get('item_total', 0) + mod_cost
                    yield current
                    current = None
                    mod_cost = 0.0
                yield r
                continue

            if r['item_type'] == 'Product':
                if current is not None:
                    if mod_cost > 0:
                        current['item_total'] = current.get('item_total', 0) + mod_cost
                    yield current
                current = r
                mod_cost = 0.0

            elif r['item_type'] == 'Modifier' and current is not None:
                mt = r.get('item_total', 0)
                mod_rev = mt if mt != 0 else (r['unit_price'] * (r['qty'] if r.get('qty') else 1))
                mod_cost += mod_rev

        if current is not None:
            if mod_cost > 0:
                current['item_total'] = current.get('item_total', 0) + mod_cost
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
        department, category = resolve_item_category(name, dept, subdept, category_overrides)

        rows.append({
            'date': date_str,
            'name': name,
            'department': department,
            'subdepartment': subdept,
            'category': category,
            'quantity': round(data['quantity']),
            'revenue': round(data['revenue'], 2),
            'transactions': data['transactions'],
        })

    rows = [r for r in rows if r['department'] not in SKIP_DEPARTMENTS]
    rows.sort(key=lambda r: (r['date'], r['department'], r['name']))
    return rows


def aggregate_intraday(products, category_overrides):
    """
    Aggregate resolved products into item x business_date x 30-min slot rows.
    Uses the same category-override logic as aggregate_item_date().
    """
    agg = defaultdict(lambda: {
        'quantity': 0.0,
        'revenue': 0.0,
        'transactions': 0,
        'subdepartment': '',
        'category': '',
    })

    for p in products:
        slot = p.get('slot')
        if slot is None:
            continue

        name = p['name']
        date_str = p['date']
        dept = p['department']
        subdept = p.get('subdepartment', '')
        department, category = resolve_item_category(name, dept, subdept, category_overrides)
        if department in SKIP_DEPARTMENTS:
            continue

        qty = p['qty']
        unit_price = p['unit_price']
        item_total = p.get('item_total', 0)
        revenue = item_total if item_total != 0 else (unit_price * qty if qty else unit_price)

        key = (name, date_str, slot, department, subdept, category)
        bucket = agg[key]
        bucket['quantity'] += qty
        bucket['revenue'] += revenue
        bucket['transactions'] += 1
        if subdept:
            bucket['subdepartment'] = subdept
        bucket['category'] = category

    rows = []
    for (name, date_str, slot, department, subdept, category), data in agg.items():
        rows.append({
            'date': date_str,
            'slot': slot,
            'name': name,
            'department': department,
            'subdepartment': subdept,
            'category': category,
            'quantity': round(data['quantity']),
            'revenue': round(data['revenue'], 2),
            'transactions': data['transactions'],
        })

    rows.sort(key=lambda r: (r['date'], r['slot'], r['department'], r['name']))
    return rows


def read_void_rows(csv_files):
    """
    Read voided/deleted POS rows (Sales, Product/Modifier/Package).
    Yields one dict per unique (Transaction ID, Item ID).
    """
    seen = set()
    total_rows = 0

    columns = [
        'Transaction ID', 'Item ID', 'Name', 'Item Type',
        'Department', 'Subdepartment', 'Quantity', 'Unit Amount',
        'Total', 'Transaction Type',
        'Deleted', 'Voided', 'Item Created Date', 'Item Created Time',
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
                if row[idx['Deleted']] == 'False' and row[idx['Voided']] == 'False':
                    continue
                if 'Transaction Type' in idx and row[idx['Transaction Type']] != 'Sales':
                    continue
                item_type = row[idx['Item Type']]
                if item_type not in ('Product', 'Modifier', 'Package'):
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)
                total_rows += 1

                name = row[idx['Name']].strip()
                name = NAME_MERGE.get(name, name)
                time_raw = row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else ''
                _, _, slot = parse_time_fields(time_raw)
                if slot is None:
                    continue

                qty = float(row[idx['Quantity']] or 0)
                unit_price = float(row[idx['Unit Amount']] or 0)
                item_total = float(row[idx['Total']] or 0) if 'Total' in idx else 0
                value = abs(item_total if item_total != 0 else (unit_price * qty if qty else unit_price))

                void_type = 'deleted' if row[idx['Deleted']] != 'False' else 'voided'

                yield {
                    'name': name,
                    'department': row[idx.get('Department', 0)].strip() if 'Department' in idx else '',
                    'subdepartment': normalize_subdepartment(row[idx.get('Subdepartment', 0)].strip()) if 'Subdepartment' in idx else '',
                    'date': business_day(
                        row[idx['Item Created Date']].strip(),
                        time_raw,
                    ),
                    'slot': slot,
                    'quantity': qty if qty else 1,
                    'value': value,
                    'type': void_type,
                }

    print(f'  Read {total_rows:,} void/deleted rows')


def aggregate_voids(void_rows, category_overrides):
    """Aggregate void/deleted rows by item x date x slot x department."""
    agg = defaultdict(lambda: {
        'quantity': 0.0,
        'value': 0.0,
        'type': 'voided',
    })

    for row in void_rows:
        name = row['name']
        dept = row['department']
        subdept = row.get('subdepartment', '')
        department, _category = resolve_item_category(name, dept, subdept, category_overrides)
        if department in SKIP_DEPARTMENTS:
            continue

        key = (name, row['date'], row['slot'], department, row['type'])
        bucket = agg[key]
        bucket['quantity'] += row['quantity']
        bucket['value'] += row['value']
        bucket['type'] = row['type']

    rows = []
    for (name, date_str, slot, department, void_type), data in agg.items():
        rows.append({
            'date': date_str,
            'slot': slot,
            'name': name,
            'department': department,
            'quantity': round(data['quantity']),
            'value': round(data['value'], 2),
            'type': void_type,
        })

    rows.sort(key=lambda r: (r['date'], r['slot'], r['department'], r['name']))
    return rows


# =============================================================================
# MODIFIER ROWS (date-granular, same format as product rows)
# =============================================================================

def aggregate_modifier_transactions(csv_files):
    """
    Read modifier rows from CSVs, aggregate by (name, date).
    Returns rows in same format as product transactions for Modifiers department.
    """
    agg = defaultdict(lambda: {'quantity': 0.0, 'revenue': 0.0, 'transactions': 0, 'subdepartment': ''})

    columns = [
        'Transaction ID', 'Item ID', 'Name', 'Item Type',
        'Department', 'Subdepartment', 'Quantity', 'Unit Amount',
        'Total', 'Transaction Type', 'Deleted', 'Voided',
        'Item Created Date', 'Item Created Time',
    ]

    seen = set()
    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: header.index(c) for c in columns if c in header}
            if 'Transaction ID' not in idx or 'Item ID' not in idx or 'Item Type' not in idx:
                continue
            max_idx = max(idx.values())

            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                if 'Transaction Type' in idx and row[idx['Transaction Type']] != 'Sales':
                    continue
                if row[idx['Item Type']] != 'Modifier':
                    continue
                if row[idx.get('Department', 0)].strip() != 'Food':
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)

                name = row[idx['Name']].strip()
                date_str = business_day(
                    row[idx['Item Created Date']].strip(),
                    row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else '',
                )
                subdept = normalize_subdepartment(row[idx.get('Subdepartment', 0)].strip()) if 'Subdepartment' in idx else ''
                qty = float(row[idx['Quantity']] or 0)
                unit = float(row[idx['Unit Amount']] or 0)
                total = float(row[idx['Total']] or 0) if 'Total' in idx else 0
                revenue = total if total != 0 else (unit * qty if qty else unit)

                bucket_key = (name, date_str)
                bucket = agg[bucket_key]
                bucket['quantity'] += qty if qty else 1
                bucket['revenue'] += revenue
                bucket['transactions'] += 1
                if subdept:
                    bucket['subdepartment'] = subdept

    rows = []
    for (name, date_str), data in agg.items():
        category = data['subdepartment'] or 'Food Mods'
        rows.append({
            'date': date_str,
            'name': name,
            'department': 'Modifiers',
            'subdepartment': data['subdepartment'] or '',
            'category': category,
            'quantity': round(data['quantity']),
            'revenue': round(data['revenue'], 2),
            'transactions': data['transactions'],
        })

    rows.sort(key=lambda r: (r['date'], r['name']))
    return rows


# =============================================================================
# EXPORT: modifier_transactions.json (date-granular, for Modifiers dashboard view)
# =============================================================================

def export_modifier_transactions(csv_files):
    """
    Export modifier rows with date granularity to a separate file.
    Used for the Modifiers department view (calendar, weekly trends, etc.)
    without double-counting in main transactions.json.
    """
    rows = aggregate_modifier_transactions(csv_files)
    out = os.path.join(OUTPUT_DIR, 'modifier_transactions.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'))
    size_kb = os.path.getsize(out) / 1024
    print(f'  -> {out}  ({len(rows):,} rows, {size_kb:.0f} KB)')
    return rows


# =============================================================================
# EXPORT: transactions.json
# =============================================================================

def export_transactions(csv_files, category_overrides):
    """Export item x date rows for all departments, including Modifiers.
    Includes Adjustments and Refunds as deduction rows to align with POS Total Sale."""
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

    print('  Adding adjustments & refunds (POS alignment)...')
    deductions = aggregate_deductions_by_date_dept(csv_files)
    SKIP_DEPARTMENTS = {'', 'TEST DEPARTMENT', 'Parties test'}
    deduction_count = 0
    for (date_str, dept), amount in deductions.items():
        if abs(amount) < 0.01:
            continue
        if dept in SKIP_DEPARTMENTS or dept == '(blank)':
            continue
        rows.append({
            'date': date_str,
            'name': '[Adjustments & Refunds]',
            'department': dept,
            'subdepartment': '',
            'category': dept,
            'quantity': 0,
            'revenue': round(amount, 2),
            'transactions': 0,
        })
        deduction_count += 1
    rows.sort(key=lambda r: (r['date'], r['department'], r['name']))
    print(f'  Added {deduction_count:,} deduction rows')

    out = os.path.join(OUTPUT_DIR, 'transactions.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'))

    size_kb = os.path.getsize(out) / 1024
    print(f'  -> {out}  ({size_kb:.0f} KB)')
    return rows, products


def _write_intraday_shards(rows, subdir=''):
    """Write intraday rows sharded by department/year under public/data/intraday/."""
    base = os.path.join(INTRADAY_DIR, subdir) if subdir else INTRADAY_DIR
    os.makedirs(base, exist_ok=True)

    by_dept_year = defaultdict(list)
    for r in rows:
        year = r['date'][:4]
        by_dept_year[(r['department'], year)].append(r)

    departments = set()
    years = set()
    counts = {}

    for (dept, year), dept_rows in sorted(by_dept_year.items()):
        dept_dir = os.path.join(base, dept)
        os.makedirs(dept_dir, exist_ok=True)
        out = os.path.join(dept_dir, f'{year}.json')
        with open(out, 'w', encoding='utf-8') as f:
            json.dump(dept_rows, f, separators=(',', ':'))
        size_kb = os.path.getsize(out) / 1024
        departments.add(dept)
        years.add(year)
        key = f'{subdir}/{dept}/{year}' if subdir else f'{dept}/{year}'
        counts[key] = len(dept_rows)
        print(f'  -> {out}  ({len(dept_rows):,} rows, {size_kb:.0f} KB)')

    return sorted(departments), sorted(years), counts


def export_intraday(products, category_overrides):
    """Export item x date x 30-min slot rows, sharded by department/year."""
    print('  Aggregating intraday (item x date x slot)...')
    rows = aggregate_intraday(products, category_overrides)
    print(f'  {len(rows):,} intraday rows')

    departments, years, counts = _write_intraday_shards(rows)
    return {
        'departments': departments,
        'years': years,
        'counts': counts,
    }


def export_voids(csv_files, category_overrides):
    """Export voided/deleted item rows, sharded by department/year."""
    print('  Reading void/deleted rows...')
    void_rows = list(read_void_rows(csv_files))

    print('  Aggregating voids (item x date x slot)...')
    rows = aggregate_voids(void_rows, category_overrides)
    print(f'  {len(rows):,} void rows')

    departments, years, counts = _write_intraday_shards(rows, subdir='voids')
    return sorted(years), counts


def write_intraday_index(intraday_meta, void_years, void_counts=None):
    """Write index.json for the intraday dashboard."""
    counts = dict(intraday_meta.get('counts', {}))
    if void_counts:
        counts.update(void_counts)
    index = {
        'departments': intraday_meta['departments'],
        'years': intraday_meta['years'],
        'generated': datetime.now().isoformat(),
        'voidYears': void_years,
        'counts': counts,
    }
    os.makedirs(INTRADAY_DIR, exist_ok=True)
    out = os.path.join(INTRADAY_DIR, 'index.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(index, f, indent=2)
    print(f'  -> {out}')
    return index


# =============================================================================
# EXPORT: modifiers.json
# =============================================================================

def export_modifiers(csv_files):
    """
    Extract and aggregate all Modifier items (Food department only).
    Outputs modifiers.json for the Data Explorer Modifiers section.
    """
    modifiers = defaultdict(lambda: {'count': 0, 'revenue': 0.0, 'unit_price': 0.0, 'subdepartment': ''})

    columns = [
        'Transaction ID', 'Item ID', 'Name', 'Item Type',
        'Department', 'Subdepartment', 'Quantity', 'Unit Amount',
        'Total', 'Transaction Type', 'Deleted', 'Voided',
    ]

    seen = set()
    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: header.index(c) for c in columns if c in header}
            if 'Transaction ID' not in idx or 'Item ID' not in idx or 'Item Type' not in idx:
                continue
            max_idx = max(idx.values())

            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                if 'Transaction Type' in idx and row[idx['Transaction Type']] != 'Sales':
                    continue
                if row[idx['Item Type']] != 'Modifier':
                    continue
                if row[idx.get('Department', 0)].strip() != 'Food':
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)

                name = row[idx['Name']].strip()
                subdept = normalize_subdepartment(row[idx.get('Subdepartment', 0)].strip()) if 'Subdepartment' in idx else ''
                qty = float(row[idx['Quantity']] or 0)
                unit = float(row[idx['Unit Amount']] or 0)
                total = float(row[idx['Total']] or 0) if 'Total' in idx else 0

                m = modifiers[name]
                m['count'] += 1
                m['revenue'] += total if total != 0 else (unit * qty if qty else unit)
                if unit > 0:
                    m['unit_price'] = unit
                if subdept:
                    m['subdepartment'] = subdept

    rows = [
        {
            'name': name,
            'count': data['count'],
            'revenue': round(data['revenue'], 2),
            'unitPrice': round(data['unit_price'], 2),
            'subdepartment': data['subdepartment'] or '',
        }
        for name, data in sorted(modifiers.items(), key=lambda x: x[1]['count'], reverse=True)
    ]

    data = {
        'modifiers': rows,
        'generatedAt': datetime.now().isoformat(),
    }

    out = os.path.join(OUTPUT_DIR, 'modifiers.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'  -> {out}  ({len(rows)} modifiers)')
    return data


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
        'Department', 'Item Created Date', 'Item Created Time', 'Total',
        'Quantity', 'Unit Amount', 'Deleted', 'Voided',
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

                date_str = business_day(
                    row[idx['Item Created Date']].strip(),
                    row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else '',
                )
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
        'Department', 'Item Created Date', 'Item Created Time', 'Total',
        'Quantity', 'Unit Amount', 'Deleted', 'Voided',
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

                date_str = business_day(
                    row[idx['Item Created Date']].strip(),
                    row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else '',
                )
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
    """Export bowling forecast: seasonal model + current year actuals."""
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
# TICKET LOOKUP: read all line types (no txn/item-type filter)
# =============================================================================

_TICKET_SKIP_FILES = frozenset({'food_purchases.csv'})


def _parse_bool_cell(s):
    if s is None:
        return False
    t = str(s).strip().lower()
    return t in ('true', '1', 'yes')


def _norm_hhmm(time_str):
    """Normalize 'HH:MM:SS' or similar to 'HH:MM' for display."""
    if not time_str or not str(time_str).strip():
        return ''
    parts = str(time_str).strip().split(':')
    if len(parts) >= 2:
        return f'{parts[0]}:{parts[1]}'
    return str(time_str).strip()


def read_ticket_rows_deduped(csv_files):
    """
    Read all POS rows: non-deleted, non-voided only.
    No filter on Transaction Type or Item Type. Dedupe by (Transaction ID, Item ID).
    Skips food_purchases.csv (different format).
    Returns list of dicts with parsed fields.
    """
    columns = [
        'Transaction ID', 'Item ID',
        'Transaction Created Date', 'Transaction Created Time', 'Transaction Closed Time',
        'Transaction Total', 'Transaction User', 'Transaction Terminal', 'Transaction Type',
        'Name', 'Item Type', 'Department', 'Subdepartment',
        'Quantity', 'Unit Amount', 'Total',
        'Deleted', 'Voided',
        'Tax Included', 'Sold in Package',
    ]
    row_map = {}
    key_order = []

    for csv_path in csv_files:
        if os.path.basename(csv_path).lower() in _TICKET_SKIP_FILES:
            continue
        if not os.path.isfile(csv_path):
            continue
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: header.index(c) for c in columns if c in header}
            if 'Transaction ID' not in idx or 'Item ID' not in idx:
                continue
            max_idx = max(idx.values())

            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue

                txn_id = row[idx['Transaction ID']].strip()
                item_id = int(row[idx['Item ID']])
                key = (txn_id, item_id)
                if key in row_map:
                    continue

                name = row[idx['Name']].strip() if 'Name' in idx else ''
                name = NAME_MERGE.get(name, name)
                item_type = row[idx['Item Type']].strip() if 'Item Type' in idx else ''
                dept = row[idx['Department']].strip() if 'Department' in idx and len(row) > idx['Department'] else ''
                sub_raw = row[idx['Subdepartment']].strip() if 'Subdepartment' in idx and len(row) > idx['Subdepartment'] else ''
                subdept = normalize_subdepartment(sub_raw) if sub_raw else ''
                qty = float(row[idx['Quantity']] or 0) if 'Quantity' in idx else 0.0
                unit_price = float(row[idx['Unit Amount']] or 0) if 'Unit Amount' in idx else 0.0
                item_total = float(row[idx['Total']] or 0) if 'Total' in idx else 0.0

                txn_date_raw = row[idx['Transaction Created Date']].strip() if 'Transaction Created Date' in idx else ''
                txn_time_raw = row[idx['Transaction Created Time']].strip() if 'Transaction Created Time' in idx else ''
                txn_date = business_day(txn_date_raw, txn_time_raw)
                txn_closed_raw = row[idx['Transaction Closed Time']].strip() if 'Transaction Closed Time' in idx else ''
                txn_total = float(row[idx['Transaction Total']] or 0) if 'Transaction Total' in idx else 0.0
                txn_user = row[idx['Transaction User']].strip() if 'Transaction User' in idx else ''
                txn_terminal = row[idx['Transaction Terminal']].strip() if 'Transaction Terminal' in idx else ''
                txn_type = row[idx['Transaction Type']].strip() if 'Transaction Type' in idx else ''

                tax_in = _parse_bool_cell(row[idx['Tax Included']]) if 'Tax Included' in idx else False
                sold_pkg = _parse_bool_cell(row[idx['Sold in Package']]) if 'Sold in Package' in idx else False

                rec = {
                    'txn_id': txn_id,
                    'item_id': item_id,
                    'name': name,
                    'item_type': item_type,
                    'department': dept,
                    'subdepartment': subdept,
                    'qty': qty,
                    'unit_price': unit_price,
                    'item_total': item_total,
                    'txn_date': txn_date,
                    'txn_time': _norm_hhmm(txn_time_raw),
                    'txn_closed_time': _norm_hhmm(txn_closed_raw),
                    'txn_total': txn_total,
                    'txn_user': txn_user,
                    'txn_terminal': txn_terminal,
                    'txn_type': txn_type,
                    'tax_included': tax_in,
                    'sold_in_package': sold_pkg,
                }
                row_map[key] = rec
                key_order.append(key)

    return [row_map[k] for k in key_order]


def _primary_transaction_type(types_list):
    """Prefer Sales, then Refund, else most common."""
    if not types_list:
        return ''
    uniq = set(types_list)
    if 'Sales' in uniq:
        return 'Sales'
    if 'Refund' in uniq:
        return 'Refund'
    return Counter(types_list).most_common(1)[0][0]


def _group_ticket_rows(rows):
    by_txn = defaultdict(list)
    for r in rows:
        by_txn[r['txn_id']].append(r)
    return by_txn


_STANDALONE_ITEM_TYPES = frozenset({
    'Tax', 'GratuityIn', 'Adjustment', 'PaymentCredit', 'PaymentCash', 'Account', 'Cancel',
})


def _build_ticket_line_items(rows_sorted_by_item_id):
    """
    Sort by Item ID, then assign parentItemId for Modifiers per spec.
    """
    rows = sorted(rows_sorted_by_item_id, key=lambda r: r['item_id'])
    current_parent = None
    out = []
    for r in rows:
        it = r['item_type']
        iid = r['item_id']
        entry = {
            'itemId': iid,
            'name': r['name'],
            'itemType': it,
            'dept': r['department'],
            'subdept': r['subdepartment'] or '',
            'qty': r['qty'],
            'unitAmount': round(r['unit_price'], 2),
            'total': round(r['item_total'], 2),
            'taxIncluded': r['tax_included'],
            'soldInPackage': r['sold_in_package'],
        }
        if it == 'Modifier':
            if current_parent is not None:
                entry['parentItemId'] = current_parent
        elif it == 'Product':
            current_parent = iid
        elif it == 'Package':
            current_parent = None
        elif it in _STANDALONE_ITEM_TYPES:
            current_parent = None
        else:
            current_parent = None

        out.append(entry)
    return out


# =============================================================================
# EXPORT: payments.json (date-granular payment method breakdown)
# =============================================================================

PAYMENT_ITEM_TYPES = ('PaymentCash', 'PaymentCredit', 'PaymentStoredValue')

def aggregate_payments(csv_files):
    """
    Read payment rows from CSVs, aggregate by (date, paymentType, name).
    Uses unique transaction IDs per bucket for transaction counts.
    """
    agg = defaultdict(lambda: {'amount': 0.0, 'txn_ids': set()})

    columns = [
        'Transaction ID', 'Item ID', 'Name', 'Item Type',
        'Quantity', 'Unit Amount', 'Total',
        'Transaction Type', 'Deleted', 'Voided',
        'Item Created Date', 'Item Created Time',
    ]

    seen = set()
    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: header.index(c) for c in columns if c in header}
            if 'Transaction ID' not in idx or 'Item ID' not in idx or 'Item Type' not in idx:
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
                if item_type not in PAYMENT_ITEM_TYPES:
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)

                name = row[idx['Name']].strip() or item_type
                date_str = business_day(
                    row[idx['Item Created Date']].strip(),
                    row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else '',
                )
                qty = float(row[idx['Quantity']] or 0)
                unit = float(row[idx['Unit Amount']] or 0)
                total = float(row[idx['Total']] or 0) if 'Total' in idx else 0
                amount = total if total != 0 else (unit * qty if qty else unit)

                bucket_key = (date_str, item_type, name)
                bucket = agg[bucket_key]
                bucket['amount'] += amount
                bucket['txn_ids'].add(row[idx['Transaction ID']])

    rows = []
    for (date_str, payment_type, name), data in agg.items():
        rows.append({
            'date': date_str,
            'paymentType': payment_type,
            'name': name,
            'amount': round(data['amount'], 2),
            'transactions': len(data['txn_ids']),
        })

    rows.sort(key=lambda r: (r['date'], r['paymentType'], r['name']))
    return rows


def export_payments(csv_files):
    """Export payment rows with date granularity for the Payments dashboard."""
    rows = aggregate_payments(csv_files)
    out = os.path.join(OUTPUT_DIR, 'payments.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'))
    size_kb = os.path.getsize(out) / 1024
    print(f'  -> {out}  ({len(rows):,} rows, {size_kb:.0f} KB)')
    return rows


# =============================================================================
# EXPORT: packages.json (summer specials / package sales)
# =============================================================================

PACKAGE_DEFS = [
    {'displayName': 'Summer Triple Play', 'posName': 'Summer Triple PLay', 'kind': 'package'},
    {'displayName': 'Monday Roll Call', 'posName': 'Monday Roll Call', 'kind': 'package'},
    {'displayName': 'First Roll Friday', 'posName': 'Friday First Role', 'kind': 'package'},
    {'displayName': 'All You Can Bowl', 'posName': 'All you can bowl - Charge', 'kind': 'charge'},
    {'displayName': 'Family Fun Pack', 'posName': 'Family Fun Pack Charge', 'kind': 'charge'},
    {'displayName': 'Summer Party Builder', 'posName': 'Summer Party Builder Charge', 'kind': 'charge'},
    {'displayName': 'Group Party Pack', 'posName': 'Group Party Charge', 'kind': 'charge'},
]

PACKAGE_POS_NAMES = {d['posName'] for d in PACKAGE_DEFS if d['kind'] == 'package'}
CHARGE_POS_NAMES = {d['posName'] for d in PACKAGE_DEFS if d['kind'] == 'charge'}
POS_TO_DISPLAY = {d['posName']: d['displayName'] for d in PACKAGE_DEFS}
PACKAGE_CATEGORY = 'Summer Specials'
PACKAGE_DEPARTMENT = 'Bowling'


def _package_child_revenue(txn_rows, package_item_id):
    """Sum bundled product revenue for one Package line item in a transaction."""
    pkg_id = int(package_item_id)
    next_pkg_id = None
    for r in txn_rows:
        if r['item_type'] == 'Package' and int(r['item_id']) > pkg_id:
            next_pkg_id = int(r['item_id'])
            break
    total = 0.0
    for r in txn_rows:
        if r['item_type'] != 'Product' or not r.get('sold_in_package'):
            continue
        iid = int(r['item_id'])
        if iid <= pkg_id:
            continue
        if next_pkg_id is not None and iid >= next_pkg_id:
            continue
        amt = r['item_total'] if r['item_total'] != 0 else (r['unit_price'] * (r['qty'] or 1))
        total += amt
    return total


def aggregate_packages(csv_files):
    """
    Export date-granular rows for tracked summer specials.
    Package-type items get revenue from bundled children (Sold in Package).
    Charge-type items use the charge product line directly.
    """
    agg = defaultdict(lambda: {'revenue': 0.0, 'quantity': 0, 'txn_ids': set()})

    columns = [
        'Transaction ID', 'Item ID', 'Name', 'Item Type',
        'Department', 'Subdepartment', 'Quantity', 'Unit Amount', 'Total',
        'Transaction Type', 'Deleted', 'Voided',
        'Item Created Date', 'Item Created Time', 'Sold in Package',
    ]

    seen = set()
    by_txn = defaultdict(list)

    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: header.index(c) for c in columns if c in header}
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

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)

                name = row[idx['Name']].strip()
                item_type = row[idx['Item Type']].strip()
                if item_type not in ('Package', 'Product'):
                    continue

                qty = float(row[idx['Quantity']] or 0)
                unit = float(row[idx['Unit Amount']] or 0)
                item_total = float(row[idx['Total']] or 0) if 'Total' in idx else 0
                sold_in = (
                    row[idx['Sold in Package']].strip() == 'True'
                    if 'Sold in Package' in idx else False
                )

                by_txn[row[idx['Transaction ID']]].append({
                    'item_id': int(row[idx['Item ID']]),
                    'name': name,
                    'item_type': item_type,
                    'qty': qty,
                    'unit_price': unit,
                    'item_total': item_total,
                    'sold_in_package': sold_in,
                    'date': business_day(
                        row[idx['Item Created Date']].strip(),
                        row[idx['Item Created Time']].strip() if 'Item Created Time' in idx else '',
                    ),
                    'department': row[idx['Department']].strip() if 'Department' in idx else '',
                    'subdepartment': row[idx['Subdepartment']].strip() if 'Subdepartment' in idx else '',
                })

    for txn_id, rows in by_txn.items():
        rows.sort(key=lambda r: r['item_id'])
        for r in rows:
            if r['item_type'] == 'Package' and r['name'] in PACKAGE_POS_NAMES:
                display = POS_TO_DISPLAY[r['name']]
                revenue = _package_child_revenue(rows, r['item_id'])
                bucket = (r['date'], display)
                agg[bucket]['revenue'] += revenue
                agg[bucket]['quantity'] += 1
                agg[bucket]['txn_ids'].add(txn_id)
            elif r['item_type'] == 'Product' and r['name'] in CHARGE_POS_NAMES:
                display = POS_TO_DISPLAY[r['name']]
                revenue = r['item_total'] if r['item_total'] != 0 else (r['unit_price'] * (r['qty'] or 1))
                bucket = (r['date'], display)
                agg[bucket]['revenue'] += revenue
                agg[bucket]['quantity'] += int(r['qty'] or 1)
                agg[bucket]['txn_ids'].add(txn_id)

    out_rows = []
    for (date_str, display_name), data in agg.items():
        if not date_str or len(date_str) < 10:
            continue
        out_rows.append({
            'date': date_str,
            'name': display_name,
            'department': PACKAGE_DEPARTMENT,
            'subdepartment': 'Packages',
            'category': PACKAGE_CATEGORY,
            'quantity': data['quantity'],
            'revenue': round(data['revenue'], 2),
            'transactions': len(data['txn_ids']),
        })

    out_rows.sort(key=lambda r: (r['date'], r['name']))
    return out_rows


def export_packages(csv_files):
    """Export package / summer special rows for the Package Detail dashboard."""
    rows = aggregate_packages(csv_files)
    out = os.path.join(OUTPUT_DIR, 'packages.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(rows, f, separators=(',', ':'))
    size_kb = os.path.getsize(out) / 1024
    print(f'  -> {out}  ({len(rows):,} rows, {size_kb:.0f} KB)')
    return rows


def export_ticket_detail(csv_files):
    """Write public/data/tickets/YYYY-MM.json — full receipt lines per month."""
    print('  Reading all line items for ticket detail...')
    rows = read_ticket_rows_deduped(csv_files)
    by_txn = _group_ticket_rows(rows)

    tickets_dir = os.path.join(OUTPUT_DIR, 'tickets')
    os.makedirs(tickets_dir, exist_ok=True)

    by_month = defaultdict(list)

    for txn_id, group in by_txn.items():
        group_sorted = sorted(group, key=lambda r: r['item_id'])
        first = group_sorted[0]
        date_str = first['txn_date']
        if not date_str or len(date_str) < 7:
            ym = 'unknown'
        else:
            ym = date_str[:7]

        types_list = [r['txn_type'] for r in group if r['txn_type']]
        ticket = {
            'txnId': txn_id,
            'date': first['txn_date'],
            'time': first['txn_time'],
            'closedTime': first['txn_closed_time'],
            'total': round(first['txn_total'], 2),
            'user': first['txn_user'],
            'terminal': first['txn_terminal'],
            'type': _primary_transaction_type(types_list),
            'items': _build_ticket_line_items(group),
        }
        by_month[ym].append(ticket)

    total_bytes = 0
    for ym in sorted(by_month.keys()):
        month_list = by_month[ym]
        month_list.sort(key=lambda t: (t['date'] or '', t['time'] or '', t['txnId']), reverse=True)
        out_path = os.path.join(tickets_dir, f'{ym}.json')
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(month_list, f, separators=(',', ':'))
        sz = os.path.getsize(out_path)
        total_bytes += sz
        print(f'  -> {out_path}  ({len(month_list):,} tickets, {sz / 1024:.0f} KB)')

    print(f'  Ticket detail: {len(by_month)} month file(s), {total_bytes / (1024 * 1024):.2f} MB total')

    months_path = os.path.join(tickets_dir, 'months.json')
    with open(months_path, 'w', encoding='utf-8') as f:
        json.dump(sorted(by_month.keys()), f, separators=(',', ':'))
    print(f'  -> {months_path}')

    return by_month


# =============================================================================
# EXPORT: _employees_pos.json (per-employee POS sales + tips)
# =============================================================================

def _load_service_charges_config():
    defaults = {
        'matchSuffix': 'Service Charge',
        'excludeNames': ['Processing Fee'],
        'vipName': 'VIP Service Charge',
        'partyName': 'Party Service Charge',
    }
    if os.path.exists(SERVICE_CHARGES_CONFIG):
        with open(SERVICE_CHARGES_CONFIG, encoding='utf-8') as f:
            defaults.update(json.load(f))
    return defaults


def _normalize_employee_name(name):
    if not name or not str(name).strip():
        return None
    return ' '.join(str(name).strip().lower().split())


def _ticket_line_amount(line):
    total = line.get('total') or 0
    if total != 0:
        return float(total)
    qty = line.get('qty') or 0
    unit = line.get('unitAmount') or 0
    return float(unit * qty if qty else unit)


def _is_service_charge(name, cfg):
    if name in cfg.get('excludeNames', []):
        return False
    suffix = cfg.get('matchSuffix', 'Service Charge')
    return bool(name) and name.endswith(suffix)


def _service_charge_bucket(name, cfg):
    if name == cfg.get('vipName'):
        return 'vip'
    if name == cfg.get('partyName'):
        return 'party'
    return 'other'


def _empty_employee_day():
    return {
        'sales': 0.0,
        'tickets': 0,
        'gratuity': 0.0,
        'serviceChargeVip': 0.0,
        'serviceChargeParty': 0.0,
        'serviceChargeOther': 0.0,
    }


def aggregate_employees_from_tickets(by_month):
    """Aggregate POS sales, gratuity, and service charges per employee per day."""
    cfg = _load_service_charges_config()
    product_types = {'Product', 'Modifier', 'Package'}
    employees = {}
    date_min = None
    date_max = None

    def ensure_emp(norm, display):
        if norm not in employees:
            employees[norm] = {
                'displayName': display,
                'days': defaultdict(_empty_employee_day),
                'deptMix': defaultdict(float),
                'topItems': defaultdict(float),
                'nameCounts': Counter(),
            }
        employees[norm]['nameCounts'][display] += 1

    for _ym, tickets in by_month.items():
        for ticket in tickets:
            date = ticket.get('date') or ''
            if date:
                date_min = date if date_min is None else min(date_min, date)
                date_max = date if date_max is None else max(date_max, date)

            ticket_user = (ticket.get('user') or '').strip()
            ticket_user_norm = _normalize_employee_name(ticket_user)

            sc_vip = sc_party = sc_other = 0.0
            for line in ticket.get('items') or []:
                if line.get('itemType') != 'Adjustment':
                    continue
                name = (line.get('name') or '').strip()
                if not _is_service_charge(name, cfg):
                    continue
                amt = _ticket_line_amount(line)
                bucket = _service_charge_bucket(name, cfg)
                if bucket == 'vip':
                    sc_vip += amt
                elif bucket == 'party':
                    sc_party += amt
                else:
                    sc_other += amt

            if ticket_user_norm and (sc_vip or sc_party or sc_other):
                ensure_emp(ticket_user_norm, ticket_user)
                day = employees[ticket_user_norm]['days'][date]
                day['serviceChargeVip'] += sc_vip
                day['serviceChargeParty'] += sc_party
                day['serviceChargeOther'] += sc_other

            if ticket_user_norm:
                ensure_emp(ticket_user_norm, ticket_user)
                employees[ticket_user_norm]['days'][date]['tickets'] += 1

            for line in ticket.get('items') or []:
                it = line.get('itemType')
                if it == 'GratuityIn':
                    recip = (line.get('name') or '').strip()
                    norm = _normalize_employee_name(recip)
                    if norm:
                        ensure_emp(norm, recip)
                        employees[norm]['days'][date]['gratuity'] += _ticket_line_amount(line)
                elif it in product_types:
                    amt = _ticket_line_amount(line)
                    dept = (line.get('dept') or 'Unknown').strip() or 'Unknown'
                    item_name = (line.get('name') or '').strip()
                    if ticket_user_norm:
                        employees[ticket_user_norm]['days'][date]['sales'] += amt
                        employees[ticket_user_norm]['deptMix'][dept] += amt
                        if item_name:
                            employees[ticket_user_norm]['topItems'][item_name] += amt

    out_employees = {}
    for norm, data in employees.items():
        display = data['nameCounts'].most_common(1)[0][0] if data['nameCounts'] else norm
        days_out = {}
        for day_key, vals in data['days'].items():
            days_out[day_key] = {
                k: round(v, 2) if isinstance(v, float) else v
                for k, v in vals.items()
            }
        top_items = sorted(data['topItems'].items(), key=lambda x: -x[1])[:10]
        dept_mix = dict(sorted(data['deptMix'].items(), key=lambda x: -x[1]))
        out_employees[norm] = {
            'displayName': display,
            'days': days_out,
            'deptMix': {k: round(v, 2) for k, v in dept_mix.items()},
            'topItems': [{'name': n, 'revenue': round(r, 2)} for n, r in top_items],
        }

    return {
        'generatedAt': datetime.now().isoformat(),
        'dateRange': [date_min or '', date_max or ''],
        'employees': out_employees,
    }


def export_employees_pos(by_month):
    """Write public/data/_employees_pos.json from ticket month buckets."""
    payload = aggregate_employees_from_tickets(by_month)
    with open(EMPLOYEES_POS_OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
        f.write('\n')
    count = len(payload['employees'])
    size_kb = os.path.getsize(EMPLOYEES_POS_OUTPUT) / 1024
    print(f'  -> {EMPLOYEES_POS_OUTPUT}  ({count:,} employees, {size_kb:.0f} KB)')
    return payload


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

    print('\n[1/11] Transactions...')
    rows, products = export_transactions(csv_files, category_overrides)

    print('\n[2/11] Modifiers...')
    export_modifiers(csv_files)
    print('  Modifier transactions (date-granular)...')
    export_modifier_transactions(csv_files)

    print('\n[3/11] Summary...')
    summary = export_summary(rows)
    for dept, info in summary['departments'].items():
        print(f'  {dept}: ${info["revenue"]:,.0f}  '
              f'({info["uniqueItems"]} items, {info["transactions"]:,} txns)')

    print('\n[4/11] Bowling Seasonality...')
    export_bowling_seasonality(csv_files)

    print('\n[5/11] Bowling Forecast...')
    export_bowling_forecast(csv_files)

    print('\n[6/11] Holiday Analysis...')
    try:
        import sys
        _scripts = os.path.join(_ROOT, 'scripts')
        if _scripts not in sys.path:
            sys.path.insert(0, _scripts)
        from holiday_analysis import export_holiday_analysis
        if export_holiday_analysis(rows, quiet=True) == 0:
            print(f'  -> {os.path.join(OUTPUT_DIR, "holiday_analysis.json")}')
    except ImportError as e:
        print(f'  SKIP: holiday_analysis not available ({e})')

    print('\n[7/12] Ticket detail (by month)...')
    by_month = export_ticket_detail(csv_files)

    print('\n[8/12] Employee POS aggregation...')
    export_employees_pos(by_month)

    print('\n[9/12] Payments...')
    export_payments(csv_files)

    print('\n[10/12] Packages (summer specials)...')
    export_packages(csv_files)

    print('\n[11/12] Intraday sales (by department/year)...')
    intraday_meta = export_intraday(products, category_overrides)

    print('\n[12/12] Intraday voids (by department/year)...')
    void_years, void_counts = export_voids(csv_files, category_overrides)
    write_intraday_index(intraday_meta, void_years, void_counts)

    print('\n' + '=' * 60)
    print(f'Done! {len(rows):,} transaction rows written to {OUTPUT_DIR}')
    print('=' * 60)
    return 0


if __name__ == '__main__':
    exit(main())
