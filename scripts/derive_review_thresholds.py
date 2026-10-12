#!/usr/bin/env python3
"""
Propose starting flag thresholds from published history.

Prints the distribution. It does not edit config/daily_review.json; copy the
numbers you want into that file's thresholds block.

Usage:
  py -3 scripts/derive_review_thresholds.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, 'scripts'))

from daily_review_data import (  # noqa: E402
    DEFAULT_DATA_DIR,
    WEEKDAY_SHIFT,
    _empty_group,
    _read_json,
    _tips_for,
    build_sales_index,
    load_review_config,
    _non_revenue_names,
)


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * pct
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    weight = rank - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def _show(label: str, values: list[float], unit: str = '%') -> None:
    if not values:
        print(f'{label}: no days')
        return
    print(
        f'{label}: n={len(values)}  '
        f'p5={_percentile(values, 0.05):.1f}{unit}  '
        f'p10={_percentile(values, 0.10):.1f}{unit}  '
        f'p50={_percentile(values, 0.50):.1f}{unit}  '
        f'p90={_percentile(values, 0.90):.1f}{unit}  '
        f'p95={_percentile(values, 0.95):.1f}{unit}'
    )


def main() -> None:
    config = load_review_config()
    data_dir = DEFAULT_DATA_DIR
    summary = _read_json(os.path.join(data_dir, 'summary.json'))
    transactions = _read_json(os.path.join(data_dir, 'transactions.json'))
    gratuity = _read_json(os.path.join(data_dir, 'gratuity.json'), required=False) or {}
    non_revenue = _non_revenue_names(summary)
    end = date.fromisoformat(summary['dateRange'][1])
    start = end - timedelta(days=364)
    index = build_sales_index(
        transactions, config, non_revenue,
        start - timedelta(days=WEEKDAY_SHIFT), end,
    )
    floor = float(config['thresholds']['deptDropMinLyDollars'])
    drop_ids = config.get('dropFlagGroups') or [g['id'] for g in config['departmentGroups']]

    print(f'Window {start.isoformat()} to {end.isoformat()}, compared with 364 days earlier.')
    print(f'Department change only counted when last year was at least ${floor:.0f}.')
    print()

    combined = []
    for group in config['departmentGroups']:
        if group['id'] not in drop_ids:
            continue
        changes = []
        day = start
        while day <= end:
            cur = index.get(day.isoformat())
            prev = index.get((day - timedelta(days=WEEKDAY_SHIFT)).isoformat())
            cur_sales = ((cur or {}).get('groups') or {}).get(group['id'], _empty_group())['sales'] if cur else 0.0
            prev_sales = ((prev or {}).get('groups') or {}).get(group['id'], _empty_group())['sales'] if prev else 0.0
            if prev_sales >= floor:
                changes.append((cur_sales - prev_sales) / prev_sales * 100.0)
            day += timedelta(days=1)
        combined.extend(changes)
        _show(group['label'], changes)
    _show('Food+Bar+Bowling+Parties', combined)

    tips = []
    deductions = []
    day = start
    while day <= end:
        key = day.isoformat()
        bucket = index.get(key)
        net = bucket['net'] if bucket else 0.0
        if net >= 500:
            tip = _tips_for(gratuity, key)
            if tip is not None:
                tips.append(tip / net * 100.0)
        if bucket:
            deductions.append(bucket['deductions'])
        day += timedelta(days=1)
    print()
    _show('Tip % of sales (days over $500)', tips)
    _show('Adjustments and refunds', deductions, unit='')
    print()
    print('How the starting config was chosen:')
    print('  Department drop: about -40%, the food/bar p5. Parties are left out of')
    print('  the flag (median day is already down; a quiet booking day looks like -100%).')
    print('  Leagues and Other are left out because their schedules do not repeat weekly.')
    print('  Tips: p5 to p95, rounded to 3% and 10%. Refunds: p95, about $470.')
    print('Edit config/daily_review.json to change them.')


if __name__ == '__main__':
    main()
