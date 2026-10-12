#!/usr/bin/env python3
"""Render the daily-review metrics dict as Markdown and as inline-styled HTML."""

from __future__ import annotations

import html
import re
from datetime import date, datetime
from html.parser import HTMLParser

import markdown

# Concourse palette: black, red, grays, and the blue square.
_BLACK = '#1e1e1e'
_RED = '#ff1d25'
_GREEN = '#188c3a'
_BLUE = '#3776de'
_GRAY = '#e6e6e6'
_PAPER = '#f7f7f7'

BRAND_NAME = 'Concourse Bowling Daily Sales'

_TAG_STYLES = {
    'h1': (
        f'font-size:22px;font-weight:600;margin:0;line-height:1.25;color:#ffffff;'
        f'background:{_BLACK};padding:18px 18px 14px;'
    ),
    'h2': (
        f'font-size:22px;font-weight:600;margin:28px 0 10px;padding-bottom:4px;'
        f'color:{_BLACK};border-bottom:2px solid {_RED};'
    ),
    'h3': (
        f'font-size:18px;font-weight:600;margin:22px 0 4px;color:{_BLACK};'
        f'border-left:3px solid {_BLUE};padding-left:8px;'
    ),
    'p': 'margin:4px 0 10px;font-size:14px;line-height:1.4;',
    'table': 'border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:14px;',
    'th': (
        f'border-bottom:2px solid {_BLACK};padding:4px 8px;font-weight:600;'
        f'vertical-align:bottom;background:{_GRAY};color:{_BLACK};'
    ),
    'td': 'border-bottom:1px solid #eeeeee;padding:4px 8px;vertical-align:top;',
    'blockquote': (
        f'margin:0 0 16px;padding:8px 12px;background:#fff5f5;'
        f'border-left:4px solid {_RED};'
    ),
    'ul': 'margin:6px 0 12px;padding-left:18px;',
    'li': 'margin:6px 0;font-size:15px;line-height:1.4;',
    'hr': 'border:none;border-top:1px solid #dddddd;margin:16px 0;',
    'strong': 'font-weight:600;',
    'em': 'font-style:italic;',
}


