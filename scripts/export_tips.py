#!/usr/bin/env python3
"""
Collect the facts the tip worksheet calculates from. No tip math lives here.

Writes public/data/tips/YYYY-MM.json:
  tabs with tips or a service charge, punches, reservation windows, the
  employee directory, and a copy of config/tip_pools.json.

Party tabs are tabs with a service charge. A bare Account line is usually an
open-bowling or house-account tab (hundreds a week), not a party.

Usage:
  py -3 scripts/export_tips.py
  py -3 scripts/export_tips.py --from-tickets
"""

from __future__ import annotations

import csv
import glob
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, date
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_ROOT, 'data')
OUTPUT_DIR = os.path.join(_ROOT, 'public', 'data')
TIPS_DIR = os.path.join(OUTPUT_DIR, 'tips')
RULES_PATH = os.path.join(_ROOT, 'config', 'tip_pools.json')
SERVICE_CHARGES_CONFIG = os.path.join(_ROOT, 'config', 'service_charges.json')
EMPLOYEES_PATH = os.path.join(OUTPUT_DIR, 'employees.json')
PUNCHES_PATH = os.path.join(OUTPUT_DIR, 'punches.json')
SNAPSHOT_PATH = os.path.join(OUTPUT_DIR, 'booking_snapshot.json')
SKIP_FILES = frozenset({'food_purchases.csv'})
TZ = ZoneInfo('America/Los_Angeles')

_PARTY_NAME_LEADING_DATE = re.compile(r'^\d{1,2}/\d{1,2}/\d{4}\s+')
_PARTY_NAME_TRAILING_DATE = re.compile(r'\s+\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$')
_BAR_ITEM_TYPES = frozenset({'Product', 'Modifier', 'Package'})
_WINDOW_ITEM_TYPES = frozenset({'Product', 'Modifier', 'Package'})


def load_tip_rules(path: str | None = None) -> dict:
    """The whole config file, including the pay period, is published as rules."""
    with open(path or RULES_PATH, encoding='utf-8') as handle:
        rules = json.load(handle)
    if not isinstance(rules.get('pools'), dict):
        raise RuntimeError(f'{path or RULES_PATH} is missing pools')
    return rules


def crew_tag_label(name: str, rules: dict | None = None) -> str | None:
    """Return the person's name from a 'Server - Name' product, else None."""
    rules = rules or load_tip_rules()
    pattern = rules.get('tagPattern') or r'^Server\s*-\s+(.+)$'
    match = re.match(pattern, (name or '').strip())
    if not match:
        return None
    label = ' '.join(match.group(1).split())
    return label or None


def is_crew_tag(name: str, rules: dict | None = None) -> bool:
    return crew_tag_label(name, rules) is not None


def business_day(date_str: str, time_str: str, cutoff: int = 4) -> str:
    """Activity before `cutoff` belongs to the previous business day."""
    if not time_str or not date_str or len(date_str) < 10:
        return date_str
    try:
        hour = int(str(time_str).split(':')[0])
    except (ValueError, IndexError):
        return date_str
    if hour < cutoff:
        try:
            dt = datetime.strptime(date_str[:10], '%Y-%m-%d') - timedelta(days=1)
            return dt.strftime('%Y-%m-%d')
        except ValueError:
            return date_str
    return date_str[:10]


def clean_party_name(raw: str | None) -> str | None:
    text = ' '.join(str(raw or '').split())
    text = _PARTY_NAME_LEADING_DATE.sub('', text)
    text = _PARTY_NAME_TRAILING_DATE.sub('', text)
    text = ' '.join(text.split())
    return text or None


