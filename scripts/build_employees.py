#!/usr/bin/env python3
"""
build_employees.py

Merge POS employee metrics (_employees_pos.json) with 7shifts labor
(_employees_labor.json) using config/employee_map.txt (primary) and
config/employee_map.json (optional), and write public/data/employees.json.

Run after:
  npm run etl      (or export_dashboards.py — produces _employees_pos.json)
  npm run labor    (pull_7shifts_labor.py — produces _employees_labor.json)

Usage:
  python scripts/build_employees.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POS_PATH = os.path.join(_ROOT, 'public', 'data', '_employees_pos.json')
LABOR_PATH = os.path.join(_ROOT, 'public', 'data', '_employees_labor.json')
MAP_PATH = os.path.join(_ROOT, 'config', 'employee_map.json')
MAP_TXT_PATH = os.path.join(_ROOT, 'config', 'employee_map.txt')
OUTPUT_PATH = os.path.join(_ROOT, 'public', 'data', 'employees.json')

EMPTY_DAY = {
    'sales': 0.0,
    'tickets': 0,
    'gratuity': 0.0,
    'serviceChargeVip': 0.0,
    'serviceChargeParty': 0.0,
    'serviceChargeOther': 0.0,
    'hours': 0.0,
    'laborCost': 0.0,
    'scheduledShifts': 0,
    'lateMinutes': 0.0,
    'noShow': 0,
}


def normalize_name(name: str) -> str:
    return ' '.join((name or '').strip().lower().split())


def slugify(text: str) -> str:
    s = normalize_name(text)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'unknown'


def load_json(path: str) -> dict:
    if not os.path.exists(path):
        print(f'FAIL: missing {path}')
        sys.exit(1)
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def merge_days(pos_days: dict, labor_days: dict) -> dict[str, dict]:
    all_dates = sorted(set(pos_days.keys()) | set(labor_days.keys()))
    merged: dict[str, dict] = {}
    for day in all_dates:
        out = dict(EMPTY_DAY)
        for key, val in (pos_days.get(day) or {}).items():
            if key in out:
                out[key] = val
        for key, val in (labor_days.get(day) or {}).items():
            if key in out:
                out[key] = val
        if any(out[k] for k in out if isinstance(out[k], (int, float)) and out[k]):
            merged[day] = out
    return merged


def resolve_labor_ref(
    ref: str,
    labor_by_id: dict[str, dict],
    labor_by_norm: dict[str, str],
) -> str | None:
    """Resolve a 7shifts user ID or full name to a labor user id string."""
    ref = (ref or '').strip()
    if not ref or ref in ('-', '—'):
        return None
    if ref.isdigit() and ref in labor_by_id:
        return ref
    norm = normalize_name(ref)
    if norm in labor_by_norm:
        return labor_by_norm[norm]
    return None


def load_employee_map_txt(
    labor_by_id: dict[str, dict],
    labor_by_norm: dict[str, str],
) -> list[dict]:
    """
    Parse config/employee_map.txt.

    Format: POS login [, login2 ...] | 7shifts ID or name | display name (optional)
    Lines starting with # are ignored.
    """
    if not os.path.exists(MAP_TXT_PATH):
        return []

    grouped: dict[str, dict] = {}
    line_no = 0

    with open(MAP_TXT_PATH, encoding='utf-8') as f:
        for raw in f:
            line_no += 1
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            if '|' not in line:
                print(f'  map.txt line {line_no}: skipped (no | separator)')
                continue

            parts = [p.strip() for p in line.split('|')]
            if len(parts) < 2:
                continue

            pos_raw = parts[0]
            labor_ref = parts[1]
            display = parts[2] if len(parts) > 2 else ''

            pos_norms = [
                normalize_name(n)
                for n in pos_raw.split(',')
                if normalize_name(n)
            ]
            labor_id = resolve_labor_ref(labor_ref, labor_by_id, labor_by_norm)

            if not pos_norms and not labor_id:
                continue
            if not labor_id:
                # POS listed but no 7shifts match yet — leave for auto-discover
                continue

            group_key = labor_id
            if group_key not in grouped:
                profile = labor_by_id.get(labor_id) or {}
                grouped[group_key] = {
                    'id': slugify(display or profile.get('name') or labor_id),
                    'displayName': display or profile.get('name') or f'User {labor_id}',
                    'posNames': [],
                    'sevenShiftsUserId': int(labor_id),
                }
            entry = grouped[group_key]
            for norm in pos_norms:
                if norm not in entry['posNames']:
                    entry['posNames'].append(norm)
            if display:
                entry['displayName'] = display

    return list(grouped.values())


def load_employee_map_json() -> list[dict]:
    if not os.path.exists(MAP_PATH):
        return []
    data = load_json(MAP_PATH)
    return data.get('employees') or []


def main() -> int:
    pos_data = load_json(POS_PATH)
    labor_data = load_json(LABOR_PATH)

    pos_employees = pos_data.get('employees') or {}
    labor_users = labor_data.get('users') or {}

    # labor lookups
    labor_by_id: dict[str, dict] = labor_users
    labor_by_norm: dict[str, str] = {}
    for uid, profile in labor_users.items():
        norm = normalize_name(profile.get('name') or '')
        if norm and norm not in labor_by_norm:
            labor_by_norm[norm] = uid

    # Mapping: employee_map.txt (edit by hand) then optional employee_map.json
    map_entries = load_employee_map_txt(labor_by_id, labor_by_norm)
    if map_entries:
        print(f'  loaded {len(map_entries)} mapping(s) from config/employee_map.txt')
    json_entries = load_employee_map_json()
    if json_entries:
        print(f'  loaded {len(json_entries)} mapping(s) from config/employee_map.json')
        map_entries.extend(json_entries)

    # pos lookups
    pos_by_norm: dict[str, dict] = pos_employees

    used_labor_ids: set[str] = set()
    used_pos_norms: set[str] = set()
    employees_out: list[dict] = []

    def add_employee(
        emp_id: str,
        display_name: str,
        pos_norms: list[str],
        labor_id: str | None,
        roles: list[str] | None = None,
        wage: float = 0.0,
        hired_at: str = '',
        active: bool = True,
    ) -> None:
        merged_days: dict[str, dict] = {}
        dept_mix: dict[str, float] = defaultdict(float)
        top_items: dict[str, float] = defaultdict(float)

        for norm in pos_norms:
            pos = pos_by_norm.get(norm)
            if not pos:
                continue
            used_pos_norms.add(norm)
            merged_days = merge_days(merged_days, pos.get('days') or {})
            for dept, amt in (pos.get('deptMix') or {}).items():
                dept_mix[dept] += amt
            for item in pos.get('topItems') or []:
                top_items[item.get('name', '')] += item.get('revenue', 0)

        labor_profile = labor_by_id.get(labor_id) if labor_id else None
        if labor_profile:
            used_labor_ids.add(labor_id)
            merged_days = merge_days(merged_days, labor_profile.get('days') or {})
            if not roles:
                roles = labor_profile.get('roles') or []
            if not wage:
                wage = labor_profile.get('wage') or 0.0
            if not hired_at:
                hired_at = labor_profile.get('hiredAt') or ''
            active = labor_profile.get('active', active)

        if not merged_days and not display_name:
            return

        top_items_list = sorted(top_items.items(), key=lambda x: -x[1])[:10]
        dept_mix_sorted = dict(sorted(dept_mix.items(), key=lambda x: -x[1]))

        employees_out.append({
            'id': emp_id,
            'displayName': display_name,
            'posNames': pos_norms,
            'sevenShiftsUserId': int(labor_id) if labor_id and labor_id.isdigit() else None,
            'roles': roles or [],
            'wage': round(float(wage or 0), 2),
            'hiredAt': hired_at or '',
            'active': bool(active),
            'days': merged_days,
            'deptMix': {k: round(v, 2) for k, v in dept_mix_sorted.items()},
            'topItems': [{'name': n, 'revenue': round(r, 2)} for n, r in top_items_list if n],
        })

    # explicit map entries first
    for entry in map_entries:
        emp_id = entry.get('id') or slugify(entry.get('displayName', ''))
        display = entry.get('displayName') or emp_id
        pos_norms = [normalize_name(n) for n in (entry.get('posNames') or [])]
        pos_norms = [n for n in pos_norms if n]
        labor_id = str(entry['sevenShiftsUserId']) if entry.get('sevenShiftsUserId') else None
        if not labor_id:
            for norm in pos_norms:
                labor_id = labor_by_norm.get(norm)
                if labor_id:
                    break
            if not labor_id:
                labor_id = labor_by_norm.get(normalize_name(display))
        add_employee(
            emp_id,
            display,
            pos_norms,
            labor_id,
            roles=entry.get('roles'),
            wage=entry.get('wage') or 0.0,
            hired_at=entry.get('hiredAt') or '',
            active=entry.get('active', True),
        )

    # auto-discover remaining POS employees
    for norm, pos in pos_employees.items():
        if norm in used_pos_norms:
            continue
        display = pos.get('displayName') or norm
        labor_id = labor_by_norm.get(norm)
        add_employee(slugify(display), display, [norm], labor_id)

    # auto-discover labor-only employees (no POS sales)
    for uid, profile in labor_users.items():
        if uid in used_labor_ids:
            continue
        name = profile.get('name') or f'User {uid}'
        add_employee(slugify(name), name, [], uid)

    employees_out.sort(key=lambda e: (-sum(d.get('sales', 0) for d in e['days'].values()), e['displayName'].lower()))

    pos_range = pos_data.get('dateRange') or ['', '']
    labor_range = labor_data.get('dateRange') or ['', '']
    date_range = [
        min(r for r in [pos_range[0], labor_range[0]] if r) if any([pos_range[0], labor_range[0]]) else '',
        max(r for r in [pos_range[1], labor_range[1]] if r) if any([pos_range[1], labor_range[1]]) else '',
    ]

    output = {
        'generatedAt': datetime.now().isoformat(),
        'dateRange': date_range,
        'laborDateRange': labor_range if len(labor_range) == 2 else ['', ''],
        'employees': employees_out,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)
        f.write('\n')

    unmatched_pos = sorted(set(pos_by_norm.keys()) - used_pos_norms)
    unmatched_labor = sorted(set(labor_by_id.keys()) - used_labor_ids)

    print(f'Wrote {OUTPUT_PATH}')
    print(f'  {len(employees_out)} employee(s)')
    print(f'  date range: {date_range[0]} -> {date_range[1]}')
    if labor_range[0] and labor_range[1]:
        print(f'  labor date range: {labor_range[0]} -> {labor_range[1]}')
    if unmatched_pos:
        print(f'  unmatched POS names ({len(unmatched_pos)}): {", ".join(unmatched_pos[:15])}'
              + ('...' if len(unmatched_pos) > 15 else ''))
    if unmatched_labor:
        print(f'  unmatched 7shifts users ({len(unmatched_labor)}): {", ".join(unmatched_labor[:15])}'
              + ('...' if len(unmatched_labor) > 15 else ''))

    return 0


if __name__ == '__main__':
    sys.exit(main())
