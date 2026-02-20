#!/usr/bin/env python3
"""
forecast_food_sales.py

Lightweight food sales forecasting. No Prophet, no statsmodels—just simple
averages and moving averages.

1. Day-of-week summary: avg revenue and items per weekday (staffing, prep)
2. Weekly revenue forecast: 4-week moving average with rough range (budgeting)
3. Top-item averages: weekly avg qty for top 15 items (ordering)
"""

import csv
import os
import statistics
from collections import defaultdict
from datetime import datetime

from build_dashboard import load_data

# =============================================================================
# CONFIG
# =============================================================================

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOOD_PURCHASES = os.path.join(_ROOT, 'data', 'food_purchases.csv')
TOP_N_ITEMS = 15
MOVING_AVG_WEEKS = 4
RANGE_PCT = 0.15  # ±15% for rough forecast range

DAY_ORDER = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday',
    'Friday', 'Saturday', 'Sunday',
]


def fmt_currency(val):
    return f'${val:,.0f}'


def fmt_number(val):
    return f'{val:,.0f}'


# =============================================================================
# 1. DAY-OF-WEEK SUMMARY
# =============================================================================

def load_day_of_week_data():
    """Aggregate food_purchases.csv by date, then by weekday."""
    daily_revenue = defaultdict(float)
    daily_items = defaultdict(int)
    date_to_weekday = {}

    path = FOOD_PURCHASES
    if not os.path.exists(path):
        print("  Warning: food_purchases.csv not found. Run export_clean_csv.py first.")
        return {}, {}

    with open(path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            date = row.get('Date', '').strip()
            day_name = row.get('Day_of_Week', '').strip()
            try:
                cost = float(row.get('Cost', 0))
            except (ValueError, TypeError):
                cost = 0
            if not date or not day_name:
                continue
            daily_revenue[date] += cost
            daily_items[date] += 1
            date_to_weekday[date] = day_name

    # Group by weekday
    weekday_revenue = defaultdict(list)
    weekday_items = defaultdict(list)
    for date in daily_revenue:
        wd = date_to_weekday[date]
        weekday_revenue[wd].append(daily_revenue[date])
        weekday_items[wd].append(daily_items[date])

    return dict(weekday_revenue), dict(weekday_items)


def print_day_of_week(weekday_revenue, weekday_items):
    """Print avg revenue and items per weekday."""
    print("\n" + "=" * 60)
    print("DAY-OF-WEEK SUMMARY (avg revenue & items per day)")
    print("=" * 60)
    print(f"{'Day':<12} {'Avg Revenue':>14} {'Avg Items':>12} {'Days':>6}")
    print("-" * 50)

    for day in DAY_ORDER:
        revs = weekday_revenue.get(day, [])
        items = weekday_items.get(day, [])
        avg_rev = statistics.mean(revs) if revs else 0
        avg_items = statistics.mean(items) if items else 0
        n = len(revs) if revs else 0
        print(f"{day:<12} {fmt_currency(avg_rev):>14} {fmt_number(avg_items):>12} {n:>6}")

    print()


# =============================================================================
# 2. WEEKLY REVENUE FORECAST
# =============================================================================

def print_weekly_forecast(weeks, num_weeks):
    """4-week moving average with rough range."""
    print("=" * 60)
    print("WEEKLY REVENUE FORECAST")
    print("=" * 60)

    week_list = list(weeks.keys())
    rev_list = [weeks[w]['revenue'] for w in week_list]

    if len(rev_list) < MOVING_AVG_WEEKS:
        print(f"  Not enough data (need {MOVING_AVG_WEEKS} weeks, have {len(rev_list)})")
        return

    recent = rev_list[-MOVING_AVG_WEEKS:]
    avg = statistics.mean(recent)
    try:
        std = statistics.stdev(recent)
        low = max(0, avg - std)
        high = avg + std
    except statistics.StatisticsError:
        low = avg * (1 - RANGE_PCT)
        high = avg * (1 + RANGE_PCT)

    print(f"  Method: {MOVING_AVG_WEEKS}-week moving average")
    print(f"  Next week forecast: {fmt_currency(avg)}")
    print(f"  Rough range: {fmt_currency(low)} - {fmt_currency(high)}")
    print(f"  (based on recent {MOVING_AVG_WEEKS} weeks)")
    print()


# =============================================================================
# 3. TOP-ITEM AVERAGES
# =============================================================================

def print_top_item_averages(items, num_weeks):
    """Weekly avg qty for top N items by revenue."""
    print("=" * 60)
    print(f"TOP {TOP_N_ITEMS} ITEMS - WEEKLY AVERAGE (for ordering)")
    print("=" * 60)
    print(f"{'#':<4} {'Item':<35} {'Avg Qty/Week':>14} {'Category':<20}")
    print("-" * 80)

    nw = max(num_weeks, 1)
    sorted_items = sorted(
        items.items(),
        key=lambda x: x[1]['revenue'],
        reverse=True,
    )[:TOP_N_ITEMS]

    for i, (name, st) in enumerate(sorted_items, 1):
        avg_qty = st['qty'] / nw
        cat = st.get('category', 'Other')
        print(f"{i:<4} {name[:34]:<35} {avg_qty:>14.1f} {cat:<20}")

    print()


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("Loading data...")
    data = load_data()

    print(f"  {len(data['items'])} items  |  {data['num_weeks']} weeks  |  "
          f"{fmt_currency(data['total_revenue'])} total revenue")
    print(f"  Date range: {data['date_range'][0]} to {data['date_range'][1]}")

    # 1. Day-of-week
    weekday_revenue, weekday_items = load_day_of_week_data()
    if weekday_revenue:
        print_day_of_week(weekday_revenue, weekday_items)

    # 2. Weekly forecast
    print_weekly_forecast(data['weeks'], data['num_weeks'])

    # 3. Top items
    print_top_item_averages(data['items'], data['num_weeks'])

    print("Done.")


if __name__ == '__main__':
    main()
