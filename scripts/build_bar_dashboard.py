#!/usr/bin/env python3
"""
build_bar_dashboard.py

Bar Sales Dashboard Generator
Generates a multi-page PDF report analyzing bar sales.
Data period: Oct 2025 - Jan 2026
Theme: Dark sports-bar aesthetic
"""

import csv
import os
import math
from datetime import datetime, timedelta
from collections import defaultdict, OrderedDict

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import FancyBboxPatch, Rectangle
import matplotlib.ticker as mticker

# =============================================================================
# CONFIGURATION
# =============================================================================

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(_ROOT, 'data', 'oct25-jan26.csv')
FILTER_FILE = os.path.join(_ROOT, 'config', 'bar_items.txt')
OUTPUT_FILE = os.path.join(_ROOT, 'output', 'bar_dashboard.pdf')
FIGSIZE = (11, 8.5)   # Landscape letter
DPI = 150

# -- Theme colors --
BG_DARK       = '#1a1a2e'
BG_CARD       = '#16213e'
BG_TABLE_ALT  = '#0f3460'
TEXT_PRIMARY   = '#f0e6d3'
TEXT_SECONDARY = '#a0998c'
TEXT_MUTED     = '#6b6577'
GRID_COLOR     = '#2a2a4a'
ACCENT_LINE    = '#3a3a5c'

# -- Accent palette --
AMBER  = '#f5a623'
GREEN  = '#00e676'
BLUE   = '#00b0ff'
CORAL  = '#ff5252'
PURPLE = '#bb86fc'
TEAL   = '#03dac6'
PINK   = '#ff6eb4'
GOLD   = '#ffd700'
LIME   = '#c6ff00'
SKY    = '#64b5f6'
ORANGE = '#ff9100'

# -- Category colors (Bar subdepartments) --
CATEGORY_COLORS = {
    'Draft Beer':    AMBER,
    'Liquor':        CORAL,
    'Bottle Beer':   GREEN,
    'Mocktails':     TEAL,
    'Drink tickets': PURPLE,
    'Beer Buckets':  BLUE,
}

# Category display order (by typical revenue weight)
CATEGORY_ORDER = [
    'Draft Beer', 'Liquor', 'Bottle Beer', 'Beer Buckets',
    'Mocktails', 'Drink tickets',
]

# =============================================================================
# NAME MERGES  (labeling variants -> canonical names)
# =============================================================================

NAME_MERGE = {}

# =============================================================================
# CATEGORY MAPPING  (Package items have empty Subdepartment; map buckets)
# =============================================================================

BAR_CATEGORY_MAP = {
    'Bud Light Bucket':           'Beer Buckets',
    'Coors Banquet Bucket':       'Beer Buckets',
    'Coors Light Bucket':         'Beer Buckets',
    'Miller Lite Bucket':         'Beer Buckets',
    'Blk Chry White Claw Bucket': 'Beer Buckets',
    'Watermelon White Claw Bucket': 'Beer Buckets',
}


# =============================================================================
# THEME
# =============================================================================

def apply_theme():
    """Apply dark sports-bar theme globally."""
    plt.rcParams.update({
        'figure.facecolor':  BG_DARK,
        'axes.facecolor':    BG_DARK,
        'axes.edgecolor':    GRID_COLOR,
        'axes.labelcolor':   TEXT_PRIMARY,
        'axes.grid':         True,
        'grid.color':        GRID_COLOR,
        'grid.alpha':        0.25,
        'grid.linewidth':    0.5,
        'text.color':        TEXT_PRIMARY,
        'xtick.color':       TEXT_SECONDARY,
        'ytick.color':       TEXT_SECONDARY,
        'xtick.labelsize':   8,
        'ytick.labelsize':   8,
        'legend.facecolor':  BG_CARD,
        'legend.edgecolor':  GRID_COLOR,
        'legend.fontsize':   8,
        'font.family':       'sans-serif',
        'font.size':         9,
        'axes.titlesize':    14,
        'axes.titleweight':  'bold',
        'axes.titlecolor':   TEXT_PRIMARY,
    })


