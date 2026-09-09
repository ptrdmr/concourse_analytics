# Gratuity & Service Charge Dashboard — Implementation Recommendations

Findings from the August 31, 2026 bar proof of concept, and how to build the nightly
dashboard cleanly on top of them. Results are in `bar_gratuity_poc_2026-08-31.pdf`.

Nothing here has been implemented. This is a plan.

---

## 1. Decisions to lock before writing code

These are the choices that determine whether the dashboard agrees with the POS. Get
sign-off on them first, because changing them later silently restates history.

### 1.1 Daypart on ticket open time

The POS gratuity report timestamps a tip by **`TransactionDateCreated`** — the time the
ticket was opened. This matched on 288 of 288 rows in the POC. `ItemDateCreated`, the time
the tip line was written, matched only 54 of 288.

The difference is not cosmetic. Tips are keyed in batches at settlement: 231 bar tip lines
landed across just 33 distinct minutes, with a median lag of 136 minutes from ticket open
and a maximum of 282. Dayparting on record time moved $46.11 across the 5pm boundary on a
$577 day, and pushed the pre-5pm figure from $60.11 down to $14.00.

**Use `TransactionDateCreated` for daypart assignment.** It matches the POS, and it
attributes the tip to the shift that earned it.

> Verify what the existing `aggregate_employees_from_tickets` in
> `scripts/export_dashboards.py` uses for `ticket.date` before building on it. If it
> derives from a different column, daily totals are still correct but dayparts will not be.

### 1.2 Identify the bar by terminal, not by department

`Department` is **blank on every gratuity line**. It only populates on product lines, so it
cannot isolate bar tips.

Terminal works: `BAR1`, `BAR2`, `BAR3`, `MPOS2`, `MPOS6` carry bar tips, `CAFE1` and
`SYNCSERVER` carry cafe, `MPOS3` is separate. This partition reconciled exactly
($577.12 bar + $100.42 cafe = $677.54 total).

Put the mapping in `config/` as data, not in code:

```json
{
  "Bar":  ["BAR1", "BAR2", "BAR3", "MPOS2", "MPOS6"],
  "Cafe": ["CAFE1"]
}
```

**This is the most fragile part of the design.** Terminal-to-department is a convention,
not a constraint — a new mobile POS or a reassigned terminal breaks it silently. Mitigate
with an unmapped-terminal check (see §4) rather than by trying to be clever.

### 1.3 Report the pool as the pool

The bar runs a tip pool. 43 of 50 tipped tickets split evenly four ways. Per-employee
totals are therefore **shares of a pool, not individual performance**, and must never be
presented as a leaderboard or tied to individual sales. Tony S. shows higher only because
he worked solo before the pool formed at 4:44 PM.

Recommend surfacing, per daypart: pooled total, number of participants, and each
participant's share — with pooled and non-pooled amounts distinguishable.

### 1.4 Scope of "gratuity"

Keep these as separate measures. Do not sum them into one "tips" number.

| Measure | Source | Attribution |
|---|---|---|
| Gratuity | `ItemType = 3` (`GratuityIn`) | `Name` = recipient |
| Tip-out | `ItemType = 4` (`GratuityOut`) | `Name` = employee |
| Service charge | `ItemType = 8` (`Adjustment`), name matches config | Transaction user |

`GratuityOut` was zero on Aug 31 and the export's tip-out columns were empty, so the
mechanism exists but is unused. **Handle it anyway** — the current pipeline ignores it
entirely, and if it is ever switched on, every tip total silently overstates.

---

## 2. Data quality rules

Encode these as explicit filters so they are visible and testable.

- **Exclude `IsDeleted` / `IsVoided`.** Zero on Aug 31, but do not rely on that holding.
- **Keep $0.00 gratuity lines out of counts.** 43 of the day's 291 lines are $0.00 (32 of
  them one employee on `MPOS3`). They contribute nothing to totals but will inflate any
  "tips recorded" or average-tip metric.
