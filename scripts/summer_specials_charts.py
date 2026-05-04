#!/usr/bin/env python3
"""Line charts for summer promo packages, Jun–Aug 2025, from POS export.

Combined print page also includes 2026 weekly quantity totals for Unlimited Bowling — Charge
(sum of POS Quantity per week; each unit is one charge / person, data/2026.csv).
"""

import csv
import os
from collections import defaultdict
from datetime import datetime, date, timedelta

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
from matplotlib.transforms import blended_transform_factory

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CSV = os.path.join(_ROOT, "data", "2025.csv")
CSV_2026 = os.path.join(_ROOT, "data", "2026.csv")
OUT_DIR = os.path.join(_ROOT, "output")

UNLIMITED_BOWLING_CHARGE = "Unlimited Bowling - Charge"

# Theme (align with bowling_seasonality / dashboards)
BG_DARK = "#1a1a2e"
BG_CARD = "#16213e"
TEXT_PRIMARY = "#f0e6d3"
TEXT_SECONDARY = "#a0998c"
GRID_COLOR = "#2a2a4a"
AMBER = "#f5a623"
BLUE = "#00b0ff"
TEAL = "#0ea5e9"
RED = "#d62728"  # Summer Game Deal Tuesday (distinct from Wed teal / Thu green)
CORAL = "#ff5252"
GREEN = "#4ade80"
PURPLE = "#bb86fc"
ORANGE = "#f97316"  # Unlimited Bowling — Charge (2026 weekly panel)

# Print layout (light theme — easier to read on paper, less ink than full-bleed dark)
PRINT_PAGE_BG = "#ffffff"
PRINT_AX_BG = "#fafafa"
PRINT_TEXT = "#1a1a1a"
PRINT_TEXT_MUTED = "#444444"
PRINT_GRID = "#cccccc"


def month_starts_in_range(window_start: date, window_end: date):
    """Each calendar month-start (day=1) that falls within [window_start, window_end]."""
    y, m = window_start.year, window_start.month
    d = date(y, m, 1)
    while d < window_start:
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
        d = date(y, m, 1)
    out = []
    while d <= window_end:
        out.append(d)
        if m == 12:
            y, m = y + 1, 1
        else:
            m += 1
        d = date(y, m, 1)
    return out


def _month_line_label(ms: date) -> str:
    """Display names aligned with Jun–Aug promos (user preference: June, Jul, Aug)."""
    return {6: "June", 7: "Jul", 8: "Aug"}.get(ms.month, ms.strftime("%b"))


def add_month_start_markers(ax, window_start: date, window_end: date, *, theme: str):
    """Vertical lines at the 1st of each month; labels centered under each line."""
    months = month_starts_in_range(window_start, window_end)
    if not months:
        return
    if theme == "dark":
        line_kw = dict(
            color=TEXT_SECONDARY,
            linestyle="--",
            linewidth=1.0,
            alpha=0.7,
            zorder=1,
        )
        label_color = TEXT_SECONDARY
        label_fs = 9
        # Axes y: 0 = x-axis; small negative = just under axis (avoid large gap below chart)
        label_y_axes = -0.045
    else:
        line_kw = dict(
            color="#888888",
            linestyle="--",
            linewidth=0.85,
            alpha=0.95,
            zorder=1,
        )
        label_color = PRINT_TEXT_MUTED
        label_fs = 6.5
        label_y_axes = -0.065

    trans = blended_transform_factory(ax.transData, ax.transAxes)
    for ms in months:
        ax.axvline(ms, **line_kw)
        ax.text(
            ms,
            label_y_axes,
            _month_line_label(ms),
            transform=trans,
            fontsize=label_fs,
            ha="center",
            va="top",
            color=label_color,
            alpha=0.92,
            zorder=5,
            clip_on=False,
        )


def hide_automatic_date_ticklabels(ax):
    """Hide matplotlib's default date tick labels; keep month names from add_month_start_markers."""
    ax.tick_params(axis="x", labelbottom=False)


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def parse_row_indices(header):
    return {c: header.index(c) for c in header}


def is_good_sale(row, idx):
    if len(row) <= max(idx.values()):
        return False
    if row[idx["Deleted"]] != "False" or row[idx["Voided"]] != "False":
        return False
    if row[idx["Transaction Type"]] != "Sales":
        return False
    return True


