#!/usr/bin/env python3
"""
export_verdict_data.py

Standalone Monday Verdict ETL helpers. Writes two JSON files for the dashboard:

  public/data/verdict_forecast.json   — per-department + house weekly forecasts
  public/data/daypart_baselines.json  — day-of-week × daypart trailing baselines

Stdlib only. Imports find_csv_files and business_day from export_dashboards
(same scripts/ folder on SYNCSERVER and in this repo).

Does NOT modify export_dashboards.py. Safe to run as an optional nightly step.
"""

from __future__ import annotations

import csv
import json
import os
import statistics
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta

# Same directory as export_dashboards.py
_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_SCRIPT_DIR)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from export_dashboards import OUTPUT_DIR, business_day, find_csv_files  # noqa: E402

# ---------------------------------------------------------------------------
# Forecast model constants (copied from bowling_seasonality.py — do not import
# that module; it is not present on SYNCSERVER).
# ---------------------------------------------------------------------------
LEVEL_LOOKBACK = 52
SHRINK_ALPHA = 0.5
SEASONAL_YEAR_WEIGHTS = (1, 2, 3)
MIN_DEPT_WEEKS = 20

WINDOWS = [
    ('morning', 'before 11am'),
    ('lunch', '11am-3pm'),
    ('afternoon', '3pm-6pm'),
    ('evening', '6pm-9pm'),
    ('late', '9pm-4am'),
]


def _parse_time_minutes(time_str: str) -> int | None:
    """Return minutes since midnight, or None if unparseable."""
    s = (time_str or '').strip()
    if not s:
        return None
    # Accept HH:MM:SS or HH:MM
    parts = s.split(':')
    try:
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        return h * 60 + m
    except (ValueError, IndexError):
        return None


def daypart_window(time_str: str) -> str:
    """
    Map item-created time to a daypart window.
    Business day already rolled times before 4am to the previous calendar day;
    those still fall in the late window (21:00–03:59).
    """
    mins = _parse_time_minutes(time_str)
    if mins is None:
        return 'morning'
    # late: 21:00–23:59 or 00:00–03:59
    if mins >= 21 * 60 or mins < 4 * 60:
        return 'late'
    if mins < 11 * 60:
        return 'morning'
    if mins < 15 * 60:
        return 'lunch'
    if mins < 18 * 60:
        return 'afternoon'
    if mins < 21 * 60:
        return 'evening'
    return 'late'


def _weighted_seasonal(week_num, forecast_year, by_year_week):
    prior_years = sorted(
        y for y, year_data in by_year_week.items()
        if y < forecast_year and week_num in year_data and year_data[week_num] > 0
    )
    prior_years = prior_years[-len(SEASONAL_YEAR_WEIGHTS):]
    if not prior_years:
        return None
    weights = SEASONAL_YEAR_WEIGHTS[-len(prior_years):]
    num = sum(w * by_year_week[y][week_num] for y, w in zip(prior_years, weights))
    den = sum(weights)
    return num / den if den else None


def compute_weekly_forecast(weekly, by_year_week, num_future_weeks=4, start_from_year=None):
    """
    pred = level + SHRINK_ALPHA * (seasonal - level)
    Walk-forward: level uses only weeks strictly before the target week.
    """
    week_starts = sorted(weekly.keys())
    if not week_starts:
        return []

    sorted_actuals = [
        (ws.date() if isinstance(ws, datetime) else ws, rev)
        for ws, rev in sorted(weekly.items())
    ]

    if start_from_year is not None:
        first_week = date.fromisocalendar(start_from_year, 1, 1)
        num_weeks = 52
    else:
        last = sorted_actuals[-1][0]
        first_week = last + timedelta(days=7)
        num_weeks = num_future_weeks

    forecast_weeks = []
    for i in range(num_weeks):
        next_week = first_week + timedelta(days=7 * i)
        iso = next_week.isocalendar()
        week_num = min(iso[1], 52)
        forecast_year = iso[0]

        prior = [rev for d, rev in sorted_actuals if d < next_week]
        level_vals = prior[-LEVEL_LOOKBACK:] if prior else []
        level = statistics.mean(level_vals) if level_vals else 0.0

        seasonal = _weighted_seasonal(week_num, forecast_year, by_year_week)
        if seasonal is not None:
            pred = level + SHRINK_ALPHA * (seasonal - level)
        else:
            pred = level
        forecast_weeks.append((next_week, pred))
    return forecast_weeks


def _median(values):
    if not values:
        return None
    return statistics.median(values)


