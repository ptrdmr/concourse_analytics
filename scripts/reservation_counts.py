#!/usr/bin/env python3
"""
Count realized party/reservation bookings per type, per day, from ticket JSON.

One Sales tab that rings a party/suite/lane product = one booking of that type.
Cancel/refund tickets, food names (Kingpin Fries), tests, deposit Payments, and
$0 front-desk time-clocking tabs are not bookings.

Suite packages are often named with "Time" (e.g. Kingpin - 8 Lane Suite - Time)
and sometimes ring at $0 on the event check while catering/food holds the money.
Those still count. A tab with only $0 VIP-lane SKUs and a $0 total does not.

If a tab has General Lane Reservation (Lane Reservation Charge) AND any named
program, General Lane is dropped — it only counts walk-in / standard-rate tabs.

Usage:
  python scripts/reservation_counts.py
  python scripts/reservation_counts.py --start 2026-06-14 --end 2026-09-14
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(_ROOT, 'public', 'data')
TICKETS_DIR = os.path.join(OUTPUT_DIR, 'tickets')
OUTPUT_PATH = os.path.join(OUTPUT_DIR, 'reservation_counts.json')

GENERAL_LANE = 'General Lane Reservation'

# (display name, lowercase substrings, is named program)
RESERVATION_TYPES = [
    ('Weekday Lane', ('weekday lane',), True),
    ('Sunday Lane', ('sunday lane',), True),
    ('Summer Special', ('summer special',), True),
    ('Thursday Special', ('thursday special',), True),
    ('Pair & Spare', ('pair & spare',), True),
    ('Party Builder', ('party builder',), True),
    (
        'Adult Party',
        (
            'adult party weekday',
            'adult party weekend',
            'adult weekday -',
            'adult weekend -',
            'adult weekday add',
            'adult weekend add',
        ),
        True,
    ),
    ('Supercharge', ('supercharge',), True),
    ('Strike Zone Suite', ('strike zone',), True),
    # 'kingpin -' / 'kingpin vip' — never bare 'kingpin' (matches Kingpin Fries)
    ('Kingpin Suite', ('kingpin -', 'kingpin vip'), True),
    ('Powerhouse Suite', ('powerhouse',), True),
    ('Jr. Strikers', ('jr. strikers', 'jr strikers'), True),
    ('Sports Party', ('sports party',), True),
    ('Half House', ('half house',), True),
    ('Full Facility', ('full facility', 'full house'), True),
    ('NYE Reservation', ('nye reservation',), True),
    (GENERAL_LANE, ('lane reservation charge',), False),
]

TYPE_NAMES = [t[0] for t in RESERVATION_TYPES]
NAMED_PROGRAMS = {name for name, _, named in RESERVATION_TYPES if named}
COUNTABLE_TXN_TYPES = {'Sales'}


def _is_catering_item(name: str) -> bool:
    low = name.lower().strip()
    return low.startswith('ctr -') or low.startswith('catering -')


def _item_amount(item) -> float:
    try:
        unit = abs(float(item.get('unitAmount') or 0))
    except (TypeError, ValueError):
        unit = 0.0
    try:
        total = abs(float(item.get('total') or 0))
    except (TypeError, ValueError):
        total = 0.0
    return max(unit, total)


def _is_noise_item(name: str, item: dict, low: str) -> bool:
    """Food, tests, deposits, and add-ons are not a booking line."""
    if _is_catering_item(name):
        return True
    if 'test' in low:
        return True
    if 'add bowler' in low:
        return True
    if 'payment' in low:
        return True
    dept = (item.get('dept') or '').lower()
    sub = (item.get('subdept') or '').lower()
    if dept == 'food' or sub.startswith('food'):
        return True
    if 'fries' in low or low.endswith(' cup'):
        return True
    return False


def _tab_is_realized(ticket: dict, items) -> bool:
    """True when the tab has money, or a reservation line with a real price.

    Front-desk clocking (Kingpin VIP 8 Lane x8, Supercharge time) is $0/$0.
    Event checks can have a $0 suite SKU with catering on the same tab.
    Prepaid suites can have a $699+ line with tab total $0 after the deposit.
    """
    try:
        if abs(float(ticket.get('total') or 0)) >= 1:
            return True
    except (TypeError, ValueError):
        pass
    for item in items or []:
        name = (item.get('name') or '').strip()
        if not name:
            continue
        low = name.lower()
        if _is_noise_item(name, item, low):
            continue
        if _item_amount(item) >= 1:
            return True
    return False


def classify_tab(items) -> set[str]:
    """Return the reservation types present on one tab after General Lane de-dupe."""
    found: set[str] = set()
    for item in items or []:
        name = (item.get('name') or '').strip()
        if not name:
            continue
        low = name.lower()
        if _is_noise_item(name, item, low):
            continue
        amount = _item_amount(item)
        for type_name, needles, _named in RESERVATION_TYPES:
            if not any(n in low for n in needles):
                continue
            # Extra-person Add is $33/$39; the adult party package is rung on
            # the same SKU at $495/$780+. Do not count the per-person add-on.
            if type_name == 'Adult Party' and 'add' in low and amount < 100:
                continue
            found.add(type_name)
    if GENERAL_LANE in found and (found & NAMED_PROGRAMS):
        found.discard(GENERAL_LANE)
    return found


def week_start_monday(iso: str) -> str:
    d = date.fromisoformat(iso[:10])
    return (d - timedelta(days=d.weekday())).isoformat()


def _atomic_write_json(path, obj, *, indent=2):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, indent=indent)
        f.write('\n')
    os.replace(tmp, path)


def load_tickets_by_month(tickets_dir: str | None = None) -> dict[str, list]:
    directory = tickets_dir or TICKETS_DIR
    by_month: dict[str, list] = {}
    for path in glob.glob(os.path.join(directory, '*.json')):
        name = os.path.basename(path)
        if name == 'months.json':
            continue
        with open(path, encoding='utf-8') as f:
            by_month[name[:-5]] = json.load(f)
    return by_month


def aggregate_reservation_counts(by_month: dict[str, list]):
    """Walk tickets and return daily type counts plus distinct-tab totals."""
    daily_types: dict[tuple[str, str], int] = defaultdict(int)
    daily_tabs: dict[str, int] = defaultdict(int)
    distinct_tabs = 0

    for _ym, tickets in by_month.items():
        for ticket in tickets or []:
            if (ticket.get('type') or 'Sales') not in COUNTABLE_TXN_TYPES:
                continue
            day = (ticket.get('date') or '')[:10]
            if len(day) < 10:
                continue
            items = ticket.get('items')
            if not _tab_is_realized(ticket, items):
                continue
            types = classify_tab(items)
            if not types:
                continue
            distinct_tabs += 1
            daily_tabs[day] += 1
            for t in types:
                daily_types[(day, t)] += 1

    rows = [
        {'date': day, 'type': type_name, 'count': count}
        for (day, type_name), count in daily_types.items()
    ]
    rows.sort(key=lambda r: (r['date'], TYPE_NAMES.index(r['type']) if r['type'] in TYPE_NAMES else r['type']))

    tab_rows = [{'date': day, 'tabs': n} for day, n in daily_tabs.items()]
    tab_rows.sort(key=lambda r: r['date'])

    dates = sorted(daily_tabs)
    date_range = [dates[0], dates[-1]] if dates else [None, None]
    cell_sum = sum(r['count'] for r in rows)

    return {
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
        'dateRange': date_range,
        'types': TYPE_NAMES,
        'rows': rows,
        'dailyTabs': tab_rows,
        'validation': {
            'distinctTabs': distinct_tabs,
            'cellSum': cell_sum,
            'delta': cell_sum - distinct_tabs,
        },
    }


def export_reservation_counts(by_month: dict[str, list], output_path: str | None = None):
    payload = aggregate_reservation_counts(by_month)
    path = output_path or OUTPUT_PATH
    _atomic_write_json(path, payload)
    size_kb = os.path.getsize(path) / 1024
    v = payload['validation']
    print(
        f'  -> {path}  ({len(payload["rows"]):,} rows, {v["distinctTabs"]:,} tabs, '
        f'cellSum={v["cellSum"]:,} delta={v["delta"]}, {size_kb:.0f} KB)'
    )
    return payload


def _in_window(iso: str, start: str | None, end: str | None) -> bool:
    if start and iso < start:
        return False
    if end and iso > end:
        return False
    return True


def print_weekly_matrix(payload: dict, start: str | None, end: str | None) -> None:
    types = payload.get('types') or TYPE_NAMES
    week_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    tabs_by_week: dict[str, int] = defaultdict(int)
    window_tabs = 0
    window_cells = 0

    for row in payload.get('rows') or []:
        day = row['date']
        if not _in_window(day, start, end):
            continue
        week = week_start_monday(day)
        week_counts[week][row['type']] += int(row['count'] or 0)
        window_cells += int(row['count'] or 0)

    for row in payload.get('dailyTabs') or []:
        day = row['date']
        if not _in_window(day, start, end):
            continue
        week = week_start_monday(day)
        tabs_by_week[week] += int(row['tabs'] or 0)
        window_tabs += int(row['tabs'] or 0)

    weeks = sorted(set(week_counts) | set(tabs_by_week))
    if not weeks:
        print(f'No reservation tabs in {start or "*"} .. {end or "*"}')
        return

    col_w = 12
    header = f'{"Type":<28}' + ''.join(f'{w[5:]:>{col_w}}' for w in weeks) + f'{"Total":>{col_w}}'
    print(header)
    print('-' * len(header))

    for type_name in types:
        total = 0
        line = f'{type_name:<28}'
        for week in weeks:
            n = week_counts[week].get(type_name, 0)
            total += n
            line += f'{n:>{col_w},}' if n else f'{"":>{col_w}}'
        line += f'{total:>{col_w},}'
        if total:
            print(line)

    print('-' * len(header))
    cell_line = f'{"Cell sum":<28}'
    tab_line = f'{"Distinct tabs":<28}'
    cell_total = 0
    tab_total = 0
    for week in weeks:
        cell = sum(week_counts[week].values())
        tabs = tabs_by_week.get(week, 0)
        cell_total += cell
        tab_total += tabs
        cell_line += f'{cell:>{col_w},}'
        tab_line += f'{tabs:>{col_w},}'
    cell_line += f'{cell_total:>{col_w},}'
    tab_line += f'{tab_total:>{col_w},}'
    print(cell_line)
    print(tab_line)
    print()
    print(f'Window: {start or payload["dateRange"][0]} .. {end or payload["dateRange"][1]}')
    print(f'Distinct party tabs: {window_tabs:,}')
    print(f'Sum of type cells:   {window_cells:,}')
    print(f'Delta (multi-type):  {window_cells - window_tabs:,}')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Export reservation booking counts from ticket JSON.')
    parser.add_argument('--start', help='Inclusive start date (YYYY-MM-DD) for the printed matrix')
    parser.add_argument('--end', help='Inclusive end date (YYYY-MM-DD) for the printed matrix')
    parser.add_argument('--tickets-dir', help='Override tickets directory')
    parser.add_argument('--output', help='Override JSON output path')
    args = parser.parse_args(argv)

    by_month = load_tickets_by_month(args.tickets_dir)
    if not by_month:
        print('ERROR: No ticket month files found', file=sys.stderr)
        return 1

    print(f'Ticket months: {", ".join(sorted(by_month))}')
    payload = export_reservation_counts(by_month, args.output)
    print_weekly_matrix(payload, args.start, args.end)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
