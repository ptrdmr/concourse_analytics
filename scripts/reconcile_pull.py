#!/usr/bin/env python3
"""
reconcile_pull.py

Compare a DB-pulled CSV against a manual Office export for the same fiscal year.
Uses (Transaction ID, Item ID) as the primary key and reports field mismatches.

Usage:
  python scripts/reconcile_pull.py --pulled data/2026.csv --reference path/to/manual_2026.csv
  python scripts/reconcile_pull.py --pulled data/2026.csv --reference manual.csv --max-report 20
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import Counter

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_rows(path: str) -> tuple[list[str], dict[tuple[str, str], list[str]]]:
    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        # Office exports often include a trailing empty column from a final ';'.
        header = [c for c in next(reader) if c != '']
        rows: dict[tuple[str, str], list[str]] = {}
        dupes = 0
        for row in reader:
            if len(row) < 2:
                continue
            # Normalize width to header (drop trailing empties / pad).
            row = (row + [''] * len(header))[: len(header)]
            key = (row[0].strip(), row[1].strip())
            if key in rows:
                dupes += 1
            rows[key] = row
    return header, rows


def normalize_cell(value: str) -> str:
    return (value or '').strip()


def compare_rows(header: list[str], a: list[str], b: list[str]) -> list[tuple[str, str, str]]:
    mismatches = []
    width = min(len(header), len(a), len(b))
    for i in range(width):
        av = normalize_cell(a[i] if i < len(a) else '')
        bv = normalize_cell(b[i] if i < len(b) else '')
        if av != bv:
            mismatches.append((header[i], av, bv))
    return mismatches


def main() -> int:
    parser = argparse.ArgumentParser(description='Reconcile DB pull vs manual Office export')
    parser.add_argument('--pulled', required=True, help='CSV from pull_journal.py')
    parser.add_argument('--reference', required=True, help='Manual Office export CSV')
    parser.add_argument('--max-report', type=int, default=20, help='Max mismatch keys to print')
    args = parser.parse_args()

    for label, path in (('pulled', args.pulled), ('reference', args.reference)):
        if not os.path.isfile(path):
            print(f'{label} file not found: {path}', file=sys.stderr)
            return 1

    pulled_header, pulled = load_rows(args.pulled)
    ref_header, reference = load_rows(args.reference)

    if pulled_header != ref_header:
        print('WARNING: CSV headers differ between pulled and reference files.')

    pulled_keys = set(pulled)
    ref_keys = set(reference)
    only_pulled = pulled_keys - ref_keys
    only_ref = ref_keys - pulled_keys
    common = pulled_keys & ref_keys

    field_mismatches: list[tuple[tuple[str, str], list]] = []
    mismatch_fields = Counter()

    for key in common:
        diffs = compare_rows(pulled_header, pulled[key], reference[key])
        if diffs:
            field_mismatches.append((key, diffs))
            for field, _, _ in diffs:
                mismatch_fields[field] += 1

    print('=== Reconcile summary ===')
    print(f'Pulled rows:     {len(pulled):,}')
    print(f'Reference rows:  {len(reference):,}')
    print(f'In both:         {len(common):,}')
    print(f'Only in pulled:  {len(only_pulled):,}')
    print(f'Only in reference: {len(only_ref):,}')
    print(f'Rows with field mismatches: {len(field_mismatches):,}')

    if field_mismatches:
        print('\nTop mismatched fields:')
        for field, count in mismatch_fields.most_common(10):
            print(f'  {field}: {count:,}')

    if only_pulled:
        print(f'\nSample keys only in pulled (up to {args.max_report}):')
        for key in list(sorted(only_pulled))[: args.max_report]:
            print(f'  {key[0]} / {key[1]}')

    if only_ref:
        print(f'\nSample keys only in reference (up to {args.max_report}):')
        for key in list(sorted(only_ref))[: args.max_report]:
            print(f'  {key[0]} / {key[1]}')

    if field_mismatches:
        print(f'\nSample field mismatches (up to {args.max_report}):')
        for key, diffs in field_mismatches[: args.max_report]:
            print(f'  {key[0]} / {key[1]}:')
            for field, av, bv in diffs[:8]:
                print(f'    {field}: pulled={av!r} reference={bv!r}')

    ok = not only_pulled and not only_ref and not field_mismatches
    if ok:
        print('\nPASS: pulled CSV matches reference for all keys and fields.')
        return 0

    print('\nFAIL: differences found. Do not enable automation until reconciled.')
    return 2


if __name__ == '__main__':
    raise SystemExit(main())
