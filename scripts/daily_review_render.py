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
        f'font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;'
        f'margin:22px 0 8px;padding-bottom:4px;color:{_BLACK};border-bottom:2px solid {_RED};'
    ),
    'h3': (
        f'font-size:15px;font-weight:600;margin:14px 0 4px;color:{_BLACK};'
    ),
    'p': 'margin:4px 0 8px;font-size:15px;line-height:1.4;',
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
        attr_map = dict(attrs)
        if tag == 'p' and attr_map.get('data-hero'):
            style = (
                f'margin:2px 0 4px;font-size:32px;font-weight:600;line-height:1.1;color:{_BLACK};'
            )
        else:
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
    names = [item['name'] for item in items if item.get('name')]
    return ', '.join(names) if names else ''


def _date_line(metrics: dict) -> str:
    day = _as_date(metrics['date'])
    text = f"{day.strftime('%A')}, {day.strftime('%b')} {day.day}"
    if metrics.get('holiday'):
        text += f" · {metrics['holiday']}"
    return text


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
        return f"# {BRAND_NAME}\n\n<p data-date=\"1\">{_date_line(metrics)}</p>\n\nClosed. No review sent.\n"

    lines: list[str] = []
    if metrics.get('banner'):
        lines.append(f"> **Data incomplete.** {metrics['banner']}")
        lines.append('')

    lines.append(f"# {BRAND_NAME}")
    lines.append('')
    lines.append(f"<p data-date=\"1\">{_date_line(metrics)}</p>")
    lines.append('')

    if not metrics.get('show_numbers'):
        lines.append(_footer(metrics))
        return '\n'.join(lines).rstrip() + '\n'

    net = metrics['net_sales']
    lines.append(f"<p data-hero=\"1\">{_money(net)}</p>")
    lines.append('')
    change = _pct_text(_pct(net, metrics.get('net_sales_ly_dow')))
    lines.append(
        f"{change} vs last year's {metrics.get('weekday') or 'weekday'} "
        f"({_money(metrics.get('net_sales_ly_dow'))})"
    )
    if metrics.get('ly_dow_holiday'):
        lines.append('')
        lines.append(f"*Last year's {metrics.get('weekday')} was {metrics['ly_dow_holiday']}.*")
    lines.append('')
    labor = metrics.get('labor') or {}
    if labor.get('available'):
        pct = f"{labor['pct']:.0f}% of sales" if labor.get('pct') is not None else 'sales % n/a'
        lines.append(f"Labor **{_money(labor.get('cost'))}** · {pct}")
    else:
        lines.append('Labor **unavailable**')
    lines.append('')
    tips = metrics.get('tips')
    if tips is None or not net:
        lines.append('Tips **n/a**')
    else:
        lines.append(f"Tips **{_money(tips)}** · {tips / net * 100.0:.1f}% of sales")

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
    lines.append('## By Department')
    lines.append('')
    lines.append('| Department | Sales | vs LY |')
    lines.append('|---|---:|---:|')
    for group in metrics.get('departments') or []:
        lines.append(
            f"| {group['label']} | {_money(group['sales'])} | {_pct_text(group.get('delta_pct'))} |"
        )
    lines.append(
        f"| **Total** | **{_money(net)}** | **{_pct_text(_pct(net, metrics.get('net_sales_ly_dow')))}** |"
    )
    lines.append('')
    lines.append(f"*Prize fund collected (not revenue): {_money(metrics.get('prize_fund'))}*")

    lines.append('')
    lines.append('## Details')
    lines.append('')
    bowling = metrics.get('bowling') or {}
    lines.append(
        f"**Bowling** {_qty(bowling.get('games'))} games · {bowling.get('lane_hours') or 0:.1f} lane hrs · "
        f"{_qty(bowling.get('shoes'))} shoes · {_qty(bowling.get('online'))} online"
    )
    lines.append('')
    lines.append('**Top sellers**')
    lines.append('')
    seller_lines = []
    for group in metrics.get('departments') or []:
        if group.get('id') not in ('food', 'bar', 'bowling'):
            continue
        names = _top_line(group.get('top_items') or [])
        if names:
            seller_lines.append(f"- {group['label']}: {names}")
    if seller_lines:
        lines.extend(seller_lines)
    else:
        lines.append('None.')
    lines.append('')
    running_bits = []
    for key, label in (('wtd', 'Week'), ('mtd', 'Month'), ('ytd', 'Year')):
        block = (metrics.get('running') or {}).get(key) or {}
        running_bits.append(
            f"{label} {_money(block.get('sales'))} {_pct_text(block.get('delta_pct'))}"
        )
    lines.append('**To date** ' + ' · '.join(running_bits))

    lines.append('')
    lines.append('**Labor by role**')
    lines.append('')
    roles = metrics.get('roles') or []
    if not labor.get('available'):
        lines.append("Unavailable. Yesterday's labor is not shown in its place.")
    elif not roles:
        lines.append('No punch detail for this day.')
    else:
        lines.append('| Role | |')
        lines.append('|---|---:|')
        for role in roles:
            lines.append(
                f"| {role['name']} | {role['hours']:.1f} hrs · {_money(role['cost'])} |"
            )
        notes = []
        if any(role['name'] == 'Multiple roles' for role in roles):
            notes.append(
                'Multiple roles means that person has no per-shift role on file yet.'
            )
        report_hours = labor.get('hours') or 0
        punch_hours = metrics.get('role_hours') or 0
        if report_hours and abs(punch_hours - report_hours) / report_hours > 0.05:
            notes.append(
                f"Role hours are from time punches ({punch_hours:.1f} hrs). "
                f"The labor total above is the 7shifts report ({report_hours:.1f} hrs)."
            )
        if notes:
            lines.append('')
            lines.append('*' + ' '.join(notes) + '*')

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
        f'<div style="margin-top:6px;font-size:14px;color:{_GRAY};">{html.escape(date_line)}</div>'
        if date_line else ''
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'bgcolor="{_BLACK}" style="background:{_BLACK};margin:0;border-collapse:collapse;">'
        f'<tr><td bgcolor="{_BLACK}" style="padding:16px 18px 12px;background:{_BLACK};">'
        f'<div style="font-size:20px;line-height:1.2;font-weight:600;color:#ffffff;">'
        f'{html.escape(BRAND_NAME)}</div>'
        f'{date_html}'
        '</td></tr>'
        f'<tr><td bgcolor="{_RED}" style="height:4px;background:{_RED};font-size:0;line-height:0;">&nbsp;</td></tr>'
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
    date_match = re.search(r'<p\b[^>]*data-date="1"[^>]*>(.*?)</p>\s*', styled, flags=re.DOTALL)
    if date_match:
        date_line = date_match.group(1)
        styled = styled[:date_match.start()] + styled[date_match.end():]
    else:
        date_line = _long(review_date) if review_date else ''
    # The rule under the title is the red stripe in the header, not a second line.
    styled = re.sub(r'^\s*<hr\b[^>]*/>\s*', '', styled, count=1)
    styled = _color_changes(styled)
    header = _header_block(date_line)
    return (
        '<!DOCTYPE html><html><head>'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark">'
        '</head><body style="margin:0;padding:16px;background:#f2f2f2;">'
        '<div style="max-width:640px;margin:0 auto;font-family:Segoe UI, Helvetica, Arial, sans-serif;'
        f'color:{_BLACK};font-size:15px;line-height:1.45;background:#ffffff;">'
        f'{header}'
        f'<div style="padding:8px 18px 20px;">{styled}</div>'
        '</div></body></html>'
    )
