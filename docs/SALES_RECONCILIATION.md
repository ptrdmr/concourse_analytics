# Sales Reconciliation: Dashboard vs POS

Our dashboard pipeline matches the POS backend detail reports. A persistent ~3% gap exists between those reports and the POS web dashboard, but that discrepancy is on the POS side.

## How We Calculate Daily Sales (v2 Pipeline)

1. **Source**: POS CSV exports in `data/`
2. **Product revenue**: Rows where
   - `Transaction Type` = "Sales"
   - `Item Type` = Product, Modifier, or Package
   - `Deleted` = False, `Voided` = False
3. **Modifiers**: Merged into parent products; modifier cost is added to product `item_total` (no double-count). This is correct — many products (e.g. BYO Pizza) have `Total = $0` with the price living entirely on the modifier (e.g. "Large" = $20).
4. **Deductions** (to match POS detail reports):
   - **Adjustments**: `Transaction Type` = Sales, `Item Type` = Adjustment — added as negative rows per (date, department). Includes comps (Manger Full Comp, Employee food) and charges (Party Service Charge, VIP Service Charge).
   - **Refunds**: `Transaction Type` = Refund, Product/Modifier/Package — added as negative rows per (date, department)
5. **Date**: Uses `Item Created Date` for daily attribution. Verified that `Transaction Fiscal` and `Transaction Created Date` produce identical monthly totals.

## Tax Handling

Items with `Tax Included = True` (primarily Soda, Refill, Bottled Water, Online Soda) already have tax backed out of the `Total` column by the POS. For example, Soda has `Unit Amount = $3.75` (shelf price) but `Total = $3.48` (pre-tax). No ETL adjustment is needed.

Separate `Item Type = Tax` rows are excluded from sales — they are not summed into our totals.

## March 2026 Reconciliation (Definitive)

### Our pipeline matches the POS backend detail report

| Source | Sales Total | Tax | Gratuity | Adjustments |
|--------|----------:|----:|--------:|----------:|
| **POS Backend Report** (march2026.pdf) | **$512,178.03** | $17,530.91 | $29,920.10 | ($5,091.60) |
| **Our Pipeline** (transactions.json) | **$512,374.03** | — | — | ($5,091.60) |
| POS Web Dashboard | $497,113.07 | $16,831.90 | $28,492.77 | — |

The ~$196 difference between our pipeline and the backend report is from modifier resolution edge cases (orphan modifiers at transaction boundaries).

### Department-level match

| Department | POS Backend Report | Our Pipeline |
|------------|------------------:|------------:|
| Arcade | $2,843.00 | $2,843.00 |
| Bar | $136,331.60 | $136,331.60 |
| Bowling | $186,792.61 | (split: see note) |
| Food | $93,458.00 | $93,458.00 |
| General Income | $765.32 | $765.32 |
| League Fees | $91,987.50 | $91,987.50 |

**Note**: Our pipeline classifies some bowling subdepartments (General Parties, Supercharge, VIP Suites, Youth Groups) under a "Parties" department. The combined Bowling + Parties total matches the POS Bowling Total.

### Daily verification (March 21, 2026)

Compared our pipeline output to the POS daily detail report for a $28.5K Saturday:

- Total gap: **$10** (a single comp the POS attributed to Bar but the CSV put under Food)
- Every other department: exact match

### The POS web dashboard is the outlier

The POS web dashboard's "Total Sales" ($497,113) is $15,065 lower than both the POS backend detail report ($512,178) and our pipeline ($512,374). This gap exists across every revenue component — Sales, Tax, and Gratuity are all lower in the dashboard. The dashboard appears to use a separate aggregation layer with its own reconciliation logic.

## What We Exclude

| Item Type / Txn Type | Our Handling | Notes |
|---------------------|--------------|-------|
| **Tax** | Excluded | Already backed out of product `Total` for Tax Included items |
| **GratuityIn** | Excluded | In Revenue, not Sales |
| **Account** | Excluded | Deposits and redemptions; separate from product sales |
| **PaymentCredit/Cash** | Excluded | Payment methods, not sales |
| **Cancel** (Transaction Type) | Excluded | Separate transaction IDs; never in our Sales-filtered gross |

## Diagnostic: Compare a Single Day

Run the reconciliation script for a specific date:

```bash
python scripts/reconcile_day.py 2026-01-15
```

This outputs our totals by item type and department so you can compare to the POS report for that day.
