#!/usr/bin/env python3
"""
export_clean_csv.py

Reads the raw POS sales data, filters to the curated food items
in food_items.txt, and writes a clean CSV with 5 columns:
  Name, Date, Time, Day_of_Week, Cost
"""

import csv
import os
from datetime import datetime
from collections import defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')
FILTER_FILE = os.path.join(_ROOT, 'config', 'food_items.txt')
OUTPUT_FILE = os.path.join(_ROOT, 'data', 'food_purchases.csv')

# Early-season labeling variants -> canonical names
NAME_MERGE = {
    'Carne Asada Taco Plate (3)': 'Taco Plate',
    'Carnitas Tacos Plate (3)':   'Taco Plate',
    'Chicken Tacos Plate (3)':    'Taco Plate',
    'Hummus Trio m':              'Hummus Trio',
    'Pretzel Sticks m':           'Pretzel Sticks',
    'Irish Nachos m':             'Irish Nachos',
    'Sliders m':                  'Sliders',
}

# Day-of-week names indexed by weekday() (0=Monday)
DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday',
             'Friday', 'Saturday', 'Sunday']


def _read_transactions():
    """Phase 1: Read CSV rows and group by Transaction ID."""
    transactions = defaultdict(list)
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)
        idx = {c: header.index(c) for c in [
            'Transaction ID', 'Item ID', 'Name', 'Item Type',
            'Department', 'Unit Amount', 'Deleted', 'Voided',
            'Item Created Date', 'Item Created Time',
        ]}
        max_idx = max(idx.values())
        for row in reader:
            if len(row) <= max_idx:
                continue
            if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                continue
            item_type = row[idx['Item Type']]
            if item_type not in ('Product', 'Modifier'):
                continue
            transactions[row[idx['Transaction ID']]].append({
                'item_id':    int(row[idx['Item ID']]),
                'name':       NAME_MERGE.get(row[idx['Name']].strip(),
                                             row[idx['Name']].strip()),
                'item_type':  item_type,
                'department': row[idx['Department']].strip(),
                'unit_price': float(row[idx['Unit Amount']] or 0),
                'date':       row[idx['Item Created Date']].strip(),
                'time':       row[idx['Item Created Time']].strip(),
            })
    return transactions


def _resolve_products(transactions, allowed):
    """Phase 2: Walk each transaction, link modifiers to parent products,
    compute true costs, and yield resolved food product dicts."""
    for rows in transactions.values():
        rows.sort(key=lambda r: r['item_id'])
        current_product = None
        modifier_cost = 0.0

        for r in rows:
            if r['item_type'] == 'Product':
                # Emit the previous product if it's one of ours
                if current_product is not None:
                    if current_product['unit_price'] == 0 and modifier_cost > 0:
                        current_product['unit_price'] = modifier_cost
                    yield current_product
                    current_product = None
                    modifier_cost = 0.0

                # Check if this product is one we care about
                if (r['name'] in allowed
                        and r['department'] == 'Food'):
                    current_product = r
                    modifier_cost = 0.0
                else:
                    current_product = None
                    modifier_cost = 0.0

            elif r['item_type'] == 'Modifier' and current_product is not None:
                modifier_cost += r['unit_price']

        # Don't forget the last product in the transaction
        if current_product is not None:
            if current_product['unit_price'] == 0 and modifier_cost > 0:
                current_product['unit_price'] = modifier_cost
            yield current_product


def main():
    # Load allowed product names
    with open(FILTER_FILE, 'r', encoding='utf-8') as f:
        allowed = set(line.strip() for line in f if line.strip())

    print(f'Loaded {len(allowed)} items from {FILTER_FILE}')

    print('Phase 1: Reading transactions...')
    transactions = _read_transactions()
    print(f'Phase 2: Resolving {len(transactions):,} transactions...')

    rows_written = 0
    dates_seen = []
    out_path = OUTPUT_FILE

    with open(out_path, 'w', encoding='utf-8', newline='') as fout:
        writer = csv.writer(fout)
        writer.writerow(['Name', 'Date', 'Time', 'Day_of_Week', 'Cost'])

        for p in _resolve_products(transactions, allowed):
            date_str = p['date']
            time_str = p['time']
            cost = f'{p["unit_price"]:.4f}'

            try:
                dt = datetime.strptime(date_str, '%Y-%m-%d')
                day_name = DAY_NAMES[dt.weekday()]
                dates_seen.append(dt)
            except ValueError:
                day_name = ''

            writer.writerow([p['name'], date_str, time_str, day_name, cost])
            rows_written += 1

    # Summary
    size_kb = os.path.getsize(out_path) / 1024
    min_d = min(dates_seen).strftime('%b %d, %Y') if dates_seen else 'N/A'
    max_d = max(dates_seen).strftime('%b %d, %Y') if dates_seen else 'N/A'

    print(f'\nExported {rows_written:,} purchase records')
    print(f'Date range: {min_d} to {max_d}')
    print(f'File size:  {size_kb:.0f} KB')
    print(f'Saved to:   {out_path}')


if __name__ == '__main__':
    main()