- **Expect the journal to exceed the POS export slightly.** Three $0.00 lines
  (txn 826050, 826255, 826267) were in the journal but not the export. No dollar impact.
  Every exported row was `Marked as Paid`, so the likely cause is unpaid state — worth
  confirming before treating the export as the definition of truth.
- **Business day is a 4 AM rollover**, already implemented as `business_day()` in
  `scripts/export_dashboards.py`. Reuse it; do not reimplement. Aug 31's last tip was
  9:15 PM so the boundary was untested — validate against a late night before trusting it.

---

## 3. Suggested shape

Follow the existing pattern: SQL → CSV → aggregate → JSON. Do not add a live DB dependency
to the dashboard.

**Extraction.** `pull_journal.py` already exports the needed columns. Confirm
`TransactionDateCreated` survives into the ticket JSON — the POC found `read_ticket_rows_deduped`
drops `Item Created Date/Time`, so verify before assuming any timestamp is available
downstream.

**Aggregation.** A new function alongside `aggregate_employees_from_tickets`, rather than
changing it. The existing daily gratuity totals are correct and feed `employees.json`;
leave them alone so this can ship without restating published numbers.

**Output.** One file, `public/data/gratuity.json`, keyed by business date:

```jsonc
{
  "2026-08-31": {
    "departments": {
      "Bar": {
        "dayparts": {
          "pre17": { "total": 60.11, "pooled": 16.11, "solo": 44.00 },
          "post17": { "total": 517.01, "pooled": 477.01, "solo": 40.00 }
        },
        "employees": {
          "Tony S.": { "pre17": 48.03, "post17": 119.26, "day": 167.29 }
        },
        "day": 577.12
      }
    },
    "serviceCharges": { "vip": 0.0, "party": 0.0, "other": 0.0, "comps": -152.75 },
    "meta": { "lines": 291, "zeroLines": 43, "voided": 0, "tipOut": 0.0 }
  }
}
```

Carry `meta` through to the dashboard. When someone disputes a number, these are the fields
that resolve it without a database session.

**Daypart boundary** belongs in config, not hardcoded at 17. It will be questioned.

---

## 4. Validation

Add to `_validate_build.py`, and fail the nightly build loudly rather than publishing
suspect numbers:

- Sum of per-employee gratuity equals sum of journal gratuity lines for the day.
- Sum of dayparts equals the day total, per employee and per department.
- Department totals sum to the all-department total (catches unmapped terminals).
- **Alert on any terminal not present in the department map.** This is the tripwire for the
  §1.2 fragility.
- Alert if `GratuityOut` is ever non-zero, until it is deliberately handled.

Before going live, reconcile against the POS gratuity export for **at least a full week**,
including a weekend and a late night. Aug 31 was a single Monday with a stable four-person
pool; it does not prove the pool logic holds when staff change mid-shift.

---

## 5. Open questions

1. Does the tip pool composition change mid-shift, and should shares be attributed to the
   daypart in which they were earned or the shift the employee worked?
2. Should service charges appear in employee-facing figures at all? They are attributed to
   the ticket owner, not the tip recipient — a different person under a pool.
3. Aug 31 had no VIP or party service charges, only comps (−$41.25 employee food,
   −$111.50 manager comp). **The service charge half of this dashboard is unvalidated.**
   Run the POC again on a banquet or event date before building it.
4. Is `MPOS3` (32 zero-dollar lines, one employee) a configuration problem worth fixing at
   the POS rather than working around in the pipeline?

---

## 6. Recommended sequence

1. Confirm the §1 decisions with whoever owns tip policy.
2. Re-run the POC on a service-charge-heavy date and on a late night.
3. Reconcile a full week against the POS export.
4. Build aggregation + `gratuity.json` behind the validation in §4.
5. Add the dashboard view once the JSON has been stable for several nightly runs.
