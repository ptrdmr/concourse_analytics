# Food & Bar Sales Analysis

POS sales analysis for Oct 2025 - Jan 2026. Dashboards, exports, and lightweight forecasting.

## Data

Raw transaction CSVs (`data/2023.csv`, `data/2024.csv`, `data/2025.csv`, `data/oct25-jan26.csv`) are excluded from the repo due to GitHub's 100MB file limit. Place your own exports in `data/` and run `python scripts/export_dashboards.py` to regenerate `public/data/` for the dashboard.

## Structure

```
food_oct25-jan26/
├── data/           # Raw and derived data
│   ├── oct25-jan26.csv      # Raw POS export
│   └── food_purchases.csv   # Cleaned food items (from export_clean_csv)
├── config/         # Item filter lists
│   ├── food_items.txt
│   └── bar_items.txt
├── output/         # Generated reports
│   ├── food_dashboard.pdf
│   └── bar_dashboard.pdf
└── scripts/        # Python scripts
```

## Running Scripts

From the project root:

```bash
# Export cleaned food data (run first if food_purchases.csv is missing)
python scripts/export_clean_csv.py

# Food sales forecast (day-of-week, weekly forecast, top items)
python scripts/forecast_food_sales.py

# Bar sales forecast (same structure)
python scripts/forecast_bar_sales.py

# Generate dashboards
python scripts/build_dashboard.py      # Food
python scripts/build_bar_dashboard.py  # Bar

# Utilities
python scripts/product_summary.py
python scripts/food_products.py
python scripts/find_modifiers.py
python scripts/inspect_pizza_transactions.py
```