def load_and_aggregate(csv_path: str):
    start = date(2025, 6, 1)
    end = date(2025, 8, 31)

    meetup = defaultdict(float)
    game_deal_tue = defaultdict(float)
    game_deal_wed = defaultdict(float)
    game_deal_thu = defaultdict(float)
    friday_pregame = defaultdict(float)
    sunday_special = defaultdict(float)
    sunday_games_after_8 = defaultdict(float)

    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";")
        header = next(reader)
        idx = parse_row_indices(header)

        for row in reader:
            if not is_good_sale(row, idx):
                continue

            ds = row[idx["Item Created Date"]].strip()
            try:
                dt = datetime.strptime(ds, "%Y-%m-%d").date()
            except ValueError:
                continue
            if dt < start or dt > end:
                continue

            name = row[idx["Name"]].strip()
            itype = row[idx["Item Type"]].strip()
            try:
                qty = float(row[idx["Quantity"]] or 0)
            except ValueError:
                qty = 0

            wd = dt.weekday()  # Mon=0 .. Sun=6

            if itype == "Package":
                if name == "Summer Monday League Meetup" and wd == 0:
                    meetup[dt] += qty
                elif name == "Summer Game Deal" and wd == 1:
                    game_deal_tue[dt] += qty
                elif name == "Summer Game Deal" and wd == 2:
                    game_deal_wed[dt] += qty
                elif name == "Summer Game Deal" and wd == 3:
                    game_deal_thu[dt] += qty
                elif name == "Summer Friday Pre-Game" and wd == 4:
                    friday_pregame[dt] += qty
                elif name == "Sunday special" and wd == 6:
                    sunday_special[dt] += qty

            if (
                itype == "Product"
                and name == "Game Bowling"
                and wd == 6
            ):
                tstr = row[idx["Item Created Time"]].strip()
                try:
                    t = datetime.strptime(tstr, "%H:%M:%S").time()
                except ValueError:
                    continue
                if t.hour >= 20:
                    sunday_games_after_8[dt] += qty

    return {
        "meetup": meetup,
        "game_deal_tue": game_deal_tue,
        "game_deal_wed": game_deal_wed,
        "game_deal_thu": game_deal_thu,
        "friday_pregame": friday_pregame,
        "sunday_special": sunday_special,
        "sunday_games_after_8": sunday_games_after_8,
    }, start, end


def _monday_of_week(d: date) -> date:
    return d - timedelta(days=d.weekday())


def load_unlimited_bowling_charge_weekly_2026(csv_path: str):
    """Sum of Quantity for Unlimited Bowling — Charge per week (week id = that week's Monday)."""
    by_week = defaultdict(float)
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";")
        header = next(reader)
        idx = parse_row_indices(header)
        for row in reader:
            if not is_good_sale(row, idx):
                continue
            if row[idx["Item Type"]].strip() != "Product":
                continue
            if row[idx["Name"]].strip() != UNLIMITED_BOWLING_CHARGE:
                continue
            ds = row[idx["Item Created Date"]].strip()
            try:
                dt = datetime.strptime(ds, "%Y-%m-%d").date()
            except ValueError:
                continue
            if dt.year != 2026:
                continue
            try:
                qty = float(row[idx["Quantity"]] or 0)
            except ValueError:
                qty = 0.0
            by_week[_monday_of_week(dt)] += qty

    if not by_week:
        return [], {}, None, None

    min_m = min(by_week.keys())
    max_m = max(by_week.keys())
    weeks = []
    d = min_m
    while d <= max_m:
        weeks.append(d)
        d += timedelta(days=7)
    counts = {w: float(by_week.get(w, 0)) for w in weeks}
    window_end = max_m + timedelta(days=6)
    return weeks, counts, min_m, window_end


def style_ax(ax, title, ylabel):
    ax.set_facecolor(BG_CARD)
    ax.set_title(title, color=TEXT_PRIMARY, fontsize=12, pad=10)
    ax.set_ylabel(ylabel, color=TEXT_SECONDARY, fontsize=10)
    ax.tick_params(colors=TEXT_SECONDARY, labelsize=9)
    ax.grid(True, color=GRID_COLOR, linestyle="--", alpha=0.6)
    for spine in ax.spines.values():
        spine.set_color(GRID_COLOR)


