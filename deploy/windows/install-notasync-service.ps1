param(
  [string]$ServiceName = "NotaSyncGCONT",
  [string]$DisplayName = "NotaSync GCONT",
  [string]$Description = "Servico interno NotaSync GCONT para busca e consulta de NFS-e.",
  [string]$ProjectPath = "",
  [int]$Port = 3000,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Execute este script em um PowerShell aberto como Administrador."
  }
}

function Escape-XmlValue([string]$Value) {
  return [Security.SecurityElement]::Escape($Value)
}

Assert-Admin

if (-not $ProjectPath) {
  $ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
} else {
  $ProjectPath = (Resolve-Path $ProjectPath).Path
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  throw "Node.js nao encontrado no PATH. Instale Node.js 24 LTS e abra um novo PowerShell."
}

$nodePath = $nodeCommand.Source
$winSwPath = Join-Path $ProjectPath "$ServiceName.exe"
$xmlPath = Join-Path $ProjectPath "$ServiceName.xml"
$distPath = Join-Path $ProjectPath "dist\main.js"
$storagePath = Join-Path $ProjectPath "storage"
$logsPath = Join-Path $ProjectPath "logs"

if (-not (Test-Path $winSwPath)) {
  throw "WinSW nao encontrado em '$winSwPath'. Baixe WinSW-x64.exe e renomeie para '$ServiceName.exe' na raiz do projeto."
}

New-Item -ItemType Directory -Force -Path $storagePath | Out-Null
New-Item -ItemType Directory -Force -Path $logsPath | Out-Null

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($existingService -and $existingService.Status -ne "Stopped") {
  Write-Host "Parando servico '$ServiceName' antes do build para liberar arquivos do Prisma..."
  & $winSwPath stop
}

if (-not $SkipBuild) {
  Push-Location $ProjectPath
  try {
    npm ci
    npm run prisma:generate
    npm run build
    npm run prisma:deploy
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $distPath)) {
  throw "Build nao encontrado em '$distPath'. Rode npm run build antes de instalar o servico."
}

$xml = @"
<service>
  <id>$(Escape-XmlValue $ServiceName)</id>
  <name>$(Escape-XmlValue $DisplayName)</name>
  <description>$(Escape-XmlValue $Description)</description>
  <executable>$(Escape-XmlValue $nodePath)</executable>
  <arguments>dist\main.js</arguments>
  <workingdirectory>$(Escape-XmlValue $ProjectPath)</workingdirectory>
  <env name="NODE_ENV" value="production" />
  <env name="PORT" value="$Port" />
  <env name="STORAGE_ROOT_PATH" value="$(Escape-XmlValue $storagePath)" />
  <logpath>$(Escape-XmlValue $logsPath)</logpath>
  <log mode="roll" />
  <onfailure action="restart" delay="10 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>20 sec</stoptimeout>
</service>
"@

Set-Content -Path $xmlPath -Value $xml -Encoding UTF8

if ($existingService) {
  $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if ($existingService.Status -ne "Stopped") {
    & $winSwPath stop
  }
  & $winSwPath start
} else {
  & $winSwPath install
  & $winSwPath start
}

$firewallRule = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue
if (-not $firewallRule) {
  New-NetFirewallRule -DisplayName $DisplayName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
}

Write-Host ""
Write-Host "Servico instalado/iniciado: $ServiceName"
Write-Host "Porta configurada: $Port"
Write-Host "Teste local: http://localhost:$Port/app"
Write-Host "Acesso pela rede: http://IP_DO_SERVIDOR:$Port/app"