# =============================================================================
# DATA LOADING
# =============================================================================

def _read_transactions():
    """Phase 1: Read CSV rows and group by Transaction ID."""
    transactions = defaultdict(list)
    with open(DATA_FILE, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)
        idx = {c: header.index(c) for c in [
            'Transaction ID', 'Item ID', 'Name', 'Item Type',
            'Department', 'Subdepartment', 'Quantity', 'Unit Amount',
            'Deleted', 'Voided', 'Item Created Date',
        ]}
        max_idx = max(idx.values())
        for row in reader:
            if len(row) <= max_idx:
                continue
            if row[idx['Deleted']] != 'False' or row[idx['Voided']] != 'False':
                continue
            item_type = row[idx['Item Type']]
            if item_type not in ('Product', 'Modifier', 'Package'):
                continue
            transactions[row[idx['Transaction ID']]].append({
                'item_id':      int(row[idx['Item ID']]),
                'name':         NAME_MERGE.get(row[idx['Name']].strip(),
                                               row[idx['Name']].strip()),
                'item_type':    item_type,
                'department':   row[idx['Department']].strip(),
                'subdepartment': row[idx['Subdepartment']].strip(),
                'qty':          float(row[idx['Quantity']] or 0),
                'unit_price':   float(row[idx['Unit Amount']] or 0),
                'date':         row[idx['Item Created Date']].strip(),
            })
    return transactions


def _resolve_products(transactions, allowed):
    """Phase 2: Walk each transaction, link modifiers to parent products,
    compute true costs, and yield resolved bar product dicts.
    Package items are standalone (no modifiers)."""
    for rows in transactions.values():
        rows.sort(key=lambda r: r['item_id'])
        current_product = None
        modifier_cost = 0.0

        for r in rows:
            if r['item_type'] == 'Package':
                # Emit the previous product if any
                if current_product is not None:
                    if current_product['unit_price'] == 0 and modifier_cost > 0:
                        current_product['unit_price'] = modifier_cost
                    yield current_product
                    current_product = None
                    modifier_cost = 0.0
                # Package is standalone - yield if in our filter
                if r['name'] in allowed:
                    yield r
                continue

            if r['item_type'] == 'Product':
                # Emit the previous product if it's one of ours
                if current_product is not None:
                    if current_product['unit_price'] == 0 and modifier_cost > 0:
                        current_product['unit_price'] = modifier_cost
                    yield current_product
                    current_product = None
                    modifier_cost = 0.0

                # Check if this product is one we care about
                if (r['name'] in allowed and r['department'] == 'Bar'):
                    current_product = r
                    modifier_cost = 0.0
                else:
                    current_product = None
                    modifier_cost = 0.0

            elif r['item_type'] == 'Modifier' and current_product is not None:
                modifier_cost += r['unit_price']

        # Don't forget the last product in the transaction
        if current_product is not None:
            if current_product['unit_price'] == 0 and modifier_cost > 0:
                current_product['unit_price'] = modifier_cost
            yield current_product


