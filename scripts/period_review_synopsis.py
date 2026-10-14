#!/usr/bin/env python3
"""
Plain-English sentences for a period review.

Every number comes from the metrics dict. A rule that finds nothing worth
saying returns nothing, and the paragraph is capped at five sentences.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date

Candidate = tuple[float, str, str]

_NOUN = {'week': 'week', 'month': 'month', 'quarter': 'quarter', 'year': 'year'}
_COUNT = {
    0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
    6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
}
_ORDINAL = {2: 'Second', 3: 'Third', 4: 'Fourth', 5: 'Fifth', 6: 'Sixth'}


def _money(value: float | None) -> str:
    if value is None:
        return 'n/a'
    rounded = int(round(value))
    sign = '-' if rounded < 0 else ''
    return f'{sign}${abs(rounded):,}'


def _signed(value: float) -> str:
    rounded = int(round(value))
    if rounded < 0:
        return f'-${abs(rounded):,}'
    if rounded > 0:
        return f'+${rounded:,}'
    return '$0'


def _qty(value: float | None) -> str:
    if value is None:
        return 'n/a'
    return f'{int(round(value)):,}'


def _pct(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return (current - previous) / abs(previous) * 100.0


def _pct_number(value: float) -> str:
    if abs(value - round(value)) < 0.05:
        return f'{value:.0f}%'
    return f'{value:.1f}%'


def _updown(pct: float) -> str:
    if pct > 0.05:
        return f'up {_pct_number(pct)}'
    if pct < -0.05:
        return f'down {_pct_number(abs(pct))}'
    return 'flat'


def _word(count: int) -> str:
    return _COUNT.get(count, str(count))


def _noun(metrics: dict, plural: bool = False) -> str:
    word = _NOUN.get(metrics.get('kind') or '', 'period')
    return word + 's' if plural else word


def _short_date(iso: str) -> str:
    day = date.fromisoformat(iso[:10])
    return f"{day.strftime('%b')} {day.day}"


def _run(values: list[float | None], direction: str) -> int:
    run = 0
    for delta in reversed(values):
        if delta is None:
            break
        if direction == 'down' and delta < -0.5:
            run += 1
        elif direction == 'up' and delta > 0.5:
            run += 1
        else:
            break
    return run


def _streak_sentence(count: int, noun: str, direction: str, subject: str | None) -> str:
    if count <= 6:
        word = _ORDINAL.get(count, str(count))
        if subject:
            return (
                f'{subject} is {direction} vs last year for the {word.lower()} '
                f'{noun} in a row.'
            )
        return f'{word} {noun} in a row {direction} vs last year.'
    if subject:
        return f'{subject} is {direction} vs last year for {count} {noun}s in a row.'
    return f'{count} {noun}s in a row {direction} vs last year.'


def _headline(metrics: dict) -> list[str]:
    title = metrics.get('title') or 'This period'
    net = metrics.get('net_sales')
    ly = metrics.get('net_sales_ly')
    delta = metrics.get('delta_pct')
    phrase = metrics.get('ly_phrase') or 'last year'
    if delta is None:
        first = f'{title} came in at {_money(net)}.'
    else:
        first = f'{title} came in at {_money(net)}, {_updown(delta)} on {phrase} ({_money(ly)}).'
    sentences = [first]
    driver = _driver(metrics)
    if driver:
        sentences.append(driver)
    return sentences


def _driver(metrics: dict) -> str | None:
    net = metrics.get('net_sales') or 0
    ly = metrics.get('net_sales_ly') or 0
    total = net - ly
    if abs(total) < 500:
        return None
    best = None
    for group in metrics.get('departments') or []:
        dollar = float(group.get('sales') or 0) - float(group.get('ly') or 0)
        if best is None or abs(dollar) > abs(best[0]):
            best = (dollar, group.get('label') or 'One department')
    if best is None or abs(best[0]) < 500 or abs(best[0]) < 0.5 * abs(total):
        return None
    if best[0] > 0 and total > 0:
        return f'{best[1]} did most of the lifting ({_signed(best[0])}).'
    if best[0] < 0 and total < 0:
        return f'{best[1]} accounted for most of the drop ({_signed(best[0])}).'
    return None


def _calendar(metrics: dict) -> list[Candidate]:
    daily = metrics.get('daily') or []
    daily_ly = metrics.get('daily_ly') or []
    if not daily:
        return []
    saturdays = [row for row in daily if row.get('weekday_index') == 5]
    saturdays_ly = [row for row in daily_ly if row.get('weekday_index') == 5]
    if len(saturdays) == len(saturdays_ly):
        return []
    this_sales = sum(row.get('sales') or 0 for row in saturdays)
    ly_sales = sum(row.get('sales') or 0 for row in saturdays_ly)
    if saturdays:
        average = this_sales / len(saturdays)
    elif saturdays_ly:
        average = ly_sales / len(saturdays_ly)
    else:
        return []
    worth = (len(saturdays) - len(saturdays_ly)) * average
    net = abs(metrics.get('net_sales') or 0)
    if abs(worth) < max(500, 0.03 * net):
        return []
    title = metrics.get('title') or 'This period'
    phrase = metrics.get('ly_phrase') or 'last year'
    direction = 'the gain' if worth > 0 else 'the gap'
    text = (
        f'{title} had {_word(len(saturdays))} Saturdays to {phrase}\'s '
        f'{_word(len(saturdays_ly))}, worth roughly {_money(abs(worth))} of {direction}.'
    )
    return [(min(70.0, abs(worth) / max(net, 1) * 100), text, 'calendar')]


def _holidays(metrics: dict) -> list[Candidate]:
    current = metrics.get('holidays') or []
    previous = metrics.get('holidays_ly') or []
    if set(current) == set(previous):
        return []
    phrase = metrics.get('ly_phrase') or 'last year'
    this = ', '.join(current) if current else 'none'
    last = ', '.join(previous) if previous else 'none'
    text = f'Holidays this {_noun(metrics)}: {this}. {phrase.capitalize()}: {last}.'
    return [(32.0, text, 'holiday')]


def _closed_days(metrics: dict) -> list[Candidate]:
    current = int(metrics.get('closed_days') or 0)
    previous = int(metrics.get('closed_days_ly') or 0)
    if current == previous:
        return []
    phrase = metrics.get('ly_phrase') or 'last year'
    text = (
        f'{_word(current).capitalize()} closed '
        f'{"day" if current == 1 else "days"}, versus {_word(previous)} {phrase}.'
    )
    return [(30.0, text, 'closed')]


def _shape(metrics: dict) -> list[Candidate]:
    if metrics.get('kind') != 'month':
        return []
    sales = [float(row.get('sales') or 0) for row in (metrics.get('daily') or [])]
    if len(sales) < 20:
        return []
    first = sum(sales[:10]) / 10
    last = sum(sales[-10:]) / 10
    if first <= 0:
        return []
    change = (last - first) / first * 100.0
    if abs(change) < 15:
        return []
    if change < 0:
        text = (
            f'Strong start, softer finish: the last ten days averaged '
            f'{_pct_number(abs(change))} below the first ten.'
        )
    else:
        text = (
            f'Slow start, stronger finish: the last ten days averaged '
            f'{_pct_number(change)} above the first ten.'
        )
    return [(abs(change), text, 'shape')]


def _peak_month(metrics: dict) -> list[Candidate]:
    if metrics.get('kind') not in ('quarter', 'year'):
        return []
    months = metrics.get('months') or []
    if len(months) < 3:
        return []
    average = sum(float(row.get('sales') or 0) for row in months) / len(months)
    if average <= 0:
        return []
    peak = max(months, key=lambda row: float(row.get('sales') or 0))
    if float(peak.get('sales') or 0) < average * 1.15:
        return []
    name = str(peak.get('label') or '').split(' ')[0] or 'One month'
    text = f'{name} was the peak month ({_money(peak.get("sales"))}).'
    score = (float(peak.get('sales') or 0) / average - 1) * 100
    return [(score, text, 'peak')]


def _extreme_day(metrics: dict) -> list[Candidate]:
    daily = [row for row in (metrics.get('daily') or []) if not row.get('closed')]
    if len(daily) < 7:
        return []
    ordered = sorted(float(row.get('sales') or 0) for row in daily)
    median = ordered[len(ordered) // 2]
    if median <= 0:
        return []
    found = []
    best = metrics.get('best_day')
    if best and float(best.get('sales') or 0) >= median * 1.8:
        holiday = f", {best['holiday']}" if best.get('holiday') else ''
        text = (
            f"Busiest day was {best.get('weekday')}, {_short_date(best['date'])} "
            f"({_money(best.get('sales'))}{holiday})."
        )
        found.append((min(40.0, float(best['sales']) / median * 10), text, 'busy-day'))
    slow = metrics.get('slowest_day')
    if slow and 0 < float(slow.get('sales') or 0) <= median * 0.45:
        text = (
            f"Quietest open day was {slow.get('weekday')}, {_short_date(slow['date'])} "
            f"({_money(slow.get('sales'))})."
        )
        found.append((25.0, text, 'quiet-day'))
    return found


def _bowling(metrics: dict) -> list[Candidate]:
    bowling = metrics.get('bowling') or {}
    games_pct = _pct(bowling.get('games'), bowling.get('games_ly'))
    if games_pct is None or abs(games_pct) < 8:
        return []
    phrase = metrics.get('ly_phrase') or 'last year'
    bits = [
        f"Games were {_updown(games_pct)} on {phrase} "
        f"({_qty(bowling.get('games'))} vs {_qty(bowling.get('games_ly'))})"
    ]
    lane_pct = _pct(bowling.get('lane_hours'), bowling.get('lane_hours_ly'))
    if lane_pct is not None and abs(lane_pct) >= 8:
        bits.append(f'lane hours were {_updown(lane_pct)}')
    online_pct = _pct(bowling.get('online'), bowling.get('online_ly'))
    if online_pct is not None and abs(online_pct) >= 15:
        bits.append(f'online reservations were {_updown(online_pct)}')
    return [(abs(games_pct), ', and '.join(bits) + '.', 'bowling')]


def _parties(metrics: dict) -> list[Candidate]:
    parties = metrics.get('parties') or {}
    count = int(parties.get('count') or 0)
    previous = parties.get('count_ly')
    if previous is None:
        return []
    previous = int(previous)
    diff = count - previous
    pct = _pct(count, previous)
    big_count = abs(diff) >= 5
    big_pct = pct is not None and abs(pct) >= 20 and abs(diff) >= 2
    if not big_count and not big_pct:
        return []
    popular = (parties.get('top') or [{}])[0].get('name')
    extra = f', with {popular} the most popular' if popular else ''
    text = f'{count} party bookings, {_updown(pct) if pct is not None else "changed"}{extra}.'
    if pct is None:
        text = f'{count} party bookings{extra}.'
    return [(max(abs(diff) * 3, abs(pct or 0)), text, 'parties')]


def _leagues(metrics: dict) -> list[Candidate]:
    group = next((row for row in (metrics.get('departments') or []) if row.get('id') == 'leagues'), None)
    if not group:
        return []
    sales = float(group.get('sales') or 0)
    ly = float(group.get('ly') or 0)
    prize = metrics.get('prize_fund')
    prize_bit = f', prize fund collected {_money(prize)}' if prize else ''
    if ly < 500 <= sales and sales >= max(ly * 2, 1):
        text = f'League season is underway: league fees {_money(sales)}{prize_bit}.'
        return [(60.0, text, 'leagues')]
    delta = group.get('delta_pct')
    if delta is not None and abs(delta) >= 15 and max(sales, ly) >= 1000:
        text = f'League fees were {_money(sales)}, {_updown(delta)} on {metrics.get("ly_phrase")}{prize_bit}.'
        return [(abs(delta), text, 'leagues')]
    return []


def _labor_month(metrics: dict) -> list[Candidate]:
    if metrics.get('kind') not in ('quarter', 'year'):
        return []
    months = [row for row in (metrics.get('months') or []) if row.get('labor_pct') is not None]
    if len(months) < 3:
        return []
    period_pct = (metrics.get('labor') or {}).get('pct')
    peak = max(months, key=lambda row: float(row['labor_pct']))
    if period_pct is None or float(peak['labor_pct']) < float(period_pct) + 3:
        return []
    name = str(peak.get('label') or '').split(' ')[0]
    text = f'{name} was the highest-labor month, at {float(peak["labor_pct"]):.0f}% of sales.'
    return [(float(peak['labor_pct']) - float(period_pct), text, 'labor-month')]


def _mix(metrics: dict) -> list[Candidate]:
    best = None
    for group in metrics.get('departments') or []:
        share = group.get('share')
        share_ly = group.get('share_ly')
        if share is None or share_ly is None:
            continue
        points = float(share) - float(share_ly)
        if abs(points) < 2:
            continue
        if best is None or abs(points) > abs(best[0]):
            best = (points, group.get('label') or 'One department', float(share), float(share_ly))
    if best is None:
        return []
    points, label, share, share_ly = best
    direction = 'up' if points > 0 else 'down'
    text = f'{label} was {share:.0f}% of sales, {direction} from {share_ly:.0f}%.'
    return [(abs(points) * 8, text, 'mix')]


def _movers(metrics: dict) -> list[Candidate]:
    arrived = []
    for group in metrics.get('departments') or []:
        if group.get('id') not in ('food', 'bar', 'bowling'):
            continue
        current = [item.get('name') for item in (group.get('top_items') or [])[:3] if item.get('name')]
        previous = {item.get('name') for item in (group.get('ly_top_items') or [])[:3]}
        if not previous:
            continue
        for name in current:
            if name not in previous and name not in arrived:
                arrived.append(name)
    if not arrived:
        return []
    names = ', '.join(arrived[:2])
    text = f'New in the top sellers: {names}.'
    return [(30.0, text, 'mover')]


def _pacing(metrics: dict) -> list[Candidate]:
    if metrics.get('kind') != 'quarter':
        return []
    ytd = metrics.get('ytd') or {}
    delta = ytd.get('delta_pct')
    if delta is None or abs(delta) < 3:
        return []
    text = f'Year to date {_money(ytd.get("sales"))}, {_updown(delta)} on last year.'
    return [(abs(delta) * 2, text, 'pacing')]


def _history(metrics: dict) -> list[dict]:
    return list(metrics.get('history') or [])


def _streaks(metrics: dict) -> list[Candidate]:
    history = _history(metrics)
    if len(history) < 2:
        return []
    minimum = 3 if metrics.get('kind') == 'week' else 2
    noun = _noun(metrics)
    best = None
    total = _run([row.get('delta_pct') for row in history], 'down')
    if total >= minimum and (best is None or total > best[0]):
        best = (total, None, 'down')
    total_up = _run([row.get('delta_pct') for row in history], 'up')
    if total_up >= minimum and (best is None or total_up > best[0]):
        best = (total_up, None, 'up')
    group_ids = {row.get('id') for row in (metrics.get('departments') or [])}
    if not group_ids and history:
        group_ids = set((history[-1].get('groups') or {}).keys())
    allowed = set(metrics.get('drop_groups') or [])
    if allowed:
        group_ids = {gid for gid in group_ids if gid in allowed}
    for gid in group_ids:
        values = [((row.get('groups') or {}).get(gid) or {}).get('delta_pct') for row in history]
        label = ((history[-1].get('groups') or {}).get(gid) or {}).get('label') or gid
        for direction in ('down', 'up'):
            run = _run(values, direction)
            if run >= minimum and (best is None or run > best[0]):
                best = (run, label, direction)
    if best is None:
        return []
    text = _streak_sentence(best[0], noun, best[2], best[1])
    return [(80 + best[0] * 5, text, 'streak')]


def _reversals(metrics: dict) -> list[Candidate]:
    history = _history(metrics)
    if len(history) < 4:
        return []
    noun = _noun(metrics)
    best = None

    def consider(current, preceding_values, subject):
        nonlocal best
        if current is None or current <= 0.5:
            return
        preceding = 0
        for delta in reversed(preceding_values):
            if delta is None or delta >= -0.5:
                break
            preceding += 1
        if preceding >= 3 and (best is None or preceding > best[0]):
            best = (preceding, subject)

    consider(
        history[-1].get('delta_pct'),
        [row.get('delta_pct') for row in history[:-1]],
        None,
    )
    group_ids = set((history[-1].get('groups') or {}).keys())
    allowed = set(metrics.get('drop_groups') or [])
    if allowed:
        group_ids = {gid for gid in group_ids if gid in allowed}
    for gid in group_ids:
        values = [((row.get('groups') or {}).get(gid) or {}).get('delta_pct') for row in history]
        label = ((history[-1].get('groups') or {}).get(gid) or {}).get('label') or gid
        consider(values[-1] if values else None, values[:-1], label)
    if best is None:
        return []
    count = _COUNT.get(best[0], str(best[0]))
    if best[1]:
        text = f'{best[1]} is up on last year after {count} {noun}s down.'
    else:
        text = f'First {noun} up on last year after {count} down.'
    return [(90 + best[0], text, 'reversal')]


def _momentum(metrics: dict) -> list[Candidate]:
    history = _history(metrics)
    if len(history) < 3:
        return []
    deltas = [row.get('delta_pct') for row in history[-3:]]
    if any(delta is None for delta in deltas):
        return []
    first, mid, last = deltas
    span = last - first
    slowing = first > mid > last and abs(span) >= 4
    speeding = first < mid < last and abs(span) >= 4
    if not slowing and not speeding:
        return []
    bits = ', then '.join(_updown(delta) for delta in deltas)
    if slowing and last > 0:
        lead = 'Growth vs last year is slowing'
    elif speeding and last < 0:
        lead = 'The decline vs last year is deepening'
    elif speeding:
        lead = 'Growth vs last year is picking up'
    else:
        lead = 'The comparison vs last year is fading'
    return [(55 + abs(span), f'{lead}: {bits}.', 'momentum')]


def _slot(kind: str, start_iso: str) -> int:
    day = date.fromisoformat(start_iso[:10])
    if kind == 'month':
        return day.month
    if kind == 'quarter':
        return (day.month - 1) // 3
    if kind == 'week':
        return day.isocalendar().week
    return 0


def _records(metrics: dict) -> list[Candidate]:
    history = [row for row in _history(metrics) if float(row.get('sales') or 0) >= 100]
    if len(history) < 2:
        return []
    current = history[-1]
    if current.get('label') != metrics.get('label'):
        return []
    sales = float(current.get('sales') or 0)
    kind = metrics.get('kind')
    noun = _noun(metrics)

    def beats(rows: list[dict]) -> bool:
        others = [float(row.get('sales') or 0) for row in rows if row is not current]
        if not others:
            return False
        return sales >= max(others) * 1.03

    slot = _slot(kind, current.get('start') or metrics.get('start'))
    same = [row for row in history if _slot(kind, row.get('start') or '') == slot]
    if beats(history) and len(history) >= 3:
        text = f'Busiest {noun} in our data (since 2023).'
        return [(88.0, text, 'record')]
    if kind != 'year' and beats(same) and len(same) >= 2:
        name = date.fromisoformat((current.get('start') or metrics['start'])[:10]).strftime('%B')
        if kind == 'quarter':
            name = current.get('title') or name
        if kind == 'week':
            text = 'Best week of this number in our data (since 2023).'
        elif kind == 'quarter':
            text = f'Best {name} in our data (since 2023).'
        else:
            text = f'Best {name} in our data (since 2023).'
        return [(86.0, text, 'record')]
    higher = [index for index, row in enumerate(history[:-1]) if float(row.get('sales') or 0) > sales]
    if not higher:
        return []
    last_higher = higher[-1]
    if len(history) - 1 - last_higher < 3:
        return []
    title = history[last_higher].get('title') or 'an earlier period'
    text = f'Busiest {noun} since {title}.'
    return [(72.0, text, 'record')]


def _rolling(metrics: dict) -> list[Candidate]:
    if metrics.get('kind') != 'month':
        return []
    history = _history(metrics)
    if len(history) < 3:
        return []
    last = history[-3:]
    if any(not row.get('sales_ly') for row in last):
        return []
    current = metrics.get('delta_pct')
    together = _pct(
        sum(float(row.get('sales') or 0) for row in last),
        sum(float(row.get('sales_ly') or 0) for row in last),
    )
    if current is None or together is None or current * together >= 0:
        return []
    if abs(current) < 2 or abs(together) < 2:
        return []
    name = metrics.get('title') or 'This month'
    text = (
        f'{name} was {_updown(current)}, but the last three months together '
        f'are {_updown(together)} on last year.'
    )
    return [(70.0, text, 'rolling')]


def _labor_creep(metrics: dict) -> list[Candidate]:
    pcts = []
    for row in reversed(_history(metrics)):
        if row.get('labor_pct') is None:
            break
        pcts.append(float(row['labor_pct']))
    pcts.reverse()
    if len(pcts) < 3:
        return []
    run = 1
    for index in range(len(pcts) - 1, 0, -1):
        if pcts[index] >= pcts[index - 1] + 0.3:
            run += 1
        else:
            break
    if run < 3 or pcts[-1] - pcts[-run] < 1:
        return []
    noun = _noun(metrics, plural=True)
    text = (
        f'Labor has risen for {run} {noun} running, from {pcts[-run]:.0f}% '
        f'to {pcts[-1]:.0f}%.'
    )
    return [(75 + (pcts[-1] - pcts[-run]) * 5, text, 'labor-creep')]


def _weekday_pattern(metrics: dict) -> list[Candidate]:
    if metrics.get('kind') == 'week':
        return []
    current = metrics.get('daily') or []
    previous = metrics.get('daily_ly') or []
    if not current or not previous:
        return []
    buckets = defaultdict(list)
    for row in previous:
        buckets[row.get('weekday_index')].append(row)
    used = defaultdict(int)
    grouped = defaultdict(list)
    for row in current:
        index = row.get('weekday_index')
        spot = used[index]
        used[index] += 1
        ly_rows = buckets.get(index) or []
        if spot >= len(ly_rows):
            continue
        ly = ly_rows[spot]
        if ly.get('closed') or float(ly.get('sales') or 0) < 200:
            continue
        grouped[index].append((row, ly))
    best = None
    for pairs in grouped.values():
        if len(pairs) < 3:
            continue
        down = sum(1 for row, ly in pairs if float(row.get('sales') or 0) <= float(ly.get('sales') or 0) * 0.9)
        if down / len(pairs) < 0.75:
            continue
        cur_total = sum(float(row.get('sales') or 0) for row, _ in pairs)
        ly_total = sum(float(ly.get('sales') or 0) for _, ly in pairs)
        change = _pct(cur_total, ly_total)
        if change is None or change > -8:
            continue
        if best is None or change < best[0]:
            best = (change, pairs[0][0].get('weekday') or 'One weekday', down, len(pairs))
    if best is None:
        return []
    text = f'{best[1]}s were down in {best[2]} of {best[3]} weeks.'
    return [(50 + abs(best[0]), text, 'weekday')]


def _item_trends(metrics: dict) -> list[Candidate]:
    if metrics.get('kind') == 'week':
        return []
    history = _history(metrics)
    if len(history) < 3:
        return []
    last = history[-3:]
    best = None
    noun = _noun(metrics, plural=True)
    for gid in ('food', 'bar', 'bowling'):
        books = []
        for entry in last:
            group = (entry.get('groups') or {}).get(gid) or {}
            books.append({item['name']: float(item.get('revenue') or 0) for item in group.get('top') or []})
        top = ((last[-1].get('groups') or {}).get(gid) or {}).get('top') or []
        if not top:
            continue
        name = top[0].get('name')
        if not name or any(name not in book or book[name] <= 0 for book in books):
            continue
        revenues = [book[name] for book in books]
        rising = revenues[1] >= revenues[0] * 1.08 and revenues[2] >= revenues[1] * 1.08
        falling = revenues[1] <= revenues[0] * 0.92 and revenues[2] <= revenues[1] * 0.92
        if not rising and not falling:
            continue
        change = abs(revenues[-1] - revenues[0]) / revenues[0]
        if best is None or change > best[0]:
            best = (change, name, 'up' if rising else 'down')
    if best is None:
        return []
    text = f'{best[1]} has been {best[2]} for three {noun} running.'
    return [(40 + best[0] * 20, text, 'item-trend')]


def _biggest_day(metrics: dict) -> list[Candidate]:
    best = metrics.get('best_day') or {}
    year_best = metrics.get('year_best_day') or {}
    if not best.get('date') or best.get('date') != year_best.get('date'):
        return []
    end = date.fromisoformat(str(metrics.get('end'))[:10])
    if (end - date(end.year, 1, 1)).days < 28:
        return []
    holiday = f", {best['holiday']}" if best.get('holiday') else ''
    text = (
        f"{best.get('weekday')}, {_short_date(best['date'])} was the biggest day "
        f"of {end.year} so far ({_money(best.get('sales'))}{holiday})."
    )
    return [(45.0, text, 'year-day')]


_RULES = (
    _calendar, _holidays, _closed_days, _shape, _peak_month, _extreme_day,
    _bowling, _parties, _leagues, _labor_month, _mix, _movers, _pacing,
    _streaks, _reversals, _momentum, _records, _rolling, _labor_creep,
    _weekday_pattern, _item_trends, _biggest_day,
)


def build_synopsis(metrics: dict) -> list[str]:
    """Up to five sentences. The headline is always first."""
    if not metrics.get('show_numbers'):
        return []
    sentences = _headline(metrics)
    ranked: list[Candidate] = []
    for rule in _RULES:
        ranked.extend(rule(metrics))
    ranked.sort(key=lambda item: -item[0])
    used = set()
    for _score, text, tag in ranked:
        if tag in used or len(sentences) >= 5:
            continue
        used.add(tag)
        sentences.append(text)
    delta = metrics.get('delta_pct')
    if len(sentences) == 1 and not metrics.get('flags') and (delta is None or abs(delta) < 3):
        sentences.append(f'A steady {_noun(metrics)} with no big swings.')
    return sentences[:5]


def slow_decline_flags(metrics: dict, config: dict) -> list[dict]:
    """A department down vs last year for 3+ periods, even if none crossed the line."""
    if not metrics.get('show_numbers'):
        return []
    history = _history(metrics)
    thresholds = (config.get('periodThresholds') or {}).get(metrics.get('kind')) or {}
    drop_pct = float(thresholds.get('deptDropPct') or 0)
    already = {flag.get('group') for flag in metrics.get('flags') or []}
    noun = _noun(metrics)
    flags = []
    for gid in config.get('dropFlagGroups') or []:
        if gid in already:
            continue
        run = 0
        label = gid
        for entry in reversed(history):
            group = (entry.get('groups') or {}).get(gid) or {}
            label = group.get('label') or label
            delta = group.get('delta_pct')
            if delta is None or delta >= -0.5:
                break
            run += 1
        if run >= 3:
            flags.append({
                'group': gid,
                'title': f'{label} down vs last year for {run} {noun}s in a row',
                'detail': (
                    f'None of those periods hit the {drop_pct:.0f}% line, '
                    f'so this is a slow decline rather than one bad {noun}.'
                ),
            })
    return flags
