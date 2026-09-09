#!/usr/bin/env python3
"""
pull_journal.py

Read-only pull from SyncJournal.dbo.TRNJournalLogs and write Office-compatible
semicolon CSVs filtered by TransactionFiscalDate (business/fiscal year).

Modes:
  --bulk              Export all years from START_DATE through current year
  --nightly           Re-export current fiscal year (+ prior year in January)
  --year YYYY         Export a single fiscal year

Examples:
  python scripts/pull_journal.py --bulk
  python scripts/pull_journal.py --nightly
  python scripts/pull_journal.py --year 2026
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, 'scripts'))

from dotenv import load_dotenv
load_dotenv(os.path.join(_ROOT, '.env'))

from db import connect  # noqa: E402

DATA_DIR = os.path.join(_ROOT, os.getenv('DATA_DIR', 'data'))
ENUM_PATH = os.path.join(_ROOT, 'config', 'enum_map.json')

CSV_HEADER = [
    'Transaction ID', 'Item ID', 'Transaction Created Date', 'Transaction Created Time',
    'Transaction Closed Date', 'Transaction Closed Time', 'Transaction Ended Date',
    'Transaction Ended Time', 'Transaction Fiscal', 'Transaction Terminal',
    'Transaction User', 'Transaction Shift Number', 'Transaction Total',
    'Transaction Type', 'Name', 'Item Type', 'Item Created Date', 'Item Created Time',
    'Item Terminal', 'Item User', 'Quantity', 'Unit Amount', 'Total', 'Deleted',
    'Voided', 'Item Ended Date', 'Item Ended Time', 'Item Shift Number', 'Department',
    'Subdepartment', 'Tax Included', 'Tax Exempt', 'Sold in Package', 'Sold By', 'Rate',
]

SELECT_SQL = """
SELECT
    TransactionID,
    ID,
    TransactionDateCreated,
    TransactionDateClosed,
    TransactionShiftEndDate,
    TransactionFiscalDate,
    TransactionTerminal,
    TransactionUser,
    TransactionShiftEndNumber,
    TransactionTotal,
    TransactionType,
    Name,
    ItemType,
    ItemDateCreated,
    ItemTerminal,
    ItemUser,
    Quantity,
    UnitAmount,
    Total,
    IsDeleted,
    IsVoided,
    ShiftEndDate,
    ShiftEndNumber,
    Department,
    SubDepartment,
    IsTaxIncluded,
    IsTaxExempt,
    IsSoldInPackage,
    SoldByType,
    AvailabilityMapName,
    AvailabilityLevelName
