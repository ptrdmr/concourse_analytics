#!/usr/bin/env python3
"""
holiday_analysis.py

Generates holiday_analysis.json: US holiday dates (including variable-date holidays)
with aggregated POS revenue/transactions per holiday period, for YoY analysis.

Reads from public/data/transactions.json (created by export_dashboards.py).
Outputs to public/data/holiday_analysis.json.
"""

import json
import os
from datetime import datetime, timedelta
from collections import defaultdict

try:
    import holidays
except ImportError:
    print('ERROR: holidays package required. Run: pip install holidays>=0.50')
    exit(1)

try:
    from dateutil.easter import easter
except ImportError:
    easter = None

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TRANSACTIONS_FILE = os.path.join(_ROOT, 'public', 'data', 'transactions.json')
OUTPUT_FILE = os.path.join(_ROOT, 'public', 'data', 'holiday_analysis.json')
YEAR_COLORS = ['#00b0ff', '#f5a623', '#ff5252', '#03dac6', '#ff9100', '#bb86fc']


def get_holiday_periods(years):
    """
    Build list of (holiday_name, single_date, year) for each occurrence.
    All holidays are single-day. Weekend days that flank main holidays
    (e.g. Memorial Day Weekend Friday) are their own labeled entities.
    """
    us_holidays = holidays.UnitedStates(years=years)
    periods = []

    for year in years:
        # --- From holidays library (variable dates) ---
        for dt, name in us_holidays.items():
            if dt.year != year:
                continue
            # Skip "observed" variants – we create our own day-before/day-after labels
            if " (observed)" in name:
                continue
            display_name = "Presidents' Day" if name == "Washington's Birthday" else name

            if name == "New Year's Day":
                # Single day: Jan 1
                periods.append((display_name, dt, year))
            elif name == "Memorial Day":
                # Memorial Day (Mon) + weekend days as separate entities
                periods.append(("Memorial Day Weekend Friday", dt - timedelta(days=3), year))
                periods.append(("Memorial Day Weekend Saturday", dt - timedelta(days=2), year))
                periods.append(("Memorial Day Weekend Sunday", dt - timedelta(days=1), year))
                periods.append((display_name, dt, year))
            elif name == "Independence Day":
                periods.append(("Day before Independence Day", dt - timedelta(days=1), year))
                periods.append((display_name, dt, year))
                periods.append(("Day after Independence Day", dt + timedelta(days=1), year))
            elif name == "Labor Day":
                periods.append(("Labor Day Weekend Friday", dt - timedelta(days=3), year))
                periods.append(("Labor Day Weekend Saturday", dt - timedelta(days=2), year))
                periods.append(("Labor Day Weekend Sunday", dt - timedelta(days=1), year))
                periods.append((display_name, dt, year))
            elif name in ("Thanksgiving", "Thanksgiving Day"):
                display_name = "Thanksgiving"
                periods.append((display_name, dt, year))
                periods.append(("Black Friday", dt + timedelta(days=1), year))
                periods.append(("Thanksgiving Weekend Saturday", dt + timedelta(days=2), year))
                periods.append(("Thanksgiving Weekend Sunday", dt + timedelta(days=3), year))
            elif name == "Christmas Day":
                periods.append(("Christmas Eve", datetime(year, 12, 24).date(), year))
                periods.append((display_name, dt, year))
                periods.append(("Day after Christmas", datetime(year, 12, 26).date(), year))
            else:
                # MLK, Juneteenth, Veterans, Presidents' Day, etc. – single day
                periods.append((display_name, dt, year))

        # --- New Year's Eve (Dec 31) – single day ---
        periods.append(("New Year's Eve", datetime(year, 12, 31).date(), year))

        # --- Easter: Sat, Sun, Mon as separate entities ---
        if easter:
            easter_sun = easter(year)
            periods.append(("Easter Saturday", easter_sun - timedelta(days=1), year))
            periods.append(("Easter", easter_sun, year))
            periods.append(("Easter Monday", easter_sun + timedelta(days=1), year))

        # --- Fixed-date holidays ---
        periods.append(("Valentine's Day", datetime(year, 2, 14).date(), year))
        periods.append(("St. Patrick's Day", datetime(year, 3, 17).date(), year))

    # Dedupe by (name, date) – same holiday name can appear multiple times per year (e.g. New Year's Eve)
    # but we want unique (name, date) since we're doing single-day
    seen = set()
    unique = []
    for name, d, year in periods:
        key = (name, d)
        if key in seen:
            continue
        seen.add(key)
        unique.append((name, d, d, year))  # start=end for single day

    return unique


