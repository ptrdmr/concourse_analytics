#!/usr/bin/env python3
"""Render a period-review metrics dict as Markdown and inline-styled HTML.

One template covers week, month, quarter, and year. Sections that do not
apply to the shorter periods are left out, and every section has a hard cap
so the email cannot grow into a wall of text.
"""

from __future__ import annotations

from datetime import date

from daily_review_render import (
    _generated_clock,
    _money,
    _pct_text,
    _qty,
    render_html,
)

BRANDS = {
    'week': 'Concourse Bowling Weekly Sales',
    'month': 'Concourse Bowling Monthly Sales',
    'quarter': 'Concourse Bowling Quarterly Sales',
    'year': 'Concourse Bowling Yearly Sales',
}

MAX_SYNOPSIS = 5
MAX_FLAGS = 5
MAX_ROLES = 6
MAX_SELLERS = 3


def _brand(metrics: dict) -> str:
    return BRANDS.get(metrics.get('kind') or '', 'Concourse Bowling Sales')


def _as_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _short(value: str) -> str:
    day = _as_date(value)
    return f"{day.strftime('%b')} {day.day}"


def subject_line(metrics: dict) -> str:
    brand = _brand(metrics)
    title = metrics.get('title') or ''
    if not metrics.get('show_numbers'):
        return f'{brand} — {title}: data incomplete'
    count = len(metrics.get('flags') or [])
    if count == 1:
        prefix = '[1 flag] '
    elif count > 1:
        prefix = f'[{count} flags] '
    else:
        prefix = ''
    change = _pct_text(metrics.get('delta_pct'))
    labor = metrics.get('labor') or {}
    if labor.get('available') and labor.get('reliable') and labor.get('pct') is not None:
        labor_bit = f", labor {labor['pct']:.0f}%"
    else:
        labor_bit = ', labor n/a'
    return (
        f"{prefix}{brand} — {title}: {_money(metrics.get('net_sales'))} "
        f"({change} vs LY){labor_bit}"
    )


def _key_numbers(metrics: dict) -> str:
    labor = metrics.get('labor') or {}
    if labor.get('available') and labor.get('pct') is not None:
        labor_bit = f"Labor {labor['pct']:.0f}%"
        if labor.get('days_with_labor') != labor.get('days'):
            labor_bit += f" ({labor.get('days_with_labor')} of {labor.get('days')} days)"
        if labor.get('splh') is not None:
            labor_bit += f" · {_money(labor.get('splh'))} per labor hour"
    else:
        labor_bit = 'Labor n/a'
    net = metrics.get('net_sales') or 0
    tips = metrics.get('tips')
    if tips is None or not net:
        tip_bit = 'Tips n/a'
    else:
        tip_bit = f"Tips {tips / net * 100.0:.1f}%"
    parties = (metrics.get('parties') or {}).get('count')
    party_bit = f"{int(parties or 0)} parties"
    games = (metrics.get('bowling') or {}).get('games')
    return f"{labor_bit} · {tip_bit} · {party_bit} · {_qty(games)} games"


def _role_rows(roles: list[dict]) -> list[dict]:
    if len(roles) <= MAX_ROLES:
        return roles
    head = list(roles[:MAX_ROLES])
    rest = roles[MAX_ROLES:]
    head.append({
        'name': 'Other',
        'hours': sum(row.get('hours') or 0 for row in rest),
        'cost': sum(row.get('cost') or 0 for row in rest),
    })
    return head


def _footer(metrics: dict) -> str:
    labor = metrics.get('labor') or {}
    source = labor.get('source') or metrics.get('labor_file_source') or 'unavailable'
    if not labor.get('available'):
        source = 'unavailable'
    pulled = _generated_clock(metrics.get('pos_generated_at') or '')
    start = _short(metrics['start']) if metrics.get('start') else ''
    end = _short(metrics['end']) if metrics.get('end') else ''
    ly_start = _short(metrics['ly_start']) if metrics.get('ly_start') else ''
    ly_end = _short(metrics['ly_end']) if metrics.get('ly_end') else ''
    lines = (
        f"*{start}–{end} · compared with {ly_start}–{ly_end} "
        f"· POS pulled {pulled} · Labor source: {source} "
        f"· LY comparison = same calendar period last year*"
    )
    url = (metrics.get('dashboard_url') or '').strip()
    if url:
        lines += f"\n\n[Full detail is on the dashboard]({url})."
    return lines


