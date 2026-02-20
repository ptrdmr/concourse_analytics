import csv
import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')

modifiers = {}
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

    for row in reader:
        if len(row) <= max(name_idx, type_idx, dept_idx):
            continue
        if (row[type_idx] == 'Modifier'
                and row[deleted_idx] == 'False'
                and row[voided_idx] == 'False'
                and row[dept_idx].strip() == 'Food'):
            name = row[name_idx].strip()
            subdept = row[subdept_idx].strip()
            unit = float(row[unit_idx]) if row[unit_idx] else 0
            total = float(row[total_idx]) if row[total_idx] else 0
            if name not in modifiers:
                modifiers[name] = {'count': 0, 'revenue': 0, 'unit_price': unit, 'subdept': subdept}
            modifiers[name]['count'] += 1
            modifiers[name]['revenue'] += total
            if unit > 0:
                modifiers[name]['unit_price'] = unit

sorted_mods = sorted(modifiers.items(), key=lambda x: x[1]['count'], reverse=True)
print(f"{'NAME':<45} {'SUBDEPT':<20} {'COUNT':>6} {'UNIT $':>8} {'TOTAL REV':>12}")
print("-" * 95)
for name, stats in sorted_mods:
    print(f"{name:<45} {stats['subdept']:<20} {stats['count']:>6} ${stats['unit_price']:>7.2f} ${stats['revenue']:>11.2f}")
