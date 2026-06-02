param(
  [string]$ServiceName = "NotaSyncGCONT",
  [string]$ProjectPath = ""
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

$winSwPath = Join-Path $ProjectPath "$ServiceName.exe"
if (-not (Test-Path $winSwPath)) {
  throw "WinSW nao encontrado em '$winSwPath'."
}

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existingService) {
  Write-Host "Servico '$ServiceName' nao esta instalado."
  exit 0
}

if ($existingService.Status -ne "Stopped") {
  & $winSwPath stop
}

& $winSwPath uninstall
Write-Host "Servico removido: $ServiceName"
