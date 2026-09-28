#!/usr/bin/env python3
"""
Build public/data/leagues.json from intraday league rows.

Combined fees are League Fees lines that actually collected money. Before each
league moved to split pricing, lineage and prize fund rang as one of those fees,
so they stay one total and are not assigned to a league.

Split rows are the new per-league items:
  "<League> Lineage"              -> lineage (house revenue)
  "<League> Prize Fund"           -> prizeFund (held for the league)
  "<League> Prize Fund General"   -> prizeFundGeneral (held, lump sum)

The league name is the item name with that suffix removed. Items whose names
start with "Test" are dropped.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LEAGUE_FEES = 'League Fees'
LEAGUE_LINEAGE = 'League Lineage'
LEAGUE_PRIZE = 'League Prize Fund'
SPLIT_DEPARTMENTS = (LEAGUE_LINEAGE, LEAGUE_PRIZE)

# Longer suffix first so "Prize Fund General" is not read as "Prize Fund".
_SUFFIXES = (
    (' Prize Fund General', 'prizeFundGeneral'),
    (' Prize Fund', 'prizeFund'),
    (' Lineage', 'lineage'),
)


def parse_split_item(name: str, department: str):
    """Return (league, kind) or None when the row is not a split league item."""
    raw = (name or '').strip()
    if not raw or raw.lower().startswith('test'):
        return None
    if department == LEAGUE_LINEAGE:
        suffix, kind = _SUFFIXES[2]
    elif department == LEAGUE_PRIZE:
        if raw.endswith(_SUFFIXES[0][0]):
            suffix, kind = _SUFFIXES[0]
        elif raw.endswith(_SUFFIXES[1][0]):
            suffix, kind = _SUFFIXES[1]
        else:
            return None
    else:
        return None
    if not raw.endswith(suffix):
        return None
    league = raw[: -len(suffix)].strip()
    if not league or league.lower().startswith('test'):
        return None
    return league, kind


def _round_money(value: float) -> float:
    return round(float(value or 0), 2)


def build_league_payload(intraday_rows, void_rows=None) -> dict:
    """Pure aggregation. intraday and void rows use the dashboard shard shape."""
    combined: dict[str, dict] = {}
    split: dict[tuple, dict] = {}
    voids: dict[tuple, dict] = {}
    dates: list[str] = []

    for row in intraday_rows or []:
        department = (row.get('department') or '').strip()
        date = row.get('date') or ''
        if not date:
            continue
        if department == LEAGUE_FEES:
            revenue = float(row.get('revenue') or 0)
            if revenue == 0:
                continue
            dates.append(date)
            bucket = combined.setdefault(date, {'date': date, 'revenue': 0.0, 'payments': 0})
            bucket['revenue'] += revenue
            bucket['payments'] += int(row.get('transactions') or 0)
            continue
        parsed = parse_split_item(row.get('name') or '', department)
        if not parsed:
            continue
        league, kind = parsed
        dates.append(date)
        key = (date, league, kind)
        bucket = split.setdefault(key, {
            'date': date,
            'league': league,
            'kind': kind,
            'revenue': 0.0,
            'quantity': 0.0,
            'payments': 0,
            'firstSlot': None,
        })
        bucket['revenue'] += float(row.get('revenue') or 0)
        bucket['quantity'] += float(row.get('quantity') or 0)
        bucket['payments'] += int(row.get('transactions') or 0)
        slot = row.get('slot')
        if slot is not None and (bucket['firstSlot'] is None or slot < bucket['firstSlot']):
            bucket['firstSlot'] = slot

    for row in void_rows or []:
        department = (row.get('department') or '').strip()
        parsed = parse_split_item(row.get('name') or '', department)
        if not parsed:
            continue
        league, kind = parsed
        date = row.get('date') or ''
        if not date:
            continue
        dates.append(date)
        key = (date, league, kind)
        bucket = voids.setdefault(key, {
            'date': date,
            'league': league,
            'kind': kind,
            'count': 0.0,
            'value': 0.0,
        })
        bucket['count'] += abs(float(row.get('quantity') or 0))
        bucket['value'] += float(row.get('value') or 0)

    combined_out = []
    for row in sorted(combined.values(), key=lambda r: r['date']):
        combined_out.append({
            'date': row['date'],
            'revenue': _round_money(row['revenue']),
            'payments': row['payments'],
        })

    split_out = []
    for row in sorted(split.values(), key=lambda r: (r['date'], r['league'], r['kind'])):
        split_out.append({
            'date': row['date'],
            'league': row['league'],
            'kind': row['kind'],
            'revenue': _round_money(row['revenue']),
            'quantity': row['quantity'],
            'payments': row['payments'],
            'firstSlot': row['firstSlot'] if row['firstSlot'] is not None else 0,
        })

    void_out = []
    for row in sorted(voids.values(), key=lambda r: (r['date'], r['league'], r['kind'])):
        void_out.append({
            'date': row['date'],
            'league': row['league'],
            'kind': row['kind'],
            'count': row['count'],
            'value': _round_money(row['value']),
        })

    return {
        'generatedAt': datetime.now().isoformat(),
        'dataThrough': max(dates) if dates else '',
        'combined': combined_out,
        'split': split_out,
        'voids': void_out,
    }


def load_published_rows(root: str | None = None):
    """Read the league intraday shards already published under public/data."""
    base = os.path.join(root or _ROOT, 'public', 'data', 'intraday')
    rows = []
    voids = []
    for department in (LEAGUE_FEES, LEAGUE_LINEAGE, LEAGUE_PRIZE):
        folder = os.path.join(base, department)
        if os.path.isdir(folder):
            for name in sorted(os.listdir(folder)):
                if not name.endswith('.json'):
                    continue
                with open(os.path.join(folder, name), encoding='utf-8') as handle:
                    rows.extend(json.load(handle))
        void_folder = os.path.join(base, 'voids', department)
        if os.path.isdir(void_folder):
            for name in sorted(os.listdir(void_folder)):
                if not name.endswith('.json'):
                    continue
                with open(os.path.join(void_folder, name), encoding='utf-8') as handle:
                    voids.extend(json.load(handle))
    return rows, voids


def write_published(root: str | None = None) -> dict:
    rows, voids = load_published_rows(root)
    payload = build_league_payload(rows, voids)
    out = os.path.join(root or _ROOT, 'public', 'data', 'leagues.json')
    with open(out, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2)
        handle.write('\n')
    return payload


def _print_summary(payload: dict) -> None:
    combined = sum(row['revenue'] for row in payload['combined'])
    by_kind = {}
    leagues = set()
    for row in payload['split']:
        by_kind[row['kind']] = by_kind.get(row['kind'], 0) + row['revenue']
        leagues.add(row['league'])
    print(f"  dataThrough: {payload['dataThrough']}")
    print(f"  combined fees: ${combined:,.2f} across {len(payload['combined'])} days")
    print(f"  split leagues: {len(leagues)}")
    for kind in ('lineage', 'prizeFund', 'prizeFundGeneral'):
        print(f"  {kind}: ${by_kind.get(kind, 0):,.2f}")
    print(f"  void groups: {len(payload['voids'])}")


if __name__ == '__main__':
    if '--from-published' not in sys.argv:
        print('Usage: python scripts/league_export.py --from-published')
        sys.exit(1)
    payload = write_published()
    print(f"Wrote public/data/leagues.json")
    _print_summary(payload)