def load_data():
    """Read CSV, resolve modifier costs, aggregate everything."""

    # Load product filter
    with open(FILTER_FILE, 'r', encoding='utf-8') as f:
        allowed = set(line.strip() for line in f if line.strip())

    print('  Phase 1: Reading transactions...')
    transactions = _read_transactions()
    print(f'  Phase 2: Resolving {len(transactions):,} transactions...')

    items = {}
    weekly = defaultdict(lambda: {'revenue': 0.0, 'qty': 0.0, 'transactions': 0})
    categories = defaultdict(lambda: {'revenue': 0.0, 'qty': 0.0, 'transactions': 0})
    monthly_cat = defaultdict(lambda: defaultdict(lambda: {'revenue': 0.0, 'qty': 0.0}))
    all_dates = []

    for p in _resolve_products(transactions, allowed):
        name = p['name']
        qty = p['qty']
        unit_price = p['unit_price']
        revenue = unit_price * qty if qty else unit_price
        date_str = p['date']
        # Use Subdepartment from CSV; Package items have empty subdept -> use BAR_CATEGORY_MAP
        subdept = (p.get('subdepartment') or '').strip()
        category = subdept or BAR_CATEGORY_MAP.get(name, 'Other')

        # Item aggregation
        if name not in items:
            items[name] = dict(category=category, qty=0.0, revenue=0.0,
                               transactions=0, unit_price=0.0)
        items[name]['qty'] += qty
        items[name]['revenue'] += revenue
        items[name]['transactions'] += 1
        if unit_price > 0:
            items[name]['unit_price'] = unit_price

        # Date parsing
        try:
            dt = datetime.strptime(date_str, '%Y-%m-%d')
        except (ValueError, IndexError):
            continue
        all_dates.append(dt)

        # Weekly (Monday start)
        ws = dt - timedelta(days=dt.weekday())
        weekly[ws]['revenue'] += revenue
        weekly[ws]['qty'] += qty
        weekly[ws]['transactions'] += 1

        # Category
        categories[category]['revenue'] += revenue
        categories[category]['qty'] += qty
        categories[category]['transactions'] += 1

        # Monthly x Category
        month = date_str[:7]
        monthly_cat[month][category]['revenue'] += revenue
        monthly_cat[month][category]['qty'] += qty

    sorted_weeks = OrderedDict(sorted(weekly.items()))
    num_weeks = len(sorted_weeks) or 1

    total_revenue = sum(i['revenue'] for i in items.values())
    total_qty = sum(i['qty'] for i in items.values())
    total_trans = sum(i['transactions'] for i in items.values())

    min_d = min(all_dates).strftime('%b %d, %Y') if all_dates else 'N/A'
    max_d = max(all_dates).strftime('%b %d, %Y') if all_dates else 'N/A'

    return dict(
        items=items,
        weeks=sorted_weeks,
        categories=dict(categories),
        monthly_categories={m: dict(c) for m, c in sorted(monthly_cat.items())},
        num_weeks=num_weeks,
        total_revenue=total_revenue,
        total_qty=total_qty,
        total_transactions=total_trans,
        date_range=(min_d, max_d),
    )


# =============================================================================
# HELPERS
# =============================================================================

def fmt_currency(val, compact=False):
    if compact and abs(val) >= 1000:
        return f'${val/1000:,.1f}K'
    return f'${val:,.0f}'

def fmt_number(val):
    return f'{val:,.0f}'

def add_page_footer(fig, page_num):
    fig.text(0.95, 0.015, f'Page {page_num}',
             ha='right', va='bottom', fontsize=7, color=TEXT_MUTED)

def new_figure():
    fig = plt.figure(figsize=FIGSIZE)
    fig.patch.set_facecolor(BG_DARK)
    return fig

def save_page(pdf, fig):
    pdf.savefig(fig, dpi=DPI, facecolor=fig.get_facecolor(), edgecolor='none')
    plt.close(fig)


# =============================================================================
# PAGE 1 : EXECUTIVE SUMMARY
# =============================================================================

