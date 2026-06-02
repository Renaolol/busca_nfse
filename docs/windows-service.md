# Windows Server como servico

Este guia descreve como rodar o NotaSync GCONT como um servico do Windows Server e acessar pela rede interna com um nome como `http://notasync.lan/`.

## Pre-requisitos

- Node.js 24 LTS instalado.
- PostgreSQL instalado e rodando como servico Windows.
- OpenSSL instalado e disponivel no `PATH`.
- Projeto copiado/clonado no servidor.
- Arquivo `.env` configurado.
- PowerShell executado como Administrador.

## Variaveis principais

O `.env` deve conter, no minimo:

```env
NODE_ENV=production
PORT=80
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
npm run start:prod
```

Com `PORT=80`, o app deve abrir em:

```text
http://localhost/
```

A raiz `/` redireciona para `/app`.

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
.\deploy\windows\install-notasync-service.ps1 -Port 80 -HostName notasync.lan
```

Se o build/migration ja foi feito e voce quer apenas instalar/reiniciar o servico:

```powershell
.\deploy\windows\install-notasync-service.ps1 -Port 80 -HostName notasync.lan -SkipBuild
```

O script cria:

- `NotaSyncGCONT.xml`
- pasta `logs`
- pasta `storage`
- regra de firewall para a porta definida
- servico Windows `NotaSyncGCONT`

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

## Acesso por notasync.lan

Para acessar sem IP e sem porta:

```text
http://notasync.lan/
```

voce precisa de duas coisas:

1. O app rodando na porta `80`.
2. `notasync.lan` resolvendo para o IP do servidor.

### Opcao recomendada: DNS interno

No servidor DNS da rede, crie um registro `A`:

```text
notasync.lan -> IP_DO_SERVIDOR
```

Se o Windows Server tambem for o DNS e existir a zona `lan`, use:

```powershell
Add-DnsServerResourceRecordA -ZoneName "lan" -Name "notasync" -IPv4Address "IP_DO_SERVIDOR"
```

Teste:

```powershell
Resolve-DnsName notasync.lan
Test-NetConnection notasync.lan -Port 80
```

### Opcao rapida: arquivo hosts

Em cada computador que vai acessar, edite como Administrador:

```text
C:\Windows\System32\drivers\etc\hosts
```

Adicione:

```text
IP_DO_SERVIDOR notasync.lan
```

Exemplo:

```text
192.168.0.10 notasync.lan
```

## Se a porta 80 estiver ocupada

Verifique:

```powershell
netstat -ano | findstr ":80"
```

Se IIS ou outro servico estiver usando a porta 80, escolha uma das opcoes:

- parar/remover o servico que usa a porta 80;
- rodar o NotaSync em `3000` e configurar IIS/Caddy/Nginx como reverse proxy;
- acessar temporariamente `http://notasync.lan:3000/`.

Para instalar na porta 3000:

```powershell
.\deploy\windows\install-notasync-service.ps1 -Port 3000 -HostName notasync.lan
```
