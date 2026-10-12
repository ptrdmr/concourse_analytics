# run_lane_chart.ps1
# Posts the POS lane book to the leads site. Does not touch git.
#
# The date span is the script default: 2026-07-10 through 2028-09-30 inclusive.
# Each post replaces that whole book on the leads site.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File run_lane_chart.ps1
#
# Scheduled every 10 minutes by register_lane_task.ps1.
# The 05:30 nightly still posts once, as a backup.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSCommandPath
Set-Location $Root

$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir ("lane_chart_{0:yyyyMMdd}.log" -f (Get-Date))

# Continue so a Python stderr line is captured instead of becoming a terminating
# error. The process exit code is what Task Scheduler records.
$ErrorActionPreference = 'Continue'
$Output = & py -3 scripts/push_lane_chart.py 2>&1
$Code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($null -eq $Code) { $Code = 1 }

$Lines = @()
foreach ($Item in @($Output)) {
    if ($Item -is [System.Management.Automation.ErrorRecord]) {
        if ($null -ne $Item.TargetObject -and "$($Item.TargetObject)".Trim()) {
            $Lines += "$($Item.TargetObject)".TrimEnd()
        }
        else {
            $Lines += "$($Item.Exception.Message)".TrimEnd()
        }
    }
    else {
        $Text = "$Item".TrimEnd()
        if ($Text) { $Lines += $Text }
    }
}
if (-not $Lines) {
    $Lines = @("POS lane book: no output (exit $Code)")
}

$Stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
foreach ($Line in $Lines) {
    $Recorded = "[$Stamp] $Line"
    Add-Content -Path $LogFile -Value $Recorded
    Write-Host $Recorded
}

exit $Code
