#!/usr/bin/env python3
"""
One-page December booking status for leadership.

Reads public/data/booking_pace.json (the same file as the reservations page).
If that file is not on this checkout, falls back to origin/main. Each prior
year is cut off the same number of days before December 1 as the
data-through date.

2024 party deposits use the 17hats paid dates already applied in
booking_pace.json (config/deposit_history_2024.json).

Usage:
  python scripts/export_dec_bookings_status_pdf.py
  python scripts/export_dec_bookings_status_pdf.py --month 2026-12
"""

from __future__ import annotations

import argparse
import json
import subprocess
import textwrap
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.gridspec import GridSpec
import matplotlib.ticker as mticker

ROOT = Path(__file__).resolve().parent.parent
LOCAL_PATH = ROOT / "public" / "data" / "booking_pace.json"
OUT_DIR = ROOT / "output"

GROUPS = [
    ("suites", "VIP suites"),
    ("kids", "Kids parties"),
    ("lanes", "Lane reservations"),
    ("pair", "Pair & Spare"),
]

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def parse_day(iso: str) -> date:
    return date.fromisoformat(iso[:10])


def format_day(value: date) -> str:
    return value.isoformat()


def add_days(iso: str, days: int) -> str:
    return format_day(parse_day(iso) + timedelta(days=days))


def days_between(start: str, end: str) -> int:
    return (parse_day(end) - parse_day(start)).days


def month_day(iso: str) -> str:
    value = parse_day(iso)
    return f"{MONTHS[value.month - 1]} {value.day}"


def money0(amount: float) -> str:
    return f"${round(amount):,}"


def signed_count(delta: int) -> str:
    return f"{delta:+d}"


def signed_money0(delta: float) -> str:
    sign = "+" if delta >= 0 else "−"
    return f"{sign}${round(abs(delta)):,}"


def signed_pct(base: float, current: float) -> str:
    if base == 0:
        return "0%" if current == 0 else "new"
    pct = ((current - base) / base) * 100
    return f"{pct:+.0f}%"


def default_month(today: date) -> str:
    return f"{today.year}-12"


def load_pace() -> dict:
    if LOCAL_PATH.exists():
        return json.loads(LOCAL_PATH.read_text(encoding="utf-8"))
    raw = subprocess.check_output(
        ["git", "show", "origin/main:public/data/booking_pace.json"],
        cwd=ROOT,
    )
    return json.loads(raw)


def compare_as_of(data_through: str, focus_month: str, compare_year: int) -> str:
    focus_start = f"{focus_month}-01"
    compare_start = f"{compare_year}-{focus_month[5:7]}-01"
    lag = days_between(data_through, focus_start)
    return add_days(compare_start, -lag)


def for_month(payments: list[dict], month_key: str, as_of: str) -> list[dict]:
    return [
        row for row in payments
        if row.get("status") != "cancelled"
        and row.get("event")
        and row["event"][:7] == month_key
        and row["paid"] <= as_of
    ]


def totals(rows: list[dict]) -> tuple[int, float]:
    events = sum(1 for row in rows if row["isFirstPayment"])
    dollars = sum(row["amount"] for row in rows)
    return events, dollars


def pace_points(focus: list[dict], priors: dict[int, list[dict]], focus_month: str, as_of: str, cutoffs: dict[int, str]):
    focus_start = parse_day(f"{focus_month}-01")
    points = []
    for week in range(12, -1, -1):
        focus_cut = focus_start - timedelta(days=7 * week)
        if focus_cut > parse_day(as_of):
            continue
        point = {"label": month_day(format_day(focus_cut)), "focus": totals(for_paid(focus, format_day(focus_cut)))[1]}
        for year, rows in priors.items():
            compare_cut = date(year, focus_start.month, 1) - timedelta(days=7 * week)
            point[year] = totals(for_paid(rows, format_day(compare_cut)))[1]
        points.append(point)
    if not points or points[-1]["label"] != month_day(as_of):
        point = {"label": month_day(as_of), "focus": totals(for_paid(focus, as_of))[1]}
        for year, rows in priors.items():
            point[year] = totals(for_paid(rows, cutoffs[year]))[1]
        points.append(point)
    return points


def for_paid(rows: list[dict], cutoff: str) -> list[dict]:
    return [row for row in rows if row["paid"] <= cutoff]


