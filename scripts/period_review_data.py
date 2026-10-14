#!/usr/bin/env python3
"""
Turn public/data JSON into one metrics dict for a completed week, month,
quarter, or year. No formatting and no network calls.

Sales compare to the same calendar period last year (same ISO week for weeks).
Labor is this period only. History back to 2023 is attached so the synopsis
can see streaks and records.
"""

from __future__ import annotations

import os
from datetime import date, timedelta

from daily_review_data import (  # noqa: E402
    _empty_day,
    _holiday_name,
    _labor_day,
    _non_revenue_names,
    _pct,
    _read_json,
    _tips_for,
    _top_items,
    build_sales_index,
    file_is_fresh,
    load_review_config,
)

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA_DIR = os.path.join(_ROOT, 'public', 'data')
HISTORY_START = date(2023, 1, 1)
KINDS = ('week', 'month', 'quarter', 'year')
CATCHUP_DAYS = 7


def add_months(day: date, months: int) -> date:
    """First of the month, `months` after the month containing `day`."""
    index = day.month - 1 + months
    return date(day.year + index // 12, index % 12 + 1, 1)


def _week_label(start: date) -> str:
    iso = start.isocalendar()
    return f'{iso.year}-W{iso.week:02d}'


def human_title(kind: str, start: date, end: date) -> str:
    if kind == 'week':
        if start.month == end.month and start.year == end.year:
            return f"{start.strftime('%b')} {start.day}–{end.day}, {end.year}"
        if start.year == end.year:
            return f"{start.strftime('%b')} {start.day}–{end.strftime('%b')} {end.day}, {end.year}"
        return f"{start.strftime('%b')} {start.day}, {start.year}–{end.strftime('%b')} {end.day}, {end.year}"
    if kind == 'month':
        return f"{start.strftime('%B')} {start.year}"
    if kind == 'quarter':
        return f"Q{(start.month - 1) // 3 + 1} {start.year}"
    return str(start.year)


def ly_phrase(kind: str, ly_start: date) -> str:
    if kind == 'month':
        return f"last {ly_start.strftime('%B')}"
    if kind == 'quarter':
        return f"last Q{(ly_start.month - 1) // 3 + 1}"
    if kind == 'year':
        return 'last year'
    return f"the week of {ly_start.strftime('%b')} {ly_start.day}, {ly_start.year}"


def period_bounds(kind: str, as_of: date) -> tuple[date, date, str]:
    """Most recently completed period whose end is on or before `as_of`."""
    if kind not in KINDS:
        raise ValueError(kind)
    if kind == 'week':
        start = as_of - timedelta(days=as_of.weekday())
        end = start + timedelta(days=6)
        if end > as_of:
            end = start - timedelta(days=1)
            start = end - timedelta(days=6)
        return start, end, _week_label(start)
    if kind == 'month':
        start = date(as_of.year, as_of.month, 1)
        end = add_months(start, 1) - timedelta(days=1)
        if end > as_of:
            end = start - timedelta(days=1)
            start = date(end.year, end.month, 1)
        return start, end, f'{start.year}-{start.month:02d}'
    if kind == 'quarter':
        start_month = ((as_of.month - 1) // 3) * 3 + 1
        start = date(as_of.year, start_month, 1)
        end = add_months(start, 3) - timedelta(days=1)
        if end > as_of:
            end = start - timedelta(days=1)
            start_month = ((end.month - 1) // 3) * 3 + 1
            start = date(end.year, start_month, 1)
        quarter = (start.month - 1) // 3 + 1
        return start, end, f'{start.year}-Q{quarter}'
    start = date(as_of.year, 1, 1)
    end = date(as_of.year, 12, 31)
    if end > as_of:
        start = date(as_of.year - 1, 1, 1)
        end = date(as_of.year - 1, 12, 31)
    return start, end, str(start.year)


def ly_bounds(kind: str, start: date, end: date) -> tuple[date, date]:
    """Same calendar period one year earlier. Weeks use the ISO week number.

    A week 53 falls back to week 52 when last year had no week 53.
    """
    if kind == 'week':
        iso = start.isocalendar()
        try:
            ly_start = date.fromisocalendar(iso.year - 1, iso.week, 1)
        except ValueError:
            ly_start = date.fromisocalendar(iso.year - 1, iso.week - 1, 1)
        return ly_start, ly_start + timedelta(days=6)
    if kind == 'month':
        ly_start = date(start.year - 1, start.month, 1)
        return ly_start, add_months(ly_start, 1) - timedelta(days=1)
    if kind == 'quarter':
        ly_start = date(start.year - 1, start.month, 1)
        return ly_start, add_months(ly_start, 3) - timedelta(days=1)
    return date(start.year - 1, 1, 1), date(start.year - 1, 12, 31)


def iter_periods(kind: str, first: date, last: date):
    """Completed periods of `kind` with end between `first` and `last`."""
    if kind == 'week':
        start = first - timedelta(days=first.weekday())
        while start <= last:
            end = start + timedelta(days=6)
            if first <= end <= last:
                yield start, end, _week_label(start)
            start += timedelta(days=7)
        return
    if kind == 'month':
        start = date(first.year, first.month, 1)
        while start <= last:
            end = add_months(start, 1) - timedelta(days=1)
            if first <= end <= last:
                yield start, end, f'{start.year}-{start.month:02d}'
            start = add_months(start, 1)
        return
    if kind == 'quarter':
        start_month = ((first.month - 1) // 3) * 3 + 1
        start = date(first.year, start_month, 1)
        while start <= last:
            end = add_months(start, 3) - timedelta(days=1)
            if first <= end <= last:
                quarter = (start.month - 1) // 3 + 1
                yield start, end, f'{start.year}-Q{quarter}'
            start = add_months(start, 3)
        return
    year = first.year
    while date(year, 1, 1) <= last:
        start, end = date(year, 1, 1), date(year, 12, 31)
        if first <= end <= last:
            yield start, end, str(year)
        year += 1


def _closed(bucket: dict) -> bool:
    return abs(bucket['net']) < 0.005 and bucket['prize'] == 0 and not bucket['held']


def _span(index: dict, start: date, end: date, holidays: dict) -> dict:
    net = prize = deductions = 0.0
    groups: dict = {}
    bowling = {'games': 0.0, 'lane_minutes': 0.0, 'shoes': 0.0, 'online': 0.0}
    daily = []
    closed = 0
    day = start
    while day <= end:
        bucket = index.get(day.isoformat()) or _empty_day()
        net += bucket['net']
        prize += bucket['prize']
        deductions += bucket['deductions']
        for gid, group in bucket['groups'].items():
            dest = groups.setdefault(gid, {'sales': 0.0, 'items': {}})
            dest['sales'] += group['sales']
            for name, pair in group['items'].items():
                item = dest['items'].setdefault(name, [0.0, 0.0])
                item[0] += pair[0]
                item[1] += pair[1]
        for key in bowling:
            bowling[key] += bucket['bowling'][key]
        if _closed(bucket):
            closed += 1
        daily.append({
            'date': day.isoformat(),
            'weekday': day.strftime('%A'),
            'weekday_index': day.weekday(),
            'sales': bucket['net'],
            'holiday': _holiday_name(day, holidays),
            'closed': _closed(bucket),
        })
        day += timedelta(days=1)
    return {
        'net': net,
        'prize': prize,
        'deductions': deductions,
        'groups': groups,
        'bowling': bowling,
        'daily': daily,
        'closed_days': closed,
        'days': (end - start).days + 1,
    }


def _labor_over(labor: dict, index: dict, start: date, end: date) -> dict:
    cost = hours = sales_with = 0.0
    days_with = 0
    total = (end - start).days + 1
    day = start
    while day <= end:
        entry = _labor_day(labor, day.isoformat())
        if entry:
            days_with += 1
            cost += entry['cost']
            hours += entry['hours']
            bucket = index.get(day.isoformat())
            if bucket:
                sales_with += bucket['net']
        day += timedelta(days=1)
    pct = (cost / sales_with * 100.0) if sales_with else None
    return {
        'cost': cost,
        'hours': hours,
        'pct': pct,
        'days_with_labor': days_with,
        'days': total,
        'sales_with_labor': sales_with,
    }


def _labor_block(labor: dict, index: dict, start: date, end: date, fresh: bool) -> dict:
    rolled = _labor_over(labor, index, start, end)
    source = labor.get('source') or ''
    empty = {
        'available': False,
        'cost': None,
        'hours': None,
        'pct': None,
        'splh': None,
        'days_with_labor': rolled['days_with_labor'],
        'days': rolled['days'],
        'source': '',
        'reliable': False,
    }
    if not fresh or rolled['days_with_labor'] == 0:
        return empty
    hours = rolled['hours']
    sales = rolled['sales_with_labor']
    coverage = rolled['days_with_labor'] / rolled['days'] if rolled['days'] else 0
    return {
        'available': True,
        'cost': rolled['cost'],
        'hours': hours,
        'pct': rolled['pct'],
        'splh': (sales / hours) if hours else None,
        'days_with_labor': rolled['days_with_labor'],
        'days': rolled['days'],
        'source': source,
        'reliable': coverage >= 0.8,
    }


def _tips_span(gratuity: dict, start: date, end: date) -> float | None:
    total = 0.0
    seen = False
    day = start
    while day <= end:
        value = _tips_for(gratuity, day.isoformat())
        if value is not None:
            seen = True
            total += value
        day += timedelta(days=1)
    return total if seen else None


def _party_span(reservations: dict, start: date, end: date, party_types: set[str]) -> dict:
    from collections import defaultdict
    counts: dict[str, int] = defaultdict(int)
    first, last = start.isoformat(), end.isoformat()
    for row in (reservations or {}).get('rows') or []:
        day = row.get('date') or ''
        if day < first or day > last:
            continue
        kind = row.get('type') or ''
        if kind in party_types:
            counts[kind] += int(row.get('count') or 0)
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return {
        'count': sum(counts.values()),
        'top': [{'name': name, 'count': count} for name, count in ranked[:3]],
    }


def _roles_span(employees: dict, start: date, end: date) -> list[dict]:
    from collections import defaultdict
    hours: dict[str, float] = defaultdict(float)
    cost: dict[str, float] = defaultdict(float)
    first, last = start.isoformat(), end.isoformat()
    for emp in (employees or {}).get('employees') or []:
        for day, entry in (emp.get('days') or {}).items():
            if day < first or day > last:
                continue
            by_role = entry.get('byRole')
            if by_role:
                for name, parts in by_role.items():
                    hours[name] += float((parts or {}).get('hours') or 0)
                    cost[name] += float((parts or {}).get('laborCost') or 0)
                continue
            worked = float(entry.get('hours') or 0)
            if worked <= 0:
                continue
            roles = [role for role in (emp.get('roles') or []) if role]
            label = roles[0] if len(roles) == 1 else ('Multiple roles' if roles else 'Unassigned')
            hours[label] += worked
            cost[label] += float(entry.get('laborCost') or 0)
    rows = [
        {'name': name, 'hours': hrs, 'cost': cost[name]}
        for name, hrs in hours.items()
        if hrs > 0
    ]
    rows.sort(key=lambda row: (-row['hours'], row['name']))
    return rows


def _refund_span(data_dir: str, start: date, end: date, limit: int = 3) -> tuple[list[dict], int]:
    found = []
    month = date(start.year, start.month, 1)
    last_month = date(end.year, end.month, 1)
    first, last = start.isoformat(), end.isoformat()
    while month <= last_month:
        path = os.path.join(data_dir, 'tickets', f'{month.strftime("%Y-%m")}.json')
        tickets = _read_json(path, required=False) or []
        for ticket in tickets:
            day = ticket.get('date') or ''
            if day < first or day > last or ticket.get('type') != 'Refund':
                continue
            found.append({
                'txnId': str(ticket.get('txnId') or ''),
                'amount': abs(float(ticket.get('total') or 0)),
                'user': ticket.get('user') or '',
            })
        month = add_months(month, 1)
    found.sort(key=lambda ticket: -ticket['amount'])
    return found[:limit], len(found)


def _group_rows(span: dict, ly_span: dict, config: dict) -> list[dict]:
    rows = []
    net = span['net']
    ly_net = ly_span['net']
    for group in config['departmentGroups']:
        gid = group['id']
        cur = span['groups'].get(gid) or {'sales': 0.0, 'items': {}}
        prev = ly_span['groups'].get(gid) or {'sales': 0.0, 'items': {}}
        sales, ly = cur['sales'], prev['sales']
        rows.append({
            'id': gid,
            'label': group['label'],
            'sales': sales,
            'ly': ly,
            'delta_pct': _pct(sales, ly),
            'share': (sales / net * 100.0) if net else None,
            'share_ly': (ly / ly_net * 100.0) if ly_net else None,
            'top_items': _top_items(cur, limit=8),
            'ly_top_items': _top_items(prev, limit=8),
        })
    return rows


def _history_groups(span: dict, ly_span: dict, config: dict) -> dict:
    groups = {}
    for group in config['departmentGroups']:
        gid = group['id']
        cur = span['groups'].get(gid) or {'sales': 0.0, 'items': {}}
        prev = ly_span['groups'].get(gid) or {'sales': 0.0, 'items': {}}
        groups[gid] = {
            'label': group['label'],
            'sales': cur['sales'],
            'ly': prev['sales'],
            'delta_pct': _pct(cur['sales'], prev['sales']),
            'top': [
                {'name': item['name'], 'revenue': item['revenue']}
                for item in _top_items(cur, limit=8)
            ],
        }
    return groups


def _month_rows(index, labor, start: date, end: date, holidays: dict) -> list[dict]:
    rows = []
    cursor = date(start.year, start.month, 1)
    while cursor <= end:
        month_end = min(add_months(cursor, 1) - timedelta(days=1), end)
        span = _span(index, cursor, month_end, holidays)
        ly_start, ly_end = ly_bounds('month', cursor, month_end)
        ly_span = _span(index, ly_start, ly_end, holidays)
        rolled = _labor_over(labor, index, cursor, month_end)
        rows.append({
            'label': cursor.strftime('%b %Y'),
            'sales': span['net'],
            'ly': ly_span['net'],
            'delta_pct': _pct(span['net'], ly_span['net']),
            'labor_pct': rolled['pct'] if rolled['days_with_labor'] else None,
        })
        cursor = add_months(cursor, 1)
    return rows


def _best_day(daily: list[dict]) -> dict | None:
    open_days = [row for row in daily if not row['closed']]
    if not open_days:
        return None
    return max(open_days, key=lambda row: row['sales'])


def _slowest_day(daily: list[dict]) -> dict | None:
    open_days = [row for row in daily if not row['closed']]
    if not open_days:
        return None
    return min(open_days, key=lambda row: row['sales'])


def _year_best(index: dict, end: date, holidays: dict) -> dict | None:
    start = date(end.year, 1, 1)
    best = None
    day = start
    while day <= end:
        bucket = index.get(day.isoformat()) or _empty_day()
        if not _closed(bucket) and (best is None or bucket['net'] > best['sales']):
            best = {
                'date': day.isoformat(),
                'weekday': day.strftime('%A'),
                'sales': bucket['net'],
                'holiday': _holiday_name(day, holidays),
            }
        day += timedelta(days=1)
    return best


def _ytd_end_last_year(end: date) -> date:
    try:
        return date(end.year - 1, end.month, end.day)
    except ValueError:
        return date(end.year - 1, end.month, end.day - 1)


def period_history(kind: str, through: date, index: dict, labor: dict,
                   config: dict, holidays: dict) -> list[dict]:
    """Every completed period of this kind from 2023 through `through`."""
    history = []
    for start, end, label in iter_periods(kind, HISTORY_START, through):
        span = _span(index, start, end, holidays)
        ly_start, ly_end = ly_bounds(kind, start, end)
        ly_span = _span(index, ly_start, ly_end, holidays) if ly_end >= HISTORY_START else None
        rolled = _labor_over(labor, index, start, end)
        ly_net = ly_span['net'] if ly_span else 0.0
        history.append({
            'label': label,
            'start': start.isoformat(),
            'end': end.isoformat(),
            'title': human_title(kind, start, end),
            'sales': span['net'],
            'sales_ly': ly_net if ly_span else None,
            'delta_pct': _pct(span['net'], ly_net) if ly_span else None,
            'groups': _history_groups(span, ly_span or _blank_span(), config),
            'labor_pct': rolled['pct'] if rolled['days_with_labor'] else None,
        })
    return history


def _blank_span() -> dict:
    return {'net': 0.0, 'groups': {}}


def data_covers(summary: dict | None, end: date) -> bool:
    """True when the POS file was rewritten after `end` and includes that day."""
    if not summary:
        return False
    generated = summary.get('generatedAt') or ''
    date_range = summary.get('dateRange') or ['', '']
    covers = bool(date_range[1]) and end.isoformat() <= date_range[1]
    return bool(covers and file_is_fresh(generated, end))


def due_periods(as_of: date, sent: dict, summary: dict | None) -> list[tuple]:
    """Periods to send this morning.

    A period qualifies when it is the latest completed one, the POS file covers
    its last day, it has not been sent, and it ended within the last 7 days.
    The window is what lets a missed night catch up without dumping a backlog
    the first time this is turned on.
    """
    found = []
    for kind in KINDS:
        start, end, label = period_bounds(kind, as_of)
        if (sent or {}).get(kind) == label:
            continue
        if not data_covers(summary, end):
            continue
        age = (as_of - end).days
        if age < 0 or age > CATCHUP_DAYS:
            continue
        found.append((kind, start, end, label))
    return found


def load_context(data_dir: str | None = None, config: dict | None = None) -> dict:
    """Read the JSON once. Raises FileNotFoundError if POS files are missing."""
    data_dir = data_dir or DEFAULT_DATA_DIR
    config = config or load_review_config()
    summary = _read_json(os.path.join(data_dir, 'summary.json'))
    transactions = _read_json(os.path.join(data_dir, 'transactions.json'))
    labor = _read_json(os.path.join(data_dir, 'labor.json'), required=False) or {}
    gratuity = _read_json(os.path.join(data_dir, 'gratuity.json'), required=False) or {}
    reservations = _read_json(os.path.join(data_dir, 'reservation_counts.json'), required=False) or {}
    employees = _read_json(os.path.join(data_dir, 'employees.json'), required=False) or {}
    non_revenue = _non_revenue_names(summary)
    last_text = (summary.get('dateRange') or ['', ''])[1] or HISTORY_START.isoformat()
    last = date.fromisoformat(last_text)
    index = build_sales_index(transactions, config, non_revenue, HISTORY_START, last)
    return {
        'data_dir': data_dir,
        'config': config,
        'summary': summary,
        'index': index,
        'labor': labor,
        'gratuity': gratuity,
        'reservations': reservations,
        'employees': employees,
        'holidays': {},
    }


def _bowling_block(span: dict, ly_span: dict, config: dict) -> dict:
    divisor = float((config.get('bowling') or {}).get('laneHoursDivisor') or 60) or 60.0

    def hours(block):
        return block['bowling']['lane_minutes'] / divisor

    return {
        'games': span['bowling']['games'],
        'games_ly': ly_span['bowling']['games'],
        'lane_hours': hours(span),
        'lane_hours_ly': hours(ly_span),
        'shoes': span['bowling']['shoes'],
        'shoes_ly': ly_span['bowling']['shoes'],
        'online': span['bowling']['online'],
        'online_ly': ly_span['bowling']['online'],
    }


def _holiday_list(daily: list[dict]) -> list[str]:
    names = []
    for row in daily:
        name = row.get('holiday')
        if name and name not in names:
            names.append(name)
    return names


def gather_period(
    kind: str,
    start: date,
    end: date,
    data_dir: str | None = None,
    config: dict | None = None,
    context: dict | None = None,
) -> dict:
    """Metrics for one completed period. Raises FileNotFoundError if POS JSON is missing."""
    if context is None:
        context = load_context(data_dir, config)
    config = context['config']
    index = context['index']
    labor = context['labor']
    holidays = context['holidays']
    summary = context['summary']

    ly_start, ly_end = ly_bounds(kind, start, end)
    span = _span(index, start, end, holidays)
    ly_span = _span(index, ly_start, ly_end, holidays)
    generated_at = summary.get('generatedAt') or ''
    show = data_covers(summary, end)
    label = {
        'week': _week_label(start),
        'month': f'{start.year}-{start.month:02d}',
        'quarter': f'{start.year}-Q{(start.month - 1) // 3 + 1}',
        'year': str(start.year),
    }[kind]
    banner = None
    if not file_is_fresh(generated_at, end):
        banner = (
            f'POS data was last written {generated_at or "never"}, so this period '
            f'is not ready. Nothing below is filled in.'
        )
        show = False
    elif not show:
        date_range = summary.get('dateRange') or ['', '']
        banner = (
            f'POS data runs through {date_range[1] or "an unknown date"} and does not '
            f'include {end.isoformat()}. Nothing below is filled in.'
        )

    groups = _group_rows(span, ly_span, config) if show else []
    labor_block = _labor_block(
        labor, index, start, end, file_is_fresh(labor.get('generatedAt'), end) and show,
    )
    tips = _tips_span(context['gratuity'], start, end) if show else None
    tips_ly = _tips_span(context['gratuity'], ly_start, ly_end) if show else None
    parties = _party_span(
        context['reservations'], start, end, set(config.get('partyTypes') or []),
    ) if show else {'count': 0, 'top': []}
    parties_ly = _party_span(
        context['reservations'], ly_start, ly_end, set(config.get('partyTypes') or []),
    ) if show else {'count': 0, 'top': []}
    refund_tickets, refund_count = _refund_span(context['data_dir'], start, end) if show else ([], 0)
    roles = _roles_span(context['employees'], start, end) if show else []
    history = period_history(kind, end, index, labor, config, holidays) if show else []
    months = _month_rows(index, labor, start, end, holidays) if show and kind in ('quarter', 'year') else []
    ytd = None
    if show and kind == 'quarter':
        ytd_start = date(end.year, 1, 1)
        ytd_span = _span(index, ytd_start, end, holidays)
        ytd_ly = _span(index, date(end.year - 1, 1, 1), _ytd_end_last_year(end), holidays)
        ytd = {
            'sales': ytd_span['net'],
            'sales_ly': ytd_ly['net'],
            'delta_pct': _pct(ytd_span['net'], ytd_ly['net']),
        }

    closed = bool(show and span['closed_days'] == span['days'] and abs(span['net']) < 0.005)
    best = _best_day(span['daily']) if show else None
    slowest = _slowest_day(span['daily']) if show else None
    if best and slowest and best['date'] == slowest['date']:
        slowest = None

    metrics = {
        'kind': kind,
        'label': label,
        'title': human_title(kind, start, end),
        'ly_phrase': ly_phrase(kind, ly_start),
        'start': start.isoformat(),
        'end': end.isoformat(),
        'ly_start': ly_start.isoformat(),
        'ly_end': ly_end.isoformat(),
        'show_numbers': show and not closed,
        'closed': closed,
        'banner': banner,
        'days': span['days'],
        'closed_days': span['closed_days'] if show else 0,
        'closed_days_ly': ly_span['closed_days'] if show else 0,
        'net_sales': span['net'] if show else None,
        'net_sales_ly': ly_span['net'] if show else None,
        'delta_pct': _pct(span['net'], ly_span['net']) if show else None,
        'labor': labor_block,
        'labor_file_source': labor.get('source') or '',
        'tips': tips,
        'tips_ly': tips_ly,
        'departments': groups,
        'prize_fund': span['prize'] if show else None,
        'prize_fund_ly': ly_span['prize'] if show else None,
        'bowling': _bowling_block(span, ly_span, config) if show else None,
        'parties': {**parties, 'count_ly': parties_ly['count']} if show else None,
        'deductions': span['deductions'] if show else 0.0,
        'refund_tickets': refund_tickets,
        'refund_count': refund_count,
        'roles': roles,
        'daily': span['daily'] if show else [],
        'daily_ly': ly_span['daily'] if show else [],
        'holidays': _holiday_list(span['daily']) if show else [],
        'holidays_ly': _holiday_list(ly_span['daily']) if show else [],
        'best_day': best,
        'slowest_day': slowest,
        'year_best_day': _year_best(index, end, holidays) if show else None,
        'months': months,
        'ytd': ytd,
        'history': history,
        'pos_generated_at': generated_at,
        'drop_groups': list(config.get('dropFlagGroups') or []),
        'flags': [],
    }
    metrics['synopsis'] = []
    if metrics['show_numbers']:
        from period_review_synopsis import build_synopsis, slow_decline_flags
        metrics['flags'] = evaluate_period_flags(metrics, config)
        metrics['flags'].extend(slow_decline_flags(metrics, config))
        metrics['synopsis'] = build_synopsis(metrics)
    return metrics


def evaluate_period_flags(metrics: dict, config: dict) -> list[dict]:
    """Threshold flags for one period. Slow-decline streaks are added separately."""
    if not metrics.get('show_numbers'):
        return []
    thresholds = (config.get('periodThresholds') or {}).get(metrics['kind']) or {}
    drop_pct = float(thresholds.get('deptDropPct') or 0)
    drop_floor = float(thresholds.get('deptDropMinLyDollars') or 0)
    refund_floor = float(thresholds.get('refundsDollars') or 0)
    tip_low = float(thresholds.get('tipPctLow') or 0)
    tip_high = float(thresholds.get('tipPctHigh') or 100)
    flags = []

    labor = metrics.get('labor') or {}
    if not labor.get('available'):
        flags.append({
            'title': 'Labor unavailable',
            'detail': 'The 7shifts file does not cover this period, so labor is not shown.',
        })
    elif (labor.get('source') or metrics.get('labor_file_source')) not in ('', 'report'):
        flags.append({
            'title': 'Labor is estimated',
            'detail': (
                f"Source is {labor.get('source') or metrics.get('labor_file_source')}, "
                f"not the 7shifts report."
            ),
        })
    else:
        labor_high = float(thresholds.get('laborPctHigh') or 0)
        pct = labor.get('pct')
        net = metrics.get('net_sales') or 0
        if labor.get('reliable') and labor_high and pct is not None and pct > labor_high:
            coverage = ''
            if labor.get('days_with_labor') != labor.get('days'):
                coverage = (
                    f" Labor is on file for {labor.get('days_with_labor')} of "
                    f"{labor.get('days')} days."
                )
            flags.append({
                'title': f'Labor {pct:.0f}% of sales',
                'detail': (
                    f"Labor ${labor.get('cost') or 0:,.0f} is {pct:.0f}% of sales "
                    f"on the days with labor (threshold {labor_high:.0f}%).{coverage}"
                ),
            })

    drop_groups = set(config.get('dropFlagGroups') or [])
    drops = []
    for group in metrics.get('departments') or []:
        if drop_groups and group.get('id') not in drop_groups:
            continue
        delta = group.get('delta_pct')
        if delta is None or group.get('ly', 0) < drop_floor:
            continue
        if drop_pct and delta <= -drop_pct:
            drops.append(group)
    drops.sort(key=lambda group: group['delta_pct'])
    for group in drops:
        flags.append({
            'group': group['id'],
            'title': f"{group['label']} down {abs(group['delta_pct']):.0f}% vs last year",
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
        count = metrics.get('refund_count') or len(tickets)
        flags.append({
            'title': f'Adjustments and refunds ${deductions:,.0f}',
            'detail': f'{count} refund ticket(s).{extra}',
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
