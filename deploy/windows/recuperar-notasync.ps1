param(
  [string]$ServiceName = "NotaSyncGCONT",
  [int]$Port = 3000,
  # Esvazia a tabela do Simples Nacional antes de aplicar as migrations (a migration do indice de busca fica instantanea).
  [switch]$ExcluirTabelaSimples,
  # Apenas mostra o diagnostico, sem parar/alterar nada.
  [switch]$SomenteDiagnostico
)

# Recupera o NotaSync quando o servico nao abre depois de uma atualizacao.
# Uso (PowerShell como Administrador, na raiz do projeto):
#   powershell -ExecutionPolicy Bypass -File .\deploy\windows\recuperar-notasync.ps1 -ExcluirTabelaSimples
#   powershell -ExecutionPolicy Bypass -File .\deploy\windows\recuperar-notasync.ps1 -SomenteDiagnostico

$ErrorActionPreference = "Continue"
$ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $ProjectPath
$winSwPath = Join-Path $ProjectPath "$ServiceName.exe"
$logsPath = Join-Path $ProjectPath "logs"
$healthUrl = "http://localhost:$Port/health"
$simplesMigrationPrefix = "20260930"

function Write-Etapa([string]$Texto) {
  Write-Host ""
  Write-Host "=== $Texto" -ForegroundColor Cyan
}

function Write-Ok([string]$Texto) {
  Write-Host "OK: $Texto" -ForegroundColor Green
}

function Write-Aviso([string]$Texto) {
  Write-Host "ATENCAO: $Texto" -ForegroundColor Yellow
}

function Stop-Recuperacao([string]$Texto) {
  Write-Host ""
  Write-Host "PAROU: $Texto" -ForegroundColor Red
  Write-Host "Envie para o suporte toda a saida deste script (inclusive as linhas de log acima)." -ForegroundColor Red
  exit 1
}

function Test-SistemaNoAr {
  try {
    $resposta = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 5
    return $resposta.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Show-Logs {
  foreach ($nome in @("$ServiceName.out.log", "$ServiceName.err.log")) {
    $arquivo = Join-Path $logsPath $nome
    if (Test-Path $arquivo) {
      Write-Host "--- $nome (ultimas 25 linhas, alterado em $((Get-Item $arquivo).LastWriteTime))"
      Get-Content $arquivo -Tail 25
    } else {
      Write-Host "--- $nome nao encontrado em $logsPath"
    }
  }
}

if (-not $SomenteDiagnostico) {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Stop-Recuperacao "Execute este script em um PowerShell aberto como Administrador."
  }
}

Write-Host "Projeto: $ProjectPath"

Write-Etapa "Situacao atual"
if (Test-SistemaNoAr) {
  Write-Ok "O sistema ja esta respondendo em $healthUrl"
} else {
  Write-Aviso "O sistema nao responde em $healthUrl"
}
$servico = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($servico) { Write-Host "Servico $ServiceName`: $($servico.Status)" } else { Write-Aviso "Servico $ServiceName nao instalado." }
Show-Logs

Write-Etapa "Espaco em disco"
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and ($_.Used + $_.Free) -gt 0 } | ForEach-Object {
  $livreGb = [math]::Round($_.Free / 1GB, 1)
  Write-Host "$($_.Name): $livreGb GB livres"
  if ($livreGb -lt 5) { Write-Aviso "Pouco espaco em $($_.Name): o PostgreSQL pode parar ou recusar gravacoes." }
}

Write-Etapa "PostgreSQL"
$postgres = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
if (-not $postgres) {
  Write-Aviso "Nenhum servico postgresql* encontrado neste servidor (o banco pode estar em outra maquina)."
} else {
  foreach ($pg in $postgres) {
    Write-Host "$($pg.Name): $($pg.Status)"
    if ($pg.Status -ne "Running" -and -not $SomenteDiagnostico) {
      Write-Host "Iniciando $($pg.Name)..."
      Start-Service -Name $pg.Name -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 5
      $pg.Refresh()
      if ($pg.Status -ne "Running") { Stop-Recuperacao "O PostgreSQL ($($pg.Name)) nao iniciou. Verifique espaco em disco e o log do PostgreSQL." }
      Write-Ok "$($pg.Name) iniciado."
    }
  }
}

Write-Etapa "Arquivo .env"
$envPath = Join-Path $ProjectPath ".env"
if (-not (Test-Path $envPath)) { Stop-Recuperacao "Arquivo .env nao encontrado em $ProjectPath." }
if (-not (Select-String -Path $envPath -Pattern "^\s*DATABASE_URL\s*=" -Quiet)) { Stop-Recuperacao "DATABASE_URL ausente no .env." }
Write-Ok ".env encontrado com DATABASE_URL."

Write-Etapa "Dependencias (node_modules)"
& node -e "require.resolve('@nestjs/core'); require.resolve('@prisma/client'); require.resolve('jszip'); require.resolve('prisma/package.json')" 2>$null
$dependenciasOk = ($LASTEXITCODE -eq 0)
if ($dependenciasOk) { Write-Ok "Dependencias instaladas." } else { Write-Aviso "Dependencias ausentes ou incompletas (node_modules quebrado)." }

