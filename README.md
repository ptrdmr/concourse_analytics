# Concourse Analytics

POS sales analytics for **Concourse Bowl-Bar-Grill** — food, bar, bowling, parties, league fees, and more. A Next.js dashboard backed by Python ETL over semicolon-delimited POS CSV exports.

Data span: **2023 → present** (driven by whatever CSVs you place in `data/`).

## Quick start

```bash
# 1. Place POS CSV exports in data/ (see Data below)

# 2. Regenerate dashboard JSON
npm run etl
# or: python scripts/export_dashboards.py

# 3. Run the dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Dashboard pages

| Route | Description |
|-------|-------------|
| `/` | Overview — department KPIs and summary cards |
| `/explorer` | Data Explorer — filters, trends, top items, calendar |
| `/dayparts` | Dayparts — item sales by time of day (30-min buckets), day-of-week comparison, item/category filters |
| `/payments` | Payment tender breakdown and daily trends |
| `/compare` | Side-by-side period comparisons |
| `/specials` | Summer packages and specialty cocktails |
| `/holidays` | Holiday year-over-year analysis |
| `/bowling` | Bowling seasonality and forecast |
| `/tickets` | Ticket lookup by month and transaction ID |

The app reads static JSON from `public/data/`. No database required.

## Data

CSV files are **not committed** (large POS exports). Place exports in `data/`:

```
data/
├── 2023.csv
├── 2024.csv
├── 2025.csv
├── 2026.csv
└── ...          # any additional exports (deduped by Transaction ID + Item ID)
```

Run the ETL to refresh `public/data/`:

```bash
npm run etl
```

### Key ETL outputs

| Path | Contents |
|------|----------|
| `public/data/transactions.json` | Item × business-day aggregates (all departments) |
| `public/data/summary.json` | Department KPIs and date ranges |
| `public/data/intraday/{dept}/YYYY.json` | Item × date × 30-min slot (Dayparts page) |
| `public/data/intraday/index.json` | Intraday catalog (departments, years) |
| `public/data/tickets/YYYY-MM.json` | Full ticket receipts by month |
| `public/data/payments.json` | Payment type breakdown |
| `public/data/bowling_forecast.json` | Bowling forecast vs actuals |
| `public/data/holiday_analysis.json` | Holiday YoY analysis |

**Business day:** sales before 4:00 AM roll to the previous calendar day.

**Modifiers:** modifier revenue is rolled into parent product totals (no double-counting).

## Project structure

```
├── app/                  # Next.js 15 dashboard (App Router)
│   ├── dayparts/         # Intraday / daypart analysis
│   ├── explorer/         # Main data explorer
│   ├── components/       # Nav, charts, filters
│   ├── hooks/            # Data fetching hooks
│   └── lib/              # Aggregation, formatting, date helpers
├── config/               # Category overrides, item lists
├── data/                 # POS CSV exports (gitignored)
├── public/data/          # Generated JSON (committed)
├── scripts/              # Python ETL and analysis
└── netlify/functions/    # Serverless chat (optional)
```

## Stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS, Recharts
- **ETL:** Python 3 (`scripts/export_dashboards.py`)
- **Deploy:** Static export to Netlify (`npm run build`)

## Scripts

### Dashboard ETL (run this to refresh everything)

```bash
npm run etl
```

Pipeline steps: transactions → modifiers → summary → bowling seasonality/forecast → holiday analysis → tickets → payments → packages → **intraday sales** → intraday voids.

### Other Python scripts

```bash
python scripts/export_clean_csv.py       # Food items → data/food_purchases.csv
python scripts/forecast_food_sales.py    # Food day-of-week forecast
python scripts/forecast_bar_sales.py     # Bar day-of-week forecast
python scripts/build_dashboard.py        # Food PDF dashboard
python scripts/build_bar_dashboard.py    # Bar PDF dashboard
python scripts/reconcile_day.py          # Reconcile one day vs POS
python scripts/reconcile_month.py        # Monthly department reconciliation
```

### npm scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run etl` | Run full ETL pipeline |
| `npm run specialty` | Regenerate specialty cocktails JSON |

## Dayparts

The `/dayparts` page uses intraday data (30-minute slots, 4 AM business-day start):

- Compare day shapes across selected weekdays (overlaid lines)
- Heatmap by day-of-week × time slot
- Drill into top items for a selected time window
- Filter by department, date range, specific items (search + multi-select), and category dropdown

Select at least one day of the week (or **All**) to load charts. **Clear** resets day selection.
