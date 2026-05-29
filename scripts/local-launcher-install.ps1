param(
  [Parameter(Mandatory = $true)]
  [string]$ControlPlaneUrl
)

$ErrorActionPreference = "Stop"

function Normalize-ControlPlaneOrigin {
  param([string]$Value)
  $uri = [System.Uri]::new($Value)
  if ($uri.Scheme -ne "http" -and $uri.Scheme -ne "https") {
    throw "ControlPlaneUrl must be http or https."
  }
  return $uri.GetLeftPart([System.UriPartial]::Authority)
}

$controlPlaneOrigin = Normalize-ControlPlaneOrigin -Value $ControlPlaneUrl
$localAppData = [Environment]::GetFolderPath("LocalApplicationData")
$root = Join-Path $localAppData "CodexMissionControl"
$launcherRoot = Join-Path $root "launcher"
$logRoot = Join-Path $root "logs"
$launcherPath = Join-Path $launcherRoot "local-launcher.mjs"
$configPath = Join-Path $launcherRoot "launcher-config.json"
$taskName = "CodexMissionControlLocalLauncher"
$startupLink = Join-Path ([Environment]::GetFolderPath("Startup")) "Codex Mission Control Local Launcher.lnk"

function Start-Launcher {
  param(
    [string]$NodePath,
    [string]$LauncherScript,
    [string]$WorkingDirectory
  )

  Start-Process `
    -FilePath $NodePath `
    -ArgumentList "`"$LauncherScript`"" `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle Hidden
}

function Stop-ExistingLauncher {
  param([string]$LauncherScript)

  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$LauncherScript*" } |
    ForEach-Object {
      try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      } catch {
        Write-Warning "Unable to stop existing launcher process $($_.ProcessId). $($_.Exception.Message)"
      }
    }
}

function Install-StartupShortcut {
  param(
    [string]$NodePath,
    [string]$LauncherScript,
    [string]$WorkingDirectory,
    [string]$ShortcutPath
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $NodePath
  $shortcut.Arguments = "`"$LauncherScript`""
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.WindowStyle = 7
  $shortcut.Description = "Codex Mission Control Local Launcher"
  $shortcut.Save()
}

New-Item -ItemType Directory -Force -Path $launcherRoot | Out-Null
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$nodeCommand = Get-Command node -ErrorAction Stop
$files = @("local-launcher.mjs", "local-launcher-utils.mjs")
foreach ($file in $files) {
  $url = "$controlPlaneOrigin/api/workers/bootstrap?file=$file"
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile (Join-Path $launcherRoot $file)
}

$config = @{
  allowedOrigins = @($controlPlaneOrigin)
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json -Depth 4
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($configPath, $config, $utf8NoBom)

Stop-ExistingLauncher -LauncherScript $launcherPath

$installMode = "scheduled-task"
try {
  $action = New-ScheduledTaskAction -Execute $nodeCommand.Source -Argument "`"$launcherPath`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $taskName
} catch {
  $installMode = "startup-folder"
  Write-Warning "Scheduled Task install failed. Falling back to the current user's Startup folder. $($_.Exception.Message)"
  Install-StartupShortcut `
    -NodePath $nodeCommand.Source `
    -LauncherScript $launcherPath `
    -WorkingDirectory $launcherRoot `
    -ShortcutPath $startupLink
  Start-Launcher `
    -NodePath $nodeCommand.Source `
    -LauncherScript $launcherPath `
    -WorkingDirectory $launcherRoot
}

Write-Host "Codex Mission Control Local Launcher installed for $controlPlaneOrigin"
Write-Host "Install mode: $installMode"
Write-Host "Launcher: http://127.0.0.1:17320"
