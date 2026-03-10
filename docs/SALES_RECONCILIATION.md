# Sales Reconciliation: Dashboard vs POS

The dashboard totals are aligned with POS Total Sale via a processing pipeline that includes Adjustments and Refunds as deductions.

## How We Calculate Daily Sales (v2 Pipeline)

1. **Source**: POS CSV exports in `data/`
2. **Product revenue**: Rows where
   - `Transaction Type` = "Sales"
   - `Item Type` = Product, Modifier, or Package
   - `Deleted` = False, `Voided` = False
3. **Modifiers**: Merged into parent products; modifier cost is added to product `item_total` (no double-count)
4. **Deductions** (to match POS Total Sale):
   - **Adjustments**: `Transaction Type` = Sales, `Item Type` = Adjustment — added as negative rows per (date, department)
   - **Refunds**: `Transaction Type` = Refund, Product/Modifier/Package — added as negative rows per (date, department)
5. **Date**: Uses `Item Created Date` for daily attribution

## Jan 2025 Case Study

- **Our net**: ~$594,528 (product $599,992 − deductions $5,464)
- **POS Total Sale**: $593,266
- **Remaining gap**: ~$1,262 (we may be missing some POS deductions, e.g. additional discount types)

## What We Exclude (That the POS Might Include/Handle Differently)

| Item Type / Txn Type | Our Handling | POS May |
|---------------------|--------------|---------|
| **Refund** (Transaction Type) | Excluded entirely | Net against Sales |
| **Adjustment** (4K+ rows) | Excluded | May reduce Sales (comps, discounts) |
| **Tax** | Excluded | In Revenue, not Sales |
| **GratuityIn** | Excluded | In Revenue, not Sales |
| **Account** (deposits) | Excluded | Often separate line |
| **PaymentCredit/Cash** | Excluded | Payment methods, not sales |

## Likely Causes of Mismatch

### 1. Date Field
- **We use**: `Item Created Date`
- **POS may use**: `Transaction Created Date`, `Transaction Closed Date`, or `Transaction Fiscal`
- Transactions that span midnight can land on different days.

### 2. Refunds
- We exclude all `Transaction Type = Refund` rows.
- If the POS shows **net sales** (Sales − Refunds), we'd be higher.

### 3. Adjustments
- We exclude `Item Type = Adjustment` (~4K rows).
- Comps, discounts, or voids may reduce POS Sales. We don't subtract them.

### 4. Modifier Attribution
- We merge modifiers into products. The POS might report modifiers as separate line items or aggregate differently.

## Diagnostic: Compare a Single Day

Run the reconciliation script for a specific date:

```bash
python scripts/reconcile_day.py 2026-01-15
```

This outputs our totals by item type and department so you can compare to the POS report for that day.
