# 'Continue' because the git plumbing used to build the fixtures writes routine
# notices to stderr, which a 'Stop' preference would treat as fatal.
$ErrorActionPreference = 'Continue'

# Pull the real functions out of run_nightly.ps1 so this exercises the shipped
# code rather than a copy that could drift.
$Src = Join-Path (Split-Path -Parent (Split-Path -Parent $PSCommandPath)) 'run_nightly.ps1'
if (-not (Test-Path $Src)) { throw "run_nightly.ps1 not found at $Src" }
$Ast = [System.Management.Automation.Language.Parser]::ParseFile($Src, [ref]$null, [ref]$null)

# FindAll's scriptblock must run at script scope: inside a function, $args is
# that function's arguments, not the AST node.
$PushFn = $Ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                         $args[0].Name -eq 'Invoke-GitPush' }, $true)
$PullFn = $Ast.FindAll({ $args[0] -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
                         $args[0].Name -eq 'Invoke-GitPull' }, $true)
if (-not $PushFn) { throw 'Invoke-GitPush not found' }
if (-not $PullFn) { throw 'Invoke-GitPull not found' }
. ([scriptblock]::Create($PushFn[0].Extent.Text))
. ([scriptblock]::Create($PullFn[0].Extent.Text))

function Write-Log($Message) { Write-Host "    [log] $Message" }

# run_nightly.ps1 calls this with $ErrorActionPreference = 'Stop' in effect.
# Reproduce that, otherwise the test cannot catch git's stderr chatter being
# promoted to a terminating error.
function Invoke-UnderProductionPrefs {
    $ErrorActionPreference = 'Stop'
    Invoke-GitPush
}

function Invoke-PullUnderProductionPrefs {
    $ErrorActionPreference = 'Stop'
    Invoke-GitPull
}

