#!/usr/bin/env python3
"""
bowling_sarima.py

SARIMA-based bowling revenue forecast. Loads the same POS data as bowling_seasonality,
fits a SARIMAX model with 52-week seasonality, and produces a forecast chart and CSV.
"""

import argparse
import csv
import os
import sys
from datetime import datetime, timedelta, date

# Allow import from same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bowling_seasonality import (
    load_bowling_data,
    build_52week_by_year,
    load_forecast,
    compare_forecast_to_actual,
)

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

# =============================================================================
# CONFIGURATION
# =============================================================================

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DATA = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')
DEFAULT_OUTPUT = os.path.join(_ROOT, 'output', 'bowling_sarima.png')
FORECAST_CSV_COLS = ['week_start', 'week_of_year', 'year', 'predicted_revenue', 'saved_at']

# SARIMA orders
ORDER = (1, 0, 1)
SEASONAL_ORDER = (1, 0, 1, 52)

# Theme (match bowling_seasonality)
BG_DARK = '#1a1a2e'
BG_CARD = '#16213e'
TEXT_PRIMARY = '#f0e6d3'
TEXT_SECONDARY = '#a0998c'
GRID_COLOR = '#2a2a4a'
AMBER = '#f5a623'
BLUE = '#00b0ff'
TEAL = '#03dac6'
PURPLE = '#bb86fc'   # Forecast
GREEN = '#00e676'    # Actuals overlay
CORAL = '#ff5252'
ORANGE = '#ff9100'
YEAR_COLORS = [BLUE, AMBER, CORAL, TEAL, ORANGE, PURPLE]


def weekly_to_series(weekly):
    """Convert weekly dict to pandas Series with regular weekly frequency."""
    if not weekly:
        return None
    dates = sorted(weekly.keys())
    values = [weekly[d] for d in dates]
    s = pd.Series(values, index=pd.DatetimeIndex(dates))
    s = s.asfreq('W-MON', fill_value=0)
    return s


def fit_sarima(series, order=ORDER, seasonal_order=SEASONAL_ORDER):
    """
    Fit SARIMAX model. Returns (model, forecast_result) or (None, None) on failure.
    Tries simpler fallback if convergence fails.
    """
    try:
        model = SARIMAX(
            series,
            order=order,
            seasonal_order=seasonal_order,
            enforce_stationarity=True,
            enforce_invertibility=True,
        )
        fitted = model.fit(disp=False)
        return fitted, None
    except Exception as e:
        print(f'  SARIMA fit failed: {e}')
        # Fallback: simpler seasonal order
        try:
            model = SARIMAX(
                series,
                order=(1, 0, 1),
                seasonal_order=(0, 0, 0, 52),  # No seasonal AR/MA
                enforce_stationarity=True,
                enforce_invertibility=True,
            )
            fitted = model.fit(disp=False)
            print('  Using fallback: seasonal_order=(0,0,0,52)')
            return fitted, None
        except Exception as e2:
            print(f'  Fallback failed: {e2}')
            return None, str(e2)


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


def save_forecast(forecast_weeks, path):
    """Write forecast to CSV (same format as bowling_seasonality)."""
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


def build_graph(daily, weekly, date_range, output_path, forecast_weeks=None,
               by_year_week=None, actuals_weekly=None):
    """
    Create figure matching bowling_seasonality layout:
    Panel 1: 52-week seasonality by year (actual)
    Panel 2: 52-week forecast (SARIMA, by year, with optional actuals overlay)
    """
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
        f'BOWLING REVENUE - SARIMA FORECAST  ({min_d.strftime("%b %d, %Y")} — {max_d.strftime("%b %d, %Y")})',
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
        ax2.set_title('52-Week Forecast (SARIMA)', fontsize=12, color=PURPLE, pad=10)
        ax2.legend(loc='upper right', facecolor=BG_CARD, edgecolor=GRID_COLOR,
                   labelcolor=TEXT_PRIMARY, fontsize=8)

    fig.tight_layout(rect=[0, 0, 1, 0.94])
    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)
    fig.savefig(output_path, dpi=150, facecolor=fig.get_facecolor(),
                edgecolor='none', bbox_inches='tight')
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(
        description='SARIMA bowling revenue forecast from POS data (same args as bowling_seasonality).'
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
        help='End date YYYY-MM-DD for training data (default: last date in data). '
             'Use e.g. --end 2025-12-31 to avoid training on 2026 when backtesting.'
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

    if args.forecast_weeks > 0:
        series = weekly_to_series(weekly)
        if series is None or len(series) < 104:  # Need at least 2 seasons for s=52
            print('  Need at least 104 weeks (2 years) for SARIMA. Have:', len(series) if series is not None else 0)
            return 1

        print(f'  Fitting SARIMA order={ORDER} seasonal_order={SEASONAL_ORDER}...')
        fitted, err = fit_sarima(series)
        if fitted is None:
            print('  Could not fit model.')
            return 1

        print(f'  Forecasting {args.forecast_weeks} weeks...')
        forecast_result = fitted.get_forecast(steps=args.forecast_weeks)

        last_week = max(weekly.keys())
        forecast_weeks = []
        for i in range(args.forecast_weeks):
            pred = float(forecast_result.predicted_mean.iloc[i])
            next_week = last_week + timedelta(days=7 * (i + 1))
            forecast_weeks.append((next_week, pred))

        preds = [v for _, v in forecast_weeks]
        print(f'  Forecast: {args.forecast_weeks} weeks (SARIMA) '
              f'range {fmt_currency(min(preds))}-{fmt_currency(max(preds))}/week')

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
