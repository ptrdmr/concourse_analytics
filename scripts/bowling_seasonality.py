#!/usr/bin/env python3
"""
bowling_seasonality.py

Bowling revenue seasonality graph. Loads bowling sales from POS CSV,
aggregates by day and week, and produces a graph showing trends over time.
Extensible for any date range and any CSV with the same format.
"""

import argparse
import csv
import os
import statistics
from collections import defaultdict
from datetime import datetime, timedelta, date

FORECAST_WEEKS_LOOKBACK = 4
FORECAST_CSV_COLS = ['week_start', 'week_of_year', 'year', 'predicted_revenue', 'saved_at']

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker

# =============================================================================
# CONFIGURATION
# =============================================================================

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')
DEFAULT_OUTPUT = os.path.join(_ROOT, 'output', 'bowling_seasonality.png')

# Theme (match build_dashboard / build_bar_dashboard)
BG_DARK = '#1a1a2e'
BG_CARD = '#16213e'
TEXT_PRIMARY = '#f0e6d3'
TEXT_SECONDARY = '#a0998c'
GRID_COLOR = '#2a2a4a'
AMBER = '#f5a623'
BLUE = '#00b0ff'
TEAL = '#03dac6'
PURPLE = '#bb86fc'   # Forecast bars
GREEN = '#00e676'    # Actuals overlay
CORAL = '#ff5252'
ORANGE = '#ff9100'
YEAR_COLORS = [BLUE, AMBER, CORAL, TEAL, ORANGE, PURPLE]  # Cycle for year overlay

# =============================================================================
# DATA LOADING
# =============================================================================

def load_bowling_data(data_paths, start_date=None, end_date=None):
    """
    Load bowling revenue from one or more CSVs. Filter: Department=Bowling,
    Transaction Type=Sales, Item Type=Product, not Deleted/Voided.
    data_paths: single path (str) or list of paths.
    Returns (daily_revenue, weekly_revenue, date_range) or (None, None, None).
    """
    if isinstance(data_paths, str):
        data_paths = [data_paths]
    daily = defaultdict(float)
    all_dates = []

    for data_path in data_paths:
        if not os.path.isfile(data_path):
            continue
        with open(data_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f, delimiter=';')
            header = next(reader)
            idx = {c: header.index(c) for c in [
                'Transaction Type', 'Item Type', 'Department',
                'Item Created Date', 'Total', 'Quantity', 'Unit Amount',
                'Deleted', 'Voided',
            ]}
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
                if row[idx['Department']].strip() != 'Bowling':
                    continue

                date_str = row[idx['Item Created Date']].strip()
                total_val = float(row[idx['Total']] or 0)
                qty = float(row[idx['Quantity']] or 0)
                unit = float(row[idx['Unit Amount']] or 0)

                revenue = total_val if total_val != 0 else (qty * unit if qty else unit)

                try:
                    dt = datetime.strptime(date_str, '%Y-%m-%d')
                except ValueError:
                    continue

                if start_date and dt < start_date:
                    continue
                if end_date and dt > end_date:
                    continue

                daily[date_str] += revenue
                all_dates.append(dt)

    if not daily:
        return None, None, None

    # Weekly aggregation (Monday start)
    weekly = defaultdict(float)
    for date_str, rev in daily.items():
        dt = datetime.strptime(date_str, '%Y-%m-%d')
        week_start = dt - timedelta(days=dt.weekday())
        weekly[week_start] += rev

    min_d = min(all_dates)
    max_d = max(all_dates)
    return dict(daily), dict(weekly), (min_d, max_d)


