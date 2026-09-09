> **ARCHIVED 2026-09-09 — completed, do not execute.**
>
> This handoff was carried out. `scripts/pull_7shifts_labor.py`,
> `scripts/build_employees.py`, `config/employee_map.txt` and
> `config/employee_map.json` now live in this repo, and `run_nightly.ps1`
> invokes both scripts. The separate `server_pipeline/` bundle it refers to no
> longer exists; the nightly task runs from this repo directly.
>
> Kept for the background in section 2 onward, which still describes how the
> 7shifts auth and employee merge work.

# Handoff: add nightly 7shifts labor to the SYNCSERVER pipeline

**Audience:** the agent working on SYNCSERVER, which owns the live
`server_pipeline/` bundle and the registered Task Scheduler job.

**Goal:** the nightly job currently refreshes POS data only. Labor and employee
JSON are stale (last updated by hand on 2026-07-23). Add the 7shifts pull and
the employee merge to the same nightly run.

**Prepared on:** 2026-07-27, from the dev checkout.

---

## 1. What you are given

```
handoff_7shifts/
├── README.md                        <- this file
└── files/
    ├── scripts/pull_7shifts_labor.py
    ├── scripts/build_employees.py
    ├── config/employee_map.txt
    ├── config/employee_map.json
    └── run_nightly.REFERENCE.ps1    <- diff target only, do NOT copy over
```

Copy them into the live bundle, preserving the subfolder they came from:

| Source in this folder | Destination on SYNCSERVER |
|---|---|
| `files/scripts/pull_7shifts_labor.py` | `<bundle>/scripts/pull_7shifts_labor.py` |
| `files/scripts/build_employees.py` | `<bundle>/scripts/build_employees.py` |
| `files/config/employee_map.txt` | `<bundle>/config/employee_map.txt` |
| `files/config/employee_map.json` | `<bundle>/config/employee_map.json` |

`<bundle>` is wherever `run_nightly.ps1` lives, e.g. `C:\Concourse\server_pipeline`.

These are unmodified copies of the scripts that already run correctly on the
dev machine. **Do not rewrite them.** The only code change needed on the server
is in `run_nightly.ps1` (section 5).

`run_nightly.REFERENCE.ps1` is the dev checkout's version with the change
already applied. It is there so you can **diff against it**, not copy it. The
server's copy may have drifted since it was deployed, and the server's copy is
the source of truth. Apply the edits in section 5 to the file that is actually
running.

---

## 2. How the 7shifts integration works

### Authentication

A **REST API bearer token**, read from the bundle's `.env`. There is no browser
session, no cookie, no OAuth dance, and no manual CSV export from the 7shifts
web UI. This is why the job can run unattended on the server:

```python
headers = {
    'Authorization': f'Bearer {token}',
    'Accept': 'application/json',
}
```

Base URL is `https://api.7shifts.com/v2`. The script calls `/whoami` on startup
to verify the token before doing any real work, and exits with a clear message
on a 401.

### Data flow

```
pull_7shifts_labor.py   (7shifts API)
    -> public/data/labor.json             daily labor cost + hours
    -> public/data/labor_intraday.json    30-minute slot shape
    -> public/data/_employees_labor.json  per-employee hours/cost

export_dashboards.py    (already running nightly, POS side)
    -> public/data/_employees_pos.json    per-employee sales/tips

build_employees.py      (merge, no network access)
    reads _employees_pos.json + _employees_labor.json + config/employee_map.txt
    -> public/data/employees.json
```

### Primary source vs fallback — read this before trusting any number

`pull_7shifts_labor.py` prefers the **Daily Sales & Labor report**
(`actual_labor_cost`), which matches the 7shifts website exactly, including
overtime, salaried staff, and employer uplift. That report requires the 7shifts
**"The Works"** plan or higher.

If the report returns 403/404, the script **silently falls back** to estimating
cost from individual time punches multiplied by a wage lookup, plus an optional
`SEVENSHIFTS_LABOR_UPLIFT_PCT` for employer taxes and benefits. The fallback is
an approximation.

The script prints which path it used as `source=` in its output. It also
self-checks against a known-good reconciliation date baked into the code
(2026-06-17 = $2,829 on the 7shifts website) and prints a warning if the
estimate drifts. **Confirm `source=` and the printed totals before you schedule
anything.** A number that is wrong but plausible is worse than no number.

### Business day handling

Days roll over at **4 AM** (`BUSINESS_DAY_CUTOFF_HOUR = 4`), matching the POS
side. Timezone defaults to `America/Los_Angeles`. This is why the nightly task
runs at 5 AM — after the cutoff, so the previous business day is complete.

### Employee mapping