class _InlineStyler(HTMLParser):
    """Add a style attribute to each tag. Right-align every table column but the first."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._cell = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        self.parts.append(self._open(tag, attrs))

    def handle_startendtag(self, tag: str, attrs) -> None:
        self.parts.append(self._open(tag, attrs, close=True))

    def handle_endtag(self, tag: str) -> None:
        self.parts.append(f'</{tag}>')

    def handle_data(self, data: str) -> None:
        self.parts.append(html.escape(data))

    def _open(self, tag: str, attrs, close: bool = False) -> str:
        if tag == 'tr':
            self._cell = 0
        if tag in ('td', 'th'):
            self._cell += 1
        style = _TAG_STYLES.get(tag, '')
        if tag in ('td', 'th') and self._cell > 1:
            style += 'text-align:right;'
        kept = [(k, v) for k, v in attrs if k != 'style']
        if style:
            kept.append(('style', style))
        rendered = ''.join(
            f' {key}' if value is None else f' {key}="{html.escape(value, quote=True)}"'
            for key, value in kept
        )
        ending = ' />' if close else '>'
        return f'<{tag}{rendered}{ending}'


def _as_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def _short(value: str) -> str:
    day = _as_date(value)
    return f"{day.strftime('%a %b')} {day.day}"


def _long(value: str) -> str:
    day = _as_date(value)
    return f"{day.strftime('%A, %B')} {day.day}, {day.year}"


def _money(value: float | None) -> str:
    if value is None:
        return 'n/a'
    rounded = int(round(value))
    sign = '-' if rounded < 0 else ''
    return f'{sign}${abs(rounded):,}'


def _signed_money(value: float | None) -> str:
    if value is None:
        return 'n/a'
    rounded = int(round(value))
    if rounded < 0:
        return f'-${abs(rounded):,}'
    if rounded > 0:
        return f'+${rounded:,}'
    return '$0'


def _pct(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current - previous) / abs(previous) * 100.0


def _pct_text(change: float | None) -> str:
    if change is None:
        return 'n/a'
    if abs(change) < 0.05:
        return '0%'
    arrow = '▲' if change > 0 else '▼'
    return f'{arrow} {abs(change):.1f}%'


def _pts_text(current: float | None, previous: float | None) -> str:
    if current is None or previous is None:
        return 'n/a'
    delta = current - previous
    if abs(delta) < 0.05:
        return '0 pts'
    arrow = '▲' if delta > 0 else '▼'
    return f'{arrow} {abs(delta):.1f} pts'


def _qty(value: float | None) -> str:
    if value is None:
        return 'n/a'
    rounded = int(round(value))
    return f'{rounded:,}'


def _top_line(items: list[dict]) -> str:
    if not items:
        return 'No items.'
    parts = []
    for item in items:
        qty = int(round(item.get('quantity') or 0))
        parts.append(f"{item['name']} ({qty:,})")
    return ' · '.join(parts)


def _generated_clock(value: str) -> str:
    if not value:
        return 'unknown'
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return value
    hour = parsed.strftime('%I').lstrip('0') or '12'
    return f"{hour}:{parsed.strftime('%M %p')}"


def subject_line(metrics: dict) -> str:
    day = _short(metrics['date'])
    if not metrics.get('show_numbers'):
        return f'{BRAND_NAME} — {day}: data incomplete'
    count = len(metrics.get('flags') or [])
    if count == 1:
        prefix = '[1 flag] '
    elif count > 1:
        prefix = f'[{count} flags] '
    else:
        prefix = ''
    change = _pct_text(_pct(metrics.get('net_sales'), metrics.get('net_sales_ly_dow')))
    labor = metrics.get('labor') or {}
    if labor.get('available') and labor.get('pct') is not None:
        labor_bit = f", labor {labor['pct']:.0f}%"
    else:
        labor_bit = ', labor n/a'
    return f"{prefix}{BRAND_NAME} — {day}: {_money(metrics.get('net_sales'))} ({change} vs LY){labor_bit}"


def render_markdown(metrics: dict) -> str:
    if metrics.get('closed') and not metrics.get('banner'):
        return f"# {BRAND_NAME}\n\n{_long(metrics['date'])}\n\nClosed. No review sent.\n"

    lines: list[str] = []
    if metrics.get('banner'):
        lines.append(f"> **Data incomplete.** {metrics['banner']}")
        lines.append('')

    if not metrics.get('show_numbers'):
        lines.append(f"# {BRAND_NAME}")
        lines.append('')
        lines.append(_long(metrics['date']))
        lines.append('')
        lines.append(_footer(metrics))
        return '\n'.join(lines).rstrip() + '\n'

    lines.append(f"# {BRAND_NAME}")
    lines.append('')
    lines.append(_long(metrics['date']))
    lines.append('')
    lines.append('---')
    holiday_bits = []
    if metrics.get('holiday'):
        holiday_bits.append(f"Yesterday was {metrics['holiday']}.")
    if metrics.get('ly_dow_holiday'):
        holiday_bits.append(
            f"Comparison day ({_short(metrics['ly_dow'])}) was {metrics['ly_dow_holiday']}."
        )
    elif metrics.get('ly_date_holiday'):
        holiday_bits.append(
            f"Same date last year ({_short(metrics['ly_date'])}) was {metrics['ly_date_holiday']}."
        )
    if holiday_bits:
        lines.append('')
        lines.append('*' + ' '.join(holiday_bits) + '*')

    lines.append('')
    lines.append('## The Day at a Glance')
    lines.append('')
    ly_dow = _short(metrics['ly_dow'])
    ly_date = _short(metrics['ly_date'])
    lines.append(f'| | Yesterday | vs LY ({ly_dow}) | vs same date LY ({ly_date}) |')
    lines.append('|---|---:|---:|---:|')
    net = metrics['net_sales']
    lines.append(
        '| **Net Sales** | **' + _money(net) + '** | '
        + _pct_text(_pct(net, metrics.get('net_sales_ly_dow')))
        + f" ({_signed_money((net or 0) - (metrics.get('net_sales_ly_dow') or 0))}) | "
        + _pct_text(_pct(net, metrics.get('net_sales_ly_date'))) + ' |'
    )
    labor = metrics.get('labor') or {}
    ly_labor = metrics.get('labor_ly_dow') or {}
    ly_labor_date = metrics.get('labor_ly_date') or {}
    if labor.get('available'):
        labor_cell = f"**{_money(labor['cost'])}** · {labor['pct']:.1f}% of sales" if labor.get('pct') is not None else f"**{_money(labor['cost'])}**"
        lines.append(
            '| **Labor** | ' + labor_cell + ' | '
            + _pts_text(labor.get('pct'), ly_labor.get('pct')) + ' | '
            + _pts_text(labor.get('pct'), ly_labor_date.get('pct')) + ' |'
        )
    else:
        lines.append('| **Labor** | **unavailable** | n/a | n/a |')
    tips = metrics.get('tips')
    if tips is None or not net:
        tip_cell = 'n/a'
        tip_pct = None
    else:
        tip_pct = tips / net * 100.0
        tip_cell = f"**{_money(tips)}** · {tip_pct:.1f}% of sales"
    lines.append(
        '| **Tips** | ' + tip_cell + ' | '
        + _pct_text(_pct(tips, metrics.get('tips_ly_dow'))) + ' | '
        + _pct_text(_pct(tips, metrics.get('tips_ly_date'))) + ' |'
    )

    lines.append('')
    lines.append('### Sales by Department')
    lines.append('')
    lines.append('| Department | Sales | vs LY | |')
    lines.append('|---|---:|---:|---|')
    for group in metrics.get('departments') or []:
        marker = ' ⚠' if group.get('flagged') else ''
        lines.append(
            f"| {group['label']} | {_money(group['sales'])} | {_pct_text(group.get('delta_pct'))} |{marker} |"
        )
    lines.append(f"| **Total** | **{_money(net)}** | **{_pct_text(_pct(net, metrics.get('net_sales_ly_dow')))}** | |")
    lines.append('')
    lines.append(
        f"*League prize fund collected (not revenue): {_money(metrics.get('prize_fund'))} "
        f"· vs LY {_pct_text(_pct(metrics.get('prize_fund'), metrics.get('prize_fund_ly')))}*"
    )

    lines.append('')
    lines.append('## Needs Attention')
    lines.append('')
    flags = metrics.get('flags') or []
    if not flags:
        lines.append('All clear.')
    else:
        for flag in flags:
            lines.append(f"- **{flag['title']}.** {flag['detail']}")

    lines.append('')
    lines.append('## Departments')
    for group in metrics.get('departments') or []:
        lines.append('')
        lines.append(
            f"### {group['label']} — {_money(group['sales'])} ({_pct_text(group.get('delta_pct'))})"
        )
        lines.append(f"Top items: {_top_line(group.get('top_items') or [])}")
        if group['id'] == 'bowling' and metrics.get('bowling'):
            bowling = metrics['bowling']
            lines.append('')
            lines.append('| Games bowled | Lane hours | Shoe rentals | Online reservations |')
            lines.append('|---:|---:|---:|---:|')
            lines.append(
                '| ' + ' | '.join([
                    f"{_qty(bowling['games'])} ({_pct_text(_pct(bowling['games'], bowling['games_ly']))})",
                    f"{bowling['lane_hours']:.1f} ({_pct_text(_pct(bowling['lane_hours'], bowling['lane_hours_ly']))})",
                    f"{_qty(bowling['shoes'])} ({_pct_text(_pct(bowling['shoes'], bowling['shoes_ly']))})",
                    f"{_qty(bowling['online'])} ({_pct_text(_pct(bowling['online'], bowling['online_ly']))})",
                ]) + ' |'
            )
        if group['id'] == 'parties' and metrics.get('parties') is not None:
            parties = metrics['parties']
            top = parties.get('top') or []
            top_text = ' · '.join(f"{item['name']} ({item['count']})" for item in top) or 'none recorded'
            lines.append('')
            count = parties['count']
            label = 'party package' if count == 1 else 'party packages'
            lines.append(f"**{count} {label} yesterday.** {top_text}")
        if group['id'] == 'other':
            detail = metrics.get('other_detail') or []
            if detail:
                bits = ' · '.join(f"{row['name']} {_money(row['sales'])}" for row in detail)
                lines.append('')
                lines.append(bits)

    lines.append('')
    lines.append('## Labor')
    lines.append('')
    if not labor.get('available'):
        lines.append('Unavailable. Yesterday\'s labor is not shown in its place.')
    else:
        splh = f"${labor['splh']:.0f} sales per labor hour" if labor.get('splh') is not None else 'sales per labor hour n/a'
        ly_splh = ly_labor.get('splh')
        splh_delta = ''
        if labor.get('splh') is not None and ly_splh is not None:
            splh_delta = f" ({_signed_money(labor['splh'] - ly_splh)} vs LY)"
        lines.append(f"**{labor['hours']:.1f} hrs** · **{_money(labor['cost'])}** · **{splh}**{splh_delta}")
        roles = metrics.get('roles') or []
        if roles:
            lines.append('')
            lines.append('| Role | Hours | Cost | % of labor |')
            lines.append('|---|---:|---:|---:|')
            role_cost = sum(r['cost'] for r in roles) or 0
            for role in roles:
                share = (role['cost'] / role_cost * 100.0) if role_cost else 0
                lines.append(
                    f"| {role['name']} | {role['hours']:.1f} | {_money(role['cost'])} | {share:.1f}% |"
                )
            report_hours = labor.get('hours') or 0
            punch_hours = metrics.get('role_hours') or 0
            lines.append('')
            note = (
                'Someone who has worked more than one role is listed under Multiple roles, '
                'because the day is not stored per role.'
            )
            if report_hours and abs(punch_hours - report_hours) / report_hours > 0.05:
                note = (
                    f"Role hours are from time punches ({punch_hours:.1f} hrs); "
                    f"the total above is the 7shifts report ({report_hours:.1f} hrs). " + note
                )
            lines.append(f'*{note}*')
        else:
            lines.append('')
            lines.append('No punch detail for this day.')

    lines.append('')
    lines.append('## Running Totals')
    lines.append('')
    lines.append('| | Sales | vs LY | Labor % |')
    lines.append('|---|---:|---:|---:|')
    labels = (('wtd', 'Week to date'), ('mtd', 'Month to date'), ('ytd', 'Year to date'))
    for key, label in labels:
        block = (metrics.get('running') or {}).get(key) or {}
        labor_pct = block.get('labor_pct')
        labor_text = 'n/a' if labor_pct is None else f'{labor_pct:.1f}%'
        lines.append(
            f"| {label} ({block.get('days', 0)} days) | {_money(block.get('sales'))} | "
            f"{_pct_text(block.get('delta_pct'))} | {labor_text} |"
        )

    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append(_footer(metrics))
    return '\n'.join(lines).rstrip() + '\n'


def _footer(metrics: dict) -> str:
    day = _as_date(metrics['date'])
    nxt = day.toordinal() + 1
    next_day = date.fromordinal(nxt)
    labor = metrics.get('labor') or {}
    source = labor.get('source') or metrics.get('labor_file_source') or 'unavailable'
    if not labor.get('available'):
        source = 'unavailable'
    pulled = _generated_clock(metrics.get('pos_generated_at') or '')
    return (
        f"*Business day {_short(metrics['date'])}, 4:00 AM → {_short(next_day.isoformat())}, 4:00 AM "
        f"· POS pulled {pulled} · Labor source: {source} "
        f"· LY comparison = same weekday 52 weeks back*"
    )


def _header_block(date_line: str) -> str:
    """Black bar, brand name, date, and the red stripe. Tables survive Gmail."""
    date_html = (
        f'<div style="margin-top:8px;font-size:16px;color:{_GRAY};">{html.escape(date_line)}</div>'
        if date_line else ''
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:{_BLACK};margin:0;border-collapse:collapse;">'
        '<tr><td style="padding:20px 18px 16px;">'
        f'<div style="font-size:28px;line-height:1.2;font-weight:600;color:#ffffff;">'
        f'{html.escape(BRAND_NAME)}</div>'
        f'{date_html}'
        '</td></tr>'
        f'<tr><td style="height:4px;background:{_RED};font-size:0;line-height:0;">&nbsp;</td></tr>'
        '</table>'
    )


def _color_changes(markup: str) -> str:
    """Up percentages in green, down percentages in red. Dollars stay as they are."""
    def paint(match: re.Match) -> str:
        text = match.group(0)
        color = _GREEN if text.startswith('▲') else _RED
        return f'<span style="color:{color};font-weight:600;">{text}</span>'

    return re.sub(r'[▲▼] \d+(?:\.\d+)?(?:%| pts)', paint, markup)


def render_html(markdown_text: str, review_date: str | None = None) -> str:
    body = markdown.markdown(markdown_text, extensions=['tables'])
    styler = _InlineStyler()
    styler.feed(body)
    styled = ''.join(styler.parts)
    # The plain-text heading becomes the colored bar instead, so it is not shown twice.
    styled = re.sub(r'<h1\b[^>]*>.*?</h1>\s*', '', styled, count=1, flags=re.DOTALL)
    date_line = _long(review_date) if review_date else ''
    if date_line:
        styled = styled.replace(f'<p style="{_TAG_STYLES["p"]}">{html.escape(date_line)}</p>', '', 1)
    # The rule under the title is the red stripe in the header, not a second line.
    styled = re.sub(r'^\s*<hr\b[^>]*/>\s*', '', styled, count=1)
    styled = _color_changes(styled)
    header = _header_block(date_line)
    return (
        '<!DOCTYPE html><html><body style="margin:0;padding:16px;background:#f2f2f2;">'
        '<div style="max-width:640px;margin:0 auto;font-family:Segoe UI, Helvetica, Arial, sans-serif;'
        f'color:{_BLACK};font-size:15px;line-height:1.45;background:#ffffff;">'
        f'{header}'
        f'<div style="padding:8px 18px 20px;">{styled}</div>'
        '</div></body></html>'
    )