def page_executive_summary(pdf, data):
    fig = new_figure()
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 11)
    ax.set_ylim(0, 8.5)
    ax.axis('off')
    ax.set_facecolor(BG_DARK)

    # ---- Title banner ----
    ax.add_patch(FancyBboxPatch(
        (0.5, 7.1), 10, 1.05,
        boxstyle='round,pad=0.15', facecolor=BG_CARD,
        edgecolor=AMBER, linewidth=2))
    ax.text(5.5, 7.82, 'BAR SALES DASHBOARD',
            ha='center', va='center', fontsize=26, fontweight='bold',
            color=TEXT_PRIMARY)
    ax.text(5.5, 7.38,
            f'{data["date_range"][0]}  --  {data["date_range"][1]}',
            ha='center', va='center', fontsize=12, color=TEXT_SECONDARY)

    # ---- KPI cards ----
    top_seller = max(data['items'].items(), key=lambda x: x[1]['revenue'])
    avg_weekly = data['total_revenue'] / data['num_weeks']

    kpis = [
        ('TOTAL REVENUE',  fmt_currency(data['total_revenue']), AMBER),
        ('ITEMS SOLD',     fmt_number(data['total_qty']),        GREEN),
        ('AVG WEEKLY REV', fmt_currency(avg_weekly),             BLUE),
        ('TOP SELLER',     top_seller[0],                        CORAL),
    ]

    card_w, card_h = 2.2, 1.2
    card_y = 5.55
    gap = (10.0 - 4 * card_w) / 3
    start_x = 0.6

    for i, (label, value, color) in enumerate(kpis):
        cx = start_x + i * (card_w + gap)
        ax.add_patch(FancyBboxPatch(
            (cx, card_y), card_w, card_h,
            boxstyle='round,pad=0.1', facecolor=BG_CARD,
            edgecolor=color, linewidth=1.5))
        # Value
        val_y = card_y + card_h * 0.62
        fs = 14 if i == 3 else 18          # smaller for product name
        ax.text(cx + card_w / 2, val_y, value,
                ha='center', va='center', fontsize=fs,
                fontweight='bold', color=color)
        # Sub-value for top seller
        if i == 3:
            ax.text(cx + card_w / 2, card_y + card_h * 0.38,
                    fmt_currency(top_seller[1]['revenue']),
                    ha='center', va='center', fontsize=10, color=TEXT_SECONDARY)
        # Label
        ax.text(cx + card_w / 2, card_y + card_h * 0.15, label,
                ha='center', va='center', fontsize=8,
                fontweight='bold', color=TEXT_SECONDARY)

    # ---- Top 10 table ----
    ax.text(0.7, 5.15, 'TOP 10 ITEMS BY REVENUE',
            fontsize=13, fontweight='bold', color=AMBER)

    col_x = [0.8, 1.3, 6.2, 7.8, 9.5]
    col_ha = ['center', 'left', 'right', 'right', 'right']
    headers = ['#', 'PRODUCT', 'QTY', 'REVENUE', '% TOTAL']

    hy = 4.82
    for x, h, ha in zip(col_x, headers, col_ha):
        ax.text(x, hy, h, fontsize=9, fontweight='bold', color=AMBER,
                ha=ha, va='center')
    ax.plot([0.7, 10.3], [hy - 0.13, hy - 0.13],
            color=ACCENT_LINE, linewidth=0.8)

    top_10 = sorted(data['items'].items(),
                    key=lambda x: x[1]['revenue'], reverse=True)[:10]
    row_h = 0.40
    for i, (name, st) in enumerate(top_10):
        ry = hy - 0.38 - i * row_h
        if i % 2 == 0:
            ax.add_patch(Rectangle(
                (0.7, ry - 0.13), 9.6, row_h,
                facecolor=BG_TABLE_ALT, edgecolor='none', alpha=0.4))
        pct = st['revenue'] / data['total_revenue'] * 100 if data['total_revenue'] else 0
        cat_c = CATEGORY_COLORS.get(st['category'], TEXT_PRIMARY)
        vals = [str(i + 1), name, fmt_number(st['qty']),
                fmt_currency(st['revenue']), f'{pct:.1f}%']
        colors = [TEXT_MUTED, TEXT_PRIMARY, TEXT_PRIMARY, cat_c, TEXT_SECONDARY]
        for x, v, ha, c in zip(col_x, vals, col_ha, colors):
            ax.text(x, ry, v, fontsize=9, color=c, ha=ha, va='center')

    # ---- Footer note ----
    ax.text(5.5, 0.22,
            'Note: Package items (buckets) may show $0 revenue -- pricing on child products.',
            ha='center', va='center', fontsize=7, color=TEXT_MUTED, style='italic')

    add_page_footer(fig, 1)
    save_page(pdf, fig)


# =============================================================================
# PAGE 2 : VOLUME ANALYSIS
# =============================================================================