def to_cents(amount) -> int:
    if amount is None or amount == '':
        return 0
    dec = Decimal(str(amount)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return int(dec * 100)


def _parse_clock(value: str) -> tuple[int, int, int] | None:
    text = (value or '').strip()
    if not text:
        return None
    parts = text.split(':')
    try:
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        second = int(float(parts[2])) if len(parts) > 2 else 0
    except (TypeError, ValueError):
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59 or second < 0 or second > 59:
        return None
    return hour, minute, second


def wall_iso(day: date, clock: tuple[int, int, int], tz: ZoneInfo = TZ) -> str:
    dt = datetime(day.year, day.month, day.day, clock[0], clock[1], clock[2], tzinfo=tz)
    return dt.isoformat(timespec='seconds')


def calendar_day_for_business(business: str, clock: tuple[int, int, int], cutoff: int = 4) -> date:
    """Inverse of business_day when the only date we have is the business date."""
    day = date.fromisoformat(business)
    if clock[0] < cutoff:
        return day + timedelta(days=1)
    return day


def combine_wall(date_str: str, time_str: str, tz: ZoneInfo = TZ) -> str | None:
    clock = _parse_clock(time_str)
    if not date_str or clock is None or len(date_str) < 10:
        return None
    try:
        day = date.fromisoformat(date_str[:10])
    except ValueError:
        return None
    return wall_iso(day, clock, tz)


def _load_service_charge_rules() -> dict:
    defaults = {
        'matchSuffix': 'Service Charge',
        'excludeNames': ['Processing Fee'],
    }
    if os.path.isfile(SERVICE_CHARGES_CONFIG):
        with open(SERVICE_CHARGES_CONFIG, encoding='utf-8') as handle:
            loaded = json.load(handle)
        if isinstance(loaded, dict):
            defaults.update(loaded)
    return defaults


def _is_service_charge(name: str, cfg: dict) -> bool:
    if not name or name in (cfg.get('excludeNames') or []):
        return False
    return name.endswith(cfg.get('matchSuffix') or 'Service Charge')


def _empty_tab() -> dict:
    return {
        'bar': 0,
        'service': 0,
        'gratuity': {},
        'tags': [],
        'accounts': [],
        'first': None,
        'last': None,
        'opened': None,
        'closed': None,
        'user': '',
        'terminal': '',
        'type': '',
        'business_date': '',
    }


def _finish_tab(txn_id: str, tab: dict) -> dict | None:
    gratuity = [
        {'name': name, 'cents': cents}
        for name, cents in sorted(tab['gratuity'].items())
        if cents
    ]
    if tab['service'] == 0 and not gratuity:
        return None
    seen_accounts = []
    for name, amount in tab['accounts']:
        if name not in seen_accounts:
            seen_accounts.append(name)
    if seen_accounts:
        party_raw = max(tab['accounts'], key=lambda pair: abs(pair[1]))[0]
    else:
        party_raw = None
    tags = []
    for label in tab['tags']:
        if label not in tags:
            tags.append(label)
    return {
        'txnId': str(txn_id),
        'opened': tab['opened'],
        'closed': tab['closed'] or tab['opened'],
        'user': tab['user'],
        'terminal': tab['terminal'],
        'partyName': clean_party_name(party_raw) if party_raw else None,
        'accountNames': seen_accounts,
        'serviceChargeCents': int(tab['service']),
        'gratuity': gratuity,
        'barSalesCents': int(tab['bar']),
        'coordinators': tags,
        'firstItem': tab['first'],
        'lastItem': tab['last'],
    }


def tabs_from_accumulator(by_txn: dict) -> dict[str, list]:
    days: dict[str, list] = defaultdict(list)
    for txn_id, tab in by_txn.items():
        finished = _finish_tab(txn_id, tab)
        if not finished or not tab['business_date']:
            continue
        days[tab['business_date']].append(finished)
    for rows in days.values():
        rows.sort(key=lambda row: (row.get('opened') or '', row['txnId']))
    return dict(days)


class TipLedger:
    """Per-tab facts gathered in one pass.

    A service charge is often not the first line, so bar sales, account names,
    and item times are kept for every tab and copied on only at the end.
    """

    def __init__(self) -> None:
        self.tabs: dict[str, dict] = {}
        self.bar: dict[str, int] = defaultdict(int)
        self.accounts: dict[str, list] = defaultdict(list)
        self.first: dict[str, str] = {}
        self.last: dict[str, str] = {}
        self.meta: dict[str, tuple] = {}

    def note_meta(self, txn_id: str, row: dict, business: str, txn_type: str) -> None:
        current = self.meta.get(txn_id)
        if current is None:
            self.meta[txn_id] = (
                business,
                row.get('opened'),
                row.get('closed'),
                row.get('user') or '',
                row.get('terminal') or '',
                txn_type,
            )
            return
        business_date, opened, closed, user, terminal, stored_type = current
        self.meta[txn_id] = (
            business_date or business,
            opened or row.get('opened'),
            row.get('closed') or closed,
            user or (row.get('user') or ''),
            terminal or (row.get('terminal') or ''),
            stored_type or txn_type,
        )

    def finish(self) -> dict[str, dict]:
        for txn_id, tab in self.tabs.items():
            meta = self.meta.get(txn_id)
            if meta:
                business, opened, closed, user, terminal, txn_type = meta
                tab['business_date'] = tab['business_date'] or business
                tab['opened'] = tab['opened'] or opened
                tab['closed'] = tab['closed'] or closed
                tab['user'] = tab['user'] or user
                tab['terminal'] = tab['terminal'] or terminal
                tab['type'] = tab['type'] or txn_type
            tab['bar'] += self.bar.get(txn_id, 0)
            tab['accounts'].extend(self.accounts.get(txn_id) or [])
            if txn_id in self.first:
                tab['first'] = self.first[txn_id]
            if txn_id in self.last:
                tab['last'] = self.last[txn_id]
        return self.tabs


def accumulate_csv_row(ledger: TipLedger, row: dict, rules: dict, charge_cfg: dict, cutoff: int) -> None:
    """Fold one journal line into `ledger`. `row` uses the keys read_tip_csvs yields."""
    txn_type = row.get('txn_type') or ''
    if txn_type and txn_type != 'Sales':
        return
    txn_id = str(row.get('txn_id') or '')
    if not txn_id:
        return
    item_type = row.get('item_type') or ''
    name = (row.get('name') or '').strip()
    department = (row.get('department') or '').strip()
    cents = to_cents(row.get('total'))
    business = row.get('business_date') or ''
    if not business:
        return
    # cutoff matches the ticket export; business_date is already rolled by the caller
    del cutoff

    ledger.note_meta(txn_id, row, business, txn_type)
    tag = crew_tag_label(name, rules) if item_type == 'Product' else None
    if item_type in _BAR_ITEM_TYPES and department == 'Bar' and not tag:
        ledger.bar[txn_id] += cents
    if item_type == 'Account' and name:
        ledger.accounts[txn_id].append((name, cents))
    if item_type in _WINDOW_ITEM_TYPES and not tag and row.get('item_at'):
        when = row['item_at']
        previous = ledger.first.get(txn_id)
        if previous is None or when < previous:
            ledger.first[txn_id] = when
        previous_last = ledger.last.get(txn_id)
        if previous_last is None or when > previous_last:
            ledger.last[txn_id] = when

    service = item_type == 'Adjustment' and _is_service_charge(name, charge_cfg) and cents
    gratuity = item_type == 'GratuityIn' and cents
    if not (tag or service or gratuity):
        return

    tab = ledger.tabs.get(txn_id)
    if tab is None:
        tab = _empty_tab()
        tab['business_date'] = business
        ledger.tabs[txn_id] = tab
    if service:
        tab['service'] += cents
    if gratuity:
        key = name or '(unnamed)'
        tab['gratuity'][key] = tab['gratuity'].get(key, 0) + cents
    if tag:
        tab['tags'].append(tag)


def read_tip_csvs(csv_files: list[str], rules: dict) -> dict[str, list]:
    charge_cfg = _load_service_charge_rules()
    cutoff = int(rules.get('businessDayCutoffHour') or 4)
    columns = [
        'Transaction ID', 'Item ID', 'Transaction Created Date', 'Transaction Created Time',
        'Transaction Closed Date', 'Transaction Closed Time', 'Transaction User',
        'Transaction Terminal', 'Transaction Type', 'Name', 'Item Type', 'Department',
        'Item Created Date', 'Item Created Time', 'Total', 'Deleted', 'Voided',
    ]
    ledger = TipLedger()
    seen = set()
    for csv_path in csv_files:
        if os.path.basename(csv_path).lower() in SKIP_FILES:
            continue
        if not os.path.isfile(csv_path):
            continue
        print(f'  tips: reading {os.path.basename(csv_path)}')
        with open(csv_path, 'r', encoding='utf-8') as handle:
            reader = csv.reader(handle, delimiter=';')
            header = next(reader)
            idx = {name: header.index(name) for name in columns if name in header}
            required = {'Transaction ID', 'Item ID', 'Name', 'Item Type', 'Deleted', 'Voided'}
            if not required.issubset(idx):
                continue
            max_idx = max(idx.values())
            for raw in reader:
                if len(raw) <= max_idx:
                    continue
                if raw[idx['Deleted']] != 'False' or raw[idx['Voided']] != 'False':
                    continue
                key = (raw[idx['Transaction ID']].strip(), raw[idx['Item ID']].strip())
                if key in seen:
                    continue
                seen.add(key)
                created_day = raw[idx['Transaction Created Date']].strip() if 'Transaction Created Date' in idx else ''
                created_time = raw[idx['Transaction Created Time']].strip() if 'Transaction Created Time' in idx else ''
                closed_day = raw[idx['Transaction Closed Date']].strip() if 'Transaction Closed Date' in idx else ''
                closed_time = raw[idx['Transaction Closed Time']].strip() if 'Transaction Closed Time' in idx else ''
                item_day = raw[idx['Item Created Date']].strip() if 'Item Created Date' in idx else ''
                item_time = raw[idx['Item Created Time']].strip() if 'Item Created Time' in idx else ''
                total_raw = raw[idx['Total']].strip() if 'Total' in idx else ''
                accumulate_csv_row(ledger, {
                    'txn_id': key[0],
                    'txn_type': raw[idx['Transaction Type']].strip() if 'Transaction Type' in idx else 'Sales',
                    'name': raw[idx['Name']].strip(),
                    'item_type': raw[idx['Item Type']].strip(),
                    'department': raw[idx['Department']].strip() if 'Department' in idx else '',
                    'total': total_raw,
                    'business_date': business_day(created_day, created_time, cutoff),
                    'opened': combine_wall(created_day, created_time),
                    'closed': combine_wall(closed_day, closed_time),
                    'user': raw[idx['Transaction User']].strip() if 'Transaction User' in idx else '',
                    'terminal': raw[idx['Transaction Terminal']].strip() if 'Transaction Terminal' in idx else '',
                    'item_at': combine_wall(item_day, item_time),
                }, rules, charge_cfg, cutoff)
    return tabs_from_accumulator(ledger.finish())


def read_tip_tickets(by_month: dict, rules: dict) -> dict[str, list]:
    """Build the same tab records from published ticket JSON (no item timestamps)."""
    charge_cfg = _load_service_charge_rules()
    cutoff = int(rules.get('businessDayCutoffHour') or 4)
    by_txn: dict = {}
    for tickets in (by_month or {}).values():
        for ticket in tickets or []:
            business = (ticket.get('date') or '')[:10]
            if not business:
                continue
            open_clock = _parse_clock(ticket.get('time') or '')
            close_clock = _parse_clock(ticket.get('closedTime') or '') or open_clock
            opened = wall_iso(calendar_day_for_business(business, open_clock, cutoff), open_clock) if open_clock else None
            closed = wall_iso(calendar_day_for_business(business, close_clock, cutoff), close_clock) if close_clock else None
            txn_id = str(ticket.get('txnId') or '')
            tab = _empty_tab()
            tab['business_date'] = business
            tab['opened'] = opened
            tab['closed'] = closed
            tab['user'] = ticket.get('user') or ''
            tab['terminal'] = ticket.get('terminal') or ''
            tab['type'] = ticket.get('type') or ''
            if tab['type'] and tab['type'] != 'Sales':
                continue
            keep = False
            for line in ticket.get('items') or []:
                item_type = line.get('itemType') or ''
                name = (line.get('name') or '').strip()
                department = (line.get('dept') or '').strip()
                cents = to_cents(line.get('total'))
                tag = crew_tag_label(name, rules) if item_type == 'Product' else None
                if tag:
                    tab['tags'].append(tag)
                    keep = True
                    continue
                if item_type == 'Adjustment' and _is_service_charge(name, charge_cfg) and cents:
                    tab['service'] += cents
                    keep = True
                elif item_type == 'GratuityIn' and cents:
                    tab['gratuity'][name or '(unnamed)'] = tab['gratuity'].get(name or '(unnamed)', 0) + cents
                    keep = True
                elif item_type in _BAR_ITEM_TYPES and department == 'Bar':
                    tab['bar'] += cents
                elif item_type == 'Account' and name:
                    tab['accounts'].append((name, cents))
            if keep:
                by_txn[txn_id] = tab
    return tabs_from_accumulator(by_txn)


def load_directory(path: str | None = None) -> list[dict]:
    path = path or EMPLOYEES_PATH
    if not os.path.isfile(path):
        return []
    with open(path, encoding='utf-8') as handle:
        payload = json.load(handle)
    directory = []
    for emp in payload.get('employees') or []:
        user_id = emp.get('sevenShiftsUserId')
        directory.append({
            'id': emp.get('id') or '',
            'name': emp.get('displayName') or '',
            'posNames': [str(name) for name in (emp.get('posNames') or []) if name],
            'userId': int(user_id) if user_id else None,
        })
    directory.sort(key=lambda row: (row['name'].lower(), row['id']))
    return directory


def slice_punch(start: datetime, end: datetime, cutoff: int = 4) -> list[tuple[str, datetime, datetime]]:
    """Split a shift at the business-day boundary so each slice sits on one day."""
    if end <= start:
        return []
    slices = []
    cursor = start
    while cursor < end:
        boundary_day = cursor.date()
        if cursor.hour < cutoff:
            boundary = datetime(boundary_day.year, boundary_day.month, boundary_day.day, cutoff, tzinfo=cursor.tzinfo)
            business = (boundary_day - timedelta(days=1)).isoformat()
        else:
            next_day = boundary_day + timedelta(days=1)
            boundary = datetime(next_day.year, next_day.month, next_day.day, cutoff, tzinfo=cursor.tzinfo)
            business = boundary_day.isoformat()
        stop = min(end, boundary)
        if stop > cursor:
            slices.append((business, cursor, stop))
        cursor = stop
    return slices


def punches_by_day(punch_rows: list[dict], cutoff: int = 4) -> dict[str, list]:
    days: dict[str, list] = defaultdict(list)
    for row in punch_rows or []:
        try:
            start = datetime.fromisoformat(row['in'])
            end = datetime.fromisoformat(row['out'])
            clock_in = datetime.fromisoformat(row.get('clockIn') or row['in'])
        except (KeyError, TypeError, ValueError):
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=TZ)
        if end.tzinfo is None:
            end = end.replace(tzinfo=TZ)
        if clock_in.tzinfo is None:
            clock_in = clock_in.replace(tzinfo=TZ)
        for business, slice_start, slice_end in slice_punch(start, end, cutoff):
            days[business].append({
                'userId': int(row['userId']),
                'name': row.get('name') or '',
                'role': row.get('role') or '',
                'clockIn': clock_in.isoformat(timespec='seconds'),
                'in': slice_start.isoformat(timespec='seconds'),
                'out': slice_end.isoformat(timespec='seconds'),
            })
    for rows in days.values():
        rows.sort(key=lambda item: (item['in'], item['name'], item['role']))
    return dict(days)


