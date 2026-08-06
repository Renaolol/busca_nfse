param(
  [string]$ProjectPath = "",
  [string]$ConfigPath = "",
  [switch]$Force,
  [switch]$AllowDowngrade
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este script em um PowerShell aberto como Administrador."
  }
}

function Get-JsonFile([string]$Path) {
  return Get-Content -Path $Path -Raw | ConvertFrom-Json
}

function Get-AbsolutePath([string]$BasePath, [string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate)) {
    return $BasePath
  }

  if ([System.IO.Path]::IsPathRooted($Candidate)) {
    return $Candidate
  }

  return Join-Path $BasePath $Candidate
}

function Convert-VersionToParts([string]$Version) {
  if ([string]::IsNullOrWhiteSpace($Version)) {
    return @(0)
  }

  $normalized = $Version.Trim().TrimStart('v')
  $coreVersion = $normalized.Split('-')[0]
  $parts = @()
  foreach ($part in $coreVersion.Split('.')) {
    $value = 0
    [void][int]::TryParse($part, [ref]$value)
    $parts += $value
  }

  return $parts
}

function Compare-Version([string]$Left, [string]$Right) {
  $leftParts = Convert-VersionToParts $Left
  $rightParts = Convert-VersionToParts $Right
  $maxLength = [Math]::Max($leftParts.Count, $rightParts.Count)

  for ($i = 0; $i -lt $maxLength; $i++) {
    $leftValue = if ($i -lt $leftParts.Count) { $leftParts[$i] } else { 0 }
    $rightValue = if ($i -lt $rightParts.Count) { $rightParts[$i] } else { 0 }

    if ($leftValue -lt $rightValue) {
      return -1
    }
    if ($leftValue -gt $rightValue) {
      return 1
    }
  }

  return 0
}

function Copy-RelativePath([string]$SourceRoot, [string]$DestinationRoot, [string]$RelativePath) {
  $sourcePath = Join-Path $SourceRoot $RelativePath
  if (-not (Test-Path $sourcePath)) {
    return
  }

  $destinationPath = Join-Path $DestinationRoot $RelativePath
  $parentPath = Split-Path -Path $destinationPath -Parent
  if ($parentPath) {
    New-Item -ItemType Directory -Force -Path $parentPath | Out-Null
  }

  Copy-Item -Path $sourcePath -Destination $destinationPath -Recurse -Force
}

function Remove-RelativePath([string]$RootPath, [string]$RelativePath) {
  $targetPath = Join-Path $RootPath $RelativePath
  if (Test-Path $targetPath) {
    Remove-Item -Path $targetPath -Recurse -Force
  }
}

function Resolve-ExtractedRoot([string]$ExtractPath) {
  $packageJsonAtRoot = Join-Path $ExtractPath "package.json"
  if (Test-Path $packageJsonAtRoot) {
    return $ExtractPath
  }

  $children = Get-ChildItem -Path $ExtractPath
  if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
    $nestedPackageJson = Join-Path $children[0].FullName "package.json"
    if (Test-Path $nestedPackageJson) {
      return $children[0].FullName
    }
  }

  throw "Nao foi possivel localizar o package.json na release extraida em '$ExtractPath'."
}

