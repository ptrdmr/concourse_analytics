# Concourse Analytics

POS sales analytics for **Concourse Bowl-Bar-Grill** — food, bar, bowling, parties, league fees, and more. A Next.js dashboard backed by a Python ETL over Brunswick Sync POS journals.

One repo. The Next.js app and the nightly pipeline live here. JSON is generated in `public/data/` and committed; Netlify deploys from `main`.

Data span: **2023 → present**.

---

## Quick start (laptop)

```bash
# 1. POS CSVs in data/ (gitignored) — on the server the nightly writes these

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
| `/employees` | Employee sales, hours, and gratuity (from POS + 7shifts) |

The app reads static JSON from `public/data/`. No database required at request time.

---

## Rebuild the server (disaster recovery)

This is the whole procedure. There is no second folder to copy.

1. `git clone https://github.com/ptrdmr/concourse_analytics.git C:\repos\concourse_analytics`
2. Copy `.env.example` to `.env` and fill in `SQL_PASSWORD` and the 7shifts variables. Never commit `.env`.
3. `py -3 -m pip install -r requirements.txt`
4. `powershell -ExecutionPolicy Bypass -File register_task.ps1`

Git credentials must already be stored (fine-grained PAT). The first `git push` from this clone prompts; Git Credential Manager keeps them for the unattended nightly.

Do **not** hand-edit files on the server. A dirty working tree **aborts the nightly**. Edit on the workstation, push, and let the 05:30 job pull.

On the workstation clone, once: `git config pull.rebase true`. The server pushes a `chore(data)` commit around 05:30, so most mornings you start one commit behind.

---

## Prerequisites (SYNCSERVER)

| Component | Notes |
|-----------|-------|
| **Python 3.10+** | Add to PATH; `py -3` also works |
| **ODBC Driver 18 for SQL Server** | [Microsoft download](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server) |
| **Git for Windows** | Includes Git Credential Manager |
| **SQL login** | `concourse_readonly` with `db_datareader` on `SyncJournal` + `Sync` |
| **Node.js** | Only for local dashboard work, not for the nightly |

## Configure secrets

```powershell
cd C:\repos\concourse_analytics
copy .env.example .env
notepad .env
```

Fill in:

- `SQL_PASSWORD` — `concourse_readonly` password (store in password manager)
- `SEVENSHIFTS_TOKEN` — 7shifts REST API bearer token
- `SEVENSHIFTS_COMPANY_ID` — 7shifts company id
- `SEVENSHIFTS_TIMEZONE` — `America/Los_Angeles`
- `SEVENSHIFTS_PULL_DAYS` — `365`, and see the warning below

`SEVENSHIFTS_GUID` is optional; the pull resolves it from `/companies` when blank.

> `SEVENSHIFTS_PULL_DAYS` is the **entire published labor history, not a nightly
> increment**. `labor.json` is rewritten in full every run and never merged
> with the existing file, so lowering this to a number that looks like a sensible
> delta (30, 90) silently deletes months of history from the live dashboard.
> `run_nightly.ps1` refuses to publish a `labor.json` with fewer than 300 days.

### GitHub authentication (fine-grained PAT)

Do **not** paste the token into chat or commit it.

1. GitHub → **Settings** → **Developer settings** → **Fine-grained tokens** → **Generate**
2. Name: `syncserver-dashboard-push`
3. Repository access: **Only** `concourse_analytics`
4. Permissions: **Contents: Read and write** (+ Metadata is auto-added)
5. Copy token → password manager only

On the server, the first `git push` will prompt:

- **Username:** your GitHub username
- **Password:** paste the **token** (not your GitHub password)

---

## Verification (do this before automation)

Run in order. Do not schedule the task until reconcile passes.

### A. Test DB connection

```powershell
py -3 -c "from scripts.db import connect; c=connect(); print('OK'); c.close()"
```

If SSL/certificate errors appear, the connection string already uses `TrustServerCertificate=yes`. In SSMS, also check **Trust server certificate** when connecting via SQL auth.

### B. Optional: re-verify enum map

```powershell
py -3 scripts/derive_enums.py --reference-csv path\to\manual_2026.csv --write
```

The repo ships with a pre-verified `config/enum_map.json`.

### C. Bulk pull (initial history)

Default span: **2023 → current year**.

```powershell
py -3 scripts/pull_journal.py --bulk
```

