#!/usr/bin/env python3
"""
One row per deposit: when it was paid, when the party is, and what kind.

The event date comes from the POS when we have it (public/data/booking_snapshot.json,
refreshed by pull_bookings.py). A past party uses the day the tab was closed,
unless that posting is the same day as the deposit (the money moving onto the
tab, not the party). A future party uses the booked date. A date typed into
the account name, and config/event_date_overrides.json, are fallbacks. A
deposit with no date is kept and counted under unknownEvent.

No database access in this file except the optional pull at the start of an export.
The pull failing does not fail the nightly: the previous snapshot is used.

Usage:
  py -3 scripts/booking_pace.py
  py -3 scripts/booking_pace.py --check
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCRIPTS = os.path.join(_ROOT, 'scripts')
if _SCRIPTS not in sys.path:
    sys.path.insert(0, _SCRIPTS)

import pull_bookings  # noqa: E402
import reservation_counts  # noqa: E402
from export_dashboards import _clean_party_name, _party_types_for_tab  # noqa: E402

OUTPUT_PATH = os.path.join(_ROOT, 'public', 'data', 'booking_pace.json')
CONFIG_PATH = os.path.join(_ROOT, 'config', 'booking_pace.json')
OVERRIDES_PATH = os.path.join(_ROOT, 'config', 'event_date_overrides.json')

# Same shapes staff type into account names. See export_dashboards._PARTY_NAME_*.
_LEADING_DATE = re.compile(r'^\s*(\d{1,2})/(\d{1,2})/(\d{4})\b')
_TRAILING_DATE = re.compile(r'\s+(\d{1,2})[.-](\d{1,2})[.-](\d{2,4})\s*$')
_SECRET = re.compile(r'(PWD|PASSWORD)\s*=\s*[^;\'"\s]+', re.IGNORECASE)
_SKIP_TAB_TYPES = frozenset({'General Party', 'Unclassified'})
_REFUND_TYPES = frozenset({'Refund', 'Cancel', 'ManualCancel'})

# Deposits paid Sep 1 through Oct 19. Dollars in the brief are rounded.
BASELINE = {
    2025: {
        'deposits': 320,
        'dollars': 119333,
        'events': 8,
        'event_dollars': 17983,
        'parties': [
            ('candi cecii', 500),
            ('octi', 900),
            ('serrano water', 1800),
            ('c&s assembly', 1650),
            ('cai', 3897),
            ('arizona tile', 2496),
            ('jax bicycle', 1590),
            ("polly's pies", 5150),
        ],
    },
    2026: {
        'deposits': 365,
        'dollars': 137845,
        'events': 13,
        'event_dollars': 32643,
        'parties': [
            ('yesenia hernandez', 2796),
            ('mccandless tile', 5196),
            ('serrano water', 1800),
            ('erwin wusstig', 3526),
            ('jax bicycle', 1154),
            ('cai-manheim', 3897),
            ('rich langenwalter', 2310),
            ('amanda gandara', 3084),
            ('evangeline salomon', 858),
            ('a new view windows', 1650),
            ('anaheim aquatics', 2315),
            ('ads gold', 1650),
            ('canyon wrestling', 2407),
        ],
    },
}


def _public_error(exc: BaseException) -> str:
    text = _SECRET.sub(r'\1=***', str(exc)).replace('\n', ' ')
    return text[:180]


def business_day(value: str | None) -> str | None:
    """Ledger timestamps before 4 AM belong to the previous business day."""
    if not value:
        return None
    text = str(value).strip()
    if 'T' not in text and ' ' not in text:
        return text[:10]
    text = text.replace(' ', 'T')
    day, clock = text.split('T', 1)
    try:
        hour = int(clock[:2])
        parsed = date.fromisoformat(day[:10])
    except ValueError:
        return None
    if hour < 4:
        parsed -= timedelta(days=1)
    return parsed.isoformat()


def parse_name_date(name: str | None) -> str | None:
    """A leading M/D/YYYY or a trailing MM.DD.YY / MM-DD-YY in an account name."""
    text = str(name or '')
    match = _LEADING_DATE.match(text) or _TRAILING_DATE.search(text)
    if not match:
        return None
    month, day, year = (int(part) for part in match.groups())
    if year < 100:
        year += 2000
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _party_key(name: str | None) -> str:
    return re.sub(r'[^a-z0-9]', '', str(name or '').casefold())


def _txn_key(value) -> int | None:
    if value is None or value == '':
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def load_json(path: str, default):
    if not os.path.isfile(path):
        return default
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def load_config(path: str | None = None) -> dict:
    data = load_json(path or CONFIG_PATH, {})
    data.setdefault('reservationTypes', {})
    data.setdefault('collections', {})
    data.setdefault('tenders', [])
    data.setdefault('groups', {})
    data.setdefault('defaultType', 'General Lane Reservation')
    data.setdefault('defaultGroup', 'lanes')
    return data


def load_overrides(path: str | None = None) -> tuple[dict, dict]:
    data = load_json(path or OVERRIDES_PATH, {})
    by_txn = {str(key): value for key, value in (data.get('byTxnId') or {}).items() if value}
    by_name = {}
    for key, value in (data.get('byName') or {}).items():
        if not value:
            continue
        cleaned = _clean_party_name(key) or str(key)
        by_name[cleaned.casefold()] = value
    return by_txn, by_name


def _dates_conflict(dates) -> bool:
    parsed = []
    for value in dates:
        if not value:
            continue
        try:
            parsed.append(date.fromisoformat(str(value)[:10]))
        except ValueError:
            continue
    if len(parsed) < 2:
        return False
    return (max(parsed) - min(parsed)).days > 1


def _mapped(table: dict, key: str | None) -> str | None:
    if not key or not table:
        return None
    if key in table and table[key]:
        return table[key]
    folded = {str(name).casefold(): label for name, label in table.items()}
    label = folded.get(key.casefold())
    return label or None


def _group_for(type_name: str | None, config: dict) -> str | None:
    for group_id, names in (config.get('groups') or {}).items():
        if type_name in (names or []):
            return group_id
    return None


def index_tickets(by_month: dict) -> dict[str, dict]:
    found = {}
    for tickets in (by_month or {}).values():
        for ticket in tickets or []:
            txn = str(ticket.get('txnId') or '')
            if txn:
                found[txn] = ticket
    return found


def data_through(by_month: dict) -> str | None:
    latest = ''
    for tickets in (by_month or {}).values():
        for ticket in tickets or []:
            day = str(ticket.get('date') or '')[:10]
            if day > latest:
                latest = day
    return latest or None


def iter_deposits(by_month: dict):
    """Positive Account lines on Sales tickets. One yield per deposit."""
    for tickets in (by_month or {}).values():
        for ticket in tickets or []:
            if ticket.get('type') != 'Sales':
                continue
            paid = str(ticket.get('date') or '')[:10]
            txn = str(ticket.get('txnId') or '')
            if not paid or not txn:
                continue
            tenders = []
            for item in ticket.get('items') or []:
                if str(item.get('itemType') or '').startswith('Payment'):
                    name = (item.get('name') or '').strip()
                    if name:
                        tenders.append(name)
            for item in ticket.get('items') or []:
                if item.get('itemType') != 'Account':
                    continue
                try:
                    amount = round(float(item.get('total') or 0), 2)
                except (TypeError, ValueError):
                    continue
                if amount <= 0:
                    continue
                yield {
                    'txnId': txn,
                    'paid': paid,
                    'amount': amount,
                    'name': item.get('name') or '',
                    'tenders': tenders,
                }


def _indexes(snapshot: dict):
    by_txn_pos = defaultdict(list)
    by_acct_neg = defaultdict(list)
    for row in snapshot.get('ledger') or []:
        account_id = row.get('accountId')
        txn = _txn_key(row.get('txnId'))
        amount = row.get('amount') or 0
        if amount > 0 and txn is not None:
            by_txn_pos[txn].append(row)
        elif amount < 0 and account_id:
            by_acct_neg[int(account_id)].append(row)

    by_acct_rsv = defaultdict(list)
    by_txn_rsv = defaultdict(list)
    for row in snapshot.get('reservations') or []:
        if row.get('accountId'):
            by_acct_rsv[int(row['accountId'])].append(row)
        for txn in row.get('txnIds') or []:
            key = _txn_key(txn)
            if key is not None:
                by_txn_rsv[key].append(row)

    accounts = {}
    for row in snapshot.get('accounts') or []:
        if row.get('id') is not None:
            accounts[int(row['id'])] = row
    return by_txn_pos, by_acct_neg, by_acct_rsv, by_txn_rsv, accounts


def _match_ledger(deposit: dict, by_txn_pos) -> dict | None:
    txn = _txn_key(deposit.get('txnId'))
    if txn is None:
        return None
    hits = by_txn_pos.get(txn) or []
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    for hit in hits:
        if abs((hit.get('amount') or 0) - deposit['amount']) < 0.02:
            return hit
    return hits[0]


def _pick_reservation(candidates: list[dict], txn: int | None, paid: str) -> dict | None:
    if not candidates:
        return None
    uniq = {row['id']: row for row in candidates if row.get('id') is not None}
    pool = list(uniq.values())
    if txn is not None:
        linked = [row for row in pool if txn in {_txn_key(t) for t in (row.get('txnIds') or [])}]
        if linked:
            pool = linked
    upcoming = [row for row in pool if (row.get('event') or '') >= paid]
    pool = upcoming or pool
    pool.sort(key=lambda row: (row.get('event') or '9999-99-99', row.get('id') or 0))
    return pool[0]


def _txn_is_refund(txn, tickets: dict[str, dict]) -> bool:
    if txn is None:
        return False
    ticket = tickets.get(str(txn))
    if ticket is None:
        return False
    return ticket.get('type') in _REFUND_TYPES


def _closeout(negatives: list[dict], tickets: dict[str, dict], paid: str):
    """Split a same-day transfer from a later close-out.

    Taking a deposit often posts a negative the same minute, moving the money
    onto the party tab. That is not the party. A negative on a later business
    day is the tab actually closing. Returns
    (later_day, later_txn, applied_same_day, same_day_txn, refunded).
    """
    later_day = None
    later_txn = None
    same_txn = None
    refunded = False
    for row in negatives:
        day = business_day(row.get('at'))
        if not day or day < paid:
            continue
        if _txn_is_refund(row.get('txnId'), tickets):
            refunded = True
            continue
        if day == paid:
            same_txn = row.get('txnId')
            continue
        if later_day is None or day > later_day:
            later_day = day
            later_txn = row.get('txnId')
    return later_day, later_txn, same_txn is not None, same_txn, refunded


def _type_from_tab(ticket: dict | None) -> str | None:
    if not ticket:
        return None
    found = _party_types_for_tab(ticket, reservation_counts)
    found = [name for name in found if name not in _SKIP_TAB_TYPES]
    return found[0] if found else None


def resolve_type(deposit, reservation, redemption_ticket, account, config) -> tuple[str, str, str]:
    """Return (type, group, typeSource). First real answer wins."""
    tab_type = _type_from_tab(redemption_ticket)
    if tab_type:
        return tab_type, _group_for(tab_type, config) or config['defaultGroup'], 'tab'

    mapped = _mapped(config.get('reservationTypes') or {}, (reservation or {}).get('type'))
    if mapped and mapped not in _SKIP_TAB_TYPES:
        return mapped, _group_for(mapped, config) or config['defaultGroup'], 'rsv'

    mapped = _mapped(config.get('collections') or {}, (account or {}).get('collection'))
    if mapped:
        return mapped, _group_for(mapped, config) or config['defaultGroup'], 'collection'

    blob = ' | '.join(deposit.get('tenders') or []).casefold()
    for rule in config.get('tenders') or []:
        needle = str(rule.get('needle') or '').casefold()
        if needle and needle in blob:
            label = rule.get('type') or config['defaultType']
            return label, _group_for(label, config) or config['defaultGroup'], 'tender'

    label = config.get('defaultType') or 'General Lane Reservation'
    return label, config.get('defaultGroup') or 'lanes', 'default'


def _override_for(deposit: dict, by_txn: dict, by_name: dict) -> str | None:
    if deposit['txnId'] in by_txn:
        return by_txn[deposit['txnId']]
    cleaned = _clean_party_name(deposit.get('name'))
    if cleaned and cleaned.casefold() in by_name:
        return by_name[cleaned.casefold()]
    return None


def _status(event, closed_later: bool, applied_early: bool, cancelled: bool, today: str) -> str:
    if closed_later:
        return 'completed'
    if cancelled:
        return 'cancelled'
    # Deposit moved onto a tab the day it was paid, and the party date has passed.
    if applied_early and event and event <= today:
        return 'completed'
    if not event:
        return 'unknown'
    if event >= today:
        return 'booked'
    return 'unredeemed'


def build_payments(by_month: dict, snapshot: dict, config: dict, overrides: tuple[dict, dict], today: str) -> list[dict]:
    by_txn, by_name = overrides
    tickets = index_tickets(by_month)
    by_txn_pos, by_acct_neg, by_acct_rsv, by_txn_rsv, accounts = _indexes(snapshot)
    rows = []

    for deposit in iter_deposits(by_month):
        ledger = _match_ledger(deposit, by_txn_pos)
        account_id = int(ledger['accountId']) if ledger and ledger.get('accountId') else None
        account = accounts.get(account_id) if account_id else None
        txn = _txn_key(deposit['txnId'])

        candidates = []
        if account_id:
            candidates.extend(by_acct_rsv.get(account_id) or [])
        if txn is not None:
            candidates.extend(by_txn_rsv.get(txn) or [])
        reservation = _pick_reservation(candidates, txn, deposit['paid'])

        negatives = by_acct_neg.get(account_id, []) if account_id else []
        redeemed_on, redeemed_txn, applied_early, applied_txn, refunded = _closeout(
            negatives, tickets, deposit['paid'],
        )
        name_date = parse_name_date(deposit.get('name'))
        # The account name is the one staff keep current. The ticket line can be
        # a shorter copy, so fall back to it for the typed date.
        if not name_date and account:
            name_date = parse_name_date(account.get('name'))
        override = _override_for(deposit, by_txn, by_name)
        reserved_on = (reservation or {}).get('event')

        if override:
            event, source = override, 'override'
        elif redeemed_on:
            event, source = redeemed_on, 'redeemed'
        elif reserved_on:
            event, source = reserved_on, 'db'
        elif name_date:
            event, source = name_date, 'name'
        elif applied_early:
            event, source = deposit['paid'], 'redeemed'
        else:
            event, source = None, 'unknown'

        other_events = [row.get('event') for row in candidates]
        conflict = _dates_conflict([override, redeemed_on, reserved_on, name_date, *other_events])

        gone = bool(reservation and reservation.get('goneAt') and reserved_on and reservation['goneAt'] < reserved_on)
        cancelled = (refunded or gone) and not redeemed_on
        tab_txn = redeemed_txn if redeemed_txn is not None else applied_txn
        redemption_ticket = tickets.get(str(tab_txn)) if tab_txn is not None else None
        party_type, group, type_source = resolve_type(deposit, reservation, redemption_ticket, account, config)

        party = _clean_party_name(deposit.get('name'))
        if not party and reservation:
            party = reservation.get('title') or None
        if not party and account:
            party = account.get('name') or None

        rows.append({
            'txnId': deposit['txnId'],
            'paid': deposit['paid'],
            'amount': deposit['amount'],
            'accountId': account_id,
            'party': party,
            'isFirstPayment': True,
            'event': event,
            'eventSource': source,
            'eventConflict': conflict,
            'group': group,
            'type': party_type,
            'typeSource': type_source,
            'status': _status(event, bool(redeemed_on), applied_early, cancelled, today),
            'reservationId': reservation.get('id') if reservation else None,
        })

    groups = defaultdict(list)
    for row in rows:
        key = ('account', row['accountId']) if row['accountId'] else ('txn', row['txnId'])
        groups[key].append(row)
    for group_rows in groups.values():
        group_rows.sort(key=lambda row: (row['paid'], _txn_key(row['txnId']) or 0, row['amount']))
        for index, row in enumerate(group_rows):
            row['isFirstPayment'] = index == 0

    rows.sort(key=lambda row: (row['paid'], _txn_key(row['txnId']) or 0, row['amount']))
    return rows


def build_payload(by_month, snapshot, config, overrides, today, db_status) -> dict:
    payments = build_payments(by_month, snapshot, config, overrides, today)
    unknown = [row for row in payments if row['eventSource'] == 'unknown']
    return {
        'generatedAt': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        'dataThrough': data_through(by_month),
        'dbStatus': db_status,
        'dbAsOf': (snapshot or {}).get('pulledAt'),
        'unknownEvent': {
            'count': len(unknown),
            'amount': round(sum(row['amount'] for row in unknown), 2),
        },
        'conflicts': sum(1 for row in payments if row['eventConflict']),
        'payments': payments,
    }


def acquire_snapshot(pull, path: str) -> tuple[str, dict]:
    """Run pull(). On any failure, use the snapshot already on disk."""
    try:
        snapshot = pull()
        if not snapshot or not snapshot.get('reservations'):
            raise RuntimeError('booking pull returned nothing')
        return 'live', snapshot
    except Exception as exc:
        print(f'  WARNING: booking database unavailable ({_public_error(exc)}). Using the last snapshot.')
        snapshot = pull_bookings.read_snapshot(path)
        if snapshot and snapshot.get('reservations'):
            return 'snapshot', snapshot
        print('  WARNING: no booking snapshot on disk. Event dates fall back to account names.')
        return 'none', pull_bookings.empty_snapshot()


def export_booking_pace(by_month, *, snapshot_path=None, output_path=None, overrides_path=None,
                        config_path=None, pull=True, today=None, write=True) -> dict:
    """Write public/data/booking_pace.json. A failed pull keeps the previous snapshot."""
    snapshot_path = snapshot_path or pull_bookings.SNAPSHOT_PATH
    output_path = output_path or OUTPUT_PATH
    today = today or date.today().isoformat()
    config = load_config(config_path)
    overrides = load_overrides(overrides_path)

    if pull:
        db_status, snapshot = acquire_snapshot(
            lambda: pull_bookings.refresh_snapshot(snapshot_path, today),
            snapshot_path,
        )
    else:
        snapshot = pull_bookings.read_snapshot(snapshot_path) or pull_bookings.empty_snapshot()
        db_status = 'snapshot' if snapshot.get('pulledAt') else 'none'

    payload = build_payload(by_month, snapshot, config, overrides, today, db_status)
    if write:
        pull_bookings.atomic_write(output_path, payload)
        unknown = payload['unknownEvent']
        print(
            f'  -> {output_path}  ({len(payload["payments"]):,} deposits, '
            f'db={db_status}, conflicts={payload["conflicts"]}, '
            f'unknown={unknown["count"]} / ${unknown["amount"]:,.2f})'
        )
    return payload


def match_parties(rows: list[dict], expected: list[tuple[str, int]]):
    """Match brief names to first-payment rows. Longer names claim a row first."""
    unused = list(rows)
    matched = []
    missing = []
    ranked = sorted(expected, key=lambda pair: len(_party_key(pair[0])), reverse=True)
    for name, dollars in ranked:
        key = _party_key(name)
        found = None
        for row in unused:
            row_key = _party_key(row.get('party'))
            if row_key == key or (key and (row_key.startswith(key) or key.startswith(row_key))):
                found = row
                break
        if found is None:
            missing.append((name, dollars))
            continue
        unused.remove(found)
        amount_ok = abs(round(found['amount']) - dollars) <= 1
        matched.append((name, dollars, found, amount_ok))
    return matched, missing, unused


def check_baselines(payload: dict) -> bool:
    """Print the Sep 1 - Oct 19 window and whether it matches the brief."""
    payments = payload.get('payments') or []
    ok = True
    print(f'db={payload.get("dbStatus")} as of {payload.get("dbAsOf")}  data through {payload.get("dataThrough")}')
    for year, expected in BASELINE.items():
        start, end = f'{year}-09-01', f'{year}-10-19'
        window = [row for row in payments if start <= row['paid'] <= end]
        december = [row for row in window if str(row.get('event') or '').startswith(f'{year}-12')]
        events = [row for row in december if row.get('isFirstPayment')]
        deposit_dollars = round(sum(row['amount'] for row in window), 2)
        event_dollars = round(sum(row['amount'] for row in events), 2)
        all_dec_dollars = round(sum(row['amount'] for row in december), 2)
        print(
            f'\n{year} paid {start}..{end}: {len(window)} deposits ${deposit_dollars:,.2f} '
            f'(brief {expected["deposits"]} / ${expected["dollars"]:,})'
        )
        print(
            f'  December events: {len(events)} ${event_dollars:,.2f} '
            f'(brief {expected["events"]} / ${expected["event_dollars"]:,})'
            + (f'  all December payments ${all_dec_dollars:,.2f}' if all_dec_dollars != event_dollars else '')
        )
        if len(window) != expected['deposits'] or abs(deposit_dollars - expected['dollars']) > 1:
            ok = False
            print('  DIFFERENT deposit count or dollars')
        if len(events) != expected['events'] or abs(event_dollars - expected['event_dollars']) > 1:
            ok = False
            print('  DIFFERENT December event count or dollars')

        matched, missing, extra = match_parties(events, expected['parties'])
        for name, dollars, row, amount_ok in sorted(matched, key=lambda item: item[2]['event'] or ''):
            flag = '' if amount_ok else '  AMOUNT'
            print(
                f'    {row["event"]}  ${row["amount"]:>10,.2f}  {row["party"]}  '
                f'[{row["eventSource"]}/{row["type"]}/{row["status"]}]'
                f'{flag}  brief ${dollars:,}'
            )
            if not amount_ok:
                ok = False
        for name, dollars in missing:
            ok = False
            print(f'    MISSING  {name} ${dollars:,}')
        for row in extra:
            ok = False
            print(
                f'    EXTRA    {row["event"]} ${row["amount"]:,.2f} {row["party"]} '
                f'[{row["eventSource"]}] paid {row["paid"]}'
            )
    if ok:
        print('\nBaseline matches.')
    else:
        print('\nBaseline differs. See the lines above.')
    return ok


def load_tickets(tickets_dir: str | None = None) -> dict:
    return reservation_counts.load_tickets_by_month(tickets_dir)


def main(argv: list[str] | None = None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description='Build booking pace from tickets plus the POS snapshot')
    parser.add_argument('--check', action='store_true', help='Compare the Sep 1 - Oct 19 window to the brief')
    parser.add_argument('--no-pull', action='store_true', help='Use the snapshot already on disk')
    args = parser.parse_args(argv)

    by_month = load_tickets()
    if not by_month:
        print('ERROR: no ticket files in public/data/tickets/')
        return 1
    payload = export_booking_pace(by_month, pull=not args.no_pull)
    if args.check:
        return 0 if check_baselines(payload) else 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