FROM dbo.TRNJournalLogs WITH (NOLOCK)
WHERE TransactionFiscalDate >= ? AND TransactionFiscalDate < ?
ORDER BY ID
"""


def load_enum_map() -> dict[str, dict[str, str]]:
    with open(ENUM_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return {
        'item_type': {str(k): v for k, v in data['item_type'].items()},
        'transaction_type': {str(k): v for k, v in data['transaction_type'].items()},
        'sold_by_type': {str(k): v for k, v in data.get('sold_by_type', {}).items()},
    }


def map_enum(maps: dict[str, dict[str, str]], kind: str, code: Any) -> str:
    if code is None:
        return ''
    key = str(int(code))
    label = maps[kind].get(key)
    if label is None:
        raise RuntimeError(f'Unmapped {kind} code: {key}. Update config/enum_map.json.')
    return label


def fmt_date(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d')
    if isinstance(value, date):
        return value.strftime('%Y-%m-%d')
    return str(value)


def fmt_time(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, datetime):
        return value.strftime('%H:%M:%S')
    return ''


def fmt_money(value: Any) -> str:
    if value is None:
        return ''
    dec = Decimal(str(value)).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)
    if dec == 0:
        # Preserve explicit zero totals like 0.0000
        return '0.0000'
    return format(dec, 'f')


def fmt_qty(value: Any) -> str:
    if value is None:
        return ''
    dec = Decimal(str(value))
    if dec == 0:
        return '0.0000'
    return format(dec.quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP), 'f')


def fmt_bool(value: Any) -> str:
    return 'True' if bool(value) else 'False'


def fmt_name(name: Any) -> str:
    """Office prints EmptyTransaction when Name is blank (any transaction type)."""
    text = (name or '').strip()
    return text if text else 'EmptyTransaction'


def fmt_rate(map_name: Any, level_name: Any) -> str:
    """
    Office Rate column is 'Map - Level' when both are present.

    Values are concatenated verbatim: a rate map stored as 'NYE ' renders as
    'NYE  - nye', so padding must not be stripped.
    """
    map_s = map_name or ''
    level_s = level_name or ''
    if map_s.strip() and level_s.strip():
        return f'{map_s} - {level_s}'
    return level_s if level_s.strip() else map_s


def fmt_sold_by(sold_by_type: Any, item_type_label: str) -> str:
    """
    Office Sold By labels (verified against comparison_data/2026.csv):
      SoldByType 1 -> Time
      SoldByType 0 + Product -> Unit
      otherwise -> blank
    """
    if sold_by_type is None:
        return ''
    code = int(sold_by_type)
    if code == 1:
        return 'Time'
    if code == 0 and item_type_label == 'Product':
        return 'Unit'
    return ''


def fmt_office_bool(value: Any, item_type_label: str, *, product_only: bool = False) -> str:
    """Office omits False/True for many non-product line types."""
    if product_only:
        allowed = ('Product',)
    else:
        allowed = ('Product', 'Modifier', 'Adjustment')
    if item_type_label not in allowed:
        return ''
    return fmt_bool(value)


def row_to_csv(maps: dict[str, dict[str, str]], row: tuple) -> list[str]:
    (
        transaction_id, item_id,
        txn_created, txn_closed, txn_ended, fiscal_date,
        txn_terminal, txn_user, txn_shift_no, txn_total,
        txn_type, name, item_type,
        item_created, item_terminal, item_user,
        quantity, unit_amount, total,
        is_deleted, is_voided,
        item_ended, item_shift_no,
        department, subdepartment,
        tax_included, tax_exempt, sold_in_package,
        sold_by_type, rate_map_name, rate_level_name,
    ) = row

    txn_type_label = map_enum(maps, 'transaction_type', txn_type)
    item_type_label = map_enum(maps, 'item_type', item_type)
    is_payment = item_type_label.startswith('Payment')
    is_empty_item = item_type_label == ''

    qty_s = ''
    unit_s = ''
    if item_type_label in ('Product', 'Modifier', 'Package'):
        if quantity is not None:
            qty_s = fmt_qty(quantity)
        if unit_amount is not None:
            unit_s = fmt_money(unit_amount)

    # Office leaves Total blank on empty-item placeholder rows (ItemType 0).
    if is_empty_item:
        total_s = ''
    else:
        total_s = fmt_money(total) if total is not None else ''

    # Item-level timestamps / terminals blank on empty-item rows.
    if is_empty_item:
        item_created_date = item_created_time = item_terminal_s = item_user_s = ''
    else:
        item_created_date = fmt_date(item_created)
        item_created_time = fmt_time(item_created)
        item_terminal_s = (item_terminal or '').strip()
        item_user_s = (item_user or '').strip()

    # Item ended / shift: Office only fills these for payment lines.
    if is_payment:
        item_ended_date = fmt_date(item_ended)
        item_ended_time = fmt_time(item_ended)
        item_shift_s = '' if item_shift_no is None else str(int(item_shift_no))
    else:
        item_ended_date = item_ended_time = item_shift_s = ''

    # Subdepartment only on Product / Modifier / Adjustment in Office exports.
    if item_type_label in ('Product', 'Modifier', 'Adjustment'):
        subdepartment_s = (subdepartment or '').strip()
    else:
        subdepartment_s = ''

    return [
        str(transaction_id),
        str(item_id),
        fmt_date(txn_created), fmt_time(txn_created),
        fmt_date(txn_closed), fmt_time(txn_closed),
        fmt_date(txn_ended), fmt_time(txn_ended),
        fmt_date(fiscal_date),
        (txn_terminal or '').strip(),
        (txn_user or '').strip(),
        '' if txn_shift_no is None else str(int(txn_shift_no)),
        fmt_money(txn_total) if txn_total is not None else '',
        txn_type_label,
        fmt_name(name),
        item_type_label,
        item_created_date, item_created_time,
        item_terminal_s,
        item_user_s,
        qty_s,
        unit_s,
        total_s,
        '' if is_empty_item else fmt_bool(is_deleted),
        '' if is_empty_item else fmt_bool(is_voided),
        item_ended_date, item_ended_time,
        item_shift_s,
        # Office blanks Department on empty-item and BankDrop lines.
        '' if is_empty_item or item_type_label == 'BankDrop' else (department or '').strip(),
        subdepartment_s,
        fmt_office_bool(tax_included, item_type_label),
        fmt_office_bool(tax_exempt, item_type_label),
        fmt_office_bool(sold_in_package, item_type_label, product_only=True),
        fmt_sold_by(sold_by_type, item_type_label),
        fmt_rate(rate_map_name, rate_level_name),
        '',  # trailing empty column after final semicolon
    ]


def fiscal_year_bounds(year: int) -> tuple[datetime, datetime]:
    start = datetime(year, 1, 1)
    end = datetime(year + 1, 1, 1)
    return start, end


def years_to_export(mode: str, start_date: str, explicit_year: int | None) -> list[int]:
    today = date.today()
    if explicit_year:
        return [explicit_year]
    start_year = int(start_date[:4])
    current_year = today.year
    if mode == 'bulk':
        return list(range(start_year, current_year + 1))
    if mode == 'nightly':
        years = [current_year]
        if today.month == 1:
            years.insert(0, current_year - 1)
        return years
    raise ValueError(f'Unknown mode: {mode}')


def export_year(year: int, maps: dict[str, dict[str, str]]) -> str:
    """
    Write one fiscal year to CSV.

    Writes to a temp file and renames on success, so an interrupted pull can
    never leave a truncated year in place for the ETL to read as complete.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    out_path = os.path.join(DATA_DIR, f'{year}.csv')
    tmp_path = f'{out_path}.partial'
    start, end = fiscal_year_bounds(year)

    row_count = 0
    try:
        with connect() as conn:
            cur = conn.cursor()
            cur.execute(SELECT_SQL, (start, end))
            with open(tmp_path, 'w', encoding='utf-8', newline='') as f:
                writer = csv.writer(f, delimiter=';', lineterminator='\n')
                writer.writerow(CSV_HEADER)
                while True:
                    batch = cur.fetchmany(5000)
                    if not batch:
                        break
                    for row in batch:
                        writer.writerow(row_to_csv(maps, row))
                        row_count += 1
        os.replace(tmp_path, out_path)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

    print(f'  Wrote {out_path} ({row_count:,} rows)')
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description='Pull Sync Journal Log to Office-compatible CSV')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--bulk', action='store_true', help='Export all years from START_DATE')
    group.add_argument('--nightly', action='store_true', help='Export current year (+ prior in January)')
    group.add_argument('--year', type=int, help='Export a single fiscal year')
    args = parser.parse_args()

    start_date = os.getenv('START_DATE', '2023-01-01')
    maps = load_enum_map()

    if args.year:
        years = years_to_export('single', start_date, args.year)
    elif args.bulk:
        years = years_to_export('bulk', start_date, None)
    else:
        years = years_to_export('nightly', start_date, None)

    print(f'Exporting fiscal years: {years}')
    for year in years:
        export_year(year, maps)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
