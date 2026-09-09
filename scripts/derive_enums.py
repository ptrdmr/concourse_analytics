#!/usr/bin/env python3
"""
derive_enums.py

Re-verify enum mappings by joining DB rows to a reference Office CSV on
(Transaction ID, Item ID). Writes config/enum_map.json.

Usage:
  python scripts/derive_enums.py --reference-csv data/2026.csv
  python scripts/derive_enums.py --reference-csv path/to/manual_export.csv --sample-month 2026-01
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, 'scripts'))

from db import connect  # noqa: E402

ENUM_OUT = os.path.join(_ROOT, 'config', 'enum_map.json')

REQUIRED_ITEM_LABELS = {
    'Product', 'Modifier', 'Package', 'Adjustment',
    'PaymentCash', 'PaymentCredit', 'Tax', 'Account',
}
REQUIRED_TXN_LABELS = {'Sales', 'Refund', 'NoSale', 'Cancel'}


def load_reference_pairs(path: str) -> dict[tuple[str, str], dict[str, str]]:
    pairs: dict[tuple[str, str], dict[str, str]] = {}
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)
        idx = {name: i for i, name in enumerate(header)}
        for row in reader:
            if len(row) < len(header):
                continue
            key = (row[idx['Transaction ID']].strip(), row[idx['Item ID']].strip())
            pairs[key] = {
                'item_type': row[idx['Item Type']].strip(),
                'transaction_type': row[idx['Transaction Type']].strip(),
                'sold_by': row[idx.get('Sold By', -1)].strip() if 'Sold By' in idx else '',
            }
    return pairs


def query_db_keys(keys: list[tuple[str, str]], sample_month: str | None) -> list[tuple]:
    if not keys:
        return []
    # Batch IN lookups — sample month optional filter for speed
    clauses = []
    params: list = []
    for txn_id, item_id in keys:
        clauses.append('(TransactionID = ? AND ID = ?)')
        params.extend([int(txn_id), int(item_id)])

    month_filter = ''
    if sample_month:
        month_filter = (
            " AND ItemDateCreated >= ? AND ItemDateCreated < DATEADD(month, 1, ?)"
        )
        params.extend([f'{sample_month}-01', f'{sample_month}-01'])

    sql = f"""
        SELECT TransactionID, ID, ItemType, TransactionType, SoldByType
        FROM dbo.TRNJournalLogs WITH (NOLOCK)
        WHERE ({' OR '.join(clauses)}){month_filter}
    """
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        return cur.fetchall()


def derive_from_reference(reference_csv: str, sample_month: str | None) -> dict:
    ref = load_reference_pairs(reference_csv)
    keys = list(ref.keys())
    # Limit batch size for very large CSVs — sample diverse keys
    if len(keys) > 5000:
        keys = keys[:5000]

    item_map: dict[str, str] = {}
    txn_map: dict[str, str] = {}
    sold_map: dict[str, str] = {}
    unresolved: list[str] = []

    rows = query_db_keys(keys, sample_month)
    db_by_key = {(str(r[0]), str(r[1])): r for r in rows}

    for key, labels in ref.items():
        row = db_by_key.get(key)
        if not row:
            continue
        _, _, item_code, txn_code, sold_code = row
        ic, tc, sc = str(int(item_code)), str(int(txn_code)), str(int(sold_code))
        il, tl, sl = labels['item_type'], labels['transaction_type'], labels['sold_by']

        for code, label, mapping in (
            (ic, il, item_map),
            (tc, tl, txn_map),
            (sc, sl, sold_map),
        ):
            if not label and code == '0':
                mapping.setdefault('0', '')
                continue
            if code in mapping and mapping[code] != label:
                unresolved.append(f'conflict code {code}: {mapping[code]} vs {label}')
            else:
                mapping[code] = label

    # Also scan distinct codes in DB for one month (catch codes missing from reference)
    month = sample_month or '2026-01'
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT DISTINCT ItemType, TransactionType, SoldByType
            FROM dbo.TRNJournalLogs WITH (NOLOCK)
            WHERE ItemDateCreated >= ? AND ItemDateCreated < DATEADD(month, 1, ?)
            """,
            (f'{month}-01', f'{month}-01'),
        )
        for item_code, txn_code, sold_code in cur.fetchall():
            ic, tc, sc = str(int(item_code)), str(int(txn_code)), str(int(sold_code))
            for code, mapping in ((ic, item_map), (tc, txn_map), (sc, sold_map)):
                mapping.setdefault(code, '')

    found_item = set(item_map.values())
    found_txn = set(txn_map.values())
    missing_item = REQUIRED_ITEM_LABELS - found_item
    missing_txn = REQUIRED_TXN_LABELS - found_txn

    result = {
        'item_type': dict(sorted(item_map.items(), key=lambda x: int(x[0]))),
        'transaction_type': dict(sorted(txn_map.items(), key=lambda x: int(x[0]))),
        'sold_by_type': dict(sorted(sold_map.items(), key=lambda x: int(x[0]))),
        'verified': 'derive_enums.py',
        'reference_csv': os.path.basename(reference_csv),
        'unresolved_conflicts': unresolved,
        'missing_item_labels': sorted(missing_item),
        'missing_transaction_labels': sorted(missing_txn),
    }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description='Derive enum_map.json from DB + reference CSV')
    parser.add_argument('--reference-csv', required=True, help='Manual Office export CSV')
    parser.add_argument('--sample-month', default=None, help='YYYY-MM filter for DB lookups')
    parser.add_argument('--write', action='store_true', help='Write config/enum_map.json')
    args = parser.parse_args()

    if not os.path.isfile(args.reference_csv):
        print(f'Reference CSV not found: {args.reference_csv}', file=sys.stderr)
        return 1

    result = derive_from_reference(args.reference_csv, args.sample_month)
    print(json.dumps(result, indent=2))

    if result['unresolved_conflicts']:
        print('\nWARNING: unresolved conflicts detected.', file=sys.stderr)
    if result['missing_item_labels'] or result['missing_transaction_labels']:
        print('\nWARNING: some required labels were not found in the mapping.', file=sys.stderr)

    if args.write:
        with open(ENUM_OUT, 'w', encoding='utf-8') as f:
            json.dump(
                {k: result[k] for k in ('item_type', 'transaction_type', 'sold_by_type', 'verified', 'notes')
                 if k in result or k == 'notes'},
                f,
                indent=2,
            )
            # add notes field
        # rewrite cleanly
        out = {
            'item_type': result['item_type'],
            'transaction_type': result['transaction_type'],
            'sold_by_type': result['sold_by_type'],
            'verified': result.get('verified', ''),
            'notes': f"Derived from {result.get('reference_csv', '')}",
        }
        with open(ENUM_OUT, 'w', encoding='utf-8') as f:
            json.dump(out, f, indent=2)
        print(f'Wrote {ENUM_OUT}')

    return 0 if not result['unresolved_conflicts'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
