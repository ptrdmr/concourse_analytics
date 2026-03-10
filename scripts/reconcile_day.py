#!/usr/bin/env python3
"""
Reconcile dashboard sales vs POS for a single day.
Usage: python scripts/reconcile_day.py 2026-01-15

Outputs totals by Item Type and Department so you can compare to the POS report.
"""
import csv
import glob
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'data')


def find_csv_files():
    all_csvs = glob.glob(os.path.join(DATA_DIR, '*.csv'))
    return sorted(f for f in all_csvs if 'food_purchases' not in f.lower())


def reconcile(target_date: str):
    csv_files = find_csv_files()
    if not csv_files:
        print("No CSV files found in data/")
        return 1

    columns = [
        'Transaction ID', 'Item ID', 'Transaction Type', 'Item Type',
        'Department', 'Quantity', 'Unit Amount', 'Total',
        'Item Created Date', 'Transaction Created Date', 'Transaction Fiscal',
        'Deleted', 'Voided',
    ]

    by_item_type = defaultdict(float)
    by_item_type_count = defaultdict(int)
    by_dept = defaultdict(float)

    for csv_path in csv_files:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: i for i, c in enumerate(header) if c in columns}
            if 'Item Created Date' not in idx:
                continue
            max_idx = max(idx.values()) if idx else 0
            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                if idx.get('Transaction Type') and row[idx['Transaction Type']] != 'Sales':
                    continue
                item_type = row[idx['Item Type']].strip()
                total_val = float(row[idx.get('Total', 0)] or 0) if 'Total' in idx else 0
                qty = float(row[idx.get('Quantity', 0)] or 0) if 'Quantity' in idx else 0
                unit = float(row[idx.get('Unit Amount', 0)] or 0) if 'Unit Amount' in idx else 0
                rev = total_val if total_val != 0 else (unit * qty if qty else unit)
                dept = row[idx.get('Department', 0)].strip() if 'Department' in idx else ''
                by_item_type[item_type] += rev
                by_item_type_count[item_type] += 1
                if item_type in ('Product', 'Modifier', 'Package'):
                    item_date = row[idx['Item Created Date']].strip()
                    if item_date == target_date:
                        by_dept[dept or '(blank)'] += rev

    product_total = by_item_type.get('Product', 0) + by_item_type.get('Modifier', 0) + by_item_type.get('Package', 0)
    our_daily = sum(by_dept.values())

    print("=" * 70)
    print(f"RECONCILIATION FOR {target_date}")
    print("=" * 70)
    print()
    print("A. All Item Types (Transaction Type = Sales, full dataset):")
    for t in sorted(by_item_type.keys(), key=lambda x: -by_item_type[x]):
        print(f"  {t:25s}: ${by_item_type[t]:>12,.2f}  ({by_item_type_count[t]:,} rows)")
    print()
    print("B. Our Dashboard Logic (Product + Modifier + Package only):")
    print(f"  Product:  ${by_item_type.get('Product', 0):>12,.2f}")
    print(f"  Modifier: ${by_item_type.get('Modifier', 0):>12,.2f}")
    print(f"  Package:  ${by_item_type.get('Package', 0):>12,.2f}")
    print(f"  Total:    ${product_total:>12,.2f}")
    print()
    print("C. Our Daily Total for", target_date, "(Item Created Date):")
    print(f"  ${our_daily:>12,.2f}")
    print()
    print("D. By Department (for this date):")
    for d in sorted(by_dept.keys(), key=lambda x: -by_dept[x]):
        print(f"  {d:25s}: ${by_dept[d]:>12,.2f}")
    print()
    print("E. Excluded (we don't include these in Sales):")
    print(f"  Tax:        ${by_item_type.get('Tax', 0):>12,.2f}")
    print(f"  GratuityIn:  ${by_item_type.get('GratuityIn', 0):>12,.2f}")
    print(f"  Adjustment: ${by_item_type.get('Adjustment', 0):>12,.2f}")
    print(f"  Refunds:    (Transaction Type != Sales, excluded)")
    print()
    print("Compare C to your POS Sales Total for", target_date)
    print("If different, check: date field (Item vs Transaction Created/Fiscal), Refunds, Adjustments")
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python scripts/reconcile_day.py YYYY-MM-DD")
        sys.exit(1)
    target = sys.argv[1]
    if len(target) != 10 or target[4] != '-' or target[7] != '-':
        print("Date must be YYYY-MM-DD")
        sys.exit(1)
    sys.exit(reconcile(target))