def load_punch_rows(path: str | None = None) -> list[dict]:
    path = path or PUNCHES_PATH
    if not os.path.isfile(path):
        return []
    with open(path, encoding='utf-8') as handle:
        payload = json.load(handle)
    rows = payload.get('punches') if isinstance(payload, dict) else payload
    return list(rows or [])


def shape_reservations(resource_rows: list[dict], txn_rows: list[dict] | None = None) -> list[dict]:
    """Group reservation resource rows, keeping suites as well as lanes.

    resource row keys: id, title, type, event, resource, start, end, transaction_id
    txn row keys: reservation_id, transaction_id
    """
    grouped: dict[int, dict] = {}
    for row in resource_rows or []:
        try:
            res_id = int(row['id'])
        except (TypeError, ValueError, KeyError):
            continue
        window = grouped.get(res_id)
        if window is None:
            window = {
                'id': res_id,
                'title': (row.get('title') or '').strip(),
                'type': (row.get('type') or '').strip(),
                'event': (row.get('event') or '')[:10] or None,
                'txnIds': set(),
                'start': None,
                'end': None,
                'resources': [],
            }
            grouped[res_id] = window
        txn = row.get('transaction_id')
        if txn:
            window['txnIds'].add(str(int(txn)) if str(txn).isdigit() else str(txn))
        resource = (row.get('resource') or '').strip()
        start = row.get('start')
        end = row.get('end')
        if resource or start or end:
            window['resources'].append({
                'name': resource,
                'start': _iso_any(start),
                'end': _iso_any(end),
            })
        start_iso = _iso_any(start)
        end_iso = _iso_any(end)
        if start_iso and (window['start'] is None or start_iso < window['start']):
            window['start'] = start_iso
        if end_iso and (window['end'] is None or end_iso > window['end']):
            window['end'] = end_iso
    for row in txn_rows or []:
        try:
            res_id = int(row['reservation_id'])
        except (TypeError, ValueError, KeyError):
            continue
        window = grouped.get(res_id)
        if window is None:
            continue
        txn = row.get('transaction_id')
        if txn:
            window['txnIds'].add(str(int(txn)) if str(txn).isdigit() else str(txn))
    out = []
    for window in grouped.values():
        window['txnIds'] = sorted(window['txnIds'])
        window['resources'].sort(key=lambda item: (item.get('start') or '', item.get('name') or ''))
        out.append(window)
    out.sort(key=lambda item: (item.get('event') or '', item['id']))
    return out