`config/employee_map.txt` is a hand-maintained bridge between POS logins and
7shifts user IDs, because the two systems use different names for the same
person. Format is one person per line:

```
POS login | 7shifts user ID OR full name | display name (optional)
```

Multiple POS logins for one person are comma-separated on the left. Lines
starting with `#` are ignored. If someone shows sales but no hours on the
dashboard, this file is almost always the reason.

`config/employee_map.json` is an optional supplemental file and is currently an
empty roster. Copy it anyway so the path exists.

---

## 3. Constraints you must not break

These are the four ways this change can go wrong. Three of them fail silently.

### 3.1 The server must be the only writer of `public/data`

`run_nightly.ps1` copies with `robocopy /MIR`, which makes the dashboard repo an
**exact mirror** of the bundle's `public/data`. Any file present in the repo but
absent from the bundle gets deleted and committed as a deletion.

This is why the 7shifts pull belongs here and not on a laptop. If a second
machine also generated and pushed `labor.json`, this job would overwrite it at
5 AM every morning and commit the regression, with no error anywhere.

After this change the server generates every file in `public/data`, so `/MIR`
is correct and should stay as-is:

| Producer | Files |
|---|---|
| `export_dashboards.py` | `transactions`, `summary`, `modifiers`, `modifier_transactions`, `payments`, `packages`, `bowling_seasonality`, `bowling_forecast`, `holiday_analysis`, `_employees_pos`, `intraday/`, `tickets/` |
| `generate_specialty_cocktails_json.py` | `specialty_cocktails` |
| `pull_7shifts_labor.py` | `labor`, `labor_intraday`, `_employees_labor` |
| `build_employees.py` | `employees` |

### 3.2 `SEVENSHIFTS_PULL_DAYS` is the entire published history, not a delta

`labor.json` is **rewritten in full on every run**. The script does not merge
with the existing file. Whatever window you pull is the complete labor history
the dashboard will show.

