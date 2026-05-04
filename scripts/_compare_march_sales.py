"""One-off: March 2026 our total vs POS benchmark."""
import csv
import json
import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POS_TOTAL_SALES = 497_113.07
POS_TOTAL_TAX = 16_831.90


def from_transactions_json():
    path = os.path.join(_ROOT, "public", "data", "transactions.json")
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    march = [r for r in rows if r["date"].startswith("2026-03-")]
    total = sum(r["revenue"] for r in march)
    by_dept = {}
    for r in march:
        d = r["department"]
        by_dept[d] = by_dept.get(d, 0) + r["revenue"]
    return total, len(march), by_dept


def raw_csv_product_only_march():
    """Sum Product+Modifier+Package line Total only (no deductions) — lower bound."""
    path = os.path.join(_ROOT, "data", "2026.csv")
    product = 0.0
    with open(path, encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";")
        header = next(reader)
        idx = {c.strip(): i for i, c in enumerate(header)}
        it, tot, icd = idx["Item Type"], idx["Total"], idx["Item Created Date"]
        del_i, void_i = idx["Deleted"], idx["Voided"]
        txn_i = idx["Transaction Type"]
        for row in reader:
            if len(row) <= max(it, tot, icd):
                continue
            if not row[icd].strip().startswith("2026-03-"):
                continue
            if row[del_i] != "False" or row[void_i] != "False":
                continue
            if row[txn_i] != "Sales":
                continue
            if row[it].strip() not in ("Product", "Modifier", "Package"):
                continue
            product += float(row[tot] or 0)
    return product


def main():
    total, n, by_dept = from_transactions_json()
    print("Our dashboard pipeline (public/data/transactions.json), March 2026:")
    print(f"  Sum of revenue:  ${total:,.2f}")
    print(f"  Item x date rows: {n:,}")
    print(f"  Gap vs POS Total Sales (${POS_TOTAL_SALES:,.2f}): ${total - POS_TOTAL_SALES:,.2f}")
    print()
    print("  By department:")
    for d in sorted(by_dept.keys(), key=lambda x: -abs(by_dept[x])):
        print(f"    {d}: ${by_dept[d]:,.2f}")
    print()
    raw = raw_csv_product_only_march()
    print("Raw CSV March: sum of Product+Modifier+Package Total (Sales, not voided):")
    print(f"  ${raw:,.2f}")
    print(f"  (This excludes adjustments/refunds as separate rows in our ETL)")
    print()
    print("POS reference (your screenshot):")
    print(f"  Total Sales: ${POS_TOTAL_SALES:,.2f}")
    print(f"  Total Tax:   ${POS_TOTAL_TAX:,.2f}")


if __name__ == "__main__":
    main()