def style_ax_print(ax, title, ylabel, title_size=8.5, label_size=8, tick_size=7):
    ax.set_facecolor(PRINT_AX_BG)
    ax.set_title(title, color=PRINT_TEXT, fontsize=title_size, pad=4)
    ax.set_ylabel(ylabel, color=PRINT_TEXT_MUTED, fontsize=label_size)
    ax.tick_params(colors=PRINT_TEXT_MUTED, labelsize=tick_size)
    ax.grid(True, color=PRINT_GRID, linestyle="--", alpha=0.75)
    for spine in ax.spines.values():
        spine.set_color("#999999")


def plot_single(
    dates,
    counts,
    title,
    ylabel,
    out_path,
    line_color,
    window_start,
    window_end,
    *,
    hide_date_ticklabels: bool = False,
):
    fig, ax = plt.subplots(figsize=(11, 4), facecolor=BG_DARK)
    ys = [counts.get(d, 0) for d in dates]
    ax.plot(dates, ys, marker="o", markersize=4, linewidth=1.8, color=line_color, zorder=3)
    style_ax(ax, title, ylabel)
    add_month_start_markers(ax, window_start, window_end, theme="dark")
    fig.autofmt_xdate()
    if hide_date_ticklabels:
        hide_automatic_date_ticklabels(ax)
    fig.tight_layout()
    fig.subplots_adjust(bottom=0.14)
    fig.savefig(out_path, dpi=150, facecolor=BG_DARK, edgecolor="none")
    plt.close(fig)