def page_volume_analysis(pdf, data):
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=FIGSIZE)
    fig.patch.set_facecolor(BG_DARK)
    fig.suptitle("VOLUME ANALYSIS: WHAT'S MOVING",
                 fontsize=18, fontweight='bold', color=TEXT_PRIMARY, y=0.96)

    by_qty = sorted(data['items'].items(),
                    key=lambda x: x[1]['qty'], reverse=True)

    # -- Top 20 --
    top = by_qty[:20]
    names = [t[0] for t in top][::-1]
    qtys  = [t[1]['qty'] for t in top][::-1]
    cols  = [CATEGORY_COLORS.get(t[1]['category'], AMBER) for t in top][::-1]

    ax1.barh(range(len(names)), qtys, color=cols, edgecolor='none', height=0.72)
    ax1.set_yticks(range(len(names)))
    ax1.set_yticklabels(names, fontsize=7)
    ax1.set_xlabel('Quantity Sold', fontsize=9, color=TEXT_SECONDARY)
    ax1.set_title('Top 20 by Quantity', fontsize=12, color=AMBER, pad=10)
    ax1.xaxis.set_major_formatter(
        mticker.FuncFormatter(lambda x, _: fmt_number(x)))
    for i, v in enumerate(qtys):
        ax1.text(v + max(qtys) * 0.012, i, fmt_number(v),
                 va='center', fontsize=6, color=TEXT_SECONDARY)

    # -- Bottom 15 --
    bot = by_qty[-15:]
    b_names = [t[0] for t in bot]
    b_qtys  = [t[1]['qty'] for t in bot]
    b_cols  = [CATEGORY_COLORS.get(t[1]['category'], CORAL) for t in bot]

    ax2.barh(range(len(b_names)), b_qtys, color=b_cols,
             edgecolor='none', height=0.72, alpha=0.75)
    ax2.set_yticks(range(len(b_names)))
    ax2.set_yticklabels(b_names, fontsize=7)
    ax2.set_xlabel('Quantity Sold', fontsize=9, color=TEXT_SECONDARY)
    ax2.set_title('Bottom 15: Worth Keeping?', fontsize=12, color=CORAL, pad=10)
    mx = max(b_qtys) if b_qtys else 1
    for i, v in enumerate(b_qtys):
        ax2.text(v + mx * 0.03, i, fmt_number(v),
                 va='center', fontsize=6, color=TEXT_SECONDARY)

    # Category color legend (shared)
    present = {data['items'][t[0]]['category'] for t in top + bot}
    patches = [plt.Line2D([0], [0], marker='s', color='none',
               markerfacecolor=CATEGORY_COLORS.get(c, AMBER),
               markersize=7, label=c) for c in CATEGORY_ORDER if c in present]
    fig.legend(handles=patches, loc='lower center', ncol=6, fontsize=7,
               facecolor=BG_CARD, edgecolor=GRID_COLOR,
               labelcolor=TEXT_PRIMARY, framealpha=0.9)

    fig.subplots_adjust(left=0.18, right=0.95, top=0.88,
                        bottom=0.10, wspace=0.55)
    add_page_footer(fig, 2)
    save_page(pdf, fig)


# =============================================================================
# PAGE 3 : REVENUE RANKINGS
# =============================================================================

