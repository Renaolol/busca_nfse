# Windows Server como servico

Este guia descreve como rodar o NotaSync GCONT como um servico do Windows Server e acessar pela rede interna usando IP e porta:

```text
http://IP_DO_SERVIDOR:3000/app
```

No servidor atual, o IP identificado foi:

```text
http://10.0.0.10:3000/app
```

## Pre-requisitos

- Node.js 24 LTS instalado.
- PostgreSQL instalado e rodando como servico Windows.
- OpenSSL instalado e disponivel no `PATH`.
- Projeto copiado/clonado no servidor.
- Arquivo `.env` configurado.
- PowerShell executado como Administrador.
- WinSW baixado e colocado na raiz do projeto.

## Variaveis principais

O `.env` deve conter, no minimo:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://postgres:SENHA@localhost:5432/nfse_collector?schema=public
CERT_MASTER_KEY=SEGREDO_FORTE
STORAGE_ROOT_PATH=C:\NotaSync\storage
NFSE_ADN_CLIENT_MODE=real
NFSE_API_BASE_URL_PRODUCAO=https://adn.nfse.gov.br
NFSE_API_BASE_URL_RESTRITA=https://adn.producaorestrita.nfse.gov.br
NFSE_ADN_REJECT_UNAUTHORIZED=true
```

> O instalador do servico tambem define `NODE_ENV`, `PORT` e `STORAGE_ROOT_PATH` no XML do WinSW. Esses valores do servico prevalecem sobre o `.env`.

## Build manual

Na raiz do projeto:

```powershell
npm ci
npm run prisma:generate
npm run build
npm run prisma:deploy
```

Teste manual:

```powershell
$env:NODE_ENV="production"
$env:PORT="3000"
$env:STORAGE_ROOT_PATH="C:\Users\Administrador\Documents\GitHub\busca_nfse\storage"
node dist\main.js
```

Abra:

```text
http://localhost:3000/app
```

## Instalar WinSW

Baixe o `WinSW-x64.exe` em:

```text
https://github.com/winsw/winsw/releases
```

Renomeie o arquivo para:

```text
NotaSyncGCONT.exe
```

Coloque na raiz do projeto, ao lado do `package.json`.

Exemplo:

```text
C:\Users\Administrador\Documents\GitHub\busca_nfse\NotaSyncGCONT.exe
```

## Instalar o servico

No PowerShell como Administrador:

```powershell
cd C:\Users\Administrador\Documents\GitHub\busca_nfse
.\deploy\windows\install-notasync-service.ps1 -Port 3000 -SkipBuild
```

Se quiser que o script tambem rode `npm ci`, build e migrations, remova `-SkipBuild`:

```powershell
.\deploy\windows\install-notasync-service.ps1 -Port 3000
```

O script para o servico antes do build para liberar a DLL do Prisma (`query_engine-windows.dll.node`) e inicia novamente no final.

## Build manual com servico instalado

Se for rodar `npm run build` diretamente, pare o servico antes para evitar erro `EPERM` ao executar `prisma generate`:

```powershell
cd C:\Users\Administrador\Documents\GitHub\busca_nfse
.\NotaSyncGCONT.exe stop
npm run build
.\NotaSyncGCONT.exe start
```

O script cria:

- `NotaSyncGCONT.xml`
- pasta `logs`
- pasta `storage`
- regra de firewall para a porta `3000`
- servico Windows `NotaSyncGCONT`

## Acesso

No proprio servidor:

```text
http://localhost:3000/app
```

Na rede interna:

```text
http://10.0.0.10:3000/app
```

Tambem funciona abrir a raiz:

```text
http://10.0.0.10:3000
```

O backend redireciona automaticamente para `/app`.

Se o IP do servidor mudar, confirme com:

```powershell
ipconfig
```

Use o IPv4 da placa de rede principal, nao o IP de adaptadores auxiliares como Easypanel.

## Comandos uteis

```powershell
Get-Service NotaSyncGCONT
.\NotaSyncGCONT.exe status
.\NotaSyncGCONT.exe restart
.\NotaSyncGCONT.exe stop
.\NotaSyncGCONT.exe start
```

Logs:

```text
logs\
```

## Remover o servico

```powershell
.\deploy\windows\uninstall-notasync-service.ps1
```

## Firewall

O instalador cria a regra automaticamente. Se precisar criar manualmente:

```powershell
New-NetFirewallRule -DisplayName "NotaSync GCONT" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

Teste de conectividade:

```powershell
Test-NetConnection 10.0.0.10 -Port 3000
```

## Atualizacao automatica sem acesso remoto

Para permitir que cada escritorio atualize o app sozinho, sem novo acesso da GCONT:

1. Copie `deploy/windows/update-config.example.json` para `storage/update-config.json`.
2. Preencha a `manifestUrl` apontando para o manifesto HTTPS da release.
3. Instale a tarefa agendada:

```powershell
.\deploy\windows\install-update-task.ps1 -DailyAt 02:30
```

4. A tarefa executa `deploy/windows/update-notasync.ps1`, que:
   - baixa a release ZIP;
   - valida SHA256;
   - para o servico;
   - aplica a nova versao;
   - roda `npm ci`, build e `prisma:deploy`;
   - reinicia o servico;
   - faz rollback automatico se falhar.

O fluxo completo de distribuicao de releases e rollout esta em `docs/update-distribution.md`.