if ($SomenteDiagnostico) {
  Write-Etapa "Migrations"
  & npx.cmd prisma migrate status 2>&1 | Out-Host
  Write-Host ""
  Write-Host "Diagnostico concluido (nada foi alterado)."
  exit 0
}

Write-Etapa "Parando o servico e processos presos"
if (Test-Path $winSwPath) { & $winSwPath stop 2>&1 | Out-Host }
Start-Sleep -Seconds 3
# Processos do Prisma deste projeto (ex.: migration travada) e o que ainda ocupar a porta do sistema.
$presos = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and (
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($ProjectPath, [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine -and $_.CommandLine -like "*$ProjectPath*prisma*") -or
    ($_.CommandLine -and $_.CommandLine -like "*start-notasync.cmd*")
  )
})
$ocupantes = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Get-CimInstance Win32_Process -Filter "ProcessId = $($_.OwningProcess)" } | Where-Object { $_.Name -eq "node.exe" })
foreach ($processo in ($presos + $ocupantes)) {
  Write-Host "Encerrando $($processo.Name) (pid $($processo.ProcessId)): $($processo.CommandLine)"
  Stop-Process -Id $processo.ProcessId -Force -ErrorAction SilentlyContinue
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  Stop-Recuperacao "A porta $Port continua ocupada por outro programa (que nao e o NotaSync)."
}
Write-Ok "Servico parado."

if (-not $dependenciasOk) {
  Write-Etapa "Reinstalando dependencias"
  & npm.cmd ci --ignore-scripts
  if ($LASTEXITCODE -ne 0) { Stop-Recuperacao "npm ci falhou." }
  & npx.cmd prisma generate
  if ($LASTEXITCODE -ne 0) { Stop-Recuperacao "prisma generate falhou." }
  Write-Ok "Dependencias reinstaladas."
}

if ($ExcluirTabelaSimples) {
  Write-Etapa "Excluindo todas as empresas da tabela do Simples Nacional"
  & node scripts\limpar-simples-nacional.js --yes
  if ($LASTEXITCODE -ne 0) { Stop-Recuperacao "Nao foi possivel esvaziar a tabela do Simples Nacional." }
}

Write-Etapa "Migrations com falha"
$status = (& npx.cmd prisma migrate status 2>&1 | Out-String)
Write-Host $status
if ($status -match "P1001|Can't reach database server") {
  Stop-Recuperacao "O banco de dados nao esta acessivel (DATABASE_URL do .env)."
}
# "prisma migrate status" lista cada migration com falha na sugestao 'migrate resolve --rolled-back "NOME"';
# o erro P3009 do deploy usa "The `NOME` migration started at ... failed".
$falhas = @(
  [regex]::Matches($status, '--rolled-back "([0-9]+_[A-Za-z0-9_]+)"') | ForEach-Object { $_.Groups[1].Value }
  [regex]::Matches($status, 'The `([0-9]+_[A-Za-z0-9_]+)` migration started at [^\r\n]* failed') | ForEach-Object { $_.Groups[1].Value }
) | Select-Object -Unique
foreach ($migration in $falhas) {
  if (-not $migration.StartsWith($simplesMigrationPrefix)) {
    Stop-Recuperacao "A migration $migration falhou e nao e uma das migrations do Simples Nacional; nao vou liberar automaticamente."
  }
  Write-Host "Liberando a migration interrompida $migration ..."
  & npx.cmd prisma migrate resolve --rolled-back $migration
  if ($LASTEXITCODE -ne 0) { Stop-Recuperacao "prisma migrate resolve falhou para $migration." }
}
if (-not $falhas) { Write-Ok "Nenhuma migration com falha." }

Write-Etapa "Compilando (npm run build)"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Stop-Recuperacao "npm run build falhou." }
Write-Ok "Build concluido."

Write-Etapa "Aplicando migrations (npm run prisma:deploy)"
if (-not $ExcluirTabelaSimples) {
  Write-Aviso "Se a tabela do Simples Nacional estiver cheia, a criacao do indice de busca pode levar muitos minutos. NAO feche esta janela."
}
& npm.cmd run prisma:deploy
if ($LASTEXITCODE -ne 0) { Stop-Recuperacao "prisma migrate deploy falhou." }
Write-Ok "Migrations aplicadas."

Write-Etapa "Iniciando o servico"
if (-not (Test-Path $winSwPath)) { Stop-Recuperacao "WinSW nao encontrado em $winSwPath." }
& $winSwPath start 2>&1 | Out-Host
$limite = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $limite) {
  if (Test-SistemaNoAr) {
    Write-Host ""
    Write-Host "SISTEMA NO AR: http://localhost:$Port/app (pela rede: http://IP_DO_SERVIDOR:$Port/app)" -ForegroundColor Green
    exit 0
  }
  Start-Sleep -Seconds 5
}

Show-Logs
Stop-Recuperacao "O servico iniciou, mas o sistema nao respondeu em $healthUrl em 3 minutos."