def page_revenue_rankings(pdf, data):
    fig, ax = plt.subplots(figsize=FIGSIZE)
    fig.patch.set_facecolor(BG_DARK)

    by_rev = sorted(data['items'].items(),
                    key=lambda x: x[1]['revenue'], reverse=True)
    top = by_rev[:20]

    names = [t[0] for t in top][::-1]
    revs  = [t[1]['revenue'] for t in top][::-1]
    cols  = [CATEGORY_COLORS.get(t[1]['category'], AMBER) for t in top][::-1]

    ax.barh(range(len(names)), revs, color=cols, edgecolor='none', height=0.72)
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names, fontsize=8)
    ax.set_xlabel('Revenue', fontsize=10, color=TEXT_SECONDARY)
    ax.set_title('REVENUE RANKINGS: WHERE THE MONEY IS',
                 fontsize=16, fontweight='bold', color=TEXT_PRIMARY, pad=15)
    ax.xaxis.set_major_formatter(
        mticker.FuncFormatter(lambda x, _: fmt_currency(x, compact=True)))
    for i, v in enumerate(revs):
        ax.text(v + max(revs) * 0.01, i, fmt_currency(v),
                va='center', fontsize=7, color=TEXT_SECONDARY)

    # Top-10 concentration callout
    top10_rev = sum(t[1]['revenue'] for t in by_rev[:10])
    pct = top10_rev / data['total_revenue'] * 100 if data['total_revenue'] else 0
    note = (f'Top 10 items = {pct:.0f}% of total bar revenue  '
            f'({fmt_currency(top10_rev)} of {fmt_currency(data["total_revenue"])})')
    ax.text(0.50, 0.02, note, transform=ax.transAxes, ha='center',
            fontsize=10, fontweight='bold', color=AMBER,
            bbox=dict(boxstyle='round,pad=0.4', facecolor=BG_CARD,
                      edgecolor=AMBER, alpha=0.9))

    fig.subplots_adjust(left=0.22, right=0.92, top=0.90, bottom=0.10)
    add_page_footer(fig, 3)
    save_page(pdf, fig)


# =============================================================================
# PAGE 4 : WEEKLY TRENDS
# =============================================================================

def page_weekly_trends(pdf, data):
    fig, ax1 = plt.subplots(figsize=FIGSIZE)
    fig.patch.set_facecolor(BG_DARK)

    weeks = list(data['weeks'].keys())
    revs  = [data['weeks'][w]['revenue'] for w in weeks]
    trans = [data['weeks'][w]['transactions'] for w in weeks]
    labels = [w.strftime('%b %d') for w in weeks]
    xs = range(len(weeks))

    # Revenue fill + line
    ax1.fill_between(xs, revs, alpha=0.15, color=AMBER)
    ax1.plot(xs, revs, color=AMBER, linewidth=2.5,
             marker='o', markersize=4, label='Revenue')
    ax1.set_ylabel('Revenue ($)', fontsize=10, color=AMBER)
    ax1.yaxis.set_major_formatter(
        mticker.FuncFormatter(lambda x, _: fmt_currency(x, compact=True)))
    ax1.tick_params(axis='y', colors=AMBER)

    # Transactions on right axis
    ax2 = ax1.twinx()
    ax2.plot(xs, trans, color=BLUE, linewidth=2, linestyle='--',
             marker='s', markersize=3, label='Transactions', alpha=0.8)
    ax2.set_ylabel('Transactions', fontsize=10, color=BLUE)
    ax2.tick_params(axis='y', colors=BLUE)
    ax2.spines['right'].set_color(BLUE)
    ax2.spines['left'].set_color(AMBER)

    # Peak annotation
    peak_i = revs.index(max(revs))
    ax1.annotate(f'Peak: {fmt_currency(revs[peak_i])}',
                 xy=(peak_i, revs[peak_i]),
                 xytext=(peak_i, revs[peak_i] + max(revs) * 0.07),
                 fontsize=8, color=AMBER, fontweight='bold', ha='center',
                 arrowprops=dict(arrowstyle='->', color=AMBER, lw=1.5))

    # X axis
    ax1.set_xticks(list(xs))
    ax1.set_xticklabels(labels, rotation=45, ha='right', fontsize=7)
    ax1.set_title('WEEKLY TRENDS',
                  fontsize=16, fontweight='bold', color=TEXT_PRIMARY, pad=15)

    # Legend
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc='upper left',
               facecolor=BG_CARD, edgecolor=GRID_COLOR,
               labelcolor=TEXT_PRIMARY)

    fig.subplots_adjust(left=0.10, right=0.90, top=0.90, bottom=0.15)
    add_page_footer(fig, 4)
    save_page(pdf, fig)


# =============================================================================
# PAGE 5 : CATEGORY BREAKDOWN
# =============================================================================

