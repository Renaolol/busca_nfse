param(
  [string]$ProjectPath = "",
  [string]$ConfigPath = "",
  [string]$TaskName = "NotaSync GCONT - Atualizacao",
  [string]$DailyAt = "02:30"
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este script em um PowerShell aberto como Administrador."
  }
}

Assert-Admin

if (-not $ProjectPath) {
  $ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
} else {
  $ProjectPath = (Resolve-Path $ProjectPath).Path
}

if (-not $ConfigPath) {
  $ConfigPath = Join-Path $ProjectPath "storage\update-config.json"
} elseif (-not [System.IO.Path]::IsPathRooted($ConfigPath)) {
  $ConfigPath = Join-Path $ProjectPath $ConfigPath
}

$updateScriptPath = Join-Path $ProjectPath "deploy\windows\update-notasync.ps1"

if (-not (Test-Path $updateScriptPath)) {
  throw "Script de update nao encontrado em '$updateScriptPath'."
}

if (-not (Test-Path $ConfigPath)) {
  throw "Arquivo de configuracao nao encontrado em '$ConfigPath'. Copie o exemplo antes de instalar a tarefa."
}

$triggerTime = Get-Date $DailyAt
$trigger = New-ScheduledTaskTrigger -Daily -At $triggerTime
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$updateScriptPath`" -ProjectPath `"$ProjectPath`" -ConfigPath `"$ConfigPath`""
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host ""
Write-Host "Tarefa registrada: $TaskName"
Write-Host "Horario: todos os dias as $DailyAt"
Write-Host "Config: $ConfigPath"
