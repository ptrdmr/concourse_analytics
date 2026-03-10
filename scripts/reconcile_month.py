#!/usr/bin/env python3
"""
Reconcile dashboard sales vs POS for a full month, by department.
Usage: python scripts/reconcile_month.py 2025-01

Reads from transactions.json (output of export_dashboards.py) which includes
Adjustments & Refunds. Run 'python scripts/export_dashboards.py' first.
"""
import json
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TXNS_PATH = os.path.join(ROOT, 'public', 'data', 'transactions.json')


def reconcile(target_year_month: str):
    """target_year_month: YYYY-MM"""
    if not os.path.isfile(TXNS_PATH):
        print(f"Run export first: python scripts/export_dashboards.py")
        print(f"Expected: {TXNS_PATH}")
        return 1

    year, month = target_year_month.split('-')
    start_date = f"{year}-{month}-01"
    if month in ('01', '03', '05', '07', '08', '10', '12'):
        end_date = f"{year}-{month}-31"
    elif month in ('04', '06', '09', '11'):
        end_date = f"{year}-{month}-30"
    else:
        end_date = f"{year}-{month}-28"
        if int(year) % 4 == 0 and (int(year) % 100 != 0 or int(year) % 400 == 0):
            end_date = f"{year}-{month}-29"

    with open(TXNS_PATH, 'r') as f:
        rows = json.load(f)

    by_dept = defaultdict(float)
    by_dept_qty = defaultdict(int)
    for r in rows:
        if not (start_date <= r['date'] <= end_date):
            continue
        by_dept[r['department']] += r['revenue']
        by_dept_qty[r['department']] += r.get('quantity', 0) or (1 if r['revenue'] else 0)

    total_rev = sum(by_dept.values())
    total_qty = sum(by_dept_qty.values())

    print("=" * 60)
    print(f"DEPARTMENT COMPARISON: {target_year_month} ({start_date} to {end_date})")
    print("=" * 60)
    print()
    print("Our system (from transactions.json — includes Adjustments & Refunds)")
    print("Compare to POS 'Revenue by Department' report.")
    print()
    print(f"{'DEPARTMENT':<25} {'QUANTITY':>12} {'TOTAL':>15}")
    print("-" * 54)

    for dept in sorted(by_dept.keys(), key=lambda x: -by_dept[x]):
        rev = by_dept[dept]
        qty = by_dept_qty[dept]
        print(f"{dept:<25} {qty:>12,} ${rev:>13,.2f}")

    print("-" * 54)
    print(f"{'Total':<25} {total_qty:>12,} ${total_rev:>13,.2f}")
    print()
    print("POS totals for Jan 2025 (from your report):")
    print("  Arcade: $4,655 | Bar: $142,193.60 | Bowling: $252,787.82")
    print("  Food: $100,154.71 | General Income: $981.90 | League Fees: $86,424.28")
    print("  Parties: $6,072 | Total: $593,266.30")
    print()
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python scripts/reconcile_month.py YYYY-MM")
        print("Example: python scripts/reconcile_month.py 2025-01")
        sys.exit(1)
    target = sys.argv[1]
    if len(target) != 7 or target[4] != '-':
        print("Month must be YYYY-MM")
        sys.exit(1)
    sys.exit(reconcile(target))