def render_markdown(metrics: dict) -> str:
    brand = _brand(metrics)
    if metrics.get('closed') and not metrics.get('banner'):
        return (
            f"# {brand}\n\n<p data-date=\"1\">{metrics.get('title') or ''}</p>\n\n"
            f"Closed. No review sent.\n"
        )

    lines: list[str] = []
    if metrics.get('banner'):
        lines.append(f"> **Data incomplete.** {metrics['banner']}")
        lines.append('')
    lines.append(f'# {brand}')
    lines.append('')
    lines.append(f"<p data-date=\"1\">{metrics.get('title') or ''}</p>")
    lines.append('')
    if not metrics.get('show_numbers'):
        lines.append(_footer(metrics))
        return '\n'.join(lines).rstrip() + '\n'

    net = metrics.get('net_sales')
    lines.append(f"<p data-hero=\"1\">{_money(net)}</p>")
    lines.append('')
    lines.append(f"{_pct_text(metrics.get('delta_pct'))} vs {metrics.get('ly_phrase') or 'last year'} ({_money(metrics.get('net_sales_ly'))})")
    lines.append('')
    synopsis = [sentence.strip() for sentence in (metrics.get('synopsis') or []) if sentence.strip()]
    synopsis = synopsis[:MAX_SYNOPSIS]
    if synopsis:
        lines.append(' '.join(synopsis))
        lines.append('')

    lines.append('## Needs Attention')
    lines.append('')
    flags = metrics.get('flags') or []
    shown = flags[:MAX_FLAGS]
    if not shown:
        lines.append('All clear.')
    else:
        for flag in shown:
            lines.append(f"- **{flag['title']}.** {flag['detail']}")
        extra = len(flags) - len(shown)
        if extra:
            more = f'+{extra} more'
            if metrics.get('dashboard_url'):
                more += ' on the dashboard'
            lines.append(f'- {more}.')
    lines.append('')
    lines.append(_key_numbers(metrics))
    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## By Department')
    lines.append('')
    lines.append('| Department | Sales | vs LY |')
    lines.append('|---|---:|---:|')
    for group in metrics.get('departments') or []:
        lines.append(
            f"| {group['label']} | {_money(group.get('sales'))} | {_pct_text(group.get('delta_pct'))} |"
        )
    lines.append(
        f"| **Total** | **{_money(net)}** | **{_pct_text(metrics.get('delta_pct'))}** |"
    )
    lines.append('')
    lines.append(f"*Prize fund collected (not revenue): {_money(metrics.get('prize_fund'))}*")

    lines.append('')
    lines.append('## The period')
    lines.append('')
    kind = metrics.get('kind')
    if kind == 'week':
        lines.extend(_week_table(metrics))
    elif kind == 'month':
        lines.extend(_month_extremes(metrics))
    else:
        lines.extend(_month_table(metrics))

    lines.append('')
    lines.append('**Top sellers**')
    lines.append('')
    seller_lines = []
    for group in metrics.get('departments') or []:
        if group.get('id') not in ('food', 'bar', 'bowling'):
            continue
        names = [
            item['name'] for item in (group.get('top_items') or [])[:MAX_SELLERS]
            if item.get('name')
        ]
        if names:
            seller_lines.append(f"- {group['label']}: {', '.join(names)}")
    lines.extend(seller_lines or ['None.'])

    if kind != 'week':
        lines.append('')
        lines.append('**Labor by role**')
        lines.append('')
        labor = metrics.get('labor') or {}
        roles = _role_rows(metrics.get('roles') or [])
        if not labor.get('available'):
            lines.append('Unavailable.')
        elif not roles:
            lines.append('No punch detail for this period.')
        else:
            lines.append('| Role | |')
            lines.append('|---|---:|')
            for role in roles:
                lines.append(
                    f"| {role['name']} | {role['hours']:.1f} hrs · {_money(role['cost'])} |"
                )

    deductions = float(metrics.get('deductions') or 0)
    count = int(metrics.get('refund_count') or 0)
    if deductions or count:
        lines.append('')
        extra = ''
        tickets = metrics.get('refund_tickets') or []
        if tickets:
            top = tickets[0]
            extra = f", largest {_money(top.get('amount'))} (#{top.get('txnId')})"
        lines.append(f"Adjustments and refunds {_money(deductions)} · {count} refund tickets{extra}.")

    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append(_footer(metrics))
    return '\n'.join(lines).rstrip() + '\n'


def _week_table(metrics: dict) -> list[str]:
    lines = ['| Day | Sales | vs LY |', '|---|---:|---:|']
    current = metrics.get('daily') or []
    previous = metrics.get('daily_ly') or []
    for index, row in enumerate(current):
        ly = previous[index] if index < len(previous) else None
        ly_sales = ly.get('sales') if ly else None
        change = None
        if ly_sales not in (None, 0):
            change = (float(row.get('sales') or 0) - float(ly_sales)) / abs(float(ly_sales)) * 100.0
        holiday = f" · {row['holiday']}" if row.get('holiday') else ''
        lines.append(
            f"| {row.get('weekday')} {_short(row['date'])}{holiday} | "
            f"{_money(row.get('sales'))} | {_pct_text(change)} |"
        )
    return lines


def _month_extremes(metrics: dict) -> list[str]:
    lines = ['| | Day | Sales |', '|---|---|---:|']
    for label, row in (('Busiest', metrics.get('best_day')), ('Quietest', metrics.get('slowest_day'))):
        if not row:
            continue
        holiday = f" · {row['holiday']}" if row.get('holiday') else ''
        lines.append(
            f"| {label} | {row.get('weekday')} {_short(row['date'])}{holiday} | {_money(row.get('sales'))} |"
        )
    if len(lines) == 2:
        return ['No open days.']
    return lines


def _month_table(metrics: dict) -> list[str]:
    lines = ['| Month | Sales | vs LY |', '|---|---:|---:|']
    for row in (metrics.get('months') or [])[:12]:
        lines.append(
            f"| {row.get('label')} | {_money(row.get('sales'))} | {_pct_text(row.get('delta_pct'))} |"
        )
    if len(lines) == 2:
        return ['No months in this period.']
    return lines


def render_period_html(metrics: dict, markdown_text: str | None = None) -> str:
    text = markdown_text if markdown_text is not None else render_markdown(metrics)
    return render_html(text, metrics.get('end'), brand=_brand(metrics))