def write_combined_print_page(
    data,
    mondays,
    tuesdays,
    wednesdays,
    thursdays,
    fridays,
    sundays,
    window_start,
    window_end,
    ub_weeks,
    ub_counts,
    ub_window_start,
    ub_window_end,
    out_pdf,
    out_png,
):
    """Single US-letter landscape page: all series + footer note."""
    fig = plt.figure(figsize=(11, 8.5), facecolor=PRINT_PAGE_BG)
    gs = GridSpec(
        4,
        2,
        figure=fig,
        height_ratios=[1.0, 1.0, 1.0, 0.95],
        hspace=0.33,
        wspace=0.22,
        left=0.06,
        right=0.98,
        top=0.92,
        bottom=0.065,
    )

    fig.suptitle(
        "Summer specials — June–August 2025 (+ 2026 Unlimited Bowling)",
        color=PRINT_TEXT,
        fontsize=12,
        fontweight="bold",
        y=0.97,
    )

    # (0,0) Meetup
    ax = fig.add_subplot(gs[0, 0])
    ys = [data["meetup"].get(d, 0) for d in mondays]
    ax.plot(mondays, ys, marker="o", markersize=2.5, linewidth=1.2, color=AMBER, zorder=3)
    style_ax_print(
        ax,
        "Summer Monday League Meetup\n(packages per Monday)",
        "Qty",
    )
    add_month_start_markers(ax, window_start, window_end, theme="print")

    # (0,1) Game deal
    ax = fig.add_subplot(gs[0, 1])
    ax.plot(
        tuesdays,
        [data["game_deal_tue"].get(d, 0) for d in tuesdays],
        marker="o",
        markersize=2.2,
        linewidth=1.1,
        label="Tue",
        color=RED,
        zorder=3,
    )
    ax.plot(
        wednesdays,
        [data["game_deal_wed"].get(d, 0) for d in wednesdays],
        marker="o",
        markersize=2.2,
        linewidth=1.1,
        label="Wed",
        color=TEAL,
        zorder=3,
    )
    ax.plot(
        thursdays,
        [data["game_deal_thu"].get(d, 0) for d in thursdays],
        marker="o",
        markersize=2.2,
        linewidth=1.1,
        label="Thu",
        color=GREEN,
        zorder=3,
    )
    style_ax_print(ax, "Summer Game Deal\n(packages per Tue / Wed / Thu)", "Qty")
    ax.legend(
        loc="upper right",
        fontsize=6.5,
        framealpha=0.95,
        edgecolor="#bbbbbb",
    )
    add_month_start_markers(ax, window_start, window_end, theme="print")

    # (1,0) Friday
    ax = fig.add_subplot(gs[1, 0])
    ax.plot(
        fridays,
        [data["friday_pregame"].get(d, 0) for d in fridays],
        marker="o",
        markersize=2.5,
        linewidth=1.2,
        color=CORAL,
        zorder=3,
    )
    style_ax_print(ax, "Summer Friday Pre-Game\n(packages per Friday)", "Qty")
    add_month_start_markers(ax, window_start, window_end, theme="print")

    # (1,1) Sunday special
    ax = fig.add_subplot(gs[1, 1])
    ax.plot(
        sundays,
        [data["sunday_special"].get(d, 0) for d in sundays],
        marker="o",
        markersize=2.5,
        linewidth=1.2,
        color=PURPLE,
        zorder=3,
    )
    style_ax_print(ax, "Sunday special\n(packages per Sunday)", "Qty")
    add_month_start_markers(ax, window_start, window_end, theme="print")

    # (2,0:2) Sunday games — full width
    ax_sun_games = fig.add_subplot(gs[2, :])
    ax_sun_games.plot(
        sundays,
        [data["sunday_games_after_8"].get(d, 0) for d in sundays],
        marker="o",
        markersize=2.5,
        linewidth=1.2,
        color=BLUE,
        zorder=3,
    )
    style_ax_print(
        ax_sun_games,
        "Game Bowling — total game qty per Sunday from 8:00 PM onward",
        "Game qty",
        title_size=8.5,
    )
    add_month_start_markers(ax_sun_games, window_start, window_end, theme="print")

    # (3,0:2) Unlimited Bowling — Charge, weekly (2026)
    ax_ub = fig.add_subplot(gs[3, :])
    if ub_weeks:
        ax_ub.plot(
            ub_weeks,
            [ub_counts[w] for w in ub_weeks],
            marker="o",
            markersize=2.5,
            linewidth=1.2,
            color=ORANGE,
            zorder=3,
        )
    style_ax_print(
        ax_ub,
        "Unlimited Bowling\nWeekly Guest Count 2026",
        "Qty",
        title_size=8.5,
    )
    if ub_window_start is not None and ub_window_end is not None:
        add_month_start_markers(ax_ub, ub_window_start, ub_window_end, theme="print")

    fig.text(
        0.5,
        0.018,
        "Tip: print landscape, 100% scale (US Letter 11\" × 8.5\"). File: summer_2025_summer_specials_print.pdf",
        ha="center",
        color=PRINT_TEXT_MUTED,
        fontsize=7,
    )

    fig.autofmt_xdate(bottom=0.055)
    hide_automatic_date_ticklabels(ax_sun_games)
    hide_automatic_date_ticklabels(ax_ub)

    fig.savefig(out_png, dpi=200, facecolor=PRINT_PAGE_BG, edgecolor="none")
    try:
        fig.savefig(out_pdf, dpi=300, facecolor=PRINT_PAGE_BG, edgecolor="none")
    except PermissionError:
        print(
            f"Warning: could not write {out_pdf} (close the file if it is open). "
            f"PNG was saved: {out_png}"
        )
    plt.close(fig)