def load_sales_rows(csv_files):
    """
    Yield (business_date, department, revenue, time_str) for Sales/Product rows.
    Deduped on (Transaction ID, Item ID). Same filters as bowling weekly loader.
    """
    columns = [
        'Transaction ID', 'Item ID', 'Transaction Type', 'Item Type',
        'Department', 'Item Created Date', 'Item Created Time', 'Total',
        'Quantity', 'Unit Amount', 'Deleted', 'Voided',
    ]
    seen = set()

    for csv_path in csv_files:
        if not os.path.isfile(csv_path):
            continue
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            try:
                header = next(reader)
            except StopIteration:
                continue
            idx = {c: header.index(c) for c in columns if c in header}
            required = {
                'Transaction ID', 'Item ID', 'Transaction Type',
                'Item Type', 'Department', 'Item Created Date',
                'Deleted', 'Voided',
            }
            if not required.issubset(idx.keys()):
                continue
            max_idx = max(idx.values())

            for row in reader:
                if len(row) <= max_idx:
                    continue
                if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                    continue
                if row[idx['Transaction Type']] != 'Sales':
                    continue
                if row[idx['Item Type']] != 'Product':
                    continue

                key = (row[idx['Transaction ID']], row[idx['Item ID']])
                if key in seen:
                    continue
                seen.add(key)

                time_str = (
                    row[idx['Item Created Time']].strip()
                    if 'Item Created Time' in idx else ''
                )
                date_str = business_day(
                    row[idx['Item Created Date']].strip(),
                    time_str,
                )
                dept = row[idx['Department']].strip()
                if not dept:
                    continue

                total_val = float(row[idx['Total']] or 0) if 'Total' in idx else 0.0
                qty = float(row[idx['Quantity']] or 0) if 'Quantity' in idx else 0.0
                unit = float(row[idx['Unit Amount']] or 0) if 'Unit Amount' in idx else 0.0
                revenue = total_val if total_val != 0 else (qty * unit if qty else unit)

                yield date_str, dept, revenue, time_str


def build_dept_weekly(csv_files):
    """department -> { week_start(date) -> revenue }"""
    daily = defaultdict(lambda: defaultdict(float))  # dept -> date_str -> rev
    for date_str, dept, revenue, _time in load_sales_rows(csv_files):
        daily[dept][date_str] += revenue

    weekly = {}
    for dept, days in daily.items():
        w = defaultdict(float)
        for date_str, rev in days.items():
            try:
                dt = datetime.strptime(date_str, '%Y-%m-%d')
            except ValueError:
                continue
            ws = (dt - timedelta(days=dt.weekday())).date()
            w[ws] += rev
        weekly[dept] = dict(w)
    return weekly


def build_by_year_week(weekly):
    by_year_week = defaultdict(dict)
    for ws, rev in weekly.items():
        iso = ws.isocalendar()
        by_year_week[iso[0]][min(iso[1], 52)] = rev
    return dict(by_year_week)


def export_verdict_forecast(csv_files):
    print('  Building per-department weekly forecasts...')
    dept_weekly = build_dept_weekly(csv_files)
    departments = {}
    house_actual = defaultdict(float)
    house_forecast = defaultdict(float)

    # Determine current ISO year from latest data across all depts
    all_weeks = []
    for w in dept_weekly.values():
        all_weeks.extend(w.keys())
    if not all_weeks:
        print('  WARNING: no weekly sales data for forecast')
        return None
    max_year = max(ws.isocalendar()[0] for ws in all_weeks)
    last_actual_week = max(all_weeks)

    for dept, weekly in sorted(dept_weekly.items()):
        if len(weekly) < MIN_DEPT_WEEKS:
            print(f'  skip {dept}: only {len(weekly)} weeks (< {MIN_DEPT_WEEKS})')
            continue

        by_year_week = build_by_year_week(weekly)

        # Full current ISO year walk-forward
        year_forecast = compute_weekly_forecast(
            weekly, by_year_week, start_from_year=max_year,
        )
        # Plus 4 future weeks past last actual
        future = compute_weekly_forecast(
            weekly, by_year_week, num_future_weeks=4, start_from_year=None,
        )

        # Merge: prefer year_forecast for overlap, append future weeks beyond year set
        pred_by_week = {ws: pred for ws, pred in year_forecast}
        for ws, pred in future:
            pred_by_week[ws] = pred

        actual_rows = []
        for ws, rev in sorted(weekly.items()):
            if ws.isocalendar()[0] == max_year:
                actual_rows.append({
                    'weekStart': ws.strftime('%Y-%m-%d'),
                    'revenue': round(rev, 2),
                })
                house_actual[ws] += rev

        forecast_rows = []
        for ws, pred in sorted(pred_by_week.items()):
            forecast_rows.append({
                'weekStart': ws.strftime('%Y-%m-%d'),
                'predictedRevenue': round(pred, 2),
            })
            house_forecast[ws] += pred

        departments[dept] = {
            'actual': actual_rows,
            'forecast': forecast_rows,
        }
        print(f'  {dept}: {len(actual_rows)} actual weeks, {len(forecast_rows)} forecast weeks')

    house = {
        'actual': [
            {'weekStart': ws.strftime('%Y-%m-%d'), 'revenue': round(rev, 2)}
            for ws, rev in sorted(house_actual.items())
        ],
        'forecast': [
            {'weekStart': ws.strftime('%Y-%m-%d'), 'predictedRevenue': round(rev, 2)}
            for ws, rev in sorted(house_forecast.items())
        ],
    }

    data = {
        'generatedAt': datetime.now().isoformat(),
        'departments': departments,
        'house': house,
    }
    out = os.path.join(OUTPUT_DIR, 'verdict_forecast.json')
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    print(f'  -> {out}')
    print(f'  last actual week: {last_actual_week}')
    return data