function New-Scenario($Name) {
    $Base = Join-Path $env:TEMP "gp_$Name"
    if (Test-Path $Base) { Remove-Item $Base -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $Base | Out-Null

    # bare "origin" plus two clones: the server, and the front-end dev's machine.
    # HEAD is pinned to main because this host's git still defaults to master.
    git init --bare -q (Join-Path $Base 'origin.git')
    git --git-dir (Join-Path $Base 'origin.git') symbolic-ref HEAD refs/heads/main
    git clone -q (Join-Path $Base 'origin.git') (Join-Path $Base 'server') 2>&1 | Out-Null
    Push-Location (Join-Path $Base 'server')
    git config user.email t@t; git config user.name t
    git checkout -q -b main 2>&1 | Out-Null
    New-Item -ItemType Directory -Force -Path 'public\data' | Out-Null
    'seed' | Set-Content 'public\data\summary.json'
    'seed' | Set-Content 'app.tsx'
    git add -A; git commit -qm seed; git push -q origin main 2>&1 | Out-Null
    Pop-Location
    git clone -q (Join-Path $Base 'origin.git') (Join-Path $Base 'dev') 2>&1 | Out-Null
    Push-Location (Join-Path $Base 'dev'); git config user.email d@d; git config user.name d; Pop-Location
    return $Base
}

# ---------------------------------------------------------------- scenario 1
# Exactly last night: dev pushed front-end commits, server has a data commit.
Write-Host "`n=== 1. remote ahead, no overlapping files (last night's case) ==="
$Base = New-Scenario 's1'
Push-Location (Join-Path $Base 'dev')
'devwork' | Set-Content 'app.tsx'; git add -A; git commit -qm 'front-end fix'; git push -q origin main 2>&1 | Out-Null
Pop-Location
Push-Location (Join-Path $Base 'server')
'fresh-data' | Set-Content 'public\data\summary.json'; git add -A; git commit -qm 'chore(data): nightly refresh'
try {
    Invoke-UnderProductionPrefs
    $Local = git rev-parse HEAD; $Remote = git rev-parse 'origin/main'
    if ($Local -eq $Remote) { Write-Host "  PASS - pushed, local and remote match" } else { Write-Host "  FAIL - refs differ" }
    if ((Get-Content 'app.tsx') -eq 'devwork') { Write-Host "  PASS - dev's front-end work preserved" } else { Write-Host "  FAIL - dev work lost" }
    if ((Get-Content 'public\data\summary.json') -eq 'fresh-data') { Write-Host "  PASS - fresh data preserved" } else { Write-Host "  FAIL - data lost" }
    Write-Host "  history: $((git log --format='%s' | ForEach-Object { $_ }) -join ' | ')"
}
catch { Write-Host "  FAIL - threw: $($_.Exception.Message)" }
Pop-Location

# ---------------------------------------------------------------- scenario 2
# Already in sync: must still push normally.
Write-Host "`n=== 2. remote NOT ahead (normal night) ==="
$Base = New-Scenario 's2'
Push-Location (Join-Path $Base 'server')
'fresh-data' | Set-Content 'public\data\summary.json'; git add -A; git commit -qm 'chore(data): nightly refresh'
try {
    Invoke-UnderProductionPrefs
    if ((git rev-parse HEAD) -eq (git rev-parse 'origin/main')) { Write-Host "  PASS - pushed cleanly" } else { Write-Host "  FAIL" }
}
catch { Write-Host "  FAIL - threw: $($_.Exception.Message)" }
Pop-Location

# ---------------------------------------------------------------- scenario 3
# Genuine conflict: both sides edited the same data file. Must abort, leave the
# tree clean and the commit intact, and fail loudly.
Write-Host "`n=== 3. true conflict on public/data (must abort cleanly) ==="
$Base = New-Scenario 's3'
Push-Location (Join-Path $Base 'dev')
'hand-edited' | Set-Content 'public\data\summary.json'; git add -A; git commit -qm 'hand edit'; git push -q origin main 2>&1 | Out-Null
Pop-Location
Push-Location (Join-Path $Base 'server')
'fresh-data' | Set-Content 'public\data\summary.json'; git add -A; git commit -qm 'chore(data): nightly refresh'
$Before = git rev-parse HEAD
try {
    Invoke-UnderProductionPrefs
    Write-Host "  FAIL - should have thrown"
}
catch {
    Write-Host "  PASS - threw as designed"
    if (-not (git status --porcelain)) { Write-Host "  PASS - working tree left clean (no half-rebase)" } else { Write-Host "  FAIL - tree dirty:"; git status --porcelain }
    if (Test-Path (Join-Path (git rev-parse --git-dir) 'rebase-merge')) { Write-Host "  FAIL - rebase still in progress" } else { Write-Host "  PASS - no rebase in progress" }
    if ((git rev-parse HEAD) -eq $Before) { Write-Host "  PASS - data commit still intact" } else { Write-Host "  FAIL - commit lost" }
}
Pop-Location

# ---------------------------------------------------------------- scenario 4
# Upfront pull: remote is ahead with a config change. The server must pick it
# up BEFORE the ETL would run (i.e. after Invoke-GitPull, the file is current).
Write-Host "`n=== 4. upfront pull picks up remote work before ETL ==="
$Base = New-Scenario 's4'
Push-Location (Join-Path $Base 'dev')
'summer-menu' | Set-Content 'app.tsx'; git add -A; git commit -qm 'config change'; git push -q origin main 2>&1 | Out-Null
Pop-Location
Push-Location (Join-Path $Base 'server')
if ((Get-Content 'app.tsx') -eq 'seed') { Write-Host "  PASS - server still on old file before pull" } else { Write-Host "  FAIL - fixture not at seed" }
try {
    Invoke-PullUnderProductionPrefs
    if ((Get-Content 'app.tsx') -eq 'summer-menu') { Write-Host "  PASS - pull brought in the config change" } else { Write-Host "  FAIL - file still stale" }
    if ((git rev-parse HEAD) -eq (git rev-parse 'origin/main')) { Write-Host "  PASS - local matches origin after pull" } else { Write-Host "  FAIL - refs differ after pull" }
}
catch { Write-Host "  FAIL - threw: $($_.Exception.Message)" }
Pop-Location

# ---------------------------------------------------------------- scenario 5
# Dirty tree must abort the pull, leaving the uncommitted edit intact.
Write-Host "`n=== 5. dirty tree aborts the pull ==="
$Base = New-Scenario 's5'
Push-Location (Join-Path $Base 'dev')
'remote-work' | Set-Content 'app.tsx'; git add -A; git commit -qm 'remote work'; git push -q origin main 2>&1 | Out-Null
Pop-Location
Push-Location (Join-Path $Base 'server')
'local-hand-edit' | Set-Content 'app.tsx'
$Before = git rev-parse HEAD
try {
    Invoke-PullUnderProductionPrefs
    Write-Host "  FAIL - should have thrown"
}
catch {
    Write-Host "  PASS - threw as designed"
    if ((Get-Content 'app.tsx') -eq 'local-hand-edit') { Write-Host "  PASS - local edit left intact" } else { Write-Host "  FAIL - local edit lost" }
    if ((git rev-parse HEAD) -eq $Before) { Write-Host "  PASS - HEAD unchanged" } else { Write-Host "  FAIL - HEAD moved" }
    if ((Get-Content 'app.tsx') -ne 'remote-work') { Write-Host "  PASS - remote work was not mixed in" } else { Write-Host "  FAIL - remote mixed into dirty tree" }
}
Pop-Location

Write-Host "`n=== cleanup ==="
'gp_s1','gp_s2','gp_s3','gp_s4','gp_s5' | ForEach-Object { $p = Join-Path $env:TEMP $_; if (Test-Path $p) { Remove-Item $p -Recurse -Force } }
Write-Host "done"
