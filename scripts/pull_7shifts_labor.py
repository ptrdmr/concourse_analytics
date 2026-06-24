#!/usr/bin/env python3
"""
pull_7shifts_labor.py

Pull labor data from 7shifts and write:
  - public/data/labor.json (daily totals for Sales vs Labor card)
  - public/data/labor_intraday.json (30-min slot shape for Day Shape overlay)

Primary source: Daily Sales & Labor report (actual_labor_cost) — matches the
7shifts website exactly, including overtime, salaried staff, and employer uplift.

Fallback: time_punch aggregation with profile wage lookup + optional uplift %.

Requires .env (gitignored):
  SEVENSHIFTS_TOKEN=...
  SEVENSHIFTS_COMPANY_ID=...

Optional:
  SEVENSHIFTS_GUID=...              # company UUID; auto-fetched from /companies if blank
  SEVENSHIFTS_TIMEZONE=America/Los_Angeles
  SEVENSHIFTS_PULL_DAYS=365
  SEVENSHIFTS_LABOR_UPLIFT_PCT=12   # fallback only: employer taxes/benefits %

Usage:
  python scripts/pull_7shifts_labor.py
  python scripts/pull_7shifts_labor.py --days 90
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    print('Missing dependency: pip install requests python-dotenv')
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.path.join(_ROOT, 'public', 'data', 'labor.json')
INTRADAY_OUTPUT_PATH = os.path.join(_ROOT, 'public', 'data', 'labor_intraday.json')
EMPLOYEES_LABOR_OUTPUT_PATH = os.path.join(_ROOT, 'public', 'data', '_employees_labor.json')
EMPLOYEE_MAP_PATH = os.path.join(_ROOT, 'config', 'employee_map.json')
API_BASE = 'https://api.7shifts.com/v2'
BUSINESS_DAY_CUTOFF_HOUR = 4
DEFAULT_PULL_DAYS = 365
PAGE_LIMIT = 100
REPORT_CHUNK_DAYS = 28
MIN_REQUEST_INTERVAL = 0.11
RECONCILE_DATE = '2026-06-17'
RECONCILE_TARGET_CENTS = 282900  # $2,829 on 7shifts website
FACTOR_MIN = 0.5
FACTOR_MAX = 3.0
SLOT_RESOLUTION_MINUTES = 30


def load_env() -> None:
    env_path = os.path.join(_ROOT, '.env')
    if load_dotenv is not None and os.path.exists(env_path):
        load_dotenv(env_path)


def require_env(name: str) -> str:
    value = os.getenv(name, '').strip()
    if not value:
        print(f'FAIL: missing {name} in .env')
        sys.exit(1)
    return value


def parse_iso(dt_str: str) -> datetime:
    if dt_str.endswith('Z'):
        dt_str = dt_str[:-1] + '+00:00'
    return datetime.fromisoformat(dt_str)


def parse_date(iso: str) -> date:
    return date.fromisoformat(iso)


def business_date_from_clocked_in(clocked_in_iso: str, tz: ZoneInfo) -> str:
    dt = parse_iso(clocked_in_iso).astimezone(tz)
    if dt.hour < BUSINESS_DAY_CUTOFF_HOUR:
        dt = dt - timedelta(days=1)
    return dt.strftime('%Y-%m-%d')


def unpaid_break_hours(breaks: list | None) -> float:
    total = 0.0
    for br in breaks or []:
        if br.get('paid'):
            continue
        start = br.get('in')
        end = br.get('out')
        if not start or not end:
            continue
        total += (parse_iso(end) - parse_iso(start)).total_seconds() / 3600.0
    return total


def punch_worked_hours(punch: dict) -> float:
    clocked_in = punch.get('clocked_in')
    clocked_out = punch.get('clocked_out')
    if not clocked_in or not clocked_out:
        return 0.0
    gross = (parse_iso(clocked_out) - parse_iso(clocked_in)).total_seconds() / 3600.0
    return max(0.0, gross - unpaid_break_hours(punch.get('breaks')))


def dt_to_slot(dt: datetime) -> int:
    """30-min slot index (0-47), same convention as POS intraday export."""
    return dt.hour * 2 + (1 if dt.minute >= 30 else 0)


def slot_bounds(business_date_str: str, slot: int, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """Local start/end for a slot within a business day (4 AM start)."""
    bd = parse_date(business_date_str)
    hour = slot // 2
    minute = 30 if slot % 2 == 1 else 0
    day = bd if slot >= 8 else bd + timedelta(days=1)
    start = datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
    return start, start + timedelta(minutes=SLOT_RESOLUTION_MINUTES)


def subtract_interval(
    intervals: list[tuple[datetime, datetime]],
    cut_start: datetime,
    cut_end: datetime,
) -> list[tuple[datetime, datetime]]:
    """Remove [cut_start, cut_end) from a list of half-open work intervals."""
    result: list[tuple[datetime, datetime]] = []
    for start, end in intervals:
        if cut_end <= start or cut_start >= end:
            result.append((start, end))
            continue
        if cut_start > start:
            result.append((start, cut_start))
        if cut_end < end:
            result.append((cut_end, end))
    return result


def punch_work_intervals(punch: dict, tz: ZoneInfo) -> list[tuple[datetime, datetime]]:
    clocked_in = punch.get('clocked_in')
    clocked_out = punch.get('clocked_out')
    if not clocked_in or not clocked_out:
        return []
    start = parse_iso(clocked_in).astimezone(tz)
    end = parse_iso(clocked_out).astimezone(tz)
    if end <= start:
        return []
    intervals = [(start, end)]
    for br in punch.get('breaks') or []:
        if br.get('paid'):
            continue
        b_in = br.get('in')
        b_out = br.get('out')
        if not b_in or not b_out:
            continue
        intervals = subtract_interval(
            intervals,
            parse_iso(b_in).astimezone(tz),
            parse_iso(b_out).astimezone(tz),
        )
    return intervals


def overlap_hours(
    interval_start: datetime,
    interval_end: datetime,
    slot_start: datetime,
    slot_end: datetime,
) -> float:
    overlap_start = max(interval_start, slot_start)
    overlap_end = min(interval_end, slot_end)
    if overlap_end <= overlap_start:
        return 0.0
    return (overlap_end - overlap_start).total_seconds() / 3600.0


def chunk_date_range(start: str, end: str, max_days: int = REPORT_CHUNK_DAYS) -> list[tuple[str, str]]:
    """Split [start, end] into inclusive windows of at most max_days."""
    chunks: list[tuple[str, str]] = []
    cur = parse_date(start)
    end_d = parse_date(end)
    while cur <= end_d:
        chunk_end = min(cur + timedelta(days=max_days - 1), end_d)
        chunks.append((cur.isoformat(), chunk_end.isoformat()))
        cur = chunk_end + timedelta(days=1)
    return chunks


def round_day(entry: dict) -> dict:
    out: dict = {
        'laborCost': round(entry['laborCost'], 2),
        'laborHours': round(entry['laborHours'], 2),
    }
    if 'punchCount' in entry:
        out['punchCount'] = int(entry['punchCount'])
    if entry.get('tips'):
        out['tips'] = round(entry['tips'], 2)
    if entry.get('source'):
        out['source'] = entry['source']
    return out


class SevenShiftsClient:
    def __init__(self, token: str, company_id: str, company_guid: str | None = None) -> None:
        self.company_id = company_id
        self.company_guid = company_guid
        self.session = requests.Session()
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': 'application/json',
        }
        if company_guid:
            headers['x-company-guid'] = company_guid
        self.session.headers.update(headers)
        self._last_request_at = 0.0

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < MIN_REQUEST_INTERVAL:
            time.sleep(MIN_REQUEST_INTERVAL - elapsed)
        self._last_request_at = time.monotonic()

    def request(self, path: str, params: dict | None = None, *, fatal: bool = True) -> tuple[int, dict | None]:
        url = f'{API_BASE}{path}'
        for attempt in range(5):
            self._throttle()
            resp = self.session.get(url, params=params, timeout=60)
            if resp.status_code == 429:
                wait = min(2 ** attempt, 30)
                print(f'  rate limited, retrying in {wait}s...')
                time.sleep(wait)
                continue
            if resp.status_code == 401:
                print('FAIL: 401 Unauthorized — check SEVENSHIFTS_TOKEN')
                sys.exit(1)
            if not fatal:
                try:
                    body = resp.json() if resp.content else None
                except ValueError:
                    body = None
                return resp.status_code, body
            resp.raise_for_status()
            return resp.status_code, resp.json()
        if fatal:
            print('FAIL: exceeded retries due to rate limiting')
            sys.exit(1)
        return 429, None

    def get(self, path: str, params: dict | None = None) -> dict:
        _, payload = self.request(path, params, fatal=True)
        return payload or {}

    def verify(self) -> None:
        data = self.get('/whoami')
        identity = data.get('data') or data
        print(f'  authenticated as identity_id={identity.get("identity_id", "?")}')

    def resolve_company_guid(self) -> str:
        if self.company_guid:
            return self.company_guid
        payload = self.get('/companies')
        companies = payload.get('data') or []
        for company in companies:
            if str(company.get('id')) == str(self.company_id):
                guid = company.get('uuid') or company.get('guid')
                if guid:
                    self.company_guid = guid
                    self.session.headers['x-company-guid'] = guid
                    print(f'  resolved company GUID from /companies: {guid}')
                    print('  tip: add SEVENSHIFTS_GUID to .env to skip this lookup')
                    return guid
        print('FAIL: could not resolve company GUID — set SEVENSHIFTS_GUID in .env')
        sys.exit(1)

    def list_locations(self) -> list[dict]:
        payload = self.get(f'/company/{self.company_id}/locations')
        return payload.get('data') or []

    def list_time_punches(self, business_start: str, business_end: str) -> list[dict]:
        punches: list[dict] = []
        cursor: str | None = None
        page = 0

        while True:
            params: dict = {
                'business_date_start': business_start,
                'business_date_end': business_end,
                'limit': PAGE_LIMIT,
                'include_deleted': 'false',
            }
            if cursor:
                params['cursor'] = cursor

            payload = self.get(
                f'/company/{self.company_id}/time_punches',
                params=params,
            )
            batch = payload.get('data') or []
            punches.extend(batch)
            page += 1
            print(f'  page {page}: +{len(batch)} punches (total {len(punches)})')

            meta = payload.get('meta') or {}
            cursor_meta = meta.get('cursor') or {}
            next_cursor = cursor_meta.get('next')

            if not next_cursor:
                break
            cursor = next_cursor

        return punches

    def fetch_daily_sales_labor(
        self,
        location_id: int,
        start_date: str,
        end_date: str,
    ) -> tuple[int, list[dict]]:
        status, payload = self.request(
            '/reports/daily_sales_and_labor',
            params={
                'start_date': start_date,
                'end_date': end_date,
                'location_id': location_id,
            },
            fatal=False,
        )
        if status != 200 or not payload:
            return status, []
        return status, payload.get('data') or []


class WageResolver:
    """Look up profile wages when punch hourly_wage is zero."""

    def __init__(self, client: SevenShiftsClient) -> None:
        self.client = client
        self._cache: dict[int, dict] = {}

    def _load(self, user_id: int) -> dict:
        if user_id not in self._cache:
            payload = self.client.get(f'/company/{self.client.company_id}/users/{user_id}/wages')
            self._cache[user_id] = payload.get('data') or payload
        return self._cache[user_id]

    def hourly_wage(self, user_id: int, role_id: int | None) -> tuple[float, str]:
        data = self._load(user_id)
        rows = data.get('current_wages') or []
        hourly = [w for w in rows if w.get('wage_type') == 'hourly']
        if role_id:
            for w in hourly:
                if w.get('role_id') == role_id:
                    return w.get('wage_cents', 0) / 100.0, 'profile(role)'
        if hourly:
            best = max(w.get('wage_cents', 0) for w in hourly)
            return best / 100.0, 'profile(any-hourly)'
        if any(w.get('wage_type') == 'salaried' for w in rows):
            return 0.0, 'salaried'
        return 0.0, 'none'


def resolve_punch_wage(punch: dict, wage_resolver: WageResolver) -> float:
    wage = float(punch.get('hourly_wage') or 0) / 100.0
    if wage == 0:
        wage, _note = wage_resolver.hourly_wage(punch['user_id'], punch.get('role_id'))
    return wage


def fetch_roles(client: SevenShiftsClient) -> dict[str, str]:
    payload = client.get(f'/company/{client.company_id}/roles')
    roles: dict[str, str] = {}
    for role in payload.get('data') or []:
        role_id = role.get('id')
        name = role.get('name')
        if role_id is not None and name:
            roles[str(role_id)] = name
    return roles


def list_users(client: SevenShiftsClient) -> list[dict]:
    users: list[dict] = []
    cursor: str | None = None
    page = 0
    while True:
        params: dict = {'limit': PAGE_LIMIT}
        if cursor:
            params['cursor'] = cursor
        payload = client.get(f'/company/{client.company_id}/users', params=params)
        batch = payload.get('data') or []
        users.extend(batch)
        page += 1
        print(f'  users page {page}: +{len(batch)} (total {len(users)})')
        meta = payload.get('meta') or {}
        cursor_meta = meta.get('cursor') or {}
        next_cursor = cursor_meta.get('next')
        if not next_cursor:
            break
        cursor = next_cursor
    return users


def list_shifts(client: SevenShiftsClient, business_start: str, business_end: str) -> list[dict]:
    shifts: list[dict] = []
    cursor: str | None = None
    page = 0
    while True:
        params: dict = {
            'start': business_start,
            'end': business_end,
            'limit': PAGE_LIMIT,
            'include_deleted': 'false',
        }
        if cursor:
            params['cursor'] = cursor
        status, payload = client.request(
            f'/company/{client.company_id}/shifts',
            params=params,
            fatal=False,
        )
        if status != 200 or not payload:
            if page == 0:
                print(f'  shifts unavailable (HTTP {status}) — punctuality metrics skipped')
            break
        batch = payload.get('data') or []
        shifts.extend(batch)
        page += 1
        print(f'  shifts page {page}: +{len(batch)} (total {len(shifts)})')
        meta = payload.get('meta') or {}
        cursor_meta = meta.get('cursor') or {}
        next_cursor = cursor_meta.get('next')
        if not next_cursor:
            break
        cursor = next_cursor
    return shifts


def _normalize_name(name: str) -> str:
    return ' '.join((name or '').strip().lower().split())


def _empty_labor_day() -> dict:
    return {
        'hours': 0.0,
        'laborCost': 0.0,
        'punches': 0,
        'scheduledShifts': 0,
        'lateMinutes': 0,
        'noShow': 0,
    }


def aggregate_employees_labor(
    punches: list[dict],
    users: list[dict],
    shifts: list[dict],
    roles: dict[str, str],
    tz: ZoneInfo,
    client: SevenShiftsClient,
    uplift_pct: float = 0.0,
) -> dict:
    wage_resolver = WageResolver(client)
    multiplier = 1.0 + uplift_pct / 100.0

    user_profiles: dict[int, dict] = {}
    for user in users:
        uid = user.get('id')
        if uid is None:
            continue
        first = (user.get('first_name') or '').strip()
        last = (user.get('last_name') or '').strip()
        full = f'{first} {last}'.strip() or str(user.get('preferred_name') or user.get('name') or uid)
        user_profiles[int(uid)] = {
            'name': full,
            'hiredAt': user.get('hire_date') or user.get('created') or '',
            'active': user.get('active', True),
        }

    # scheduled shifts per user per business date
    scheduled: dict[tuple[int, str], list[datetime]] = defaultdict(list)
    for shift in shifts:
        if shift.get('deleted'):
            continue
        uid = shift.get('user_id')
        start_iso = shift.get('start') or shift.get('start_time')
        if uid is None or not start_iso:
            continue
        start_dt = parse_iso(start_iso).astimezone(tz)
        bd = business_date_from_clocked_in(start_iso, tz)
        scheduled[(int(uid), bd)].append(start_dt)

    # first clock-in per user per business date
    first_punch: dict[tuple[int, str], datetime] = {}
    for punch in punches:
        if punch.get('deleted'):
            continue
        uid = punch.get('user_id')
        clocked_in = punch.get('clocked_in')
        if uid is None or not clocked_in:
            continue
        uid = int(uid)
        bd = business_date_from_clocked_in(clocked_in, tz)
        dt = parse_iso(clocked_in).astimezone(tz)
        key = (uid, bd)
        if key not in first_punch or dt < first_punch[key]:
            first_punch[key] = dt

    employees: dict[str, dict] = {}
    for uid, profile in user_profiles.items():
        employees[str(uid)] = {
            'name': profile['name'],
            'hiredAt': profile['hiredAt'],
            'active': bool(profile['active']),
            'roles': set(),
            'wage': 0.0,
            'days': defaultdict(_empty_labor_day),
        }

    skipped = 0
    for punch in punches:
        if punch.get('deleted'):
            skipped += 1
            continue
        clocked_in = punch.get('clocked_in')
        uid = punch.get('user_id')
        if not clocked_in or uid is None:
            skipped += 1
            continue
        uid = int(uid)
        hours = punch_worked_hours(punch)
        if hours <= 0:
            skipped += 1
            continue

        wage = resolve_punch_wage(punch, wage_resolver)
        cost = hours * wage * multiplier
        role_id = punch.get('role_id')
        bd = business_date_from_clocked_in(clocked_in, tz)

        if str(uid) not in employees:
            employees[str(uid)] = {
                'name': f'User {uid}',
                'hiredAt': '',
                'active': True,
                'roles': set(),
                'wage': 0.0,
                'days': defaultdict(_empty_labor_day),
            }

        entry = employees[str(uid)]
        if role_id is not None:
            entry['roles'].add(roles.get(str(role_id), f'Role {role_id}'))
        if wage > entry['wage']:
            entry['wage'] = wage

        day = entry['days'][bd]
        day['hours'] += hours
        day['laborCost'] += cost
        day['punches'] += 1

    # punctuality + no-shows from schedules
    for (uid, bd), starts in scheduled.items():
        key = str(uid)
        if key not in employees:
            employees[key] = {
                'name': user_profiles.get(uid, {}).get('name', f'User {uid}'),
                'hiredAt': user_profiles.get(uid, {}).get('hiredAt', ''),
                'active': user_profiles.get(uid, {}).get('active', True),
                'roles': set(),
                'wage': 0.0,
                'days': defaultdict(_empty_labor_day),
            }
        day = employees[key]['days'][bd]
        day['scheduledShifts'] += len(starts)
        punch_start = first_punch.get((uid, bd))
        if punch_start is None:
            day['noShow'] += len(starts)
        else:
            earliest_sched = min(starts)
            late = (punch_start - earliest_sched).total_seconds() / 60.0
            if late > 5:
                day['lateMinutes'] += round(late)

    users_out: dict[str, dict] = {}
    for uid, entry in employees.items():
        days_out = {}
        for day_key, vals in entry['days'].items():
            days_out[day_key] = {
                'hours': round(vals['hours'], 2),
                'laborCost': round(vals['laborCost'], 2),
                'punches': int(vals['punches']),
                'scheduledShifts': int(vals['scheduledShifts']),
                'lateMinutes': round(vals['lateMinutes'], 1),
                'noShow': int(vals['noShow']),
            }
        users_out[uid] = {
            'name': entry['name'],
            'roles': sorted(entry['roles']),
            'wage': round(entry['wage'], 2),
            'hiredAt': entry['hiredAt'],
            'active': entry['active'],
            'days': days_out,
        }

    if skipped:
        print(f'  employee labor: skipped {skipped} punches')

    return users_out


def build_employees_labor_output(
    punches: list[dict],
    client: SevenShiftsClient,
    tz: ZoneInfo,
    business_start: str,
    business_end: str,
    uplift_pct: float = 0.0,
) -> dict:
    print('Building per-employee labor from punches + users...')
    users = list_users(client)
    roles = fetch_roles(client)
    shifts = list_shifts(client, business_start, business_end)
    users_data = aggregate_employees_labor(
        punches, users, shifts, roles, tz, client, uplift_pct,
    )
    return {
        'generatedAt': datetime.now(tz).isoformat(),
        'timezone': str(tz),
        'dateRange': [business_start, business_end],
        'roles': roles,
        'users': users_data,
    }


def aggregate_punches_intraday(
    punches: list[dict],
    tz: ZoneInfo,
    client: SevenShiftsClient,
) -> tuple[dict[str, dict], dict[str, str]]:
    """
    Bucket punches into 30-min slots per business date.
    Returns days[date]['slots'][slot] = {cost, headcount_users: set} before reconciliation.
    """
    wage_resolver = WageResolver(client)
    roles_seen: dict[str, str] = {}
    days: dict[str, dict] = defaultdict(lambda: {
        'slots': defaultdict(lambda: {'cost': 0.0, 'users': set()}),
        'rawCost': 0.0,
    })

    skipped = 0
    for punch in punches:
        if punch.get('deleted'):
            skipped += 1
            continue
        clocked_in = punch.get('clocked_in')
        if not clocked_in:
            skipped += 1
            continue

        user_id = punch.get('user_id')
        if user_id is None:
            skipped += 1
            continue

        role_id = punch.get('role_id')
        if role_id is not None:
            roles_seen[str(role_id)] = roles_seen.get(str(role_id), '')

        wage = resolve_punch_wage(punch, wage_resolver)
        business_date = business_date_from_clocked_in(clocked_in, tz)
        day_entry = days[business_date]

        intervals = punch_work_intervals(punch, tz)
        if not intervals:
            skipped += 1
            continue

        punch_cost = 0.0
        for interval_start, interval_end in intervals:
            for slot in range(48):
                slot_start, slot_end = slot_bounds(business_date, slot, tz)
                hours = overlap_hours(interval_start, interval_end, slot_start, slot_end)
                if hours <= 0:
                    continue
                slot_entry = day_entry['slots'][slot]
                slot_entry['cost'] += hours * wage
                slot_entry['users'].add(user_id)
                punch_cost += hours * wage

        day_entry['rawCost'] += punch_cost

    if skipped:
        print(f'  intraday: skipped {skipped} punches (deleted, open, or zero hours)')

    return dict(days), roles_seen


def reconcile_intraday_days(
    intraday_days: dict[str, dict],
    daily_targets: dict[str, dict],
) -> tuple[dict[str, dict], dict]:
    """
    Scale each day's slot costs so they sum to the authoritative daily labor cost.
    Returns serialized days and reconciliation stats.
    """
    factors: list[float] = []
    flagged: list[dict] = []
    output_days: dict[str, dict] = {}

    all_dates = sorted(set(intraday_days.keys()) | set(daily_targets.keys()))

    for day in all_dates:
        target_entry = daily_targets.get(day) or {}
        target_cost = float(target_entry.get('laborCost') or 0)
        raw = intraday_days.get(day)
        raw_cost = float(raw['rawCost']) if raw else 0.0

        if target_cost > 0 and raw_cost <= 0:
            flagged.append({
                'date': day,
                'reason': 'report_cost_no_punches',
                'targetCost': round(target_cost, 2),
            })
            continue

        if raw is None or not raw['slots']:
            continue

        if target_cost <= 0 and raw_cost > 0:
            factor = 1.0
        elif raw_cost > 0:
            factor = target_cost / raw_cost
        else:
            factor = 1.0

        if raw_cost > 0 and target_cost > 0:
            factors.append(factor)
            if factor < FACTOR_MIN or factor > FACTOR_MAX:
                flagged.append({
                    'date': day,
                    'reason': 'factor_out_of_range',
                    'factor': round(factor, 4),
                    'rawCost': round(raw_cost, 2),
                    'targetCost': round(target_cost, 2),
                })

        slots_out: dict[str, dict] = {}
        for slot, data in sorted(raw['slots'].items(), key=lambda x: int(x[0])):
            cost = round(data['cost'] * factor, 2)
            headcount = len(data['users'])
            if cost <= 0 and headcount <= 0:
                continue
            slots_out[str(slot)] = {
                'cost': cost,
                'headcount': headcount,
            }

        if slots_out:
            output_days[day] = {
                'factor': round(factor, 4),
                'slots': slots_out,
            }

    reconciliation: dict = {'flaggedDays': flagged}
    if factors:
        mean = sum(factors) / len(factors)
        variance = sum((f - mean) ** 2 for f in factors) / len(factors)
        reconciliation.update({
            'mean': round(mean, 4),
            'min': round(min(factors), 4),
            'max': round(max(factors), 4),
            'stddev': round(variance ** 0.5, 4),
            'dayCount': len(factors),
        })
    else:
        reconciliation.update({
            'mean': None,
            'min': None,
            'max': None,
            'stddev': None,
            'dayCount': 0,
        })

    return output_days, reconciliation


def build_intraday_output(
    punches: list[dict],
    daily_targets: dict[str, dict],
    tz: ZoneInfo,
    client: SevenShiftsClient,
    business_start: str,
    business_end: str,
) -> dict:
    print('Building intraday labor from time punches...')
    intraday_raw, _roles_seen = aggregate_punches_intraday(punches, tz, client)
    roles = fetch_roles(client)
    print(f'  resolved {len(roles)} role(s)')

    output_days, reconciliation = reconcile_intraday_days(intraday_raw, daily_targets)

    if reconciliation.get('dayCount', 0) > 0:
        print(
            f'  reconciliation factors: mean={reconciliation["mean"]} '
            f'min={reconciliation["min"]} max={reconciliation["max"]} '
            f'stddev={reconciliation["stddev"]} ({reconciliation["dayCount"]} days)'
        )
    flagged = reconciliation.get('flaggedDays') or []
    if flagged:
        print(f'  flagged {len(flagged)} day(s) (see labor_intraday.json reconciliation.flaggedDays)')

    return {
        'generatedAt': datetime.now(tz).isoformat(),
        'timezone': str(tz),
        'source': 'punches+report' if daily_targets else 'punches_only',
        'slotResolution': SLOT_RESOLUTION_MINUTES,
        'dateRange': [business_start, business_end],
        'reconciliation': reconciliation,
        'roles': roles,
        'days': output_days,
    }


def aggregate_report_rows(rows: list[dict]) -> dict[str, dict]:
    days: dict[str, dict] = defaultdict(lambda: {
        'laborCost': 0.0,
        'laborHours': 0.0,
        'source': 'report',
    })
    for row in rows:
        day = row.get('date')
        if not day:
            continue
        cost_cents = int(row.get('actual_labor_cost') or 0)
        minutes = int(row.get('actual_labor_minutes') or 0)
        entry = days[day]
        entry['laborCost'] += cost_cents / 100.0
        entry['laborHours'] += minutes / 60.0
    return {day: round_day(entry) for day, entry in sorted(days.items())}


def fetch_labor_from_report(
    client: SevenShiftsClient,
    business_start: str,
    business_end: str,
) -> dict[str, dict] | None:
    client.resolve_company_guid()
    locations = client.list_locations()
    if not locations:
        print('  no locations found')
        return None

    location_ids = [loc['id'] for loc in locations if loc.get('id')]
    print(f'  locations: {", ".join(f"{loc.get("name")} ({loc.get("id")})" for loc in locations)}')

    all_rows: list[dict] = []
    chunks = chunk_date_range(business_start, business_end)
    print(f'  fetching Daily Sales & Labor report ({len(chunks)} chunk(s))...')

    for loc_id in location_ids:
        for chunk_start, chunk_end in chunks:
            status, rows = client.fetch_daily_sales_labor(loc_id, chunk_start, chunk_end)
            if status in (403, 404):
                print(f'  report unavailable (HTTP {status}) — plan may not include Daily Sales & Labor')
                return None
            if status != 200:
                print(f'  report request failed (HTTP {status}) for location {loc_id} {chunk_start}->{chunk_end}')
                return None
            all_rows.extend(rows)
            print(f'  location {loc_id} {chunk_start}->{chunk_end}: +{len(rows)} day(s)')

    if not all_rows:
        print('  report returned no rows')
        return None

    return aggregate_report_rows(all_rows)


def aggregate_punches_estimated(
    punches: list[dict],
    tz: ZoneInfo,
    client: SevenShiftsClient,
    uplift_pct: float,
) -> dict[str, dict]:
    wage_resolver = WageResolver(client)
    days: dict[str, dict] = defaultdict(lambda: {
        'laborCost': 0.0,
        'laborHours': 0.0,
        'punchCount': 0,
        'tips': 0.0,
        'source': 'punches_estimated',
    })

    skipped = 0
    zero_wage_fixed = 0
    multiplier = 1.0 + uplift_pct / 100.0

    for punch in punches:
        if punch.get('deleted'):
            skipped += 1
            continue
        clocked_in = punch.get('clocked_in')
        if not clocked_in:
            skipped += 1
            continue

        hours = punch_worked_hours(punch)
        if hours <= 0:
            skipped += 1
            continue

        wage = float(punch.get('hourly_wage') or 0) / 100.0
        if wage == 0:
            wage, _note = wage_resolver.hourly_wage(punch['user_id'], punch.get('role_id'))
            if wage > 0:
                zero_wage_fixed += 1

        cost = hours * wage * multiplier
        tips = float(punch.get('tips') or 0)
        day = business_date_from_clocked_in(clocked_in, tz)

        entry = days[day]
        entry['laborCost'] += cost
        entry['laborHours'] += hours
        entry['punchCount'] += 1
        entry['tips'] += tips

    if skipped:
        print(f'  skipped {skipped} punches (deleted, open, or zero hours)')
    if zero_wage_fixed:
        print(f'  applied profile wage fallback on {zero_wage_fixed} zero-wage punch(es)')
    if uplift_pct > 0:
        print(f'  applied {uplift_pct:.1f}% employer uplift (fallback estimate)')

    return {day: round_day(entry) for day, entry in sorted(days.items())}


def print_reconciliation(days: dict[str, dict], source: str) -> None:
    entry = days.get(RECONCILE_DATE)
    if not entry:
        print(f'  reconcile {RECONCILE_DATE}: no data in pull range')
        return
    cost = entry['laborCost']
    cents = round(cost * 100)
    target = RECONCILE_TARGET_CENTS / 100.0
    delta = cost - target
    ok = abs(cents - RECONCILE_TARGET_CENTS) <= 100  # within $1
    status = 'OK' if ok else 'MISMATCH'
    print(f'  reconcile {RECONCILE_DATE} [{source}]: ${cost:,.2f} (target ${target:,.0f}, delta ${delta:+,.2f}) - {status}')
    if source == 'punches_estimated' and not ok:
        print('  WARNING: fallback estimate does not match 7shifts website — check SEVENSHIFTS_LABOR_UPLIFT_PCT')


def default_date_range(days: int) -> tuple[str, str]:
    tz_name = os.getenv('SEVENSHIFTS_TIMEZONE', 'America/Los_Angeles')
    tz = ZoneInfo(tz_name)
    end = datetime.now(tz).date()
    start = end - timedelta(days=days - 1)
    return start.isoformat(), end.isoformat()


def main() -> None:
    parser = argparse.ArgumentParser(description='Pull 7shifts labor data into public/data/labor.json')
    parser.add_argument('--days', type=int, default=int(os.getenv('SEVENSHIFTS_PULL_DAYS', DEFAULT_PULL_DAYS)),
                        help=f'Number of calendar days to pull (default {DEFAULT_PULL_DAYS})')
    args = parser.parse_args()

    load_env()
    token = require_env('SEVENSHIFTS_TOKEN')
    company_id = require_env('SEVENSHIFTS_COMPANY_ID')
    company_guid = os.getenv('SEVENSHIFTS_GUID', '').strip() or None
    tz_name = os.getenv('SEVENSHIFTS_TIMEZONE', 'America/Los_Angeles')
    uplift_pct = float(os.getenv('SEVENSHIFTS_LABOR_UPLIFT_PCT', '0') or '0')
    tz = ZoneInfo(tz_name)

    business_start, business_end = default_date_range(args.days)

    print('7shifts labor pull')
    print(f'  company_id={company_id}')
    print(f'  timezone={tz_name}')
    print(f'  business dates: {business_start} -> {business_end}')

    client = SevenShiftsClient(token, company_id, company_guid)
    print('Verifying token...')
    client.verify()

    days: dict[str, dict] | None = None
    source = 'report'
    punches: list[dict] = []

    print('Fetching Daily Sales & Labor report (primary)...')
    days = fetch_labor_from_report(client, business_start, business_end)

    print('Fetching time punches (intraday shape)...')
    punches = client.list_time_punches(business_start, business_end)
    print(f'  received {len(punches)} punches')

    if days is None:
        source = 'punches_estimated'
        print('Falling back to time punch aggregation for daily labor.json...')
        days = aggregate_punches_estimated(punches, tz, client, uplift_pct)

    if not days:
        print('WARNING: no labor days aggregated — check date range and punch data')

    print_reconciliation(days, source)

    output = {
        'generatedAt': datetime.now(tz).isoformat(),
        'timezone': tz_name,
        'companyId': company_id,
        'source': source,
        'dateRange': [business_start, business_end],
        'days': days,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)
        f.write('\n')

    total_cost = sum(d['laborCost'] for d in days.values())
    total_hours = sum(d['laborHours'] for d in days.values())
    print(f'Wrote {OUTPUT_PATH}')
    print(f'  source={source} | {len(days)} days | ${total_cost:,.2f} labor | {total_hours:,.1f} hours')

    intraday_output = build_intraday_output(
        punches,
        days,
        tz,
        client,
        business_start,
        business_end,
    )
    with open(INTRADAY_OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(intraday_output, f, indent=2)
        f.write('\n')
    print(f'Wrote {INTRADAY_OUTPUT_PATH}')
    print(f'  {len(intraday_output["days"])} intraday day(s)')

    employees_labor = build_employees_labor_output(
        punches,
        client,
        tz,
        business_start,
        business_end,
        uplift_pct if source == 'punches_estimated' else 0.0,
    )
    with open(EMPLOYEES_LABOR_OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(employees_labor, f, indent=2)
        f.write('\n')
    print(f'Wrote {EMPLOYEES_LABOR_OUTPUT_PATH}')
    print(f'  {len(employees_labor["users"])} employee(s)')


if __name__ == '__main__':
    main()