def _iso_any(value) -> str | None:
    if value is None or value == '':
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=TZ)
        return value.isoformat(timespec='seconds')
    text = str(value).strip()
    return text or None


def reservations_from_snapshot(snapshot: dict | None) -> list[dict]:
    if not snapshot:
        return []
    rows = []
    txn_rows = []
    for res in snapshot.get('reservations') or []:
        if res.get('goneAt'):
            continue
        res_id = res.get('id')
        if res_id is None:
            continue
        txn = res.get('transactionId')
        rows.append({
            'id': res_id,
            'title': res.get('title') or '',
            'type': res.get('type') or '',
            'event': res.get('event') or '',
            'resource': '',
            'start': None,
            'end': None,
            'transaction_id': txn,
        })
        for linked in res.get('txnIds') or []:
            txn_rows.append({'reservation_id': res_id, 'transaction_id': linked})
    return shape_reservations(rows, txn_rows)


def fetch_reservation_windows(start: str, end_exclusive: str) -> list[dict]:
    """Read start/end times from Sync. Returns [] when the database is unreachable."""
    try:
        sys.path.insert(0, os.path.join(_ROOT, 'scripts'))
        from db import connect
    except Exception as exc:
        print(f'  tips: reservation times unavailable ({exc})')
        return []
    resource_sql = """
        SELECT
            r.ID,
            r.ReservationTitle,
            t.Name,
            r.DateEvent,
            rr.ResourceName,
            rr.ReservationDateStart,
            rr.ReservationDateEnd,
            r.TransactionID
        FROM dbo.RSVReservations r WITH (NOLOCK)
        LEFT JOIN dbo.RSVReservationTypes t WITH (NOLOCK)
            ON t.ID = r.ReservationTypeID
        LEFT JOIN dbo.RSVReservationResources rr WITH (NOLOCK)
            ON rr.ReservationID = r.ID
        WHERE r.DateEvent >= ? AND r.DateEvent < ?
    """
    txn_sql = """
        SELECT rt.ReservationID, rt.TransactionID
        FROM dbo.RSVReservationTransactions rt WITH (NOLOCK)
        INNER JOIN dbo.RSVReservations r WITH (NOLOCK)
            ON r.ID = rt.ReservationID
        WHERE r.DateEvent >= ? AND r.DateEvent < ?
    """
    try:
        with connect(database='Sync', retries=1) as conn:
            cur = conn.cursor()
            cur.execute(resource_sql, (start, end_exclusive))
            resource_rows = []
            for res_id, title, type_name, event, resource, start_at, end_at, txn in cur.fetchall():
                resource_rows.append({
                    'id': res_id,
                    'title': title,
                    'type': type_name,
                    'event': event.strftime('%Y-%m-%d') if isinstance(event, (datetime, date)) else str(event or '')[:10],
                    'resource': resource,
                    'start': start_at,
                    'end': end_at,
                    'transaction_id': txn,
                })
            cur.execute(txn_sql, (start, end_exclusive))
            txn_rows = [
                {'reservation_id': res_id, 'transaction_id': txn}
                for res_id, txn in cur.fetchall()
            ]
    except Exception as exc:
        print(f'  tips: reservation times unavailable ({exc})')
        return []
    print(f'  tips: {len(resource_rows):,} reservation resource rows')
    return shape_reservations(resource_rows, txn_rows)


