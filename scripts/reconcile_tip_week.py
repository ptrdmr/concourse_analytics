#!/usr/bin/env python3
"""
Compare the 10/19-10/25 weekly tip sheet with the worksheet engine.

The sheet is the old manual payout. Totals should be in the same neighborhood.
Person amounts will differ where the new rules differ from what a manager typed.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, date
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
SHEET = ROOT / 'tip reference tools' / 'tip summary - the compiling layer that ingests all the changes to tips(gratuity & service charges) daily & weekly.xlsx'
FACTS = ROOT / 'public' / 'data' / 'tips' / '2026-10.json'
OUT = ROOT / 'output' / 'tip_sheet_2026-10-19.json'


def cents(value) -> int:
    if value is None or value == '':
        return 0
    if isinstance(value, str):
        text = value.replace('$', '').replace(',', '').strip()
        if not text:
            return 0
        return int(round(float(text) * 100))
    return int(round(float(value) * 100))


def as_date(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return None


def read_sheet() -> dict:
    wb = load_workbook(SHEET, data_only=False, read_only=True)
    ws = wb['10-19 10-25']
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    header = list(rows[1])
    columns = {}
    for index, value in enumerate(header):
        day = as_date(value)
        if day:
            columns[index] = day
    totals = {}
    total_row = list(rows[2])
    for index, day in columns.items():
        totals[day] = cents(total_row[index] if index < len(total_row) else 0)
    people = []
    for raw in rows[4:]:
        row = list(raw)
        last = (row[0] or '').strip() if row else ''
        first = (row[1] or '').strip() if len(row) > 1 and row[1] else ''
        position = (row[2] or '').strip() if len(row) > 2 and row[2] else ''
        if not last and not first:
            continue
        if position.lower().startswith('daily') or last.lower().startswith('daily'):
            continue
        days = {}
        for index, day in columns.items():
            amount = cents(row[index] if index < len(row) else 0)
            if amount:
                days[day] = amount
        if not days:
            continue
        people.append({
            'name': f'{first} {last}'.strip(),
            'position': position,
            'days': days,
        })
    return {'dates': [columns[index] for index in sorted(columns)], 'totals': totals, 'people': people}


def main() -> int:
    if not FACTS.is_file():
        print(f'Missing {FACTS}. Run py -3 scripts/export_tips.py first.', file=sys.stderr)
        return 1
    payload = read_sheet()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload), encoding='utf-8')
    node = os.environ.get('NODE', 'node')
    script = ROOT / 'scripts' / 'reconcile_tip_week.ts'
    result = subprocess.run(
        [node, '--experimental-strip-types', str(script), str(OUT), str(FACTS)],
        cwd=ROOT,
        check=False,
    )
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