def group_rows(rows: list[dict]) -> list[tuple[str, int, float]]:
    found = []
    for group_id, label in GROUPS:
        mine = [row for row in rows if row.get("group") == group_id]
        count, dollars = totals(mine)
        if count or dollars:
            found.append((label, count, dollars))
    other = [row for row in rows if row.get("group") not in {gid for gid, _ in GROUPS}]
    count, dollars = totals(other)
    if count or dollars:
        found.append(("Other", count, dollars))
    return found


def style_table(table, header_color: str, emphasize_last: bool = False, fontsize: float = 8) -> None:
    table.auto_set_font_size(False)
    table.set_fontsize(fontsize)
    rows = max(key[0] for key in table.get_celld())
    for (row_i, col_i), cell in table.get_celld().items():
        cell.set_edgecolor("#E2E8F0")
        cell.set_linewidth(0.4)
        text = cell.get_text()
        text.set_color("#0F172A")
        if col_i == 0:
            text.set_ha("left")
        else:
            text.set_ha("right")
        if row_i == 0:
            cell.set_facecolor(header_color)
            text.set_fontweight("bold")
            text.set_color("#334155")
        elif emphasize_last and row_i == rows:
            cell.set_facecolor("#F1F5F9")
            text.set_fontweight("bold")
        else:
            cell.set_facecolor("#FFFFFF" if row_i % 2 else "#F8FAFC")


def draw_calendar(ax, rows: list[dict], year: int) -> None:
    ax.set_xlim(0, 7)
    ax.set_ylim(6.15, -0.35)
    ax.axis("off")
    ax.set_title(
        f"December {year}, by event day",
        fontsize=11,
        fontweight="bold",
        color="#0F172A",
        loc="left",
        pad=6,
    )
    by_day: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        if row["isFirstPayment"]:
            by_day[parse_day(row["event"]).day].append(row)
    lead = (date(year, 12, 1).weekday() + 1) % 7
    for col, label in enumerate(WEEKDAYS):
        ax.text(col + 0.06, -0.05, label, fontsize=7, color="#64748B", fontweight="bold", va="top")
    for index in range(42):
        day_num = index - lead + 1
        if not 1 <= day_num <= 31:
            continue
        col = index % 7
        week = index // 7
        y = 0.55 + week
        booked = by_day.get(day_num, [])
        face = "#F1F5F9" if booked else "#FFFFFF"
        edge = "#E2E8F0" if booked else "#F1F5F9"
        ax.add_patch(plt.Rectangle((col + 0.04, y), 0.92, 0.82, facecolor=face, edgecolor=edge, linewidth=0.5, zorder=1))
        ax.text(col + 0.1, y + 0.41, str(day_num), fontsize=7, color="#64748B", va="center", zorder=2)
        if booked:
            dollars = sum(item["amount"] for item in booked)
            ax.text(col + 0.9, y + 0.41, f"{len(booked)}  {money0(dollars)}", fontsize=6.5, color="#0F172A", fontweight="bold", va="center", ha="right", zorder=2)