def reservations_for_days(days: list[str], snapshot: dict | None) -> dict[str, list]:
    """Index reservations by event date. Live times overlay the snapshot when present."""
    indexed: dict[str, dict] = {}
    for res in reservations_from_snapshot(snapshot):
        event = res.get('event')
        if event:
            indexed[f"{event}:{res['id']}"] = res
    if days:
        start = min(days)
        end = (date.fromisoformat(max(days)) + timedelta(days=1)).isoformat()
        for res in fetch_reservation_windows(start, end):
            event = res.get('event')
            if not event:
                continue
            previous = indexed.get(f"{event}:{res['id']}")
            if previous:
                txn_ids = sorted(set(previous.get('txnIds') or []) | set(res.get('txnIds') or []))
                res['txnIds'] = txn_ids
                if not res.get('title'):
                    res['title'] = previous.get('title') or ''
                if not res.get('type'):
                    res['type'] = previous.get('type') or ''
            indexed[f"{event}:{res['id']}"] = res
    by_day: dict[str, list] = defaultdict(list)
    for res in indexed.values():
        event = res.get('event')
        if event:
            by_day[event].append(res)
    for rows in by_day.values():
        rows.sort(key=lambda item: item['id'])
    return dict(by_day)


def _atomic_write(path: str, obj) -> None:
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(obj, handle, separators=(',', ':'))
        handle.write('\n')
    os.replace(tmp, path)


