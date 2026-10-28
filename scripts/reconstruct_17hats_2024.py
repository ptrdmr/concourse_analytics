#!/usr/bin/env python3
"""
Rebuild 2024 party deposits from the 17hats payment export.

In 2024 suite and party deposits were taken in 17hats and only keyed into the
POS on or near the party date, so booking_pace.json dates them too late. This
matches each 17hats invoice to the POS prepaid account it was loaded into
(exact amounts, account-name keywords, credit entry dates) and takes the event
date from that account.

Inputs (both gitignored, they hold customer names):
  data/17hats_payments_2024.csv   paid,client,project,invoice,amount
  public/data/tickets/YYYY-MM.json

Output:
  data/17hats_2024_mapping.csv       one row per payment, with the client name
                                     (gitignored)
  config/deposit_history_2024.json   paid dates only, with --write-history.
                                     POS account names, no client names.

Usage:
    python scripts/reconstruct_17hats_2024.py
    python scripts/reconstruct_17hats_2024.py --write-history
"""

from __future__ import annotations

import csv
import json
import re
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAYMENTS_CSV = ROOT / "data" / "17hats_payments_2024.csv"
MAPPING_CSV = ROOT / "data" / "17hats_2024_mapping.csv"
HISTORY_PATH = ROOT / "config" / "deposit_history_2024.json"
FIRST_WINDOW_DAY = "2024-09-02"
TICKETS_DIR = ROOT / "public" / "data" / "tickets"
TICKET_MONTHS = ("2024-08", "2025-02")

# Decisions that amounts and names alone can't settle. Reviewed by hand
# against POS credit entry dates. None means no POS account (left out).
OVERRIDES: dict[str, str | None] = {
    "124": "kdc 12-06-24",
    "160": "bowling4boobs 10-24-24",
    "169": None,  # second $5,000 Polly's Pies invoice; POS only loaded one
    "195": "cecelia vasquez 12-17-23",
    "201": "polly's pies 12-05-24",
    "220": "st. jude 12-08-24",
    "221": "bitetto's towing 12-22-24",
    "227": "partners 12-20-24",
    "177": None,  # per-donation fundraiser, not a party deposit
    "180": None,
    "184": None,
    "185": None,
    "186": None,
    "187": None,
    "192": None,
    "196": None,
    "197": None,
    "200": None,
}

STOP_WORDS = {
    "vip", "suite", "kingpin", "strike", "zone", "powerhouse", "half", "house",
    "lane", "lanes", "party", "sports", "team", "pair", "spare", "supercharge",
    "the", "reservation", "adult", "package", "special", "summer", "nye",
}
DATE_IN_NAME = re.compile(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})")


def tokens(text: str) -> set[str]:
    return {
        word for word in re.findall(r"[a-z0-9&']+", text.lower())
        if word not in STOP_WORDS and len(word) > 2
    }


def normalize_party(name: str) -> str:
    text = DATE_IN_NAME.sub(" ", name.lower())
    return re.sub(r"[^a-z0-9&]+", "", text)


def name_date(name: str) -> str | None:
    match = DATE_IN_NAME.search(name)
    if not match:
        return None
    month, day, year = (int(part) for part in match.groups())
    year = year + 2000 if year < 100 else year
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def month_keys(start: str, end: str) -> list[str]:
    keys = []
    year, month = int(start[:4]), int(start[5:])
    while f"{year}-{month:02d}" <= end:
        keys.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return keys


def load_account_lines() -> dict[str, list[dict]]:
    accounts: dict[str, list[dict]] = defaultdict(list)
    for key in month_keys(*TICKET_MONTHS):
        path = TICKETS_DIR / f"{key}.json"
        if not path.exists():
            continue
        for ticket in json.loads(path.read_text(encoding="utf-8")):
            if ticket.get("type") != "Sales":
                continue
            for item in ticket.get("items", []):
                if item.get("itemType") != "Account":
                    continue
                name = (item.get("name") or "").strip()
                accounts[name.lower()].append({
                    "name": name,
                    "date": ticket["date"][:10],
                    "amount": round(float(item.get("total") or 0), 2),
                })
    return accounts


def load_payments() -> dict[str, list[dict]]:
    invoices: dict[str, list[dict]] = defaultdict(list)
    with PAYMENTS_CSV.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            row["amount"] = round(float(row["amount"]), 2)
            invoices[row["invoice"]].append(row)
    return invoices


