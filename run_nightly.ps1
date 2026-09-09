# run_nightly.ps1
# Orchestrates: git pull -> DB pull -> ETL -> specialty JSON -> 7shifts labor
#               -> employee merge -> git add public/data -> commit -> push
#
# Runs from the concourse_analytics clone. The ETL writes JSON in place under
# public/data; there is no second repo and no copy step.
#
# Usage (manual test):
#   powershell -ExecutionPolicy Bypass -File run_nightly.ps1
#
# Rehearsal (everything except commit and push; leaves changes staged for review):
#   powershell -ExecutionPolicy Bypass -File run_nightly.ps1 -SkipPush
#
# Prerequisites:
#   - .env configured (SQL_PASSWORD, SEVENSHIFTS_TOKEN,
#     SEVENSHIFTS_COMPANY_ID, SEVENSHIFTS_PULL_DAYS=365)
#   - Python + requirements installed
#   - Git credentials stored (fine-grained PAT on first push)
#   - Working tree clean (a dirty tree aborts - edit on the workstation and push)

param(
    [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath
Set-Location $Root

$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir ("nightly_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))

# Written by pull_7shifts_labor.py. Snapshotted before the pull and restored if it
# produces nothing usable. Kept outside public\data so a failed labor pull cannot
# be committed.
$LaborFiles = @('labor.json', 'labor_intraday.json', '_employees_labor.json')
$LaborSnapshot = Join-Path $Root '.labor_snapshot'

function Write-Log($Message) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Message
    Add-Content -Path $LogFile -Value $line
    Write-Host $line
}

function Invoke-Step($Label, $Command) {
    Write-Log "START: $Label"
    Invoke-Expression $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
    Write-Log "DONE: $Label"
}

# Non-fatal variant: a 7shifts outage or expired token must not block the POS
# refresh. On failure the previous run's labor JSON stays in place and ships.
function Invoke-OptionalStep($Label, $Command) {
    Write-Log "START: $Label"
    try {
        # Out-Host keeps the child script's stdout off the pipeline so the caller
        # receives only the boolean below, not the captured output.
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

# Porcelain path is bytes 4..end. Rename lines look like "R  old -> new".
function Get-PorcelainPath([string]$Line) {
    $Path = $Line.Substring(3).Trim('"')
    if ($Path -match ' -> ') {
        $Path = ($Path -split ' -> ')[-1].Trim('"')
    }
    return ($Path -replace '\\', '/')
}

function Test-PathUnderPublicData([string]$RelPath) {
    return ($RelPath -eq 'public/data' -or $RelPath.StartsWith('public/data/'))
}

# Workstation changes must be in place before the ETL reads config/ or scripts/.
# Abort rather than publish from a half-updated checkout: a skipped night is
# recoverable, a night of wrong numbers is not.
function Invoke-GitPull {
    Write-Log 'START: Git pull'

    $ErrorActionPreference = 'Continue'

    function Invoke-Git([string[]]$GitArgs) {
        $Output = & git @GitArgs 2>&1
        $Code = $LASTEXITCODE
        foreach ($Line in $Output) {
            if ("$Line".Trim()) { Write-Log "  git: $Line" }
        }
        return $Code
    }

    $Branch = & git rev-parse --abbrev-ref HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $Branch) { throw 'could not determine the current branch' }

    $Dirty = & git status --porcelain 2>$null
    if ($Dirty) {
        throw ("working tree is dirty. The nightly aborts rather than " +
               "publish from a mixed checkout. Edit on the workstation, push, " +
               "and let this job pull. Do not hand-edit files on the server.")
    }

    if ((Invoke-Git @('pull', '--rebase', 'origin', $Branch)) -ne 0) {
        Invoke-Git @('rebase', '--abort') | Out-Null
        throw ("git pull --rebase origin/$Branch failed - see the git output above. " +
               "The run was aborted so yesterday's published JSON stays in place.")
    }
    Write-Log "DONE: Git pull (origin/$Branch)"
}

# The dashboard front-end is developed on another machine and pushed to the same
# branch, so the remote is often ahead by the time this runs. A bare push is then
# rejected as non-fast-forward, which strands the data commit in this clone and
# leaves the published dashboard stale until someone notices. Rebase onto the
# remote first.
#
# Our commits only ever touch public/data and front-end work never does, so the
# replay is normally trivial. A conflict means published JSON was hand-edited,
# which needs a human: abort so the tree is left clean, and fail loudly with the
# data commit still intact and replayable.
function Invoke-GitPush {
    Write-Log 'START: Git push'

    # git reports progress and push summaries on stderr, so folding stderr into
    # the captured output would raise error records that the script-level 'Stop'
    # preference turns fatal. Capturing into a variable and checking exit codes
    # explicitly avoids that, and puts git's own words in the log: last night's
    # failure recorded only "exit code 1", so the actual reason had to be
    # rediscovered by hand. The assignment is function-scoped.
    $ErrorActionPreference = 'Continue'

    function Invoke-Git([string[]]$GitArgs) {
        $Output = & git @GitArgs 2>&1
        $Code = $LASTEXITCODE
        foreach ($Line in $Output) {
            if ("$Line".Trim()) { Write-Log "  git: $Line" }
        }
        return $Code
    }

    $Branch = & git rev-parse --abbrev-ref HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $Branch) { throw 'could not determine the current branch' }

    # Two attempts, because a push can also lose a race against a commit landing
    # between our fetch and our push.
    for ($Attempt = 1; $Attempt -le 2; $Attempt++) {
        if ((Invoke-Git @('fetch', 'origin')) -ne 0) {
            throw 'git fetch failed - see the git output above'
        }

        $Behind = [int](& git rev-list --count "HEAD..origin/$Branch" 2>$null)
        if ($Behind -gt 0) {
            Write-Log "Remote is $Behind commit(s) ahead - rebasing the data commit onto origin/$Branch"
            if ((Invoke-Git @('rebase', "origin/$Branch")) -ne 0) {
                Invoke-Git @('rebase', '--abort') | Out-Null
                throw ("rebase onto origin/$Branch conflicted and was aborted. The data " +
                       "commit is intact but unpushed - published JSON was most likely " +
                       "hand-edited on the remote. Resolve by hand.")
            }
            Write-Log "Rebased onto origin/$Branch"
        }

        if ((Invoke-Git @('push', 'origin', $Branch)) -eq 0) {
            Write-Log 'DONE: Git push'
            return
        }
        Write-Log "WARN: push attempt $Attempt of 2 failed"
    }
    throw 'git push failed on both attempts - see the git output above'
}

# pull_7shifts_labor.py exits 0 even when it silently falls back to estimating
# labor from time punches, and even when its own reconciliation check fails, so
# the exit code alone proves nothing about the numbers. It also writes its three
# JSON files in place rather than atomically, so an interrupted run can leave
# truncated output. Validate before any of it reaches the dashboard.
function Test-LaborOutput {
    foreach ($Name in $LaborFiles) {
        $Path = Join-Path $Root "public\data\$Name"
        if (-not (Test-Path $Path)) {
            Write-Log "WARN: $Name missing after labor pull"
            return $false
        }
        try {
            $Json = Get-Content $Path -Raw | ConvertFrom-Json
        }
        catch {
            Write-Log "WARN: $Name is not valid JSON (partial write?)"
            return $false
        }

        if ($Name -eq 'labor.json') {
            if (-not $Json.days) {
                Write-Log 'WARN: labor.json has no days'
                return $false
            }
            $DayCount = @($Json.days.PSObject.Properties).Count
            # SEVENSHIFTS_PULL_DAYS is 365 and labor.json is rewritten in full each
            # run, so a short file means history is about to be truncated.
            if ($DayCount -lt 300) {
                Write-Log "WARN: labor.json has only $DayCount days, expected ~365 - refusing to publish"
                return $false
            }
            if ($Json.source -ne 'report') {
                Write-Log "WARN: labor source is '$($Json.source)', not 'report' - figures are ESTIMATES, not 7shifts actuals"
            }
            else {
                Write-Log "Labor source=report, $DayCount days"
            }
        }

        if ($Name -eq '_employees_labor.json' -and -not $Json.users) {
            Write-Log "WARN: _employees_labor.json has no users - employee merge would produce an empty roster"
            return $false
        }
    }
    return $true
}

try {
    Write-Log "=== Nightly pipeline start ==="

    Invoke-GitPull

    $Python = 'python'
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $Python = 'py -3'
    }

    Invoke-Step 'Journal pull (nightly)' "$Python scripts/pull_journal.py --nightly"

    # The ETL reads every CSV in data/ and does not dedupe adjustments/refunds
    # across files, so an overlapping export silently multiplies deductions.
    # Only one file per fiscal year may be present.
    $StrayCsv = Get-ChildItem (Join-Path $Root 'data') -Filter '*.csv' -File |
        Where-Object { $_.Name -notmatch '^\d{4}\.csv$' }
    if ($StrayCsv) {
        throw ("Unexpected CSV(s) in data/: {0}. Only YYYY.csv files may be present, " +
               "otherwise adjustments and refunds are double-counted." -f ($StrayCsv.Name -join ', '))
    }

    Invoke-Step 'Dashboard ETL' "$Python scripts/export_dashboards.py"
    Invoke-Step 'Specialty cocktails JSON' "$Python scripts/generate_specialty_cocktails_json.py"

    # 7shifts labor. Runs after the ETL because build_employees.py merges
    # _employees_pos.json (ETL output) with _employees_labor.json (7shifts output).
    # Both steps are non-fatal: a third-party outage must not stop the POS refresh.
    New-Item -ItemType Directory -Force -Path $LaborSnapshot | Out-Null
    foreach ($Name in $LaborFiles) {
        $Existing = Join-Path $Root "public\data\$Name"
        if (Test-Path $Existing) {
            Copy-Item $Existing (Join-Path $LaborSnapshot $Name) -Force
        }
    }

    $LaborOk = Invoke-OptionalStep '7shifts labor pull' "$Python scripts/pull_7shifts_labor.py"
    if ($LaborOk) {
        $LaborOk = Test-LaborOutput
    }

    if ($LaborOk) {
        Invoke-OptionalStep 'Employee merge' "$Python scripts/build_employees.py" | Out-Null
    }
    else {
        Write-Log 'SKIP: Employee merge - labor pull did not produce usable output'
        foreach ($Name in $LaborFiles) {
            $Backup = Join-Path $LaborSnapshot $Name
            if (Test-Path $Backup) {
                Copy-Item $Backup (Join-Path $Root "public\data\$Name") -Force
                Write-Log "RESTORED: $Name from previous run"
            }
        }
    }

    $Stray = git status --porcelain | Where-Object {
        -not (Test-PathUnderPublicData (Get-PorcelainPath $_))
    }
    if ($Stray) {
        $Files = ($Stray | ForEach-Object { Get-PorcelainPath $_ }) -join ', '
        throw ("changes outside public/data ($Files). The nightly only commits " +
               "generated JSON. Resolve by hand - a stray edit would otherwise " +
               "be swept into the data commit.")
    }

    Invoke-Step 'Git add' 'git add public/data'
    $Status = git status --porcelain public/data
    if (-not $Status) {
        Write-Log 'No JSON changes to commit - skipping push'
    } elseif ($SkipPush) {
        $Changed = ($Status | Measure-Object).Count
        Write-Log "SkipPush: $Changed changed file(s) staged, not committed or pushed"
    } else {
        $DateStamp = Get-Date -Format 'yyyy-MM-dd'
        Invoke-Step 'Git commit' "git commit -m `"chore(data): nightly refresh $DateStamp`""
        Invoke-GitPush
    }

    Write-Log '=== Nightly pipeline complete ==='
    exit 0
}
catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
