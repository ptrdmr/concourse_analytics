#!/usr/bin/env python3
"""
push_lane_chart.py

Read the bowling POS reservation book from Sync and POST it to the leads
site, which stores it for the read-only lane chart.

Reads RSVReservations, RSVReservationResources, and RSVReservationTypes only.
No contact fields. Writes nothing under this repo.

Requires .env (gitignored), except for --dry-run:
  LEADS_LANE_SYNC_URL=https://concourseleads.netlify.app/api/pos-lanes/sync
  LEADS_LANE_SYNC_SECRET=...   # same value as Netlify LANE_SYNC_SECRET

Usage:
  py -3 scripts/push_lane_chart.py --dry-run
  py -3 scripts/push_lane_chart.py
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    requests = None

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TZ = ZoneInfo('America/Los_Angeles')
LANE_RE = re.compile(r'^Lane\s+(\d+)$', re.IGNORECASE)
SOURCE = 'Sync.RSVReservations'

SQL = """
SELECT
    r.ID,
    r.ReservationTitle,
    r.ReservationStatusID,
    t.Name,
    rr.ResourceName,
    rr.ReservationDateStart,
    rr.ReservationDateEnd
FROM dbo.RSVReservations r WITH (NOLOCK)
INNER JOIN dbo.RSVReservationResources rr WITH (NOLOCK)
    ON rr.ReservationID = r.ID
LEFT JOIN dbo.RSVReservationTypes t WITH (NOLOCK)
    ON t.ID = r.ReservationTypeID
WHERE rr.ReservationDateStart >= ?
  AND rr.ReservationDateStart < ?