def build_month_payloads(
    tab_days: dict[str, list],
    punch_days: dict[str, list],
    reservation_days: dict[str, list],
    directory: list[dict],
    rules: dict,
) -> dict[str, dict]:
    months: dict[str, dict] = {}
    all_days = set(tab_days) | set(punch_days) | set(reservation_days)
    by_month: dict[str, list] = defaultdict(list)
    for day in all_days:
        if day and len(day) >= 7:
            by_month[day[:7]].append(day)
    generated = datetime.now(TZ).isoformat(timespec='seconds')
    for month, days in by_month.items():
        day_map = {}
        for day in sorted(days):
            reservations = []
            for res in reservation_days.get(day) or []:
                reservations.append({
                    'id': res['id'],
                    'title': res.get('title') or '',
                    'type': res.get('type') or '',
                    'event': res.get('event'),
                    'txnIds': list(res.get('txnIds') or []),
                    'start': res.get('start'),
                    'end': res.get('end'),
                    'resources': res.get('resources') or [],
                })
            day_map[day] = {
                'tabs': tab_days.get(day) or [],
                'punches': punch_days.get(day) or [],
                'reservations': reservations,
            }
        months[month] = {
            'generatedAt': generated,
            'month': month,
            'rules': rules,
            'directory': directory,
            'days': day_map,
        }
    return months