def load_transactions(rows=None):
    """Load transaction rows from transactions.json, or use provided rows."""
    if rows is not None:
        return rows
    if not os.path.isfile(TRANSACTIONS_FILE):
        print(f'ERROR: {TRANSACTIONS_FILE} not found. Run export_dashboards.py first.')
        return None

    with open(TRANSACTIONS_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def aggregate_by_date_range(rows, start_date, end_date):
    """Aggregate revenue, transactions, and byDepartment for rows in date range."""
    total_revenue = 0.0
    total_transactions = 0
    by_dept = defaultdict(float)

    for r in rows:
        try:
            d = datetime.strptime(r['date'], '%Y-%m-%d').date()
        except (ValueError, KeyError):
            continue
        if start_date <= d <= end_date:
            rev = r.get('revenue', 0) or 0
            txns = r.get('transactions', 0) or 0
            dept = r.get('department', 'Other')
            total_revenue += rev
            total_transactions += txns
            by_dept[dept] += rev

    return {
        'revenue': round(total_revenue, 2),
        'transactions': total_transactions,
        'byDepartment': dict(by_dept),
    }


def export_holiday_analysis(rows=None, quiet=False):
    """
    Generate holiday_analysis.json. If rows is provided (from export_dashboards),
    use them; otherwise load from transactions.json.
    Returns 0 on success, 1 on failure.
    """
    rows = load_transactions(rows)
    if not rows:
        return 1

    # Infer years from data
    dates = set()
    for r in rows:
        d = r.get('date')
        if d:
            dates.add(d[:4])
    years = sorted(int(y) for y in dates if y.isdigit())
    if not years:
        if not quiet:
            print('ERROR: No valid dates in transactions')
        return 1

    periods = get_holiday_periods(years)
    if not quiet:
        print(f'Transactions: {len(rows):,} rows')
        print(f'Years: {years}')
        print(f'Holiday periods: {len(periods)}')

    # Group by holiday name
    by_holiday = defaultdict(list)
    for name, start, end, year in periods:
        agg = aggregate_by_date_range(rows, start, end)
        by_holiday[name].append({
            'year': year,
            'startDate': start.strftime('%Y-%m-%d'),
            'endDate': end.strftime('%Y-%m-%d'),
            'revenue': agg['revenue'],
            'transactions': agg['transactions'],
            'byDepartment': agg['byDepartment'],
        })

    # Sort years within each holiday
    for name in by_holiday:
        by_holiday[name].sort(key=lambda x: x['year'])

    holidays_list = [
        {'name': name, 'years': data}
        for name, data in sorted(by_holiday.items())
    ]

    out = {
        'generatedAt': datetime.now().isoformat(),
        'holidays': holidays_list,
        'yearColors': YEAR_COLORS,
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2)

    return 0


def main():
    print('=' * 60)
    print('HOLIDAY ANALYSIS')
    print('=' * 60)

    rows = load_transactions(None)
    if not rows:
        return 1

    result = export_holiday_analysis(rows)
    if result == 0:
        print(f'  -> {OUTPUT_FILE}')
        print('Done!')
    return result


if __name__ == '__main__':
    exit(main())
