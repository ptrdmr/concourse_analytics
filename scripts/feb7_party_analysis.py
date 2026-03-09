#!/usr/bin/env python3
"""Analyze Feb 7 party/reservation flow: deposits booked vs redemptions."""
import csv
from collections import defaultdict

DATA = 'data/2026.csv'
# Header: Transaction ID;Item ID;...;Name;Item Type;...;Total;...;Item Created Date;...
# Index by name
cols = ['Transaction ID', 'Item ID', 'Name', 'Item Type', 'Department', 'Total', 'Quantity', 'Unit Amount',
        'Item Created Date', 'Transaction Type', 'Deleted', 'Voided']

with open(DATA, 'r', encoding='utf-8') as f:
    reader = csv.reader(f, delimiter=';')
    header = next(reader)
    idx = {c: header.index(c) for c in cols if c in header}
    max_i = max(idx.values())

    txns = defaultdict(list)
    for row in reader:
        if len(row) <= max_i:
            continue
        if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
            continue
        if 'Transaction Type' in idx and row[idx['Transaction Type']] != 'Sales':
            continue
        txn_id = row[idx['Transaction ID']]
        txns[txn_id].append({
            'name': row[idx['Name']],
            'itype': row[idx['Item Type']],
            'dept': row[idx.get('Department', 0)].strip() if 'Department' in idx else '',
            'total': float(row[idx['Total']] or 0),
            'qty': float(row[idx['Quantity']] or 0),
            'unit': float(row[idx['Unit Amount']] or 0),
            'item_created': row[idx['Item Created Date']].strip(),
        })

# Find Lane Reservation Charge and Pair & Spare Charge with Item Created Date = 2026-02-07
lane_feb7 = []
pair_feb7 = []
account_deposits_feb7 = []  # Account with positive total = deposit booked
account_applied_feb7 = []   # Account with negative total = deposit applied

for txn_id, items in txns.items():
    for it in items:
        if it['item_created'] != '2026-02-07':
            continue
        if it['name'] == 'Lane Reservation Charge':
            lane_feb7.append((txn_id, it))
        elif it['name'] == 'Pair & Spare Charge':
            pair_feb7.append((txn_id, it))
        elif it['itype'] == 'Account':
            if it['total'] > 0:
                account_deposits_feb7.append((txn_id, it))
            else:
                account_applied_feb7.append((txn_id, it))

print("=== Feb 7, 2026 (Item Created Date) ===\n")
print("LANE RESERVATION CHARGE (redemption - guest showed up):")
print(f"  Count: {len(lane_feb7)}")
lane_total = sum(i['total'] if i['total'] != 0 else (i['unit']*i['qty'] if i['qty'] else i['unit']) for _, i in lane_feb7)
print(f"  Total: ${lane_total:,.2f}")
print()

print("PAIR & SPARE CHARGE (redemption):")
print(f"  Count: {len(pair_feb7)}")
pair_total = sum(i['total'] if i['total'] != 0 else (i['unit']*i['qty'] if i['qty'] else i['unit']) for _, i in pair_feb7)
print(f"  Total: ${pair_total:,.2f}")
print()

print("ACCOUNT - Deposits BOOKED on Feb 7 (positive, customer paid deposit for future event):")
print(f"  Count: {len(account_deposits_feb7)}")
dep_total = sum(i['total'] for _, i in account_deposits_feb7)
print(f"  Total: ${dep_total:,.2f}")
for txn_id, i in account_deposits_feb7[:5]:
    print(f"    {i['name']}: ${i['total']:,.2f}")
if len(account_deposits_feb7) > 5:
    print(f"    ... and {len(account_deposits_feb7)-5} more")
print()

print("ACCOUNT - Deposits APPLIED on Feb 7 (negative, guest showed up, deposit offset):")
print(f"  Count: {len(account_applied_feb7)}")
app_total = sum(i['total'] for _, i in account_applied_feb7)
print(f"  Total: ${app_total:,.2f}")
for txn_id, i in account_applied_feb7[:5]:
    print(f"    {i['name']}: ${i['total']:,.2f}")
if len(account_applied_feb7) > 5:
    print(f"    ... and {len(account_applied_feb7)-5} more")
print()

print("=== WHAT WE COUNT (Product/Modifier/Package only) ===")
print(f"  Lane Reservation Charge: ${lane_total:,.2f} ({len(lane_feb7)} items) - REDEMPTION")
print(f"  Pair & Spare Charge: ${pair_total:,.2f} ({len(pair_feb7)} items) - REDEMPTION")
print(f"  Account deposits booked: EXCLUDED (not Product)")
print(f"  Account deposits applied: EXCLUDED (not Product)")
print()
print("POS report (from user's image): Lane $6,393 / 27, Pair & Spare $4,290 / 10 sold")
print("Our Lane total should match POS if we use same date. Pair: we have", len(pair_feb7), "vs POS 10 sold")