def main():
    csv_path = DEFAULT_CSV
    os.makedirs(OUT_DIR, exist_ok=True)

    data, start, end = load_and_aggregate(csv_path)
    all_days = list(daterange(start, end))

    # Only x-axis days that are relevant per chart (sparse Mondays, etc.)
    mondays = [d for d in all_days if d.weekday() == 0]
    tuesdays = [d for d in all_days if d.weekday() == 1]
    wednesdays = [d for d in all_days if d.weekday() == 2]
    thursdays = [d for d in all_days if d.weekday() == 3]
    fridays = [d for d in all_days if d.weekday() == 4]
    sundays = [d for d in all_days if d.weekday() == 6]

    plot_single(
        mondays,
        data["meetup"],
        "Summer Monday League Meetup — packages per Monday\n(Jun–Aug 2025, POS name)",
        "Package quantity",
        os.path.join(OUT_DIR, "summer_2025_league_meetup_mondays.png"),
        AMBER,
        start,
        end,
    )

    fig, ax = plt.subplots(figsize=(11, 4), facecolor=BG_DARK)
    style_ax(ax, "Summer Game Deal — packages per day\n(Tue / Wed / Thu, Jun–Aug 2025)", "Package quantity")
    ax.plot(
        tuesdays,
        [data["game_deal_tue"].get(d, 0) for d in tuesdays],
        marker="o",
        markersize=3,
        label="Tuesday",
        color=RED,
        zorder=3,
    )
    ax.plot(
        wednesdays,
        [data["game_deal_wed"].get(d, 0) for d in wednesdays],
        marker="o",
        markersize=3,
        label="Wednesday",
        color=TEAL,
        zorder=3,
    )
    ax.plot(
        thursdays,
        [data["game_deal_thu"].get(d, 0) for d in thursdays],
        marker="o",
        markersize=3,
        label="Thursday",
        color=GREEN,
        zorder=3,
    )
    add_month_start_markers(ax, start, end, theme="dark")
    ax.legend(facecolor=BG_CARD, edgecolor=GRID_COLOR, labelcolor=TEXT_PRIMARY)
    fig.autofmt_xdate()
    fig.tight_layout()
    fig.subplots_adjust(bottom=0.14)
    fig.savefig(
        os.path.join(OUT_DIR, "summer_2025_game_deal_tue_wed_thu.png"),
        dpi=150,
        facecolor=BG_DARK,
        edgecolor="none",
    )
    plt.close(fig)

    plot_single(
        fridays,
        data["friday_pregame"],
        "Summer Friday Pre-Game — packages per Friday\n(Jun–Aug 2025)",
        "Package quantity",
        os.path.join(OUT_DIR, "summer_2025_friday_pregame.png"),
        CORAL,
        start,
        end,
    )

    plot_single(
        sundays,
        data["sunday_special"],
        "Sunday special — packages per Sunday\n(Jun–Aug 2025)",
        "Package quantity",
        os.path.join(OUT_DIR, "summer_2025_sunday_special.png"),
        PURPLE,
        start,
        end,
    )

    plot_single(
        sundays,
        data["sunday_games_after_8"],
        "Game Bowling — total game quantity per Sunday from 8:00 PM onward\n(Jun–Aug 2025)",
        "Game quantity (sum of line items)",
        os.path.join(OUT_DIR, "summer_2025_sunday_games_after_8pm.png"),
        BLUE,
        start,
        end,
        hide_date_ticklabels=True,
    )

    ub_weeks, ub_counts, ub_w0, ub_w1 = load_unlimited_bowling_charge_weekly_2026(CSV_2026)

    write_combined_print_page(
        data,
        mondays,
        tuesdays,
        wednesdays,
        thursdays,
        fridays,
        sundays,
        start,
        end,
        ub_weeks,
        ub_counts,
        ub_w0,
        ub_w1,
        os.path.join(OUT_DIR, "summer_2025_summer_specials_print.pdf"),
        os.path.join(OUT_DIR, "summer_2025_summer_specials_print.png"),
    )

    # Console summary
    def total(counts):
        return sum(counts.values())

    print("Summer specials Jun–Aug 2025 (Sales only, not Deleted/Voided)")
    print(f"  Summer Monday League Meetup (Mon): {total(data['meetup']):.0f} pkg qty")
    print(
        f"  Summer Game Deal: Tue {total(data['game_deal_tue']):.0f}, "
        f"Wed {total(data['game_deal_wed']):.0f}, Thu {total(data['game_deal_thu']):.0f}"
    )
    print(f"  Summer Friday Pre-Game: {total(data['friday_pregame']):.0f} pkg qty")
    print(f"  Sunday special: {total(data['sunday_special']):.0f} pkg qty")
    print(f"  Sunday Game Bowling (from 8pm): {total(data['sunday_games_after_8']):.0f} game qty")
    ub_tot = sum(ub_counts.values()) if ub_counts else 0
    print(
        f"  Unlimited Bowling — Charge (2026, weekly chart): {ub_tot:.0f} total qty "
        f"({len(ub_weeks)} week span)"
    )
    print(f"\nCharts written to {OUT_DIR}/")
    print("Print layout: summer_2025_summer_specials_print.pdf (and .png)")


if __name__ == "__main__":
    main()
