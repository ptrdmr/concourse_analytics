# Handoff: Monday Verdict data exports on SYNCSERVER

**Audience:** the agent working on SYNCSERVER, which owns the live
`server_pipeline/` bundle and the registered Task Scheduler job.

**Goal:** after the existing dashboard ETL runs, also generate two small JSON
files the Overview page needs for "vs forecast" KPIs and the daypart bleed
list. Frontend code is already merged and hides those sections until the
files exist.

**Prepared from:** the dashboard repo checkout (dev machine).

---

## 1. What you are given

```
handoff_monday_verdict/
├── README.md                              <- this file
└── files/
    └── scripts/export_verdict_data.py     <- copy this exactly
```

Copy into the live bundle:

| Source in this folder | Destination on SYNCSERVER |
|---|---|
| `files/scripts/export_verdict_data.py` | `<bundle>/scripts/export_verdict_data.py` |

`<bundle>` is wherever `run_nightly.ps1` lives, e.g. `C:\Concourse\server_pipeline`.

**Do not rewrite the script.** Copy it as-is.

**Do not modify** `export_dashboards.py`. This script is standalone. It only
imports `find_csv_files`, `business_day`, and `OUTPUT_DIR` from the existing
`export_dashboards` module (same folder).

---

## 2. What the script does

Reads the POS CSVs already present in `<bundle>/data/` (from the journal pull).

Writes **exactly two** new files into `<bundle>/public/data/`:

| File | Purpose |
|---|---|
| `verdict_forecast.json` | Per-department + house weekly revenue forecasts (level + seasonal blend, same model as bowling) |
| `daypart_baselines.json` | Day-of-week × daypart trailing medians for the bleed list |

- No network access.
- No new pip dependencies (Python stdlib only).
- Does not touch any existing JSON files.
- If a department has fewer than 20 weeks of history, it is skipped.
- Daypart "current week" is the last complete Monday–Sunday week in the CSV
  data (not calendar today), so laggy exports do not invent empty weeks.

---

## 3. The single edit to `run_nightly.ps1`

**The server's live `run_nightly.ps1` is the source of truth.** Diff against it.
Do **not** paste an entire replacement file over it. It may have drifted.

After the existing ETL step that runs `export_dashboards.py`, and **before**
the robocopy / copy-to-dashboard-repo step, add a **non-fatal** step using the
existing `Invoke-OptionalStep` helper (already defined in that file).

### Where to insert

Find the block that looks roughly like:

```powershell
Invoke-Step 'Dashboard ETL' "$Python scripts/export_dashboards.py"
Invoke-Step 'Specialty cocktails JSON' "$Python scripts/generate_specialty_cocktails_json.py"
```

After those (and after the 7shifts optional steps is also fine — either place
works as long as it is **before** robocopy), add:

```powershell
# Monday Verdict JSON (forecast + daypart baselines). Non-fatal: a failure
# must not block the POS refresh; yesterday's verdict JSON stays in place.
Invoke-OptionalStep 'Verdict data export' "$Python scripts\export_verdict_data.py" | Out-Null
```

### Why optional

Same reason as 7shifts: the nightly POS refresh must still ship if this
script fails. Previous run's `verdict_forecast.json` /
`daypart_baselines.json` remain until the next success.

---

## 4. Verification (do this before relying on the schedule)

### A. Copy the script

```powershell
cd C:\Concourse\server_pipeline
# after copying export_verdict_data.py into scripts\
dir scripts\export_verdict_data.py
```

### B. Run it manually

```powershell
py -3 scripts\export_verdict_data.py
```

Expect exit code 0 and lines like:

```
export_verdict_data: start
  CSV files: N
  Building per-department weekly forecasts...
  Food: ... actual weeks, ... forecast weeks
  Bar: ...
  Bowling: ...
  -> ...\public\data\verdict_forecast.json
  Building daypart baselines...
  -> ...\public\data\daypart_baselines.json (... rows, 0.xx MB)
export_verdict_data: done
```

### C. Check the outputs

```powershell
dir public\data\verdict_forecast.json
dir public\data\daypart_baselines.json
py -3 -c "import json; d=json.load(open('public/data/verdict_forecast.json')); print('house' in d, list(d['departments'])[:8])"
py -3 -c "import json,os; d=json.load(open('public/data/daypart_baselines.json')); print(len(d['rows']), round(os.path.getsize('public/data/daypart_baselines.json')/1e6,2),'MB')"
```

Checks that must pass:

1. `verdict_forecast.json` has a top-level `house` key and departments including
   at least Food, Bar, Bowling.
2. `daypart_baselines.json` exists and is **under 1 MB**.
3. Neither file is empty.

### D. One full nightly (manual)

```powershell
powershell -ExecutionPolicy Bypass -File run_nightly.ps1
```

Then confirm:

1. Log contains `DONE: Verdict data export` (or a WARN if it failed — should not).
2. The two files appear in the dashboard repo clone under `public/data/`.
3. Git commit on the dashboard clone includes them (or they were already identical).
4. After Netlify deploys, Overview shows:
   - Total Sales line like "about $XK under/over expected" or "in line with expected"
   - "Where it's leaking" bleed list (if any dayparts qualify)
   - Forward look line in the verdict when next-week forecast exists

If the files are missing on the site, the page still works — those sections stay hidden.

---

## 5. Rollback

1. Delete the one `Invoke-OptionalStep 'Verdict data export' ...` line from
   `run_nightly.ps1`.
2. Optionally delete:
   - `<bundle>/scripts/export_verdict_data.py`
   - `<bundle>/public/data/verdict_forecast.json`
   - `<bundle>/public/data/daypart_baselines.json`
3. Nothing else depends on these files. The Overview verdict block (item + labor
   findings) keeps working from existing `transactions.json` / `labor.json`.

---

## 6. Do not

- Do not edit `export_dashboards.py`.
- Do not add pip packages.
- Do not overwrite the entire `run_nightly.ps1` from the laptop copy.
- Do not commit secrets or `.env` changes for this handoff (none required).