def compute_weekly_forecast(weekly, by_year_week, num_future_weeks=4,
                           lookback=FORECAST_WEEKS_LOOKBACK,
                           start_from_year=None):
    """
    Forecast weekly revenue using 52-week seasonality when available.
    For each week: use mean of that week-of-year across historical years.
    Fall back to N-week moving average when no seasonal history exists.

    If start_from_year is set, forecast a full 52 weeks from Jan 1 (week 1) of that year.
    Otherwise, forecast num_future_weeks starting from the week after last data.
    Returns list of (week_start, forecast_value).
    """
    week_starts = sorted(weekly.keys())
    if not week_starts:
        return []

    # Fallback: flat 4-week moving average
    recent_revs = [weekly[w] for w in week_starts[-lookback:]] if len(week_starts) >= lookback else list(weekly.values())
    fallback_avg = statistics.mean(recent_revs) if recent_revs else 0

    if start_from_year is not None:
        # Full year from Jan 1: start at Monday of week 1
        first_week = date.fromisocalendar(start_from_year, 1, 1)  # Monday of week 1
        num_weeks = 52
    else:
        last_week = week_starts[-1]
        first_week = last_week + timedelta(days=7)
        num_weeks = num_future_weeks

    forecast_weeks = []
    for i in range(num_weeks):
        next_week = first_week + timedelta(days=7 * i)
        week_num = min(next_week.isocalendar()[1], 52)

        # Collect historical revenue for this week-of-year across all years
        seasonal_values = []
        for year_data in by_year_week.values():
            if week_num in year_data and year_data[week_num] > 0:
                seasonal_values.append(year_data[week_num])

        if seasonal_values:
            pred = statistics.mean(seasonal_values)
        else:
            pred = fallback_avg

        forecast_weeks.append((next_week, pred))

    return forecast_weeks


def save_forecast(forecast_weeks, path):
    """Write forecast to CSV for later comparison."""
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(FORECAST_CSV_COLS)
        saved_at = datetime.now().isoformat()
        for week_start, rev in forecast_weeks:
            w_num = min(week_start.isocalendar()[1], 52)
            w.writerow([
                week_start.strftime('%Y-%m-%d'),
                w_num,
                week_start.year,
                f'{rev:.2f}',
                saved_at,
            ])
    print(f'  Forecast saved to: {path}')