def page_category_breakdown(pdf, data):
    fig = new_figure()
    fig.suptitle('CATEGORY BREAKDOWN',
                 fontsize=16, fontweight='bold', color=TEXT_PRIMARY, y=0.96)

    # Sort categories by revenue
    sorted_cats = sorted(data['categories'].items(),
                         key=lambda x: x[1]['revenue'], reverse=True)
    cat_names = [c[0] for c in sorted_cats]
    cat_revs  = [c[1]['revenue'] for c in sorted_cats]
    cat_cols  = [CATEGORY_COLORS.get(c, TEXT_SECONDARY) for c in cat_names]

    # ---- Donut chart (left) ----
    ax1 = fig.add_subplot(121)
    ax1.set_facecolor(BG_DARK)

    # Exclude zero-revenue for donut
    nz = [(n, r, c) for n, r, c in zip(cat_names, cat_revs, cat_cols) if r > 0]
    d_names = [x[0] for x in nz]
    d_revs  = [x[1] for x in nz]
    d_cols  = [x[2] for x in nz]

    wedges, _, autotexts = ax1.pie(
        d_revs, labels=None, colors=d_cols,
        autopct='%1.0f%%', pctdistance=0.78, startangle=90,
        wedgeprops=dict(width=0.45, edgecolor=BG_DARK, linewidth=2))
    for t in autotexts:
        t.set_fontsize(7)
        t.set_color(TEXT_PRIMARY)
        t.set_fontweight('bold')

    # Center label
    ax1.text(0, 0, fmt_currency(sum(d_revs), compact=True),
             ha='center', va='center', fontsize=15,
             fontweight='bold', color=TEXT_PRIMARY)

    ax1.legend(wedges, d_names, loc='lower center',
               bbox_to_anchor=(0.5, -0.18), ncol=2, fontsize=7,
               facecolor=BG_CARD, edgecolor=GRID_COLOR,
               labelcolor=TEXT_PRIMARY)
    ax1.set_title('Revenue by Category', fontsize=12, color=AMBER, pad=10)

    # ---- Monthly stacked bar (right) ----
    ax2 = fig.add_subplot(122)
    ax2.set_facecolor(BG_DARK)

    months = sorted(data['monthly_categories'].keys())
    month_labels = []
    for m in months:
        try:
            month_labels.append(datetime.strptime(m + '-01', '%Y-%m-%d')
                                .strftime('%b %Y'))
        except ValueError:
            month_labels.append(m)

    x = list(range(len(months)))
    bottoms = [0.0] * len(months)

    for cat in cat_names:                       # biggest on bottom
        vals = [data['monthly_categories'].get(m, {})
                    .get(cat, {'revenue': 0})['revenue']
                for m in months]
        col = CATEGORY_COLORS.get(cat, TEXT_SECONDARY)
        ax2.bar(x, vals, bottom=bottoms, color=col,
                edgecolor=BG_DARK, linewidth=0.5, width=0.6, label=cat)
        bottoms = [b + v for b, v in zip(bottoms, vals)]

    ax2.set_xticks(x)
    ax2.set_xticklabels(month_labels, fontsize=8, rotation=30, ha='right')
    ax2.yaxis.set_major_formatter(
        mticker.FuncFormatter(lambda x, _: fmt_currency(x, compact=True)))
    ax2.set_ylabel('Revenue', fontsize=9, color=TEXT_SECONDARY)
    ax2.set_title('Monthly Revenue by Category',
                  fontsize=12, color=AMBER, pad=10)
    ax2.legend(loc='upper left', fontsize=6, ncol=2,
               facecolor=BG_CARD, edgecolor=GRID_COLOR,
               labelcolor=TEXT_PRIMARY)

    fig.subplots_adjust(left=0.05, right=0.95, top=0.88,
                        bottom=0.14, wspace=0.30)
    add_page_footer(fig, 5)
    save_page(pdf, fig)


# =============================================================================
# PAGE 6+ : ITEM-LEVEL DETAIL TABLE
# =============================================================================