def score_account(pays: list[dict], lines: list[dict]) -> tuple[int, int]:
    first = min(pay["paid"] for pay in pays)
    total = round(sum(pay["amount"] for pay in pays), 2)
    draws = [line for line in lines if line["amount"] < 0 and line["date"] >= first]
    credits = [line for line in lines if line["amount"] > 0 and line["date"] >= first[:8] + "01"]
    amount_hits = 0
    timely = 0
    for pay in pays:
        paid = date.fromisoformat(pay["paid"])
        same = [line for line in credits if abs(line["amount"] - pay["amount"]) < 0.01]
        if same or any(abs(-line["amount"] - pay["amount"]) < 0.01 for line in draws):
            amount_hits += 1
        if any(timedelta(0) <= date.fromisoformat(line["date"]) - paid <= timedelta(days=14) for line in same):
            timely += 1
    drawn = round(-sum(line["amount"] for line in draws), 2)
    total_hit = bool(draws) and (abs(drawn - total) < 0.01 or any(abs(-line["amount"] - total) < 0.01 for line in draws))
    return amount_hits * 3 + timely * 3 + (4 if total_hit else 0), int(total_hit)


def match_invoices(invoices: dict[str, list[dict]], accounts: dict[str, list[dict]]) -> dict[str, tuple[str | None, str]]:
    matches: dict[str, tuple[str | None, str]] = {}
    for invoice, pays in invoices.items():
        if invoice in OVERRIDES:
            matches[invoice] = (OVERRIDES[invoice], "reviewed")
            continue
        wanted = tokens(pays[0]["project"]) | tokens(pays[0]["client"])
        best: tuple[int, str, int] | None = None
        for key, lines in accounts.items():
            amount_score, total_hit = score_account(pays, lines)
            name_hits = len(wanted & tokens(key))
            score = amount_score + name_hits * 2
            if score >= 3 and (best is None or score > best[0]):
                best = (score, key, total_hit + min(name_hits, 1))
        if best is None:
            matches[invoice] = (None, "unmatched")
        else:
            matches[invoice] = (best[1], "high" if best[2] else "medium")
    return matches


def event_date(lines: list[dict]) -> str | None:
    named = name_date(lines[0]["name"])
    draws = sorted(line["date"] for line in lines if line["amount"] < 0)
    if named and (not draws or abs((date.fromisoformat(named) - date.fromisoformat(draws[-1])).days) <= 31):
        return named
    return draws[-1] if draws else named


def build_mapping() -> list[dict]:
    invoices = load_payments()
    accounts = load_account_lines()
    matches = match_invoices(invoices, accounts)
    rows = []
    for invoice in sorted(invoices, key=int):
        key, confidence = matches[invoice]
        lines = accounts.get(key or "", [])
        event = event_date(lines) if lines else None
        account = lines[0]["name"] if lines else ""
        loaded = round(sum(line["amount"] for line in lines if line["amount"] > 0), 2)
        for pay in invoices[invoice]:
            rows.append({
                "invoice": invoice,
                "paid": pay["paid"],
                "client": pay["client"],
                "project": pay["project"],
                "amount": f"{pay['amount']:.2f}",
                "pos_account": account,
                "event": event or "",
                "pos_loaded": f"{loaded:.2f}" if lines else "",
                "confidence": confidence,
            })
    return rows


def pre_window_gaps(rows: list[dict]) -> list[dict]:
    """
    Deposits loaded in the POS but paid before the 17hats export starts.
    Events after the export ends are skipped; their gap is later payments.
    """
    export_end = max(row["paid"] for row in rows)
    by_account: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row["pos_account"] and row["event"] <= export_end:
            by_account[row["pos_account"]].append(row)
    gaps = []
    for account, items in by_account.items():
        paid = round(sum(float(item["amount"]) for item in items), 2)
        loaded = float(items[0]["pos_loaded"] or 0)
        if loaded - paid > 0.01:
            gaps.append({
                "pos_account": account,
                "event": items[0]["event"],
                "amount": round(loaded - paid, 2),
                "project": items[0]["project"],
            })
    return gaps


def write_mapping(rows: list[dict]) -> None:
    MAPPING_CSV.parent.mkdir(exist_ok=True)
    with MAPPING_CSV.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


GROUP_HINTS = (
    ("kids", ("supercharge", "sports", "jr.", "jr ")),
    ("pair", ("pair & spare", "adult party")),
    ("suites", ("suite", "kingpin", "strike zone", "powerhouse", "half house", "vip")),
)


def group_for(project: str) -> str:
    text = project.lower()
    for group, hints in GROUP_HINTS:
        if any(hint in text for hint in hints):
            return group
    return "lanes"