Writes `data/2023.csv`, `data/2024.csv`, … through the current year. Filter rule: `TransactionFiscalDate` per calendar year (matches Office exports). CSVs stay on the server and are gitignored.

### D. Reconcile against a manual export

```powershell
py -3 scripts/reconcile_pull.py --pulled data/2026.csv --reference path\to\manual_2026.csv
```

**PASS** = same row keys and fields. Fix mapping in `config/enum_map.json` if not.

### E. Run ETL locally

```powershell
py -3 scripts/export_dashboards.py
py -3 scripts/generate_specialty_cocktails_json.py
```

### E2. Compare generated JSON against what is already published

```powershell
py -3 scripts/compare_json.py --published path\to\snapshot\of\public\data
```

Every difference should be explainable before you push. Expected results:

- **Differing, timestamp only** — files carrying a `generatedAt` field.
- **Differing, tie ordering** — `intraday/voids/*` may order rows that share a date, slot and item differently. Same content.
- **Anything else** — investigate before pushing.

`bowling_forecast.json` is computed in-process by the ETL (level + seasonal blend from POS CSVs). `holiday_analysis.json` needs `scripts/holiday_analysis.py` plus the `holidays` package.

### E3. 7shifts labor and employee merge

```powershell
py -3 scripts/pull_7shifts_labor.py
py -3 scripts/build_employees.py
```

`pull_7shifts_labor.py` writes `labor.json`, `labor_intraday.json` and `_employees_labor.json`. `build_employees.py` then merges `_employees_pos.json` (from the ETL) with `_employees_labor.json` to produce `employees.json`, so it must run **after** the ETL.

**Check `source=` in the output.** The pull prefers the 7shifts *Daily Sales & Labor* report. If that endpoint returns 403 or 404 the script **silently falls back** to estimating cost from time punches, and still exits 0. `run_nightly.ps1` logs `Labor source=report` on the good path and a loud `WARN` otherwise.

> **The `MISMATCH` line on 2026-06-17 is expected.** The script self-checks that date against a hardcoded $2,829 recorded from the 7shifts website, but the report returns $2,912.98, so it prints `MISMATCH` on every run. Since `source=report` means the figure is 7shifts' own, the hardcoded target is treated as stale. Do not chase this.

Anyone showing sales but zero hours needs a line in `config/employee_map.txt`.

### F. End-to-end rehearsal (no push)

```powershell
powershell -ExecutionPolicy Bypass -File run_nightly.ps1 -SkipPush
```

The job **pulls first**. A dirty tree or a failed pull aborts the whole run so yesterday's published JSON stays put.

`tests/test_git_push.ps1` covers a clean push, a remote-ahead rebase, a genuine conflict, the upfront pull, and a dirty-tree abort:

```powershell
powershell -ExecutionPolicy Bypass -File tests\test_git_push.ps1
```

### G. Register scheduled task

```powershell
powershell -ExecutionPolicy Bypass -File register_task.ps1
```

Default: daily **5:30 AM** (after the 4 AM business-day cutoff).
Logs: `logs/nightly_YYYYMMDD_HHMMSS.log`

Do **not** move this to 5:00 AM. SYNCSERVER reboots every morning between 05:00:01 and 05:00:49, and a run starting at 05:00 is killed mid-flight — it shows up as `LastTaskResult 267014` (`SCHED_S_TASK_TERMINATED`) and a truncated log of 100-200 bytes instead of the usual ~760. SQL Server is back and accepting connections by about 05:02.

---

## Nightly behavior

1. `git pull --rebase` (aborts if the tree is dirty or the pull fails)
2. Refresh the current-year POS CSV (`--nightly`; in January, also the prior year)
3. ETL + specialty cocktails JSON + 7shifts labor + employee merge
4. Fail if anything outside `public/data` changed
5. `git add public/data`, commit `chore(data): nightly refresh YYYY-MM-DD`, rebase onto `origin/main` if needed, push

Netlify builds with `npm run build` only. It never runs Python.

| Mode | What it exports |
|------|-----------------|
| `--nightly` (scheduled) | Current fiscal year CSV, full re-export. In **January**, also re-exports the prior year. |
| `--bulk` (one-time) | All years from `START_DATE` through current year |
| `--year 2026` | Single year |

---

## Data

CSV files are **not committed**. On the server they live in `data/`:

```
data/
├── 2023.csv
├── 2024.csv
├── 2025.csv
├── 2026.csv
└── ...
```

