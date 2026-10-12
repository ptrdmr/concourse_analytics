# register_lane_task.ps1
# One-time setup: register the POS lane-book push in Windows Task Scheduler.
#
# Usage (run as a user with permission to create scheduled tasks):
#   powershell -ExecutionPolicy Bypass -File register_lane_task.ps1
#
# Runs every 10 minutes, all day. Separate from the 05:30 nightly so
# re-registering this task does not rewrite that job. The nightly still posts
# the book once, as a backup.
#
# The schedule is created with schtasks /Create /SC MINUTE /MO 10. That form
# repeats indefinitely. schtasks /Change cannot set /SC on this server, and a
# daily trigger with a one-day repetition window has been known to stop.

param(
    [string]$TaskName = 'Concourse Lane Chart',
    [string]$UserId = "$env:USERDOMAIN\$env:USERNAME"
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptPath = Join-Path $Root 'run_lane_chart.ps1'

if (-not (Test-Path $ScriptPath)) {
    throw "run_lane_chart.ps1 not found at $ScriptPath"
}

if ($ScriptPath -match '\s') {
    throw "run_lane_chart.ps1 path contains a space ($ScriptPath). schtasks would drop the quotes and split the command."
}

$Action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory $Root

# IgnoreNew: a run still going at the next 10-minute mark is left alone.
# Eight minutes is under the interval, so a hung SQL call cannot block the day.
# StartWhenAvailable covers the 05:00-05:02 reboot. schtasks itself leaves a
# 72-hour limit and StartWhenAvailable off, so these are applied after create.
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 8)

# Same reason as the nightly: the task must run with nobody logged on and be
# able to read .env. Task Scheduler stores the account password. The lane task
# does not need the GitHub credential.
$Cred = Get-Credential -UserName $UserId -Message `
    "Type the Windows password for $UserId in this window. A blank box does not count."
if (-not $Cred) {
    throw 'Registration cancelled: no credentials supplied.'
}
if (-not $Cred.GetNetworkCredential().Password) {
    throw 'The password box was left blank. Run this again and type the Windows password in the window. The later console prompt cannot finish the setup.'
}

try {
    # /Create /SC MINUTE is the indefinite trigger. /Change /SC is rejected here.
    # Continue: schtasks writes failures to stderr, and Stop would turn that
    # into a terminating error before the exit code is checked.
    $TaskRun = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`""
    $Password = $Cred.GetNetworkCredential().Password
    $ErrorActionPreference = 'Continue'
    & schtasks.exe /Create /TN $TaskName /TR $TaskRun /SC MINUTE /MO 10 /RU $Cred.UserName /RP $Password /RL LIMITED /F
    $CreateCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($CreateCode -ne 0) {
        throw "schtasks /Create failed with exit code $CreateCode"
    }

    # Keep the minute trigger. Replace the action (working directory) and the
    # settings schtasks does not offer.
    Set-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Settings $Settings `
        -User $Cred.UserName `
        -Password $Password | Out-Null

    $Registered = Get-ScheduledTask -TaskName $TaskName
    $Repetition = $Registered.Triggers[0].Repetition
    $Duration = "$($Repetition.Duration)"
    if ($Repetition.Interval -ne 'PT10M' -or ($Duration -and $Duration -ne 'PT0S')) {
        throw ("Lane task schedule is interval '$($Repetition.Interval)' duration '$Duration'. " +
               "Expected an indefinite PT10M repetition.")
    }
    if ($Registered.Principal.LogonType -ne 'Password') {
        throw "LogonType is $($Registered.Principal.LogonType); expected Password so the task runs while logged off."
    }
    if ($Registered.Settings.MultipleInstances -ne 'IgnoreNew') {
        throw "MultipleInstances is $($Registered.Settings.MultipleInstances); expected IgnoreNew."
    }
    if (-not $Registered.Settings.StartWhenAvailable) {
        throw 'StartWhenAvailable is off; a run missed during the 05:00 reboot would be skipped.'
    }
    $Limit = $Registered.Settings.ExecutionTimeLimit
    $LimitOk = ($Limit -is [TimeSpan] -and $Limit -eq (New-TimeSpan -Minutes 8)) -or ("$Limit" -eq 'PT8M')
    if (-not $LimitOk) {
        throw "ExecutionTimeLimit is '$Limit'; expected 8 minutes."
    }
}
finally {
    $Password = $null
    $Cred = $null
    [System.GC]::Collect()
}

Write-Host "Registered scheduled task: $TaskName"
Write-Host "  Runs every 10 minutes"
Write-Host "  Account:   $($Registered.Principal.UserId)"
Write-Host "  LogonType: $($Registered.Principal.LogonType)  (must be 'Password' to run while logged off)"
Write-Host "  Script:    $ScriptPath"
Write-Host ''
Write-Host 'Verify one post without waiting for the next interval:'
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$TaskName'   # LastTaskResult 0 = success"
Write-Host ''
Write-Host 'Logs: logs\lane_chart_YYYYMMDD.log'
