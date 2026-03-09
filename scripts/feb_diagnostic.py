#!/usr/bin/env python3
"""Diagnose Feb 2026 discrepancy vs POS."""
import csv
from collections import defaultdict

DATA = 'data/2026.csv'
cols = ['Transaction ID', 'Item ID', 'Item Type', 'Department', 'Transaction Type', 'Total', 'Quantity', 'Unit Amount',
        'Item Created Date', 'Deleted', 'Voided']

dept_totals = defaultdict(float)
negative_sum = 0
positive_sum = 0
seen = set()

with open(DATA, 'r', encoding='utf-8') as f:
    reader = csv.reader(f, delimiter=';')
    header = next(reader)
    idx = {c: header.index(c) for c in cols if c in header}
    max_i = max(idx.values())

    for row in reader:
        if len(row) <= max_i:
            continue
        if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
            continue
        if row[idx['Transaction Type']] != 'Sales':
            continue
        if row[idx['Item Type']] not in ('Product', 'Modifier', 'Package'):
            continue

        key = (row[idx['Transaction ID']], row[idx['Item ID']])
        if key in seen:
            continue
        seen.add(key)

        total = float(row[idx['Total']] or 0)
        qty = float(row[idx['Quantity']] or 0)
        unit = float(row[idx['Unit Amount']] or 0)
        rev = total if total != 0 else (unit * qty if qty else unit)
        created = row[idx['Item Created Date']].strip()
        dept = row[idx.get('Department', 0)].strip() if 'Department' in idx else ''

        if created < '2026-02-01' or created > '2026-02-28':
            continue

        dept_totals[dept] += rev
        if rev < 0:
            negative_sum += rev
        else:
            positive_sum += rev

print('Feb 2026 by Department:')
for d, v in sorted(dept_totals.items(), key=lambda x: -x[1]):
    label = d if d else '(blank)'
    print(f'  {label}: {round(v, 2)}')
print()
print('Negative sum:', round(negative_sum, 2))
print('Positive sum:', round(positive_sum, 2))
print('Total:', round(positive_sum + negative_sum, 2))
print()
print('POS Sales: 488898.29')
print('Gap:', round((positive_sum + negative_sum) - 488898.29, 2))
print()
# What if POS excludes League Fees, Parties, Arcade, Vending?
food_bar_bowling = dept_totals.get('Food', 0) + dept_totals.get('Bar', 0) + dept_totals.get('Bowling', 0)
print('Food+Bar+Bowling only:', round(food_bar_bowling, 2))
all_except_league = sum(v for d, v in dept_totals.items() if d != 'League Fees')
print('All except League Fees:', round(all_except_league, 2))