def page_detail_table(pdf, data):
    sorted_items = sorted(data['items'].items(),
                          key=lambda x: x[1]['revenue'], reverse=True)
    nw = max(data['num_weeks'], 1)
    rows_pp = 42                              # rows per page
    total = len(sorted_items)
    pages = math.ceil(total / rows_pp)

    headers  = ['#', 'PRODUCT', 'CATEGORY', 'QTY', 'REVENUE',
                'AVG $', 'WKLY AVG']
    col_x    = [0.4,  0.8,  5.1,  7.0,  8.0,  9.2,  10.3]
    col_ha   = ['center','left','left','right','right','right','right']
    row_h    = 0.165

    for pg in range(pages):
        fig = new_figure()
        ax = fig.add_axes([0, 0, 1, 1])
        ax.set_xlim(0, 11)
        ax.set_ylim(0, 8.5)
        ax.axis('off')
        ax.set_facecolor(BG_DARK)

        start = pg * rows_pp
        end = min(start + rows_pp, total)
        chunk = sorted_items[start:end]

        # Title
        title = 'ITEM-LEVEL DETAIL' if pg == 0 else 'ITEM-LEVEL DETAIL (cont.)'
        ax.text(5.5, 8.15, title, fontsize=16, fontweight='bold',
                ha='center', va='center', color=TEXT_PRIMARY)

        # Column headers
        hy = 7.80
        for cx, h, ha in zip(col_x, headers, col_ha):
            ax.text(cx, hy, h, fontsize=8, fontweight='bold',
                    color=AMBER, ha=ha, va='center')
        ax.plot([0.3, 10.7], [hy - 0.10, hy - 0.10],
                color=ACCENT_LINE, linewidth=1)

        # Rows
        for i, (name, st) in enumerate(chunk):
            ry = hy - 0.30 - i * row_h
            row_num = start + i + 1

            if i % 2 == 0:
                ax.add_patch(Rectangle(
                    (0.3, ry - row_h / 2 + 0.02), 10.4, row_h,
                    facecolor=BG_TABLE_ALT, edgecolor='none', alpha=0.25))

            avg_p = st['revenue'] / st['qty'] if st['qty'] else 0
            wk_avg = st['qty'] / nw
            cat_c = CATEGORY_COLORS.get(st['category'], TEXT_PRIMARY)

            vals = [str(row_num),
                    name[:32],
                    st['category'],
                    fmt_number(st['qty']),
                    fmt_currency(st['revenue']),
                    f'${avg_p:.2f}',
                    f'{wk_avg:.1f}']
            clrs = [TEXT_MUTED, TEXT_PRIMARY, cat_c, TEXT_PRIMARY,
                    TEXT_PRIMARY, TEXT_SECONDARY, TEXT_SECONDARY]

            for cx, v, ha, cl in zip(col_x, vals, col_ha, clrs):
                ax.text(cx, ry, v, fontsize=7, color=cl, ha=ha, va='center')

        add_page_footer(fig, 6 + pg)
        save_page(pdf, fig)


# =============================================================================
# MAIN
# =============================================================================

def main():
    print('Applying theme...')
    apply_theme()

    print(f'Loading data from {DATA_FILE}...')
    data = load_data()
    print(f'  {len(data["items"])} items  |  '
          f'{data["total_transactions"]:,} transactions  |  '
          f'{fmt_currency(data["total_revenue"])} revenue')
    print(f'  {data["num_weeks"]} weeks: '
          f'{data["date_range"][0]} to {data["date_range"][1]}')

    out = OUTPUT_FILE

    print('Building dashboard...')
    with PdfPages(out) as pdf:
        print('  Page 1 : Executive Summary')
        page_executive_summary(pdf, data)

        print('  Page 2 : Volume Analysis')
        page_volume_analysis(pdf, data)

        print('  Page 3 : Revenue Rankings')
        page_revenue_rankings(pdf, data)

        print('  Page 4 : Weekly Trends')
        page_weekly_trends(pdf, data)

        print('  Page 5 : Category Breakdown')
        page_category_breakdown(pdf, data)

        print('  Page 6+: Detail Table')
        page_detail_table(pdf, data)

    print(f'\nDashboard saved to: {out}')
    print('Done!')


if __name__ == '__main__':
    main()
