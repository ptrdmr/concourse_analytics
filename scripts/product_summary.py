import csv
import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')

products = {}
with open(DATA_FILE, 'r', encoding='utf-8') as f:
    reader = csv.reader(f, delimiter=';')
    header = next(reader)
    name_idx = header.index('Name')
    type_idx = header.index('Item Type')
    dept_idx = header.index('Department')
    subdept_idx = header.index('Subdepartment')
    qty_idx = header.index('Quantity')
    total_idx = header.index('Total')
    deleted_idx = header.index('Deleted')
    voided_idx = header.index('Voided')
    
    for row in reader:
        if len(row) <= max(name_idx, type_idx, dept_idx, subdept_idx, deleted_idx, voided_idx):
            continue
        if row[type_idx] == 'Product' and row[deleted_idx] == 'False' and row[voided_idx] == 'False':
            name = row[name_idx].strip()
            dept = row[dept_idx].strip()
            subdept = row[subdept_idx].strip()
            qty = float(row[qty_idx]) if row[qty_idx] else 0
            total = float(row[total_idx]) if row[total_idx] else 0
            
            key = (name, dept, subdept)
            if key not in products:
                products[key] = {'count': 0, 'total_qty': 0, 'total_revenue': 0}
            products[key]['count'] += 1
            products[key]['total_qty'] += qty
            products[key]['total_revenue'] += total

sorted_products = sorted(products.items(), key=lambda x: x[1]['count'], reverse=True)

print(f'Total unique product names: {len(sorted_products)}')
print()

# Header
print(f'{"PRODUCT NAME":<45} {"DEPARTMENT":<20} {"SUBDEPARTMENT":<20} {"TRANS":>7} {"QTY":>10} {"REVENUE":>12}')
print('-' * 120)

for (name, dept, subdept), stats in sorted_products:
    print(f'{name:<45} {dept:<20} {subdept:<20} {stats["count"]:>7} {stats["total_qty"]:>10.0f} ${stats["total_revenue"]:>11,.2f}')
