#!/usr/bin/env python3
"""
Read reservations and the account ledger from Sync and merge them into
public/data/booking_snapshot.json.

Read-only. Connects as concourse_readonly and runs SELECT only. Contact
columns (email, phone, address, PIN) are never selected. Rows the POS later
purges stay in the snapshot, so a cancelled future booking is still visible
after it disappears from the database.

Usage:
  py -3 scripts/pull_bookings.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT_PATH = os.path.join(_ROOT, 'public', 'data', 'booking_snapshot.json')
REQUIRED_LOGIN = 'concourse_readonly'

RESERVATIONS_SQL = """
SELECT
    r.ID,
    r.DateCreated,
    r.DateEvent,
    r.AccountID,
    r.TransactionID,
    r.ReservationTitle,
    r.ReservationStatusID,
    r.ParentReservationID,
    t.Name
FROM dbo.RSVReservations r WITH (NOLOCK)
LEFT JOIN dbo.RSVReservationTypes t WITH (NOLOCK)
    ON t.ID = r.ReservationTypeID
"""

RESERVATION_TXN_SQL = """
SELECT ReservationID, TransactionID
FROM dbo.RSVReservationTransactions WITH (NOLOCK)
"""

LEDGER_SQL = """
SELECT ID, AccountID, ChangeDate, ChangeAmount, TransactionID
FROM dbo.POSAccountDetails WITH (NOLOCK)
WHERE AccountChangeType = 1
"""

ACCOUNTS_SQL = """
SELECT a.ID, a.Name, c.Name
FROM dbo.POSAccounts a WITH (NOLOCK)
LEFT JOIN dbo.POSAccountCollections c WITH (NOLOCK)
    ON c.ID = a.AccountCollectionID