def build(month: str) -> Path:
    payload = load_pace()
    payments = payload["payments"]
    as_of = payload.get("dataThrough")
    if not as_of:
        raise SystemExit("booking pace file has no dataThrough date")
    focus_year = int(month[:4])
    years = [focus_year - 1, focus_year - 2]
    cutoffs = {year: compare_as_of(as_of, month, year) for year in years}

    focus = for_month(payments, month, as_of)
    month_rows = {year: for_month(payments, f"{year}-{month[5:7]}", f"{year}-12-31") for year in years}
    priors = {year: for_paid(month_rows[year], cutoffs[year]) for year in years}
    dec1 = {year: for_paid(month_rows[year], f"{year}-12-01") for year in years}
    now_count, now_dollars = totals(focus)
    then = {year: totals(priors[year]) for year in years}
    by_dec1 = {year: totals(dec1[year]) for year in years}
    points = pace_points(focus, month_rows, month, as_of, cutoffs)
    groups = group_rows(focus)
    prior_groups = {
        year: {label: (count, dollars) for label, count, dollars in group_rows(priors[year])}
        for year in years
    }
    labels_all = [label for label, _, _ in groups]
    for year in years:
        labels_all += [label for label in prior_groups[year] if label not in labels_all]
    focus_groups = {label: (count, dollars) for label, count, dollars in groups}

    print(f"{focus_year} bookings={now_count} deposits={now_dollars:.2f}")
    for year in years:
        print(f"{year} bookings={then[year][0]} deposits={then[year][1]:.2f} cutoff={cutoffs[year]} "
              f"by Dec 1={by_dec1[year][0]} / {by_dec1[year][1]:.2f}")
    last, prev = years
    rebuilt_2024 = any(row.get("paidSource") == "17hats" for row in month_rows.get(2024, []))
    early = [
        row for row in month_rows.get(2024, [])
        if row.get("paidSource") == "17hats" and row.get("paid") == "2024-09-02"
    ]

    def still_to_match(target: tuple[int, float]) -> str:
        parties = max(0, target[0] - now_count)
        dollars = max(0.0, target[1] - now_dollars)
        return f"{parties} more parties and {money0(dollars)}"

    plt.rcParams["font.sans-serif"] = "Segoe UI"
    plt.rcParams["axes.edgecolor"] = "#CBD5E1"
    plt.rcParams["axes.linewidth"] = 0.6
    plt.rcParams["text.parse_math"] = False
    fig = plt.figure(figsize=(8.5, 11), facecolor="#FFFFFF")
    gs = GridSpec(
        8, 1, figure=fig,
        height_ratios=[0.62, 0.62, 1.35, 0.28, 1.0, 1.15, 0.45, 2.3],
        hspace=0.32,
        left=0.06, right=0.94, top=0.965, bottom=0.03,
    )

    headline = (
        f"{now_count} events booked with {money0(now_dollars)} in deposits. At this point in {last}: "
        f"{then[last][0]} events and {money0(then[last][1])} ({signed_pct(then[last][1], now_dollars)} in dollars). "
        f"In {prev}: {then[prev][0]} events and {money0(then[prev][1])} ({signed_pct(then[prev][1], now_dollars)}). "
        f"Through {month_day(as_of)}, {focus_year}."
    )
    ax = fig.add_subplot(gs[0])
    ax.axis("off")
    ax.text(0, 0.78, "December bookings: where we stand", fontsize=16, fontweight="bold", color="#0F172A", va="center")
    ax.text(0, 0.28, textwrap.fill(headline, width=108), fontsize=8.5, color="#475569", va="center", linespacing=1.35)

    ax = fig.add_subplot(gs[1])
    ax.axis("off")
    cards = [
        ("BOOKINGS", str(now_count), f"{last}: {then[last][0]} ({signed_count(now_count - then[last][0])})   ·   "
                                      f"{prev}: {then[prev][0]} ({signed_count(now_count - then[prev][0])})"),
        ("DEPOSITS", money0(now_dollars), f"{last}: {money0(then[last][1])} ({signed_money0(now_dollars - then[last][1])})   ·   "
                                          f"{prev}: {money0(then[prev][1])} ({signed_money0(now_dollars - then[prev][1])})"),
    ]
    for index, (label, value, sub) in enumerate(cards):
        x0 = index * 0.5
        rect = plt.Rectangle((x0, 0.08), 0.47, 0.84, facecolor="#F8FAFC", edgecolor="#E2E8F0", linewidth=0.8, transform=ax.transAxes)
        ax.add_patch(rect)
        ax.text(x0 + 0.02, 0.72, label, fontsize=8, fontweight="bold", color="#64748B", transform=ax.transAxes)
        ax.text(x0 + 0.02, 0.40, value, fontsize=16, fontweight="bold", color="#0F172A", transform=ax.transAxes)
        ax.text(x0 + 0.02, 0.18, sub, fontsize=8, color="#475569", transform=ax.transAxes)

    ax = fig.add_subplot(gs[2])
    ax.set_facecolor("#FFFFFF")
    labels = [point["label"] for point in points]
    ax.plot(labels, [round(point[prev]) for point in points], marker="o", markersize=3.5, linewidth=1.4, linestyle="--", color="#CBD5E1", label=str(prev))
    ax.plot(labels, [round(point[last]) for point in points], marker="o", linewidth=1.8, color="#94A3B8", label=str(last))
    ax.plot(labels, [round(point["focus"]) for point in points], marker="o", linewidth=2.2, color="#059669", label=str(focus_year))
    ax.set_title("Deposits on the books, weeks before December 1", fontsize=11, fontweight="bold", color="#0F172A", loc="left", pad=8)
    ax.set_ylabel("Deposit dollars")
    ax.yaxis.set_major_formatter(mticker.StrMethodFormatter("${x:,.0f}"))
    ax.grid(axis="y", linestyle="--", alpha=0.45, color="#CBD5E1")
    ax.tick_params(labelsize=8, colors="#475569")
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    ax.set_ylim(0, max(max(point["focus"], point[last], point[prev]) for point in points) * 1.18)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)

    ax = fig.add_subplot(gs[3])
    ax.axis("off")
    ax.text(
        0, 0.5,
        f"Tuesdays before December 1, then {month_day(as_of)}. Prior years are the same number of days out. Deposit dollars, rounded. "
        + ("Source: POS booking pace; 2024 parties from 17hats paid dates." if rebuilt_2024 else "Source: POS booking pace."),
        fontsize=7, color="#64748B", va="center",
    )

    ax = fig.add_subplot(gs[4])
    ax.axis("off")
    ax.set_title("By party type, same point each year", fontsize=11, fontweight="bold", color="#0F172A", loc="left", pad=6)
    body = []
    for label in labels_all:
        count, dollars = focus_groups.get(label, (0, 0))
        last_count, last_dollars = prior_groups[last].get(label, (0, 0))
        prev_count, prev_dollars = prior_groups[prev].get(label, (0, 0))
        body.append([label, str(count), str(last_count), str(prev_count), money0(dollars), money0(last_dollars), money0(prev_dollars)])
    body.append([
        "Total", str(now_count), str(then[last][0]), str(then[prev][0]),
        money0(now_dollars), money0(then[last][1]), money0(then[prev][1]),
    ])
    table = ax.table(
        cellText=body,
        colLabels=["Party type", str(focus_year), str(last), str(prev), f"{focus_year} $", f"{last} $", f"{prev} $"],
        loc="upper center",
        cellLoc="right",
        colWidths=[0.22, 0.1, 0.1, 0.1, 0.16, 0.16, 0.16],
    )
    table.scale(1, 1.25)
    style_table(table, "#F1F5F9", emphasize_last=True)

    ax = fig.add_subplot(gs[5])
    draw_calendar(ax, focus, focus_year)

    full_month = {year: totals(month_rows[year]) for year in years}
    context = (
        f"To match {last} by Dec 1: {still_to_match(by_dec1[last])}; "
        f"for the full month, {still_to_match(full_month[last])}. "
        f"To match {prev}: {still_to_match(by_dec1[prev])} by Dec 1, "
        f"and {still_to_match(full_month[prev])} for the month. "
        f"This year is not projected."
    )
    if rebuilt_2024:
        context += " 2024 party deposits use 17hats paid dates matched to POS accounts"
        if early:
            context += (
                f"; {len(early)} deposits ({money0(sum(row['amount'] for row in early))}) "
                "paid before Sep 3, 2024 are counted as already on the books."
            )
        else:
            context += "."
    ax = fig.add_subplot(gs[6])
    ax.axis("off")
    ax.text(0, 0.55, textwrap.fill(context, width=112), fontsize=8, color="#334155", va="center", linespacing=1.35)

    ax = fig.add_subplot(gs[7])
    ax.axis("off")
    ax.set_title(f"Booked for December {focus_year}", fontsize=11, fontweight="bold", color="#0F172A", loc="left", pad=4)
    booked = sorted((row for row in focus if row["isFirstPayment"]), key=lambda row: (row["event"], row["party"] or ""))
    party_rows = [
        [month_day(row["event"]), (row.get("party") or "")[:34], row.get("type") or "", money0(row["amount"])]
        for row in booked
    ]
    party_table = ax.table(
        cellText=party_rows,
        colLabels=["Event", "Party", "Type", "Deposit"],
        loc="upper center",
        cellLoc="left",
        colWidths=[0.14, 0.40, 0.30, 0.16],
    )
    party_table.scale(1, 0.78)
    style_table(party_table, "#F1F5F9", fontsize=7)
    for (row_i, col_i), cell in party_table.get_celld().items():
        if col_i in (1, 2):
            cell.get_text().set_ha("left")

    OUT_DIR.mkdir(exist_ok=True)
    path = OUT_DIR / f"december_bookings_status_{as_of}.pdf"
    fig.savefig(path, format="pdf")
    plt.close(fig)
    print(f"Wrote {path}")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export the December booking status as a one-page PDF.")
    parser.add_argument("--month", default=default_month(date.today()), help="Event month, YYYY-MM. Default: this year's December.")
    args = parser.parse_args()
    if len(args.month) != 7 or args.month[4] != "-":
        raise SystemExit("--month must look like 2026-12")
    build(args.month)


if __name__ == "__main__":
    main()
