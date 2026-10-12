#!/usr/bin/env python3
"""
Turn the JSON already published in public/data into one metrics dict for the
daily review email. No formatting and no network calls.

Net sales matches the dashboard: sum of transactions.json revenue, excluding
departments listed in config/non_revenue.json (see revenueOnly in
app/lib/departments.ts). Adjustments and refunds are already in that file as
negative rows named "[Adjustments & Refunds]".

Lane hours are Time Bowling quantity divided by laneHoursDivisor (60). The POS
stores that quantity in minutes.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(_ROOT, 'config', 'daily_review.json')
NON_REVENUE_PATH = os.path.join(_ROOT, 'config', 'non_revenue.json')
DEFAULT_DATA_DIR = os.path.join(_ROOT, 'public', 'data')

DEDUCTION_NAME = '[Adjustments & Refunds]'
TZ = ZoneInfo('America/Los_Angeles')
WEEKDAY_SHIFT = 364  # same weekday, 52 weeks earlier


def load_review_config(path: str | None = None) -> dict:
    with open(path or CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


def default_review_date(now: datetime | None = None) -> date:
    """Business day the 5:30 AM job should report.

    Sales before 4:00 AM belong to the previous business day, so a run in that
    window is still about the day before yesterday.
    """
    current = now.astimezone(TZ) if now else datetime.now(TZ)
    days_back = 2 if current.hour < 4 else 1
    return current.date() - timedelta(days=days_back)


def _read_json(path: str, required: bool = True):
    if not os.path.isfile(path):
        if required:
            raise FileNotFoundError(path)
        return None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _generated_date(value: str | None) -> date | None:
    if not value or len(value) < 10:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def file_is_fresh(generated_at: str | None, review: date) -> bool:
    """True when the file was written on the morning after the business day."""
    written = _generated_date(generated_at)
    if written is None:
        return False
    return written >= review + timedelta(days=1)


def _pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return (current - previous) / abs(previous) * 100.0


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _shift(day: date, days: int) -> str:
    return (day - timedelta(days=days)).isoformat()


def _non_revenue_names(summary: dict | None) -> set[str]:
    from_summary = ((summary or {}).get('nonRevenue') or {}).get('departments') or {}
    if from_summary:
        return set(from_summary)
    cfg = _read_json(NON_REVENUE_PATH, required=False) or {}
    return set((cfg.get('departments') or {}))


def _group_lookup(config: dict) -> dict[str, str]:
    lookup = {}
    for group in config['departmentGroups']:
        for dept in group['departments']:
            lookup[dept] = group['id']
    return lookup


def _empty_group() -> dict:
    return {'sales': 0.0, 'items': {}}


def _empty_day() -> dict:
    return {
        'net': 0.0,
        'groups': {},
        'prize': 0.0,
        'held': {},
        'bowling': {'games': 0.0, 'lane_minutes': 0.0, 'shoes': 0.0, 'online': 0.0},
        'deductions': 0.0,
    }


def build_sales_index(rows: list[dict], config: dict, non_revenue: set[str],
                      first: date, last: date) -> dict[str, dict]:
    """date -> sales breakdown, limited to [first, last]."""
    lookup = _group_lookup(config)
    prize_dept = config.get('prizeFundDepartment') or ''
    bowling_cfg = config.get('bowling') or {}
    games_subs = set(bowling_cfg.get('gamesSubdepartments') or [])
    lane_subs = set(bowling_cfg.get('laneHoursSubdepartments') or [])
    shoe_subs = set(bowling_cfg.get('shoesSubdepartments') or [])
    online_subs = set(bowling_cfg.get('onlineSubdepartments') or [])
    first_s, last_s = first.isoformat(), last.isoformat()

    index: dict[str, dict] = {}
    for row in rows:
        day = row.get('date') or ''
        if day < first_s or day > last_s:
            continue
        dept = row.get('department') or ''
        revenue = float(row.get('revenue') or 0)
        bucket = index.get(day)
        if bucket is None:
            bucket = _empty_day()
            index[day] = bucket
        if dept in non_revenue:
            bucket['held'][dept] = bucket['held'].get(dept, 0.0) + revenue
            if dept == prize_dept:
                bucket['prize'] += revenue
            continue
        bucket['net'] += revenue
        gid = lookup.get(dept)
        if gid:
            group = bucket['groups'].setdefault(gid, _empty_group())
            group['sales'] += revenue
            name = row.get('name') or ''
            if name and name != DEDUCTION_NAME:
                item = group['items'].setdefault(name, [0.0, 0.0])
                item[0] += revenue
                item[1] += float(row.get('quantity') or 0)
        if name_is_deduction(row):
            bucket['deductions'] += abs(revenue)
        if dept == 'Bowling':
            sub = row.get('subdepartment') or ''
            qty = float(row.get('quantity') or 0)
            if sub in games_subs:
                bucket['bowling']['games'] += qty
            elif sub in lane_subs:
                bucket['bowling']['lane_minutes'] += qty
            elif sub in shoe_subs:
                bucket['bowling']['shoes'] += qty
            elif sub in online_subs:
                bucket['bowling']['online'] += qty
    return index


def name_is_deduction(row: dict) -> bool:
    return (row.get('name') or '') == DEDUCTION_NAME and float(row.get('revenue') or 0) < 0


def _top_items(group: dict | None, limit: int = 3) -> list[dict]:
    if not group:
        return []
    ranked = sorted(group['items'].items(), key=lambda kv: -kv[1][0])[:limit]
    return [
        {'name': name, 'revenue': rev, 'quantity': qty}
        for name, (rev, qty) in ranked
        if rev > 0
    ]


def _tips_for(gratuity: dict | None, day: str) -> float | None:
    dates = (gratuity or {}).get('dates') or {}
    if day not in dates:
        return None
    block = dates[day] or {}
    total = 0.0
    for part in ('pre17', 'post17'):
        houses = block.get(part) or {}
        if not isinstance(houses, dict):
            continue
        for house in houses.values():
            if isinstance(house, dict):
                total += sum(float(v or 0) for v in house.values())
    return total


def _labor_day(labor: dict | None, day: str) -> dict | None:
    entry = ((labor or {}).get('days') or {}).get(day)
    if not entry:
        return None
    return {
        'cost': float(entry.get('laborCost') or 0),
        'hours': float(entry.get('laborHours') or 0),
        'source': entry.get('source') or (labor or {}).get('source') or '',
    }


def _party_summary(reservations: dict | None, day: str, party_types: set[str]) -> dict:
    counts: dict[str, int] = defaultdict(int)
    for row in (reservations or {}).get('rows') or []:
        if row.get('date') != day:
            continue
        kind = row.get('type') or ''
        if kind in party_types:
            counts[kind] += int(row.get('count') or 0)
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return {
        'count': sum(counts.values()),
        'top': [{'name': name, 'count': count} for name, count in ranked[:3]],
    }


def _role_rows(employees: dict | None, day: str, role_order: list[str]) -> list[dict]:
    """Punch hours by role. An employee with several roles cannot be split, so
    those hours land in 'Multiple roles'."""
    hours: dict[str, float] = defaultdict(float)
    cost: dict[str, float] = defaultdict(float)
    order = {name: i for i, name in enumerate(role_order)}
    for emp in (employees or {}).get('employees') or []:
        entry = (emp.get('days') or {}).get(day)
        if not entry:
            continue
        worked = float(entry.get('hours') or 0)
        if worked <= 0:
            continue
        roles = [r for r in (emp.get('roles') or []) if r]
        label = roles[0] if len(roles) == 1 else ('Multiple roles' if roles else 'Unassigned')
        hours[label] += worked
        cost[label] += float(entry.get('laborCost') or 0)
    rows = [
        {'name': name, 'hours': hrs, 'cost': cost[name]}
        for name, hrs in hours.items()
    ]
    rows.sort(key=lambda r: (order.get(r['name'], 1000), r['name']))
    return rows


def _refund_tickets(data_dir: str, day: str) -> list[dict]:
    path = os.path.join(data_dir, 'tickets', f'{day[:7]}.json')
    tickets = _read_json(path, required=False)
    if not tickets:
        return []
    found = []
    for ticket in tickets:
        if ticket.get('date') != day or ticket.get('type') != 'Refund':
            continue
        amount = abs(float(ticket.get('total') or 0))
        found.append({
            'txnId': str(ticket.get('txnId') or ''),
            'amount': amount,
            'user': ticket.get('user') or '',
        })
    found.sort(key=lambda t: -t['amount'])
    return found


def _holiday_name(day: date, cache: dict) -> str | None:
    year = day.year
    if year not in cache:
        try:
            import holidays
        except ImportError:
            cache[year] = {}
            return None
        cache[year] = holidays.country_holidays('US', years=[year])
    book = cache[year]
    if not book:
        return None
    name = book.get(day)
    return str(name) if name else None


def _no_hours_names(employees: dict, review: date, floor: float) -> list[str]:
    """Staff who rang sales today but did not clock in, and who did clock in
    on another day in the last 28. People who never clock in (owners ringing
    a tab, unmapped logins) would otherwise flag every morning."""
    if floor <= 0:
        return []
    key = review.isoformat()
    window_start = (review - timedelta(days=28)).isoformat()
    names = []
    for emp in (employees or {}).get('employees') or []:
        days = emp.get('days') or {}
        today = days.get(key)
        if not today:
            continue
        if float(today.get('sales') or 0) < floor or float(today.get('hours') or 0) > 0:
            continue
        clocked_recently = any(
            window_start <= day < key and float(entry.get('hours') or 0) > 0
            for day, entry in days.items()
        )
        if clocked_recently:
            names.append(emp.get('displayName') or emp.get('id') or 'Unknown')
    return names


def _sum_span(index: dict[str, dict], labor: dict | None, start: date, end: date) -> dict:
    net = 0.0
    cost = 0.0
    sales_with_labor = 0.0
    day = start
    while day <= end:
        key = day.isoformat()
        bucket = index.get(key)
        if bucket:
            net += bucket['net']
        lab = _labor_day(labor, key)
        if lab and bucket:
            cost += lab['cost']
            sales_with_labor += bucket['net']
        day += timedelta(days=1)
    pct = (cost / sales_with_labor * 100.0) if sales_with_labor else None
    return {'sales': net, 'labor_cost': cost, 'labor_pct': pct}


def _span_block(index, labor, start: date, end: date) -> dict:
    current = _sum_span(index, labor, start, end)
    previous = _sum_span(
        index, labor,
        start - timedelta(days=WEEKDAY_SHIFT),
        end - timedelta(days=WEEKDAY_SHIFT),
    )
    return {
        'days': (end - start).days + 1,
        'sales': current['sales'],
        'sales_ly': previous['sales'],
        'delta_pct': _pct(current['sales'], previous['sales']),
        'labor_pct': current['labor_pct'],
    }


def _labor_block(entry: dict | None, net_sales: float, fresh: bool) -> dict:
    if not fresh or entry is None:
        return {'available': False, 'cost': None, 'hours': None, 'pct': None, 'splh': None, 'source': ''}
    cost = entry['cost']
    hours = entry['hours']
    pct = (cost / net_sales * 100.0) if net_sales else None
    splh = (net_sales / hours) if hours else None
    return {
        'available': True,
        'cost': cost,
        'hours': hours,
        'pct': pct,
        'splh': splh,
        'source': entry.get('source') or '',
    }


def gather_review(
    review: date,
    data_dir: str | None = None,
    config: dict | None = None,
    *,
    now: datetime | None = None,
    health_notes: list[str] | None = None,
) -> dict:
    """Metrics for one business day. Raises FileNotFoundError if POS JSON is missing."""
    data_dir = data_dir or DEFAULT_DATA_DIR
    config = config or load_review_config()
    summary = _read_json(os.path.join(data_dir, 'summary.json'))
    transactions = _read_json(os.path.join(data_dir, 'transactions.json'))
    labor = _read_json(os.path.join(data_dir, 'labor.json'), required=False) or {}
    gratuity = _read_json(os.path.join(data_dir, 'gratuity.json'), required=False) or {}
    reservations = _read_json(os.path.join(data_dir, 'reservation_counts.json'), required=False) or {}
    employees = _read_json(os.path.join(data_dir, 'employees.json'), required=False) or {}

    non_revenue = _non_revenue_names(summary)
    first = date(review.year - 1, 1, 1)
    index = build_sales_index(transactions, config, non_revenue, first, review)

    generated_at = summary.get('generatedAt') or ''
    fresh = file_is_fresh(generated_at, review)
    date_range = summary.get('dateRange') or ['', '']
    covers_day = bool(date_range[1]) and review.isoformat() <= date_range[1]
    key = review.isoformat()
    bucket = index.get(key) or _empty_day()

    show_numbers = fresh and covers_day
    banner = None
    if not fresh:
        banner = (
            f'POS data was last written {generated_at or "never"}, so this morning\'s '
            f'numbers are not ready. Nothing below is filled in.'
        )
        show_numbers = False
    elif not covers_day:
        banner = (
            f'POS data runs through {date_range[1] or "an unknown date"} and does not '
            f'include {key}. Nothing below is filled in.'
        )
        show_numbers = False

    ly_dow = review - timedelta(days=WEEKDAY_SHIFT)
    try:
        ly_date = date(review.year - 1, review.month, review.day)
    except ValueError:
        # Feb 29 has no calendar twin. Use Feb 28.
        ly_date = date(review.year - 1, 2, 28)
    ly_dow_bucket = index.get(ly_dow.isoformat()) or _empty_day()
    ly_date_bucket = index.get(ly_date.isoformat()) or _empty_day()

    holidays_cache: dict = {}
    labor_fresh = file_is_fresh(labor.get('generatedAt'), review)
    labor_today = _labor_block(
        _labor_day(labor, key), bucket['net'], labor_fresh and show_numbers,
    )
    # Last year's labor is historical. Use it whenever the file still has that day.
    labor_ly = _labor_block(
        _labor_day(labor, ly_dow.isoformat()),
        ly_dow_bucket['net'],
        _labor_day(labor, ly_dow.isoformat()) is not None,
    )
    labor_ly_date = _labor_block(
        _labor_day(labor, ly_date.isoformat()),
        ly_date_bucket['net'],
        _labor_day(labor, ly_date.isoformat()) is not None,
    )

    tips = _tips_for(gratuity, key) if show_numbers else None
    tips_ly = _tips_for(gratuity, ly_dow.isoformat())
    tips_ly_date = _tips_for(gratuity, ly_date.isoformat())

    groups = []
    for group in config['departmentGroups']:
        gid = group['id']
        cur = (bucket['groups'].get(gid) or _empty_group())['sales'] if show_numbers else 0.0
        prev = (ly_dow_bucket['groups'].get(gid) or _empty_group())['sales']
        groups.append({
            'id': gid,
            'label': group['label'],
            'sales': cur,
            'ly': prev,
            'delta_pct': _pct(cur, prev) if show_numbers else None,
            'top_items': _top_items(bucket['groups'].get(gid)) if show_numbers else [],
        })

    divisor = float((config.get('bowling') or {}).get('laneHoursDivisor') or 60) or 60.0
    def lane_hours(b):
        return b['bowling']['lane_minutes'] / divisor

    bowling = {
        'games': bucket['bowling']['games'],
        'games_ly': ly_dow_bucket['bowling']['games'],
        'lane_hours': lane_hours(bucket),
        'lane_hours_ly': lane_hours(ly_dow_bucket),
        'shoes': bucket['bowling']['shoes'],
        'shoes_ly': ly_dow_bucket['bowling']['shoes'],
        'online': bucket['bowling']['online'],
        'online_ly': ly_dow_bucket['bowling']['online'],
    }

    roles = _role_rows(employees, key, config.get('roleOrder') or []) if show_numbers else []

    thresholds = config.get('thresholds') or {}
    no_hours = _no_hours_names(
        employees, review, float(thresholds.get('noHoursMinSales') or 0),
    ) if show_numbers else []

    closed = bool(show_numbers and abs(bucket['net']) < 0.005 and bucket['prize'] == 0 and not bucket['held'])

    metrics = {
        'date': key,
        'weekday': review.strftime('%A'),
        'closed': closed,
        'show_numbers': show_numbers and not closed,
        'banner': banner,
        'holiday': _holiday_name(review, holidays_cache),
        'ly_dow': ly_dow.isoformat(),
        'ly_dow_holiday': _holiday_name(ly_dow, holidays_cache),
        'ly_date': ly_date.isoformat(),
        'ly_date_holiday': _holiday_name(ly_date, holidays_cache),
        'net_sales': bucket['net'] if show_numbers else None,
        'net_sales_ly_dow': ly_dow_bucket['net'],
        'net_sales_ly_date': ly_date_bucket['net'],
        'labor': labor_today,
        'labor_ly_dow': labor_ly,
        'labor_ly_date': labor_ly_date,
        'labor_generated_at': labor.get('generatedAt') or '',
        'labor_file_source': labor.get('source') or '',
        'tips': tips,
        'tips_ly_dow': tips_ly,
        'tips_ly_date': tips_ly_date,
        'departments': groups,
        'prize_fund': bucket['prize'] if show_numbers else None,
        'prize_fund_ly': ly_dow_bucket['prize'],
        'bowling': bowling if show_numbers else None,
        'parties': _party_summary(reservations, key, set(config.get('partyTypes') or [])) if show_numbers else None,
        'other_detail': other_department_sales(transactions, config, key) if show_numbers else [],
        'deductions': bucket['deductions'] if show_numbers else 0.0,
        'refund_tickets': _refund_tickets(data_dir, key) if show_numbers else [],
        'roles': roles,
        'role_hours': sum(r['hours'] for r in roles),
        'no_hours': no_hours,
        'running': {
            'wtd': _span_block(index, labor, _week_start(review), review) if show_numbers else None,
            'mtd': _span_block(index, labor, review.replace(day=1), review) if show_numbers else None,
            'ytd': _span_block(index, labor, date(review.year, 1, 1), review) if show_numbers else None,
        },
        'pos_generated_at': generated_at,
        'health_notes': list(health_notes or []),
        'now': (now or datetime.now(TZ)).isoformat(timespec='seconds'),
    }
    metrics['flags'] = evaluate_flags(metrics, config) if metrics['show_numbers'] or metrics['health_notes'] else []
    if not metrics['show_numbers']:
        # Data-health notes still surface when numbers are hidden only as the banner.
        metrics['flags'] = []
    return metrics


def evaluate_flags(metrics: dict, config: dict) -> list[dict]:
    """Action flags. Empty means the email should say All clear."""
    if not metrics.get('show_numbers'):
        return []
    thresholds = config.get('thresholds') or {}
    drop_pct = float(thresholds.get('deptDropPct') or 20)
    drop_floor = float(thresholds.get('deptDropMinLyDollars') or 0)
    refund_floor = float(thresholds.get('refundsDollars') or 0)
    tip_low = float(thresholds.get('tipPctLow') or 0)
    tip_high = float(thresholds.get('tipPctHigh') or 100)
    flags = []

    labor = metrics.get('labor') or {}
    if not labor.get('available'):
        flags.append({
            'title': 'Labor unavailable',
            'detail': 'The 7shifts file was not refreshed this morning, so labor is not shown.',
        })
    elif (labor.get('source') or metrics.get('labor_file_source')) not in ('', 'report'):
        flags.append({
            'title': 'Labor is estimated',
            'detail': f"Source is {labor.get('source') or metrics.get('labor_file_source')}, not the 7shifts report.",
        })

    for note in metrics.get('health_notes') or []:
        flags.append({'title': 'Data health', 'detail': note})

    drop_groups = set(config.get('dropFlagGroups') or [])
    drops = []
    for group in metrics.get('departments') or []:
        if drop_groups and group.get('id') not in drop_groups:
            continue
        delta = group.get('delta_pct')
        if delta is None or group.get('ly', 0) < drop_floor:
            continue
        if delta <= -drop_pct:
            drops.append(group)
    drops.sort(key=lambda g: g['delta_pct'])
    for group in drops:
        group['flagged'] = True
        flags.append({
            'title': f"{group['label']} down {abs(group['delta_pct']):.0f}% vs LY",
            'detail': (
                f"${group['sales']:,.0f} vs ${group['ly']:,.0f} last year "
                f"(threshold: -{drop_pct:.0f}%, and last year was at least ${drop_floor:,.0f})."
            ),
        })

    deductions = float(metrics.get('deductions') or 0)
    if deductions >= refund_floor and refund_floor > 0:
        tickets = metrics.get('refund_tickets') or []
        extra = ''
        if tickets:
            top = tickets[0]
            extra = f" Largest refund ${top['amount']:,.2f} (#{top['txnId']})."
        flags.append({
            'title': f'Adjustments and refunds ${deductions:,.0f}',
            'detail': f"{len(tickets)} refund ticket(s).{extra}",
        })

    names = metrics.get('no_hours') or []
    if names:
        shown = ', '.join(names[:8])
        more = f' and {len(names) - 8} more' if len(names) > 8 else ''
        flags.append({
            'title': f'{len(names)} employee(s) with sales but no hours',
            'detail': f'{shown}{more}. Add them to config/employee_map.txt.',
        })

    net = metrics.get('net_sales') or 0
    tips = metrics.get('tips')
    if tips is not None and net > 0:
        tip_pct = tips / net * 100.0
        if tip_pct < tip_low or tip_pct > tip_high:
            flags.append({
                'title': f'Tip % unusual ({tip_pct:.1f}%)',
                'detail': f'Typical range is {tip_low:.0f}% to {tip_high:.0f}% of sales.',
            })

    return flags


def other_department_sales(rows: list[dict], config: dict, day: str) -> list[dict]:
    """Arcade / Vending / General Income sales for one date, for the Other line."""
    other = next((g for g in config['departmentGroups'] if g['id'] == 'other'), None)
    if not other:
        return []
    wanted = set(other['departments'])
    totals: dict[str, float] = defaultdict(float)
    for row in rows:
        if row.get('date') != day:
            continue
        dept = row.get('department') or ''
        if dept in wanted:
            totals[dept] += float(row.get('revenue') or 0)
    return [{'name': dept, 'sales': totals.get(dept, 0.0)} for dept in other['departments']]