"""


def empty_snapshot() -> dict:
    return {'pulledAt': None, 'reservations': [], 'ledger': [], 'accounts': []}


def read_snapshot(path: str | None = None) -> dict | None:
    path = path or SNAPSHOT_PATH
    if not os.path.isfile(path):
        return None
    with open(path, encoding='utf-8') as handle:
        data = json.load(handle)
    data.setdefault('reservations', [])
    data.setdefault('ledger', [])
    data.setdefault('accounts', [])
    return data


def atomic_write(path: str, obj: dict) -> None:
    """Write via a temp file. If the destination is locked, move it aside."""
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(obj, handle, indent=2)
        handle.write('\n')
    try:
        os.replace(tmp, path)
        return
    except PermissionError:
        pass
    locked = path + '.locked'
    n = 0
    while os.path.exists(locked):
        n += 1
        locked = f'{path}.locked{n}'
    try:
        os.replace(path, locked)
    except OSError:
        pass
    os.replace(tmp, path)


def _iso_dt(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%dT%H:%M:%S')
    if isinstance(value, date):
        return value.strftime('%Y-%m-%d')
    text = str(value).strip()
    return text[:19] if text else None


def _iso_date(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime('%Y-%m-%d')
    if isinstance(value, date):
        return value.strftime('%Y-%m-%d')
    text = str(value).strip()
    return text[:10] if text else None


def _money(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return round(float(value), 2)
    return round(float(value), 2)


def _pos_int(value) -> int | None:
    """Zero means 'not set' on these POS columns."""
    if value is None:
        return None
    number = int(value)
    return number or None


def _text(value) -> str:
    return ' '.join(str(value or '').split())


def _by_id(rows: list[dict]) -> dict[int, dict]:
    out = {}
    for row in rows or []:
        if row.get('id') is None:
            continue
        out[int(row['id'])] = row
    return out


def merge_snapshot(existing: dict | None, pulled: dict, today: str) -> dict:
    """Upsert by id. Never drop a row the database no longer returns.

    A reservation that vanishes before its event date is marked goneAt
    (cancelled, or purged early). One that vanishes after the event is the
    normal 90-day purge and is kept unchanged.
    """
    existing = existing or empty_snapshot()
    reservations = _by_id(existing.get('reservations'))
    seen: set[int] = set()
    for row in pulled.get('reservations') or []:
        rid = int(row['id'])
        seen.add(rid)
        reservations[rid] = {
            'id': rid,
            'created': row.get('created'),
            'event': row.get('event'),
            'statusId': row.get('statusId'),
            'type': row.get('type') or '',
            'accountId': row.get('accountId'),
            'transactionId': row.get('transactionId'),
            'title': row.get('title') or '',
            'parentId': row.get('parentId'),
            'txnIds': sorted({int(t) for t in (row.get('txnIds') or []) if t}),
        }

    for rid, prev in reservations.items():
        if rid in seen:
            continue
        event = prev.get('event') or ''
        if event and event > today and not prev.get('goneAt'):
            prev['goneAt'] = today

    ledger = _by_id(existing.get('ledger'))
    for row in pulled.get('ledger') or []:
        lid = int(row['id'])
        ledger[lid] = {
            'id': lid,
            'accountId': row.get('accountId'),
            'at': row.get('at'),
            'amount': _money(row.get('amount')),
            'txnId': row.get('txnId'),
        }

    accounts = _by_id(existing.get('accounts'))
    for row in pulled.get('accounts') or []:
        aid = int(row['id'])
        accounts[aid] = {
            'id': aid,
            'name': row.get('name') or '',
            'collection': row.get('collection') or '',
        }

    def sorted_rows(mapping: dict[int, dict]) -> list[dict]:
        return [mapping[key] for key in sorted(mapping)]

    return {
        'pulledAt': pulled.get('pulledAt') or today,
        'reservations': sorted_rows(reservations),
        'ledger': sorted_rows(ledger),
        'accounts': sorted_rows(accounts),
    }


def _fetch(cursor, sql: str) -> list[tuple]:
    cursor.execute(sql)
    return cursor.fetchall()


def pull_snapshot(today: str | None = None) -> dict:
    """SELECT the booking tables. Raises if the login is not read-only."""
    from db import connect

    today = today or date.today().isoformat()
    conn = connect(database='Sync')
    try:
        cur = conn.cursor()
        cur.execute('SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED')
        cur.execute('SET LOCK_TIMEOUT 5000')
        cur.execute('SELECT SUSER_SNAME()')
        login = cur.fetchone()[0]
        if login != REQUIRED_LOGIN:
            raise RuntimeError(
                f'Refusing to read bookings as {login!r}. '
                f'Only {REQUIRED_LOGIN} is allowed.'
            )

        txn_ids: dict[int, set[int]] = {}
        for reservation_id, txn_id in _fetch(cur, RESERVATION_TXN_SQL):
            if reservation_id is None or txn_id is None:
                continue
            txn_ids.setdefault(int(reservation_id), set()).add(int(txn_id))

        reservations = []
        for row in _fetch(cur, RESERVATIONS_SQL):
            rid = int(row[0])
            linked = set(txn_ids.get(rid, set()))
            own_txn = _pos_int(row[4])
            if own_txn:
                linked.add(own_txn)
            reservations.append({
                'id': rid,
                'created': _iso_dt(row[1]),
                'event': _iso_date(row[2]),
                'accountId': _pos_int(row[3]),
                'transactionId': own_txn,
                'title': _text(row[5]),
                'statusId': int(row[6]) if row[6] is not None else None,
                'parentId': _pos_int(row[7]),
                'type': _text(row[8]),
                'txnIds': sorted(linked),
            })

        ledger = []
        for row in _fetch(cur, LEDGER_SQL):
            ledger.append({
                'id': int(row[0]),
                'accountId': _pos_int(row[1]),
                'at': _iso_dt(row[2]),
                'amount': _money(row[3]),
                'txnId': _pos_int(row[4]),
            })

        accounts = []
        for row in _fetch(cur, ACCOUNTS_SQL):
            accounts.append({
                'id': int(row[0]),
                'name': _text(row[1]),
                'collection': _text(row[2]),
            })
    finally:
        conn.close()

    if not reservations:
        raise RuntimeError('Booking pull returned no reservations. Snapshot left unchanged.')
    if not ledger:
        raise RuntimeError('Booking pull returned no ledger rows. Snapshot left unchanged.')

    return {
        'pulledAt': datetime.now().strftime('%Y-%m-%dT%H:%M:%S'),
        'reservations': reservations,
        'ledger': ledger,
        'accounts': accounts,
        'today': today,
    }


def refresh_snapshot(path: str | None = None, today: str | None = None) -> dict:
    """Pull and merge. The previous file is kept if the pull fails."""
    path = path or SNAPSHOT_PATH
    today = today or date.today().isoformat()
    pulled = pull_snapshot(today)
    merged = merge_snapshot(read_snapshot(path), pulled, pulled.pop('today', today))
    atomic_write(path, merged)
    return merged


def main() -> int:
    snapshot = refresh_snapshot()
    print(
        f'Wrote {SNAPSHOT_PATH}: '
        f'{len(snapshot["reservations"]):,} reservations, '
        f'{len(snapshot["ledger"]):,} ledger rows, '
        f'{len(snapshot["accounts"]):,} accounts'
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