def export_daypart_baselines(csv_files):
    print('  Building daypart baselines...')
    # key: (dept|All, dow, window) -> weekStart(date) -> revenue
    buckets = defaultdict(lambda: defaultdict(float))
    max_business_day = None

    for date_str, dept, revenue, time_str in load_sales_rows(csv_files):
        try:
            dt = datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            continue
        bd = dt.date()
        if max_business_day is None or bd > max_business_day:
            max_business_day = bd
        dow = dt.weekday()  # Monday=0
        window = daypart_window(time_str)
        ws = bd - timedelta(days=dow)
        buckets[(dept, dow, window)][ws] += revenue
        buckets[('All', dow, window)][ws] += revenue

    if max_business_day is None:
        print('  WARNING: no daypart rows')
        return None

    # Last complete Monday–Sunday week fully ended on or before max business day.
    # Do not use calendar today — local/dev CSVs may lag the live export.
    max_monday = max_business_day - timedelta(days=max_business_day.weekday())
    max_sunday = max_monday + timedelta(days=6)
    if max_sunday > max_business_day:
        current_week = max_monday - timedelta(days=7)
    else:
        current_week = max_monday
    print(f'  daypart current week: {current_week} (data through {max_business_day})')

    rows = []
    for (dept, dow, window), week_map in buckets.items():
        # Keep last 16 complete weeks ending at current_week
        week_starts = []
        for i in range(15, -1, -1):
            week_starts.append(current_week - timedelta(days=7 * i))

        week_revenues = [week_map.get(ws, 0.0) for ws in week_starts]
        trailing = week_revenues[:-1]
        current = week_revenues[-1]
        baseline = _median(trailing)
        if baseline is None or baseline < 200:
            continue

        # underStreak: consecutive weeks ending current below 85% of then-trailing median
        streak = 0
        for i in range(len(week_revenues) - 1, -1, -1):
            prior = week_revenues[max(0, i - 15):i]
            if not prior:
                break
            med = _median(prior)
            if med is None or med <= 0:
                break
            if week_revenues[i] < 0.85 * med:
                streak += 1
            else:
                break

        rows.append({
            'department': dept,
            'dow': dow,
            'window': window,
            'weeks': [
                {
                    'weekStart': ws.strftime('%Y-%m-%d'),
                    'revenue': round(week_map.get(ws, 0.0), 2),
                }
                for ws in week_starts
            ],
            'baselineMedian': round(baseline, 2),
            'currentWeek': round(current, 2),
            'gapDollars': round(baseline - current, 2),
            'underStreak': streak,
        })

    data = {
        'generatedAt': datetime.now().isoformat(),
        'windows': [{'id': wid, 'label': label} for wid, label in WINDOWS],
        'currentWeekStart': current_week.strftime('%Y-%m-%d'),
        'rows': rows,
    }
    out = os.path.join(OUTPUT_DIR, 'daypart_baselines.json')
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    size_mb = os.path.getsize(out) / (1024 * 1024)
    print(f'  -> {out} ({len(rows)} rows, {size_mb:.2f} MB)')
    if size_mb > 1.0:
        print('  WARNING: daypart_baselines.json exceeds 1 MB')
    return data


def main():
    print('export_verdict_data: start')
    csv_files = find_csv_files()
    if not csv_files:
        print('ERROR: no CSV files found in data/')
        return 1
    print(f'  CSV files: {len(csv_files)}')
    export_verdict_forecast(csv_files)
    export_daypart_baselines(csv_files)
    print('export_verdict_data: done')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