"""


def snap15(minutes: int) -> int:
    """Nearest 15 minutes. An exact halfway point rounds down."""
    if minutes < 0:
        minutes = 0
    base, rem = divmod(minutes, 15)
    if rem > 7:
        return (base + 1) * 15
    return base * 15


def _as_datetime(value) -> datetime | None:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return None


def shape_book(rows: list[dict]) -> tuple[dict[str, list[dict]], dict]:
    stats = {
        'skipped_resource': 0,
        'skipped_no_lanes': 0,
        'skipped_status': defaultdict(int),
        'clipped': 0,
        'bad_end': 0,
        'firm': 0,
        'hold': 0,
    }
    windows: dict[tuple, dict] = {}

    for row in rows:
        status = row.get('status')
        try:
            status_id = int(status)
        except (TypeError, ValueError):
            status_id = status
        if status_id == 2:
            role = 'firm'
        elif status_id == 0:
            role = 'hold'
        else:
            key = ('status', row.get('reservation_id'), row.get('start'), row.get('end'))
            if key not in windows:
                stats['skipped_status'][str(status_id)] += 1
                windows[key] = {'skip': True}
            continue

        start = _as_datetime(row.get('start'))
        end = _as_datetime(row.get('end'))
        if start is None or end is None:
            stats['bad_end'] += 1
            continue

        reservation_id = row.get('reservation_id')
        window_key = (reservation_id, start, end)
        window = windows.get(window_key)
        if window is None:
            window = {
                'skip': False,
                'id': reservation_id,
                'title': (row.get('title') or '').strip(),
                'type_name': (row.get('type_name') or '').strip(),
                'status': role,
                'start': start,
                'end': end,
                'lanes': set(),
            }
            windows[window_key] = window

        name = (row.get('resource_name') or '').strip()
        match = LANE_RE.match(name)
        if not match:
            stats['skipped_resource'] += 1
            continue
        lane = int(match.group(1))
        if lane < 1 or lane > 40:
            stats['skipped_resource'] += 1
            continue
        window['lanes'].add(lane)

    blocks_by_res: dict[object, list[dict]] = defaultdict(list)
    for window in windows.values():
        if window.get('skip'):
            continue
        if not window['lanes']:
            stats['skipped_no_lanes'] += 1
            continue

        start: datetime = window['start']
        end: datetime = window['end']
        chart_day = start.date()
        if start.hour < 8:
            chart_day = chart_day - timedelta(days=1)

        raw_start = ((start.hour * 60 + start.minute) - 480) % 1440
        start_minute = snap15(raw_start)
        if start_minute >= 1440:
            start_minute = 1425

        if end <= start:
            duration = 15
            stats['bad_end'] += 1
        else:
            raw_duration = int((end - start).total_seconds() // 60)
            duration = snap15(raw_duration)
            if duration < 15:
                duration = 15
            cap = 1440 - start_minute
            if duration > cap:
                duration = cap
                stats['clipped'] += 1

        title = window['title']
        type_name = window['type_name']
        if title and type_name:
            label = f'{title} - {type_name}'
        elif title or type_name:
            label = title or type_name
        else:
            label = f"Reservation {window['id']}"
        label = label[:200]

        base_id = f"pos:{window['id']}:{start:%Y%m%d%H%M}"
        block = {
            'id': base_id,
            'label': label,
            'typeName': type_name,
            'status': window['status'],
            'lanes': sorted(window['lanes']),
            'startMinute': start_minute,
            'durationMinutes': duration,
            '_end': end,
            '_date': chart_day.isoformat(),
        }
        blocks_by_res[window['id']].append(block)
        stats[window['status']] += 1

    days: dict[str, list[dict]] = defaultdict(list)
    for blocks in blocks_by_res.values():
        by_base: dict[str, list[dict]] = defaultdict(list)
        for block in blocks:
            by_base[block['id']].append(block)
        for group in by_base.values():
            group.sort(key=lambda item: item['_end'])
            for index, block in enumerate(group):
                if index > 0:
                    block['id'] = f"{block['id']}-{block['_end']:%H%M}"
        for block in blocks:
            date = block.pop('_date')
            block.pop('_end')
            days[date].append(block)

    ordered = {}
    for date in sorted(days):
        days[date].sort(key=lambda item: (item['startMinute'], item['label'], item['id']))
        ordered[date] = days[date]

    stats['skipped_status'] = dict(stats['skipped_status'])
    stats['days'] = len(ordered)
    stats['blocks'] = sum(len(items) for items in ordered.values())
    return ordered, stats


def summary_line(stats: dict) -> str:
    blocks = stats['blocks']
    return (
        f"POS lane book: {stats['days']} days, {blocks:,} blocks "
        f"(firm {stats['firm']}, hold {stats['hold']}); "
        f"skipped resource {stats['skipped_resource']}, "
        f"no lanes {stats['skipped_no_lanes']}, "
        f"status {stats['skipped_status']}; "
        f"clipped {stats['clipped']}, bad end {stats['bad_end']}"
    )


def fetch_rows(start: str, end_exclusive: str) -> list[dict]:
    sys.path.insert(0, os.path.join(_ROOT, 'scripts'))
    from db import connect  # imported here so tests do not need pyodbc

    rows = []
    with connect(database='Sync') as conn:
        cur = conn.cursor()
        cur.execute(SQL, (start, end_exclusive))
        for reservation_id, title, status, type_name, resource, start_at, end_at in cur.fetchall():
            rows.append({
                'reservation_id': reservation_id,
                'title': title,
                'status': status,
                'type_name': type_name,
                'resource_name': resource,
                'start': start_at,
                'end': end_at,
            })
    return rows


def main(argv: list[str] | None = None) -> int:
    if load_dotenv is not None:
        load_dotenv(os.path.join(_ROOT, '.env'))

    parser = argparse.ArgumentParser(description='Push the POS lane book to the leads site.')
    parser.add_argument('--start', default='2026-07-10')
    parser.add_argument('--end', default='2028-09-30', help='Last chart date to include, inclusive')
    parser.add_argument('--dry-run', action='store_true', help='Print the book instead of posting it')
    args = parser.parse_args(argv)

    end_day = datetime.strptime(args.end, '%Y-%m-%d').date() + timedelta(days=1)

    try:
        rows = fetch_rows(args.start, end_day.isoformat())
    except Exception as exc:
        print(f'POS lane book: database read failed: {exc}', file=sys.stderr)
        return 1

    days, stats = shape_book(rows)
    print(summary_line(stats))
    if stats['blocks'] == 0:
        print('POS lane book: refusing to send an empty book', file=sys.stderr)
        return 1

    body = {
        'generatedAt': datetime.now(TZ).isoformat(timespec='seconds'),
        'source': SOURCE,
        'days': days,
    }
    if args.dry_run:
        json.dump(body, sys.stdout, indent=2)
        sys.stdout.write('\n')
        return 0

    url = os.getenv('LEADS_LANE_SYNC_URL', '').strip()
    secret = os.getenv('LEADS_LANE_SYNC_SECRET', '').strip()
    if not url or not secret:
        print('POS lane book: LEADS_LANE_SYNC_URL and LEADS_LANE_SYNC_SECRET are required', file=sys.stderr)
        return 1
    if requests is None:
        print('Missing dependency: pip install requests', file=sys.stderr)
        return 1

    try:
        response = requests.post(
            url,
            json=body,
            headers={'x-lane-sync-secret': secret, 'Content-Type': 'application/json'},
            timeout=60,
        )
    except requests.RequestException as exc:
        print(f'POS lane book: post failed: {exc}', file=sys.stderr)
        return 1

    if not response.ok:
        message = ''
        try:
            message = response.json().get('error', '')
        except ValueError:
            message = ''
        print(f'POS lane book: post rejected with status {response.status_code}: {message}', file=sys.stderr)
        return 1

    print('POS lane book posted')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
