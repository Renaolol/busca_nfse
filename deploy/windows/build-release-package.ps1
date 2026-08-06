param(
  [string]$ProjectPath = "",
  [string]$OutputDir = "",
  [string]$Version = "",
  [switch]$SkipBuild,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $ProjectPath) {
  $ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
} else {
  $ProjectPath = (Resolve-Path $ProjectPath).Path
}

. (Join-Path $PSScriptRoot "release-paths.ps1")

$packageJsonPath = Join-Path $ProjectPath "package.json"
$packageJson = Get-Content -Path $packageJsonPath -Raw | ConvertFrom-Json

if (-not $Version) {
  $Version = [string]$packageJson.version
}

if (-not $OutputDir) {
  $OutputDir = Join-Path $ProjectPath "releases"
} elseif (-not [System.IO.Path]::IsPathRooted($OutputDir)) {
  $OutputDir = Join-Path $ProjectPath $OutputDir
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$packageFileName = "notasync-$Version-windows.zip"
$packagePath = Join-Path $OutputDir $packageFileName

if ((Test-Path $packagePath) -and -not $Force) {
  throw "Pacote '$packagePath' ja existe. Use -Force para sobrescrever."
}

Push-Location $ProjectPath
try {
  if (-not $SkipBuild) {
    npm ci
    npm run prisma:generate
    npm run build
  }

  $timestamp = Get-Date -Format "yyyyMMddHHmmss"
  $stagingPath = Join-Path $OutputDir "staging-$Version-$timestamp"
  if (Test-Path $stagingPath) {
    Remove-Item -Path $stagingPath -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $stagingPath | Out-Null

  foreach ($relativePath in Get-NotaSyncReleasePaths) {
    $sourcePath = Join-Path $ProjectPath $relativePath
    if (-not (Test-Path $sourcePath)) {
      continue
    }

    $destinationPath = Join-Path $stagingPath $relativePath
    $parentPath = Split-Path -Path $destinationPath -Parent
    if ($parentPath) {
      New-Item -ItemType Directory -Force -Path $parentPath | Out-Null
    }

    Copy-Item -Path $sourcePath -Destination $destinationPath -Recurse -Force
  }

  $releaseInfo = [ordered]@{
    app = 'notasync-gcont'
    version = $Version
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    sourcePackageVersion = [string]$packageJson.version
  } | ConvertTo-Json -Depth 4

  Set-Content -Path (Join-Path $stagingPath "release-info.json") -Value $releaseInfo -Encoding UTF8

  if (Test-Path $packagePath) {
    Remove-Item -Path $packagePath -Force
  }

  Compress-Archive -Path (Join-Path $stagingPath '*') -DestinationPath $packagePath -CompressionLevel Optimal
} finally {
  Pop-Location
}

$hash = (Get-FileHash -Path $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestHint = [ordered]@{
  version = $Version
  packageFile = $packageFileName
  sha256 = $hash
  sizeBytes = (Get-Item $packagePath).Length
} | ConvertTo-Json -Depth 4

Set-Content -Path (Join-Path $OutputDir "notasync-$Version-windows.hash.json") -Value $manifestHint -Encoding UTF8

Write-Host ""
Write-Host "Pacote gerado: $packagePath"
Write-Host "SHA256: $hash"