Set it to `365` (the script's own default). Lowering it to something that looks
like a sensible nightly increment — 30, 90 — will quietly delete months of
labor history from the live dashboard on the next run.

### 3.3 Order matters

`build_employees.py` needs `_employees_pos.json`, which `export_dashboards.py`
produces. The 7shifts steps must run **after** the existing ETL step, not
before it and not in parallel.

### 3.4 A 7shifts failure must not block the POS refresh

7shifts is a third-party API and the token can expire. If it is down, the POS
data should still publish. Use the non-fatal wrapper in section 5, which warns
and continues, leaving the previous run's labor JSON in place to ship unchanged.

---

## 4. Config changes

### `requirements.txt`

Add `requests` (the SQL side never needed it):

```
pyodbc>=5.0.0
python-dotenv>=1.0.0
requests>=2.31.0
```

Then `py -3 -m pip install -r requirements.txt`.

### `.env`

Add to the bundle's existing `.env` — the same file that already holds
`SQL_PASSWORD` and `DASHBOARD_REPO_PATH`. Values come from the root `.env` of
the dev checkout; Pete will supply them.

```ini
SEVENSHIFTS_TOKEN=
SEVENSHIFTS_COMPANY_ID=
# Optional: auto-resolved from /companies if blank
SEVENSHIFTS_GUID=
SEVENSHIFTS_TIMEZONE=America/Los_Angeles
# Full published history, NOT an increment — see 3.2
SEVENSHIFTS_PULL_DAYS=365
```

`.env` is gitignored. Do not commit it, echo it into a log, or paste the token
into chat.

---

## 5. The `run_nightly.ps1` change

Two edits. Adapt to the server's actual copy of the file if it has drifted from
what is described here.

### 5.1 Add the non-fatal step helper

Place it next to the existing `Invoke-Step` function:

```powershell
# Non-fatal variant: a 7shifts outage or expired token must not block the POS
# refresh. On failure the previous run's labor JSON stays in place and ships.
function Invoke-OptionalStep($Label, $Command) {
    Write-Log "START: $Label"
    try {
        # Out-Host keeps script output off the pipeline so the caller receives
        # only the boolean below.
        Invoke-Expression $Command | Out-Host
        if ($LASTEXITCODE -ne 0) {
            Write-Log "WARN: $Label failed with exit code $LASTEXITCODE - continuing with previous data"
            return $false
        }
    }
    catch {
        Write-Log "WARN: $Label threw: $($_.Exception.Message) - continuing with previous data"
        return $false
    }
    Write-Log "DONE: $Label"
    return $true
}
```

**Do not drop the `| Out-Host`.** A PowerShell function returns *all* uncaptured
output, so without it the Python script's stdout becomes part of the return
value and `$LaborOk` is truthy even when the pull failed. This was verified with
a test harness: with `Out-Host` the function returns a clean `Boolean` in both
the success and failure cases.

### 5.2 Insert the two steps after the ETL

Immediately after the existing `Specialty cocktails JSON` step and **before**
the robocopy block:

```powershell
    # 7shifts labor. Runs after the ETL because build_employees.py merges
    # _employees_pos.json (from the ETL) with _employees_labor.json (from 7shifts).
    $LaborOk = Invoke-OptionalStep '7shifts labor pull' "$Python scripts/pull_7shifts_labor.py"
    if ($LaborOk) {
        Invoke-OptionalStep 'Employee merge' "$Python scripts/build_employees.py" | Out-Null
    } else {
        Write-Log 'SKIP: Employee merge - labor pull did not succeed'
    }
```

Resulting step order:

1. `pull_journal.py --nightly`
2. `export_dashboards.py`
3. `generate_specialty_cocktails_json.py`
4. `pull_7shifts_labor.py` *(new, non-fatal)*
5. `build_employees.py` *(new, non-fatal)*
6. robocopy `/MIR` to the dashboard repo
7. git add / commit / push

**No Task Scheduler change is needed.** The entry point is still
`run_nightly.ps1`, so the registered task picks this up automatically.

---

## 6. Verification, in order

Do not skip step 3. It is the only point where a wrong-but-plausible labor
number gets caught.

1. **Paths resolve to the bundle.** Both scripts derive their root as
   `dirname(dirname(__file__))`, so dropped in `<bundle>/scripts/` they read and
   write `<bundle>/config/` and `<bundle>/public/data/` — same convention as
   `export_dashboards.py`. Confirm:

   ```powershell
   py -3 -c "import sys; sys.path.insert(0,'scripts'); import build_employees as b; print(b._ROOT); print(b.OUTPUT_PATH)"
   ```

   Both paths must sit under the bundle, not under the dashboard repo clone.

2. **Run the pull by hand.**

   ```powershell
   py -3 scripts/pull_7shifts_labor.py
   ```

   Expect `labor.json`, `labor_intraday.json`, `_employees_labor.json` in
   `public/data/`, and a summary line reporting `source=`, day count, total
   labor cost, and total hours.

3. **Reconcile against the 7shifts website.** Compare the printed total labor
   cost and day count to the same date range in 7shifts. If `source=` shows the
   punch-based fallback rather than the daily report, say so in your report
   rather than proceeding — it means the plan does not expose the report
   endpoint and the numbers are estimates.

4. **Run the merge.**

   ```powershell
   py -3 scripts/build_employees.py
   ```

   Expect `public/data/employees.json`. Spot-check that employees with POS sales
   also show hours. Anyone missing hours needs a line in
   `config/employee_map.txt`.

5. **Full nightly run by hand.**

   ```powershell
   powershell -ExecutionPolicy Bypass -File run_nightly.ps1
   ```

   Read the log in `logs/`. Confirm all steps report `DONE`, the commit includes
   the labor and employee JSON, and **no `public/data` file was deleted** by the
   robocopy step.

6. **Confirm the deploy.** Check that Netlify rebuilt and the dashboard's Sales
   vs Labor card and Employees page show current data.

7. **Watch one real scheduled run** the next morning before calling it done.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `FAIL: missing SEVENSHIFTS_TOKEN` | Variable absent from the bundle's `.env` |
| `FAIL: 401 Unauthorized` | Token expired or revoked — regenerate in 7shifts admin |
| `Missing dependency: pip install requests python-dotenv` | `requests` not installed; rerun `pip install -r requirements.txt` |
| Log shows `WARN: 7shifts labor pull failed` | Working as designed — POS data still published, previous labor JSON shipped. Fix the cause, then rerun manually |
| `source=` is the punch fallback | 7shifts plan lacks the Daily Sales & Labor report; numbers are estimates. Tune `SEVENSHIFTS_LABOR_UPLIFT_PCT` and reconcile |
| Labor history shrank on the dashboard | `SEVENSHIFTS_PULL_DAYS` was lowered — see 3.2. Raise it and rerun |
| Employee shows sales but zero hours | Missing or wrong line in `config/employee_map.txt` |
| Labor JSON reverts every morning | Something other than this server is also writing `public/data` — see 3.1 |

---

## 8. Rollback

The change is additive. To revert, remove the two `Invoke-OptionalStep` calls
from `run_nightly.ps1`. The nightly job returns to POS-only, and the labor JSON
files freeze at their last good values rather than disappearing.

---

## 9. Report back

Please confirm:

- Which `source=` the labor pull used, and whether the totals matched the
  7shifts website (with the numbers you compared)
- Any employees still unmapped in `employee_map.txt`
- That the robocopy step deleted nothing
- Whether the first real 5 AM scheduled run succeeded