def write_tip_months(payloads: dict[str, dict]) -> list[str]:
    os.makedirs(TIPS_DIR, exist_ok=True)
    written = []
    for month in sorted(payloads):
        path = os.path.join(TIPS_DIR, f'{month}.json')
        _atomic_write(path, payloads[month])
        size_kb = os.path.getsize(path) / 1024
        days = len(payloads[month]['days'])
        print(f'  -> {path}  ({days} days, {size_kb:.0f} KB)')
        written.append(month)
    _atomic_write(os.path.join(TIPS_DIR, 'months.json'), written)
    return written


def supplement_published_tickets() -> int:
    """Fill tabs the journal CSVs do not have yet from public/data/tickets.

    The CSV on a workstation can lag the published ticket files. A transaction
    already present is left alone, so item timestamps from the CSV are kept.
    """
    rules = load_tip_rules()
    cutoff = int(rules.get('businessDayCutoffHour') or 4)
    tickets_dir = os.path.join(OUTPUT_DIR, 'tickets')
    by_month = {}
    for path in glob.glob(os.path.join(tickets_dir, '????-??.json')):
        with open(path, encoding='utf-8') as handle:
            by_month[os.path.basename(path)[:7]] = json.load(handle)
    if not by_month:
        print('  tips: no published tickets to supplement')
        return 0
    extra = read_tip_tickets(by_month, rules)
    punch_days = punches_by_day(load_punch_rows(), cutoff)
    snapshot = None
    if os.path.isfile(SNAPSHOT_PATH):
        with open(SNAPSHOT_PATH, encoding='utf-8') as handle:
            snapshot = json.load(handle)
    reservations = {}
    for res in reservations_from_snapshot(snapshot):
        event = res.get('event')
        if event:
            reservations.setdefault(event, []).append({
                'id': res['id'],
                'title': res.get('title') or '',
                'type': res.get('type') or '',
                'event': event,
                'txnIds': list(res.get('txnIds') or []),
                'start': res.get('start'),
                'end': res.get('end'),
                'resources': res.get('resources') or [],
            })
    os.makedirs(TIPS_DIR, exist_ok=True)
    existing = {}
    for path in glob.glob(os.path.join(TIPS_DIR, '????-??.json')):
        with open(path, encoding='utf-8') as handle:
            payload = json.load(handle)
        existing[os.path.basename(path)[:7]] = payload
    directory = load_directory()
    added = 0
    months = set(existing) | {day[:7] for day in extra if day}
    for month in sorted(months):
        payload = existing.get(month)
        if payload is None:
            payload = {
                'generatedAt': datetime.now(TZ).isoformat(timespec='seconds'),
                'month': month,
                'rules': rules,
                'directory': directory,
                'days': {},
            }
        days = payload.setdefault('days', {})
        month_extra = {day: tabs for day, tabs in extra.items() if day[:7] == month}
        before = sum(len(entry.get('tabs') or []) for entry in days.values())
        for day, tabs in month_extra.items():
            entry = days.setdefault(day, {'tabs': [], 'punches': [], 'reservations': []})
            entry['tabs'] = entry.get('tabs') or []
            have = {tab['txnId'] for tab in entry['tabs']}
            for tab in tabs:
                if tab['txnId'] in have:
                    continue
                entry['tabs'].append(tab)
                have.add(tab['txnId'])
                added += 1
            entry['tabs'].sort(key=lambda row: (row.get('opened') or '', row['txnId']))
            if not entry.get('punches'):
                entry['punches'] = punch_days.get(day) or []
            if not entry.get('reservations'):
                entry['reservations'] = reservations.get(day) or []
        after = sum(len(entry.get('tabs') or []) for entry in days.values())
        if after == before and month in existing:
            continue
        payload['generatedAt'] = datetime.now(TZ).isoformat(timespec='seconds')
        payload['rules'] = rules
        path = os.path.join(TIPS_DIR, f'{month}.json')
        _atomic_write(path, payload)
        print(f'  -> {path}  (supplemented, {after - before} tabs)')
    months_written = sorted(
        os.path.basename(path)[:7]
        for path in glob.glob(os.path.join(TIPS_DIR, '????-??.json'))
    )
    _atomic_write(os.path.join(TIPS_DIR, 'months.json'), months_written)
    print(f'  tips: supplemented {added} tabs from published tickets')
    return added


