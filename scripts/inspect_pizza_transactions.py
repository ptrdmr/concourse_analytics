"""Show a few sample transactions that contain pizza products."""
import csv
import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')

PIZZA_PRODUCTS = {
    'BYO Pizza', 'Meat Lovers', 'Bowlers Combo', 'Hawaiian',
    'Veggie Lovers', 'Hot Honey Pep', 'Bbq Chicken',
    'HH MED PEPPERONI', 'HH MED CHEESE', 'Party BYO Lrg Pizza',
}

seen = 0
with open(DATA_FILE, 'r', encoding='utf-8') as f:
    reader = csv.reader(f, delimiter=';')
    header = next(reader)
    tid_idx = header.index('Transaction ID')
    iid_idx = header.index('Item ID')
    name_idx = header.index('Name')
    type_idx = header.index('Item Type')
    unit_idx = header.index('Unit Amount')
    total_idx = header.index('Total')
    del_idx = header.index('Deleted')
    void_idx = header.index('Voided')
    dept_idx = header.index('Department')

    # Collect transactions
    transactions = {}
    for row in reader:
        if len(row) <= max(tid_idx, iid_idx, name_idx, type_idx):
            continue
        tid = row[tid_idx]
        if tid not in transactions:
            transactions[tid] = []
        transactions[tid].append(row)

    # Find transactions with pizza products
    for tid, rows in transactions.items():
        has_pizza = any(
            r[name_idx].strip() in PIZZA_PRODUCTS
            and r[type_idx] == 'Product'
            and r[del_idx] == 'False'
            and r[void_idx] == 'False'
            for r in rows
        )
        if not has_pizza:
            continue

        # Only show Food dept items and modifiers (skip payment rows, tax, etc.)
        food_rows = [r for r in rows if r[type_idx] in ('Product', 'Modifier')
                     and r[del_idx] == 'False' and r[void_idx] == 'False']
        if not food_rows:
            continue

        # Check if it has modifiers too
        has_mod = any(r[type_idx] == 'Modifier' for r in food_rows)
        if not has_mod:
            continue

        print(f"\n--- Transaction {tid} ---")
        for r in food_rows:
            iid = r[iid_idx]
            name = r[name_idx].strip()
            itype = r[type_idx]
            unit = r[unit_idx] or '0'
            total = r[total_idx] or '0'
            dept = r[dept_idx].strip()
            print(f"  ItemID={iid:>8}  {itype:<10} {dept:<10} {name:<35} unit=${unit:>7} total=${total:>7}")

        seen += 1
        if seen >= 12:
            break
