# register_task.ps1
# One-time setup: register the nightly pipeline in Windows Task Scheduler.
#
# Usage (run as a user with permission to create scheduled tasks):
#   powershell -ExecutionPolicy Bypass -File register_task.ps1
#
# Default: daily at 5:30 AM (after the 4 AM business-day cutoff)
#
# Do NOT move this to 05:00. SYNCSERVER reboots every morning between 05:00:01
# and 05:00:49 (initiated by SYSTEM via WMI, presumably POS vendor maintenance).
# A run starting at 05:00 is killed mid-flight by that restart, which shows up
# as LastTaskResult 267014 (SCHED_S_TASK_TERMINATED) and a truncated log.
# SQL Server (SYNCDB) reports "ready for client connections" by ~05:02, so 05:30
# clears the restart with roughly 28 minutes of margin.

param(
    [string]$TaskName = 'Concourse Nightly Dashboard',
    [string]$RunTime = '05:30',
    [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptPath = Join-Path $Root 'run_nightly.ps1'

if (-not (Test-Path $ScriptPath)) {
    throw "run_nightly.ps1 not found at $ScriptPath"
}

$Action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $Root

$Trigger = New-ScheduledTaskTrigger -Daily -At $RunTime
# RestartCount/RestartInterval let a run that dies to an unexpected restart or a
# transient SQL outage retry itself instead of silently skipping the day.
# DontStopOnIdleEnd stops Task Scheduler killing the run if the console is used.
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 15) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

# The task must run at 5 AM with nobody logged on, and it must be able to read
# the GitHub token from Windows Credential Manager. That needs a real logon
# session, so Task Scheduler stores the account password. An Interactive
# principal would never fire unattended, and S4U (no stored password) cannot
# decrypt the DPAPI-protected credential, so the push step would fail.
$Cred = Get-Credential -UserName $UserId -Message `
    "Windows password for $UserId (stored by Task Scheduler so the nightly run works while logged off)"
if (-not $Cred) {
    throw 'Registration cancelled: no credentials supplied.'
}

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -User $Cred.UserName `
        -Password $Cred.GetNetworkCredential().Password `
        -RunLevel Limited `
        -Force | Out-Null
}
finally {
    $Cred = $null
    [System.GC]::Collect()
}

$Registered = Get-ScheduledTask -TaskName $TaskName
Write-Host "Registered scheduled task: $TaskName"
Write-Host "  Runs daily at $RunTime"
Write-Host "  Account:   $($Registered.Principal.UserId)"
Write-Host "  LogonType: $($Registered.Principal.LogonType)  (must be 'Password' to run while logged off)"
Write-Host "  Script:    $ScriptPath"
Write-Host ''
Write-Host 'Verify it runs end to end without a logged-on session:'
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'   # LastTaskResult 0 = success"
Write-Host ''
Write-Host 'Logs: logs\nightly_YYYYMMDD_HHMMSS.log'