def load_forecast(path):
    """Load forecast from CSV. Returns list of (week_start, predicted_revenue)."""
    rows = []
    with open(path, 'r', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            week_start = datetime.strptime(row['week_start'], '%Y-%m-%d')
            pred = float(row['predicted_revenue'])
            rows.append((week_start, pred))
    return rows


def compare_forecast_to_actual(forecast_weeks, weekly):
    """Print comparison for weeks where we have both predicted and actual."""
    week_starts = {w: rev for w, rev in weekly.items()}
    matches = []
    for ws, pred in forecast_weeks:
        if ws in week_starts:
            actual = week_starts[ws]
            err = actual - pred
            pct = (err / pred * 100) if pred else 0
            matches.append((ws, pred, actual, err, pct))
    if not matches:
        print('\n  No forecast weeks overlap with current data yet (all predicted weeks are still in the future).')
        return
    print('\n' + '=' * 70)
    print('FORECAST vs ACTUAL (weeks now in data)')
    print('=' * 70)
    print(f'{"Week of":<12} {"Predicted":>12} {"Actual":>12} {"Error":>12} {"% Error":>10}')
    print('-' * 60)
    for ws, pred, actual, err, pct in matches:
        print(f'{ws.strftime("%Y-%m-%d"):<12} {fmt_currency(pred):>12} {fmt_currency(actual):>12} '
              f'{err:>+12,.0f} {pct:>+9.1f}%')
    mae = sum(abs(m[3]) for m in matches) / len(matches)
    mape = sum(abs(m[4]) for m in matches) / len(matches)
    print('-' * 60)
    print(f'  MAE: {fmt_currency(mae)}  |  MAPE: {mape:.1f}%')
    print()


def build_52week_by_year(weekly):
    """
    Group weekly revenue by (year, week_of_year). Returns dict:
    {year: {week_1_52: revenue, ...}} for each year in the data.
    Uses ISO week (1-52 or 53).
    """
    by_year_week = defaultdict(lambda: defaultdict(float))
    for week_start, rev in weekly.items():
        iso = week_start.isocalendar()
        year, week_num = iso[0], iso[1]
        # Clamp week 53 to 52 for consistent 52-week view
        week_num = min(week_num, 52)
        by_year_week[year][week_num] += rev

    return dict(by_year_week)


# =============================================================================
# THEME & HELPERS
# =============================================================================

def apply_theme():
    plt.rcParams.update({
        'figure.facecolor': BG_DARK,
        'axes.facecolor': BG_DARK,
        'axes.edgecolor': GRID_COLOR,
        'axes.labelcolor': TEXT_PRIMARY,
        'axes.grid': True,
        'grid.color': GRID_COLOR,
        'grid.alpha': 0.25,
        'text.color': TEXT_PRIMARY,
        'xtick.color': TEXT_SECONDARY,
        'ytick.color': TEXT_SECONDARY,
        'font.family': 'sans-serif',
    })


def fmt_currency(val, compact=False):
    if compact and abs(val) >= 1000:
        return f'${val/1000:,.1f}K'
    return f'${val:,.0f}'


def get_52week_month_ticks():
    """Week numbers and labels for start of each month (ISO week, ref year 2024)."""
    ticks, labels = [], []
    for m in range(1, 13):
        d = date(2024, m, 1)
        w = min(d.isocalendar()[1], 52)
        ticks.append(w)
        labels.append(f'{w}\n{d.strftime("%b")}')
    return ticks, labels


# =============================================================================
# GRAPH
# =============================================================================

def build_graph(daily, weekly, date_range, output_path, forecast_weeks=None,
               by_year_week=None, actuals_weekly=None):
    """Create figure: 52-week seasonality, 52-week forecast (if any)."""
    n_rows = 2 if forecast_weeks else 1
    fig, axes = plt.subplots(n_rows, 1, figsize=(11, 3.5 * n_rows), sharex=False)
    if n_rows == 1:
        ax1 = axes
        ax2 = None
    else:
        ax1, ax2 = axes
    fig.patch.set_facecolor(BG_DARK)

    min_d, max_d = date_range
    fig.suptitle(
        f'BOWLING REVENUE SEASONALITY  ({min_d.strftime("%b %d, %Y")} — {max_d.strftime("%b %d, %Y")})',
        fontsize=16, fontweight='bold', color=TEXT_PRIMARY, y=0.98
    )

    # --- Panel 1: 52-week seasonality by year (actual only) ---
    if by_year_week:
        years = sorted(by_year_week.keys())
        for i, year in enumerate(years):
            data = by_year_week[year]
            weeks = sorted(data.keys())
            revs = [data[w] for w in weeks]
            color = YEAR_COLORS[i % len(YEAR_COLORS)]
            ax1.plot(weeks, revs, color=color, linewidth=2, marker='o',
                    markersize=3, label=str(year))
        ax1.set_xlim(1, 52)
        wk_ticks, wk_labels = get_52week_month_ticks()
        ax1.set_xticks(wk_ticks)
        ax1.set_xticklabels(wk_labels, fontsize=7, color=TEXT_SECONDARY)
        ax1.set_xlabel('Week of year (1–52)', fontsize=9, color=TEXT_SECONDARY)
        ax1.set_ylabel('Revenue ($)', fontsize=10, color=TEXT_SECONDARY)
        ax1.yaxis.set_major_formatter(
            mticker.FuncFormatter(lambda x, _: fmt_currency(x, compact=True)))
        ax1.set_title('52-Week Seasonality by Year', fontsize=12, color=AMBER, pad=10)
        ax1.legend(loc='upper right', facecolor=BG_CARD, edgecolor=GRID_COLOR,
                   labelcolor=TEXT_PRIMARY, fontsize=8)
    else:
        ax1.set_visible(False)

    # --- Panel 2: 52-week forecast (when enabled) ---
    if forecast_weeks and ax2 is not None:
        forecast_by_year = {}
        for week_start, rev in forecast_weeks:
            yr = week_start.year
            w = min(week_start.isocalendar()[1], 52)
            if yr not in forecast_by_year:
                forecast_by_year[yr] = []
            forecast_by_year[yr].append((w, rev))

        forecast_years = sorted(forecast_by_year.keys())
        for i, year in enumerate(forecast_years):
            f_weeks, f_revs = zip(*sorted(forecast_by_year[year]))
            # Bridge: connect to last actual if this year has data
            if by_year_week and year in by_year_week and by_year_week[year]:
                last_w = max(by_year_week[year].keys())
                if last_w < min(f_weeks):
                    x = [last_w] + list(f_weeks)
                    y = [by_year_week[year][last_w]] + list(f_revs)
                else:
                    x, y = list(f_weeks), list(f_revs)
            else:
                x, y = list(f_weeks), list(f_revs)
            color = YEAR_COLORS[i % len(YEAR_COLORS)]
            ax2.plot(x, y, color=color, linewidth=2.5, linestyle='--',
                    marker='s', markersize=4, label=f'{year} forecast')

        # Overlay actuals when provided (POS-format CSVs)
        if actuals_weekly:
            actuals_by_year = {}
            for ws, rev in actuals_weekly.items():
                yr = ws.year
                w = min(ws.isocalendar()[1], 52)
                if yr not in actuals_by_year:
                    actuals_by_year[yr] = []
                actuals_by_year[yr].append((w, rev))
            for year in sorted(actuals_by_year.keys()):
                a_weeks, a_revs = zip(*sorted(actuals_by_year[year]))
                if by_year_week and year in by_year_week and by_year_week[year]:
                    last_w = max(by_year_week[year].keys())
                    if last_w < min(a_weeks):
                        x = [last_w] + list(a_weeks)
                        y = [by_year_week[year][last_w]] + list(a_revs)
                    else:
                        x, y = list(a_weeks), list(a_revs)
                else:
                    x, y = list(a_weeks), list(a_revs)
                ax2.plot(x, y, color=GREEN, linewidth=2.5, linestyle='-',
                        marker='o', markersize=4, label=f'{year} actual')

        ax2.set_xlim(1, 52)
        wk_ticks, wk_labels = get_52week_month_ticks()
        ax2.set_xticks(wk_ticks)
        ax2.set_xticklabels(wk_labels, fontsize=7, color=TEXT_SECONDARY)
        ax2.set_xlabel('Week of year (1–52)', fontsize=9, color=TEXT_SECONDARY)
        ax2.set_ylabel('Revenue ($)', fontsize=10, color=TEXT_SECONDARY)
        ax2.yaxis.set_major_formatter(
            mticker.FuncFormatter(lambda x, _: fmt_currency(x, compact=True)))
        ax2.set_title('52-Week Forecast', fontsize=12, color=PURPLE, pad=10)
        ax2.legend(loc='upper right', facecolor=BG_CARD, edgecolor=GRID_COLOR,
                   labelcolor=TEXT_PRIMARY, fontsize=8)

    fig.tight_layout(rect=[0, 0, 1, 0.94])
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    fig.savefig(output_path, dpi=150, facecolor=fig.get_facecolor(),
                edgecolor='none', bbox_inches='tight')
    plt.close(fig)


# =============================================================================
# MAIN
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description='Graph bowling revenue seasonality from POS data.'
    )
    parser.add_argument(
        '--data', nargs='+', default=[DEFAULT_DATA],
        help='Path(s) to CSV. Pass multiple for multi-file: --data 2023.csv 2024.csv 2025.csv jan2026.csv'
    )
    parser.add_argument(
        '--start', type=str, default=None,
        help='Start date YYYY-MM-DD (default: first date in data)'
    )
    parser.add_argument(
        '--end', type=str, default=None,
        help='End date YYYY-MM-DD (default: last date in data)'
    )
    parser.add_argument(
        '--output', default=DEFAULT_OUTPUT,
        help=f'Output path (default: {DEFAULT_OUTPUT})'
    )
    parser.add_argument(
        '--forecast-weeks', type=int, default=4,
        help='Number of future weeks to forecast (default: 4, use 0 to disable)'
    )
    parser.add_argument(
        '--forecast-full-year', type=int, metavar='YEAR', default=None,
        help='Forecast full 52 weeks from Jan 1 of YEAR (overrides --forecast-weeks for save-forecast)'
    )
    parser.add_argument(
        '--save-forecast', type=str, default=None,
        help='Save forecast to CSV for later comparison'
    )
    parser.add_argument(
        '--compare-forecast', type=str, default=None,
        help='Load saved forecast CSV and print comparison vs actual (for weeks now in data)'
    )
    parser.add_argument(
        '--actuals', nargs='*', default=None,
        help='POS-format CSV(s) with actuals for forecast period (same format as --data); overlay on forecast chart'
    )
    args = parser.parse_args()

    start_date = None
    end_date = None
    if args.start:
        try:
            start_date = datetime.strptime(args.start, '%Y-%m-%d')
        except ValueError:
            print(f'Invalid --start format: {args.start}. Use YYYY-MM-DD.')
            return 1
    if args.end:
        try:
            end_date = datetime.strptime(args.end, '%Y-%m-%d')
        except ValueError:
            print(f'Invalid --end format: {args.end}. Use YYYY-MM-DD.')
            return 1

    existing = [p for p in args.data if os.path.isfile(p)]
    if not existing:
        print(f'No data files found. Tried: {args.data}')
        return 1
    if len(existing) < len(args.data):
        missing = set(args.data) - set(existing)
        print(f'Warning: skipped missing files: {missing}')

    data_src = existing[0] if len(existing) == 1 else f'{len(existing)} files'
    print(f'Loading bowling data from {data_src}...')
    daily, weekly, date_range = load_bowling_data(
        existing, start_date=start_date, end_date=end_date
    )

    if daily is None:
        print('No bowling data found in the specified range.')
        return 1

    total_rev = sum(daily.values())
    min_d, max_d = date_range
    print(f'  {len(daily)} days  |  {fmt_currency(total_rev)} total  |  '
          f'{min_d.strftime("%b %d, %Y")} to {max_d.strftime("%b %d, %Y")}')

    by_year_week = build_52week_by_year(weekly)
    forecast_weeks = None
    actuals_weekly = None

    if args.actuals:
        actuals_files = [p for p in args.actuals if os.path.isfile(p)]
        if actuals_files:
            _, actuals_weekly, _ = load_bowling_data(actuals_files)
            if actuals_weekly:
                print(f'  Loaded actuals from {len(actuals_files)} file(s)')
        elif args.actuals:
            print(f'  Warning: no actuals files found. Tried: {args.actuals}')

    if args.compare_forecast and os.path.isfile(args.compare_forecast):
        loaded = load_forecast(args.compare_forecast)
        compare_forecast_to_actual(loaded, weekly)

    if args.forecast_weeks > 0 or args.forecast_full_year is not None:
        if args.forecast_full_year is not None:
            forecast_weeks = compute_weekly_forecast(
                weekly, by_year_week, start_from_year=args.forecast_full_year
            )
            n_weeks = len(forecast_weeks)
        else:
            forecast_weeks = compute_weekly_forecast(
                weekly, by_year_week, num_future_weeks=args.forecast_weeks
            )
            n_weeks = args.forecast_weeks
        if forecast_weeks:
            preds = [fv for _, fv in forecast_weeks]
            if max(preds) - min(preds) > 100:  # Varying = seasonal
                print(f'  Forecast: {n_weeks} weeks (52-week seasonal) '
                      f'range {fmt_currency(min(preds))}–{fmt_currency(max(preds))}/week')
            else:
                print(f'  Forecast: {n_weeks} weeks @ ~{fmt_currency(preds[0])}/week '
                      f'(fallback: 4-week avg)')
            if args.save_forecast:
                save_forecast(forecast_weeks, args.save_forecast)
    apply_theme()
    build_graph(daily, weekly, date_range, args.output,
                forecast_weeks=forecast_weeks, by_year_week=by_year_week,
                actuals_weekly=actuals_weekly)
    print(f'Graph saved to: {args.output}')
    return 0


if __name__ == '__main__':
    exit(main())
