#!/usr/bin/env python3
"""Definitive Feb 7 reconciliation using test_feb_7th.csv."""
import csv
from collections import defaultdict

HEADER = [
    'Transaction ID', 'Item ID', 'Transaction Created Date', 'Transaction Created Time',
    'Transaction Closed Date', 'Transaction Closed Time', 'Transaction Ended Date',
    'Transaction Ended Time', 'Transaction Fiscal', 'Transaction Terminal',
    'Transaction User', 'Transaction Shift Number', 'Transaction Total',
    'Transaction Type', 'Name', 'Item Type', 'Item Created Date', 'Item Created Time',
    'Item Terminal', 'Item User', 'Quantity', 'Unit Amount', 'Total', 'Deleted',
    'Voided', 'Item Ended Date', 'Item Ended Time', 'Item Shift Number',
    'Department', 'Subdepartment', 'Tax Included', 'Tax Exempt', 'Sold in Package',
    'Sold By', 'Rate', ''
]

with open('test_feb_7th.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f, delimiter=';')
    rows = list(reader)

idx = {c.strip(): i for i, c in enumerate(HEADER)}

by_type = defaultdict(float)
by_type_count = defaultdict(int)
by_dept = defaultdict(float)
product_by_dept = defaultdict(float)

for row in rows:
    if len(row) < 25:
        continue
    deleted = row[idx['Deleted']].strip()
    voided = row[idx['Voided']].strip()
    txn_type = row[idx['Transaction Type']].strip()
    item_type = row[idx['Item Type']].strip()
    total_val = float(row[idx['Total']].strip() or 0)
    qty = float(row[idx['Quantity']].strip() or 0)
    unit = float(row[idx['Unit Amount']].strip() or 0)
    rev = total_val if total_val != 0 else (unit * qty if qty else unit)
    dept = row[idx['Department']].strip() if idx.get('Department') and len(row) > idx['Department'] else ''

    if deleted != 'False' or voided != 'False':
        continue
    if txn_type != 'Sales':
        continue

    by_type[item_type] += rev
    by_type_count[item_type] += 1

    if item_type in ('Product', 'Modifier', 'Package'):
        by_dept[dept] += rev
        product_by_dept[dept] += rev

print("=" * 65)
print("DEFINITIVE FEB 7 RECONCILIATION")
print("=" * 65)
print()
print("A. CSV (test_feb_7th.csv) by Item Type:")
for t in sorted(by_type.keys(), key=lambda x: -by_type[x]):
    print("  {:20s}: {:>12,.2f}  ({:,} rows)".format(t, by_type[t], by_type_count[t]))

product_total = by_type.get('Product', 0) + by_type.get('Modifier', 0) + by_type.get('Package', 0)
tax = by_type.get('Tax', 0)
grat = by_type.get('GratuityIn', 0) + by_type.get('GratuityOut', 0)
account = by_type.get('Account', 0)
adjustment = by_type.get('Adjustment', 0)
payments = by_type.get('PaymentCredit', 0) + by_type.get('PaymentCash', 0) + by_type.get('PaymentStoredValue', 0)

print()
print("B. Totals:")
print("  Product+Modifier+Package:  {:>12,.2f}".format(product_total))
print("  Tax:                       {:>12,.2f}".format(tax))
print("  Gratuity:                  {:>12,.2f}".format(grat))
print("  Account:                   {:>12,.2f}".format(account))
print("  Adjustment:                {:>12,.2f}".format(adjustment))
print("  Payments:                  {:>12,.2f}".format(payments))

print()
print("C. POS Report Numbers:")
print("  Sales Total:               {:>12s}".format("32,703.15"))
print("  Sales Tax Total:           {:>12s}".format("999.06"))
print("  Account Total:             {:>12s}".format("(8,464.27)"))
print("  Gratuity Total:            {:>12s}".format("1,469.86"))
print("  Stored Value:              {:>12s}".format("1,523.00"))
print("  Grand Total:               {:>12s}".format("28,230.80"))
print("  Payments Total:            {:>12s}".format("28,230.80"))

print()
print("D. Our Dashboard:            {:>12s}".format("~33,000"))

print()
print("E. MATCH CHECK:")
print("  Our Product+Mod+Pkg vs POS Sales Total:")
diff = product_total - 32703.15
print("    Ours:   {:>12,.2f}".format(product_total))
print("    POS:    {:>12,.2f}".format(32703.15))
print("    Diff:   {:>12,.2f}".format(diff))

print()
print("  POS formula check: Sales + Tax + Gratuity + Account + StoredValue = Grand?")
grand_check = 32703.15 + 999.06 + (-8464.27) + 1469.86 + 1523.00
print("    32703.15 + 999.06 - 8464.27 + 1469.86 + 1523.00 = {:,.2f}".format(grand_check))
print("    POS Grand Total = 28,230.80")

print()
print("F. Product+Mod+Pkg by Department:")
for d in sorted(product_by_dept.keys(), key=lambda x: -product_by_dept[x]):
    label = d if d else '(blank)'
    print("  {:25s}: {:>10,.2f}".format(label, product_by_dept[d]))