function Invoke-NpmCommands([string]$WorkingDirectory) {
  Push-Location $WorkingDirectory
  try {
    npm ci
    npm run prisma:generate
    npm run build
    npm run prisma:deploy
  } finally {
    Pop-Location
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

if (-not (Test-Path $ConfigPath)) {
  throw "Arquivo de configuracao de update nao encontrado em '$ConfigPath'."
}

. (Join-Path $PSScriptRoot "release-paths.ps1")

$config = Get-JsonFile $ConfigPath
if (-not $config.manifestUrl) {
  throw "Config de update invalida: manifestUrl obrigatoria."
}

$serviceName = if ($config.serviceName) { [string]$config.serviceName } else { "NotaSyncGCONT" }
$winSwExecutableName = if ($config.winSwExecutable) { [string]$config.winSwExecutable } else { "$serviceName.exe" }
$releaseRoot = Get-AbsolutePath $ProjectPath $config.releaseRoot
$backupRoot = Get-AbsolutePath $ProjectPath $config.backupRoot
$storageRoot = Join-Path $ProjectPath "storage"
$stateFilePath = Join-Path $storageRoot "update-state.json"
$winSwPath = Join-Path $ProjectPath $winSwExecutableName
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$downloadPath = $null
$extractPath = $null
$restorePath = $null
$backupZipPath = $null
$serviceExists = $false
$serviceWasRunning = $false

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
New-Item -ItemType Directory -Force -Path $storageRoot | Out-Null

$packageJson = Get-JsonFile (Join-Path $ProjectPath "package.json")
$currentVersion = [string]$packageJson.version

$manifest = Invoke-RestMethod -Uri ([string]$config.manifestUrl) -Method Get
if (-not $manifest.version) {
  throw "Manifesto de release invalido: version obrigatoria."
}

if (-not $manifest.windows -or -not $manifest.windows.packageUrl) {
  throw "Manifesto de release invalido: windows.packageUrl obrigatorio."
}

$targetVersion = [string]$manifest.version
$comparison = Compare-Version $currentVersion $targetVersion
if (-not $Force) {
  if ($comparison -eq 0) {
    Write-Host "Nenhuma atualizacao necessaria. Versao atual ja e $currentVersion."
    exit 0
  }

  if ($comparison -gt 0 -and -not $AllowDowngrade) {
    Write-Host "Atualizacao ignorada. Versao atual $currentVersion e mais nova que $targetVersion."
    exit 0
  }
}

$downloadPath = Join-Path $releaseRoot "notasync-$targetVersion-windows.zip"
Invoke-WebRequest -Uri ([string]$manifest.windows.packageUrl) -OutFile $downloadPath

if ($manifest.windows.sha256) {
  $downloadHash = (Get-FileHash -Path $downloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $expectedHash = ([string]$manifest.windows.sha256).ToLowerInvariant()
  if ($downloadHash -ne $expectedHash) {
    throw "Hash SHA256 da release nao confere. Esperado '$expectedHash', obtido '$downloadHash'."
  }
}

$extractPath = Join-Path $releaseRoot "extract-$targetVersion-$timestamp"
if (Test-Path $extractPath) {
  Remove-Item -Path $extractPath -Recurse -Force
}

Expand-Archive -Path $downloadPath -DestinationPath $extractPath -Force
$extractedRoot = Resolve-ExtractedRoot $extractPath
$releasePackageJson = Get-JsonFile (Join-Path $extractedRoot "package.json")
$releaseVersion = [string]$releasePackageJson.version
if ($releaseVersion -and $releaseVersion -ne $targetVersion) {
  throw "Versao do package.json da release ($releaseVersion) difere do manifesto ($targetVersion)."
}

$backupStagePath = Join-Path $backupRoot "staging-$currentVersion-$timestamp"
if (Test-Path $backupStagePath) {
  Remove-Item -Path $backupStagePath -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $backupStagePath | Out-Null

foreach ($relativePath in Get-NotaSyncReleasePaths) {
  Copy-RelativePath $ProjectPath $backupStagePath $relativePath
}

$backupZipPath = Join-Path $backupRoot "notasync-backup-$currentVersion-$timestamp.zip"
Compress-Archive -Path (Join-Path $backupStagePath '*') -DestinationPath $backupZipPath -CompressionLevel Optimal

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
  $serviceExists = $true
  $serviceWasRunning = $service.Status -ne "Stopped"
}

try {
  if ($serviceExists -and $serviceWasRunning) {
    if (-not (Test-Path $winSwPath)) {
      throw "Executavel do WinSW nao encontrado em '$winSwPath'."
    }
    & $winSwPath stop
  }

  foreach ($relativePath in Get-NotaSyncReleasePaths) {
    Remove-RelativePath $ProjectPath $relativePath
    Copy-RelativePath $extractedRoot $ProjectPath $relativePath
  }

  Invoke-NpmCommands $ProjectPath

  $state = [ordered]@{
    currentVersion = $targetVersion
    previousVersion = $currentVersion
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
    manifestUrl = [string]$config.manifestUrl
    packageUrl = [string]$manifest.windows.packageUrl
    channel = if ($manifest.channel) { [string]$manifest.channel } else { $null }
  } | ConvertTo-Json -Depth 6

  Set-Content -Path $stateFilePath -Value $state -Encoding UTF8

  if ($serviceExists) {
    & $winSwPath start
  }

  Write-Host "Atualizacao aplicada com sucesso: $currentVersion -> $targetVersion"
} catch {
  Write-Warning "Falha ao aplicar update. Iniciando rollback do projeto."

  if ($serviceExists -and (Test-Path $winSwPath)) {
    & $winSwPath stop 2>$null
  }

  $restorePath = Join-Path $backupRoot "restore-$currentVersion-$timestamp"
  if (Test-Path $restorePath) {
    Remove-Item -Path $restorePath -Recurse -Force
  }

  Expand-Archive -Path $backupZipPath -DestinationPath $restorePath -Force
  $restoreRoot = Resolve-ExtractedRoot $restorePath

  foreach ($relativePath in Get-NotaSyncReleasePaths) {
    Remove-RelativePath $ProjectPath $relativePath
    Copy-RelativePath $restoreRoot $ProjectPath $relativePath
  }

  Invoke-NpmCommands $ProjectPath

  if ($serviceExists -and (Test-Path $winSwPath)) {
    & $winSwPath start
  }

  throw
} finally {
  if ($extractPath -and (Test-Path $extractPath)) {
    Remove-Item -Path $extractPath -Recurse -Force
  }

  if ($restorePath -and (Test-Path $restorePath)) {
    Remove-Item -Path $restorePath -Recurse -Force
  }

  if ($backupStagePath -and (Test-Path $backupStagePath)) {
    Remove-Item -Path $backupStagePath -Recurse -Force
  }
}