**Business day:** sales before 4:00 AM roll to the previous calendar day.

**Modifiers:** modifier revenue is rolled into parent product totals (no double-counting).

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
| `public/data/labor.json` | Daily labor cost and hours from 7shifts |

---

## Project structure

```
├── app/                  # Next.js 15 dashboard (App Router)
├── config/               # Category overrides, enum map, cocktail list, employee map
├── data/                 # POS CSV exports (gitignored, server-local)
├── logs/                 # Nightly run logs (gitignored)
├── public/data/          # Generated JSON (committed, what Netlify serves)
├── scripts/              # Python ETL, journal pull, 7shifts, analysis
├── tests/                # Push/rebase/pull fixtures
├── run_nightly.ps1       # Orchestrator
├── register_task.ps1     # Task Scheduler setup
└── netlify/functions/    # Serverless chat (optional)
```

## Stack

- **Frontend:** Next.js 15, React 19, Tailwind CSS, Recharts
- **ETL / nightly:** Python 3, PowerShell, Git
- **Deploy:** Static export to Netlify (`npm run build`)

## Scripts

### Dashboard ETL

```bash
npm run etl
```

### Other Python scripts

```bash
python scripts/pull_journal.py --nightly
python scripts/export_clean_csv.py
python scripts/forecast_food_sales.py
python scripts/forecast_bar_sales.py
python scripts/build_dashboard.py        # needs matplotlib
python scripts/build_bar_dashboard.py    # needs matplotlib
python scripts/reconcile_day.py
python scripts/reconcile_month.py
```

### npm scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run etl` | Run full ETL pipeline |
| `npm run labor` | Pull 7shifts labor into `public/data/labor.json` |
| `npm run specialty` | Regenerate specialty cocktails JSON |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `SQL_PASSWORD is not set` | Create `.env` from `.env.example` |
| `No ODBC driver found` | Install ODBC Driver 18 for SQL Server |
| Certificate / SSL error | Already handled in `db.py`; also trust cert in SSMS |
| `Unmapped ItemType code` | Run `derive_enums.py` or update `config/enum_map.json` |
| Reconcile fails on Ended/Shift columns | DB column mapping may need tweak — check `pull_journal.py` |
| `git push` auth fails | Re-enter PAT via Credential Manager; confirm token not expired |
| `working tree is dirty` | Someone edited files on the server. Commit/stash/reset, or copy the edit to the workstation and push from there |
| `git pull --rebase ... failed` | Conflict or network. Yesterday's JSON is still published. Resolve by hand, then rerun |
| `changes outside public/data` | A script or a hand-edit touched source. The nightly will not sweep that into the data commit |
| `rebase ... conflicted and was aborted` | Front-end work and the nightly both changed the same file under `public/data`. Ordinary front-end commits are absorbed; a conflict means published JSON was hand-edited |
| `FAIL: missing SEVENSHIFTS_TOKEN` | Variable absent from `.env` |
| `FAIL: 401 Unauthorized` | 7shifts token expired or revoked — regenerate in 7shifts admin |
| `Missing dependency` on `requests` | `py -3 -m pip install -r requirements.txt` |
| `WARN: 7shifts labor pull failed` | Working as designed: POS data still published and the previous labor JSON ships |
| `WARN: labor source is 'punches_estimated'` | 7shifts plan no longer exposes the Daily Sales & Labor report |
| `WARN: labor.json has only N days` | `SEVENSHIFTS_PULL_DAYS` was lowered; publishing was refused to protect history |
| Employee shows sales but zero hours | Missing or wrong line in `config/employee_map.txt` |
| Labor JSON reverts every morning | Something other than this server is also writing `public/data` |

### Check earliest data in DB

```sql
USE SyncJournal;
SELECT MIN(TransactionFiscalDate), MAX(TransactionFiscalDate), COUNT(*) FROM dbo.TRNJournalLogs;
```

To include 2022 bowling-only history, set `START_DATE=2022-01-01` in `.env` and run `--bulk` again.

---

## Safety

- Uses **read-only** SQL login only (`concourse_readonly` / `db_datareader`)
- Queries use `WITH (NOLOCK)` — no write locks on live POS tables
- Run after close (5:30 AM default, after the SYNCSERVER reboot window)
- Manual Office export remains a fallback: drop CSVs in `data/` and run ETL manually
- Reconcile before trusting automation