def merge_into_pace(payments: list[dict], month: str, first_window_day: str = "2024-09-02") -> list[dict]:
    """
    Replace booking_pace rows for parties paid through 17hats with the 17hats
    paid dates. Deposits paid before the export window are dated to the day
    before it starts, which counts them as already on the books.
    """
    if not PAYMENTS_CSV.exists():
        return payments
    rows = build_mapping()
    in_month = [row for row in rows if row["event"][:7] == month]
    replaced = {normalize_party(row["pos_account"]) for row in in_month}
    pace_by_party = {
        normalize_party(row.get("party") or ""): row
        for row in payments
        if (row.get("event") or "")[:7] == month
    }
    kept = [
        row for row in payments
        if (row.get("event") or "")[:7] != month
        or normalize_party(row.get("party") or "") not in replaced
    ]
    added = []
    seen: set[str] = set()
    gaps = {gap["pos_account"]: gap for gap in pre_window_gaps(rows) if gap["event"][:7] == month}
    for row in sorted(in_month, key=lambda item: item["paid"]):
        account = row["pos_account"]
        template = pace_by_party.get(normalize_party(account), {})
        base = {
            "party": template.get("party") or DATE_IN_NAME.sub("", account).strip(" -"),
            "event": row["event"],
            "group": template.get("group") or group_for(row["project"]),
            "type": template.get("type") or row["project"],
            "status": "completed",
            "eventSource": "17hats",
        }
        if account in gaps and account not in seen:
            added.append({**base, "paid": first_window_day, "amount": gaps[account]["amount"], "isFirstPayment": True, "txnId": f"17hats-pre-{account}"})
            seen.add(account)
        added.append({
            **base,
            "paid": row["paid"],
            "amount": float(row["amount"]),
            "isFirstPayment": account not in seen,
            "txnId": f"17hats-{row['invoice']}-{row['paid']}",
        })
        seen.add(account)
    return kept + added


def history_document(rows: list[dict]) -> dict:
    """Paid dates for the nightly builder. No 17hats client names."""
    skipped = []
    seen_skipped: set[str] = set()
    for row in rows:
        if row["pos_account"] or row["invoice"] in seen_skipped:
            continue
        seen_skipped.add(row["invoice"])
        reason = "reviewed, left out" if row["confidence"] == "reviewed" else "no POS account matched"
        skipped.append({"invoice": row["invoice"], "reason": reason})

    gaps = {gap["pos_account"]: gap for gap in pre_window_gaps(rows)}
    payments = []
    seen_gap: set[str] = set()
    matched = sorted((row for row in rows if row["pos_account"]), key=lambda row: (row["paid"], int(row["invoice"])))
    for row in matched:
        account = row["pos_account"]
        if account in gaps and account not in seen_gap:
            payments.append({
                "account": account,
                "event": gaps[account]["event"],
                "paid": FIRST_WINDOW_DAY,
                "amount": gaps[account]["amount"],
                "invoice": row["invoice"],
                "source": "17hats",
                "note": "paid before 17hats export",
            })
            seen_gap.add(account)
        payments.append({
            "account": account,
            "event": row["event"],
            "paid": row["paid"],
            "amount": float(row["amount"]),
            "invoice": row["invoice"],
            "source": "17hats",
        })
    paid_days = [item["paid"] for item in payments]
    return {
        "_comment": (
            "2024 party deposits taken in 17hats and keyed into the POS later. "
            "Rebuilt by scripts/reconstruct_17hats_2024.py --write-history. "
            "Accounts are POS prepaid-account names. 17hats client names are not stored."
        ),
        "source": "17hats",
        "from": min(paid_days) if paid_days else None,
        "to": max(paid_days) if paid_days else None,
        "payments": payments,
        "_skipped": skipped,
    }


def write_history(rows: list[dict]) -> dict:
    document = history_document(rows)
    HISTORY_PATH.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return document


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Match 17hats payments to POS accounts.")
    parser.add_argument("--write-history", action="store_true", help="Write config/deposit_history_2024.json")
    args = parser.parse_args()

    rows = build_mapping()
    write_mapping(rows)
    invoices = {row["invoice"] for row in rows}
    unmatched = sorted({row["invoice"] for row in rows if not row["pos_account"]}, key=int)
    print(f"{len(rows)} payments across {len(invoices)} invoices -> {MAPPING_CSV}")
    print(f"No POS account: {', '.join('#' + num for num in unmatched)}")
    for gap in pre_window_gaps(rows):
        print(f"Paid before Sep 3: {gap['pos_account']} ${gap['amount']:,.2f}")
    if args.write_history:
        document = write_history(rows)
        print(f"{len(document['payments'])} history rows -> {HISTORY_PATH}")


if __name__ == "__main__":
    main()
