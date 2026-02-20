import csv
import os
from collections import defaultdict

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')

products = {}
monthly_totals = defaultdict(lambda: defaultdict(lambda: {'count': 0, 'qty': 0, 'revenue': 0}))

with open(DATA_FILE, 'r', encoding='utf-8') as f:
    reader = csv.reader(f, delimiter=';')
    header = next(reader)
    name_idx = header.index('Name')
    type_idx = header.index('Item Type')
    dept_idx = header.index('Department')
    subdept_idx = header.index('Subdepartment')
    qty_idx = header.index('Quantity')
    total_idx = header.index('Total')
    unit_idx = header.index('Unit Amount')
    deleted_idx = header.index('Deleted')
    voided_idx = header.index('Voided')
    date_idx = header.index('Item Created Date')

    for row in reader:
        if len(row) <= max(name_idx, type_idx, dept_idx, subdept_idx, deleted_idx, voided_idx, date_idx):
            continue
        if row[dept_idx].strip() == 'Food' and row[type_idx] == 'Product' and row[deleted_idx] == 'False' and row[voided_idx] == 'False':
            name = row[name_idx].strip()
            subdept = row[subdept_idx].strip()
            qty = float(row[qty_idx]) if row[qty_idx] else 0
            total = float(row[total_idx]) if row[total_idx] else 0
            unit = float(row[unit_idx]) if row[unit_idx] else 0
            date = row[date_idx].strip()
            month = date[:7] if date else 'Unknown'

            key = (name, subdept)
            if key not in products:
                products[key] = {'count': 0, 'total_qty': 0, 'total_revenue': 0, 'unit_price': unit}
            products[key]['count'] += 1
            products[key]['total_qty'] += qty
            products[key]['total_revenue'] += total
            if unit > 0:
                products[key]['unit_price'] = unit

            monthly_totals[month][name]['count'] += 1
            monthly_totals[month][name]['qty'] += qty
            monthly_totals[month][name]['revenue'] += total

# Sort by transaction count descending
sorted_products = sorted(products.items(), key=lambda x: x[1]['count'], reverse=True)

# Summary stats
total_transactions = sum(p['count'] for p in products.values())
total_revenue = sum(p['total_revenue'] for p in products.values())
total_qty = sum(p['total_qty'] for p in products.values())

print("=" * 110)
print("FOOD DEPARTMENT - PRODUCT LIST")
print(f"Period: Oct 2025 - Jan 2026")
print(f"Total Food Transactions: {total_transactions:,}")
print(f"Total Food Quantity Sold: {total_qty:,.0f}")
print(f"Total Food Revenue: ${total_revenue:,.2f}")
print(f"Unique Food Products: {len(sorted_products)}")
print("=" * 110)

# Group by subdepartment
subdepts = defaultdict(list)
for (name, subdept), stats in sorted_products:
    subdepts[subdept].append((name, stats))

for subdept in sorted(subdepts.keys()):
    items = subdepts[subdept]
    subdept_revenue = sum(s['total_revenue'] for _, s in items)
    subdept_qty = sum(s['total_qty'] for _, s in items)
    print(f"\n{'-' * 110}")
    print(f"  SUBDEPARTMENT: {subdept}  ({len(items)} items | Qty: {subdept_qty:,.0f} | Revenue: ${subdept_revenue:,.2f})")
    print(f"{'-' * 110}")
    print(f"  {'PRODUCT NAME':<42} {'UNIT $':>8} {'TRANS':>7} {'QTY':>8} {'REVENUE':>12} {'AVG/TRANS':>10}")
    print(f"  {'-'*42} {'-'*8} {'-'*7} {'-'*8} {'-'*12} {'-'*10}")
    for name, stats in items:
        avg = stats['total_revenue'] / stats['count'] if stats['count'] > 0 else 0
        unit_str = f"${stats['unit_price']:.2f}" if stats['unit_price'] > 0 else "pkg"
        print(f"  {name:<42} {unit_str:>8} {stats['count']:>7,} {stats['total_qty']:>8,.0f} ${stats['total_revenue']:>11,.2f} ${avg:>9,.2f}")

# Monthly trend
print(f"\n{'=' * 110}")
print("MONTHLY FOOD REVENUE SUMMARY")
print(f"{'=' * 110}")
for month in sorted(monthly_totals.keys()):
    items = monthly_totals[month]
    month_rev = sum(v['revenue'] for v in items.values())
    month_qty = sum(v['qty'] for v in items.values())
    month_trans = sum(v['count'] for v in items.values())
    print(f"  {month}:  {month_trans:>6,} transactions | {month_qty:>7,.0f} qty | ${month_rev:>10,.2f} revenue")
