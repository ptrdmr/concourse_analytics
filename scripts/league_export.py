#!/usr/bin/env python3
"""
Build public/data/leagues.json from intraday league rows.

Named League Fees products are that league's money from before lineage and
prize fund were split. They stay one amount on the league (kind preSplit).
They are not guessed into lineage and prize fund.

Wednesday League Payment is Super Sports house revenue (kind leaguePayment).
League Payment on any other weekday stays in the shared combined total, along
with anything still unnamed.

Ladies 600 is not Lucky Ladies & Gents. Monday Night Out is not Monday No Tap.
Silver & Gold is not Silver Striking Seniors.

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
import re
import sys
from datetime import date, datetime

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LEAGUE_FEES = 'League Fees'
LEAGUE_LINEAGE = 'League Lineage'
LEAGUE_PRIZE = 'League Prize Fund'
SPLIT_DEPARTMENTS = (LEAGUE_LINEAGE, LEAGUE_PRIZE)
# Wednesday League Payment is Super Sports. Other weekdays stay unassigned.
LEAGUE_PAYMENT_ITEM = 'LEAGUE PAYMENT'

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
    league = canonical_league_name(raw[: -len(suffix)].strip())
    if not league or league.lower().startswith('test'):
        return None
    return league, kind


def canonical_league_name(name: str) -> str:
    """Super Sports 1 and 2 are collected as one league."""
    folded = ' '.join((name or '').split())
    if re.match(r'(?i)super\s*sports\b', folded):
        return 'Super Sports'
    return folded


def _norm_fee_name(name: str) -> str:
    text = (name or '').lower().replace('&', ' and ')
    text = re.sub(r'[^a-z0-9]+', ' ', text)
    return ' '.join(text.split())


# Historical item names that belong to one league. The money is not split
# into lineage and prize fund; the back office did that by hand.
FEE_LEAGUES = {
    'river magic fees': 'River Magic',
    'river magic 24 fees': 'River Magic',
    'river magic 23 24 fees': 'River Magic',
    'river magic summer 23': 'River Magic',
    'vegas bound fees': 'Vegas Bound',
    'vegas bound': 'Vegas Bound',
    'vegas bound summer 24': 'Vegas Bound',
    'alley cats fees': 'Alley Cats',
    'ally cats fees': 'Alley Cats',
    'alley cats 24 fees': 'Alley Cats',
    'alley cats winter 25 26': 'Alley Cats',
    'alley cats summer': 'Alley Cats',
    'vegas or bust fees': 'Vegas or Bust',
    'vegas or bust25': 'Vegas or Bust',
    'vegas or bust 24 fees': 'Vegas or Bust',
    'vegas or bust 24 25': 'Vegas or Bust',
    'vegas or bust summer 26': 'Vegas or Bust',
    'vegas or bust 25 26': 'Vegas or Bust',
    'vorb 26 27': 'Vegas or Bust',
    'vorb23': 'Vegas or Bust',
    'vegas bowl 4 dollars': "Bowling 4 $'s",
    'vb4d': "Bowling 4 $'s",
    'vb4d fees': "Bowling 4 $'s",
    'vb4d27': "Bowling 4 $'s",
    'monday no tap fees': 'Monday No Tap',
    'monday notap 2025': 'Monday No Tap',
    'mon no tap 26': 'Monday No Tap',
    'monday no tap 24': 'Monday No Tap',
    'monday night out fees': 'Monday Night Out',
    'monday night out 2425': 'Monday Night Out',
    'monday night out 26': 'Monday Night Out',
    'lucky ladies and gents fees': 'Lucky Ladies & Gents',
    'ladies n gents': 'Lucky Ladies & Gents',
    'ladies and gents': 'Lucky Ladies & Gents',
    'ladies n gents 27': 'Lucky Ladies & Gents',
    'ladies 600 fees': 'Ladies 600',
    'pins and needles': 'Pins and Needles',
    'pinsnneedles': 'Pins and Needles',
    'pnn2627': 'Pins and Needles',
    'renegades fees': 'Renegades',
    'renegades 24': 'Renegades',
    'renegades 26': 'Renegades',
    'renegades 2627': 'Renegades',
    'renegades 23 24': 'Renegades',
    'cerra villa no tap': 'Cerra Villa',
    'cerra villa notap': 'Cerra Villa',
    'cerra villa notap 26': 'Cerra Villa',
    'cerra villa 26 27': 'Cerra Villa',
    'silver and gold': 'Silver & Gold',
    'silver and gold 26 27': 'Silver & Gold',
    'silver striking seniors': 'Silver Striking Seniors',
    'ss seniors': 'Silver Striking Seniors',
    'ss seniors 25 26': 'Silver Striking Seniors',
    'ss seniors 2627': 'Silver Striking Seniors',
    'big ballers': 'Big Ballers',
    'big ballers fees': 'Big Ballers',
    'big ballers26 27': 'Big Ballers',
    'big ballers 2526': 'Big Ballers',
    'ebowla': 'Ebowla',
    'ebowla fees': 'Ebowla',
}


def is_wednesday(iso_date: str) -> bool:
    year, month, day = (int(part) for part in iso_date.split('-'))
    return date(year, month, day).weekday() == 2


def fee_league(name: str):
    """Return the league for a named pre-split fee, or None if it stays shared."""
    if (name or '').strip().upper() == LEAGUE_PAYMENT_ITEM:
        return None
    return FEE_LEAGUES.get(_norm_fee_name(name))


def _add_split(split: dict, dates: list, date: str, league: str, kind: str, row: dict) -> None:
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
            item = (row.get('name') or '').strip()
            if item.upper() == LEAGUE_PAYMENT_ITEM and is_wednesday(date):
                _add_split(split, dates, date, 'Super Sports', 'leaguePayment', row)
                continue
            named = fee_league(item)
            if named:
                _add_split(split, dates, date, named, 'preSplit', row)
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
        _add_split(split, dates, date, league, kind, row)

    for row in void_rows or []:
        department = (row.get('department') or '').strip()
        date = row.get('date') or ''
        item = (row.get('name') or '').strip()
        if not date:
            continue
        if department == LEAGUE_FEES and item.upper() == LEAGUE_PAYMENT_ITEM and is_wednesday(date):
            league, kind = 'Super Sports', 'leaguePayment'
        elif department == LEAGUE_FEES and fee_league(item):
            league, kind = fee_league(item), 'preSplit'
        else:
            parsed = parse_split_item(item, department)
            if not parsed:
                continue
            league, kind = parsed
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
    for kind in ('preSplit', 'lineage', 'prizeFund', 'prizeFundGeneral', 'leaguePayment'):
        print(f"  {kind}: ${by_kind.get(kind, 0):,.2f}")
    print(f"  void groups: {len(payload['voids'])}")


if __name__ == '__main__':
    if '--from-published' not in sys.argv:
        print('Usage: python scripts/league_export.py --from-published')
        sys.exit(1)
    payload = write_published()
    print(f"Wrote public/data/leagues.json")
    _print_summary(payload)