def export_tip_facts(*, csv_files: list[str] | None = None, tickets_by_month: dict | None = None) -> list[str]:
    rules = load_tip_rules()
    cutoff = int(rules.get('businessDayCutoffHour') or 4)
    if csv_files is not None:
        tab_days = read_tip_csvs(csv_files, rules)
    elif tickets_by_month is not None:
        tab_days = read_tip_tickets(tickets_by_month, rules)
    else:
        raise RuntimeError('export_tip_facts needs csv_files or tickets_by_month')
    punch_days = punches_by_day(load_punch_rows(), cutoff)
    directory = load_directory()
    known_users = {row['userId'] for row in directory if row.get('userId')}
    for punches in punch_days.values():
        for punch in punches:
            if punch['userId'] in known_users:
                continue
            known_users.add(punch['userId'])
            directory.append({
                'id': f"user-{punch['userId']}",
                'name': punch['name'] or f"User {punch['userId']}",
                'posNames': [],
                'userId': punch['userId'],
            })
    directory.sort(key=lambda row: (row['name'].lower(), row['id']))
    snapshot = None
    if os.path.isfile(SNAPSHOT_PATH):
        with open(SNAPSHOT_PATH, encoding='utf-8') as handle:
            snapshot = json.load(handle)
    days = sorted(set(tab_days) | set(punch_days))
    reservation_days = reservations_for_days(days, snapshot) if days else {}
    payloads = build_month_payloads(tab_days, punch_days, reservation_days, directory, rules)
    print(f'  tips: {sum(len(v) for v in tab_days.values()):,} tipped or party tabs')
    written = write_tip_months(payloads)
    if csv_files is not None:
        supplement_published_tickets()
    return written


def restamp_tip_punches() -> int:
    """Replace punches inside existing month files. Skips a CSV reread."""
    if not os.path.isdir(TIPS_DIR):
        print('  tips: no month files to restamp')
        return 0
    rules = load_tip_rules()
    cutoff = int(rules.get('businessDayCutoffHour') or 4)
    punch_days = punches_by_day(load_punch_rows(), cutoff)
    updated = 0
    for path in glob.glob(os.path.join(TIPS_DIR, '????-??.json')):
        with open(path, encoding='utf-8') as handle:
            payload = json.load(handle)
        days = payload.get('days') or {}
        changed = False
        for day, entry in days.items():
            punches = punch_days.get(day) or []
            if punches != (entry.get('punches') or []):
                entry['punches'] = punches
                changed = True
        if not changed:
            continue
        payload['generatedAt'] = datetime.now(TZ).isoformat(timespec='seconds')
        _atomic_write(path, payload)
        updated += 1
    print(f'  tips: restamped punches in {updated} month file(s)')
    return updated


def _find_csvs() -> list[str]:
    found = glob.glob(os.path.join(DATA_DIR, '*.csv'))
    return sorted(
        path for path in found
        if os.path.dirname(os.path.abspath(path)) == os.path.abspath(DATA_DIR)
        and os.path.basename(path).lower() not in SKIP_FILES
    )


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if '--supplement-tickets' in argv:
        supplement_published_tickets()
        return 0
    if '--from-tickets' in argv:
        tickets_dir = os.path.join(OUTPUT_DIR, 'tickets')
        by_month = {}
        for path in glob.glob(os.path.join(tickets_dir, '????-??.json')):
            with open(path, encoding='utf-8') as handle:
                by_month[os.path.basename(path)[:7]] = json.load(handle)
        if not by_month:
            print('No published tickets to read')
            return 1
        export_tip_facts(tickets_by_month=by_month)
        return 0
    csv_files = _find_csvs()
    if not csv_files:
        print('No CSV files in data/')
        return 1
    export_tip_facts(csv_files=csv_files)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
