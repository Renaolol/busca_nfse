# Publicacao de Release

Este guia descreve, passo a passo, como publicar uma nova release do NotaSync GCONT para distribuicao automatica aos escritorios.

O fluxo abaixo assume:

- repositório publico no GitHub;
- pacote Windows publicado em `GitHub Releases`;
- manifesto publicado no proprio repositorio em `updates/stable/manifest.json`;
- servidores clientes consumindo o manifesto via `raw.githubusercontent.com`.

Quando houver push na branch `main` com alteracao relevante do projeto, o workflow `Publish Windows Release` automatiza a publicacao da release, atualiza o manifesto `stable` e deixa o servidor apto a puxar a nova versao. Ainda assim, a versao do `package.json` precisa ser incrementada antes do push para que o updater enxergue a novidade.

## Visao geral

Para publicar uma release nova, voce sempre faz estes blocos:

1. atualizar a versao no `package.json`;
2. validar a aplicacao;
3. gerar o ZIP da release;
4. publicar a release no GitHub;
5. atualizar o manifesto `stable`;
6. testar o updater em um servidor piloto.

## Pre-requisitos

- PowerShell como Administrador no servidor ou maquina de build Windows.
- `NotaSyncGCONT.exe` disponivel na raiz do projeto se o servico estiver instalado.
- Git configurado com permissao de `push`.
- Repositorio GitHub publico.
- A aplicacao local deve estar funcional antes da geracao do pacote.

## 1. Atualizar a versao da aplicacao

Edite o arquivo `package.json` e atualize o campo `version`.

Exemplo:

```json
"version": "0.1.3"
```

Importante:

- a versao do `package.json` precisa bater com a tag publicada;
- nao use `build-release-package.ps1 -Version ...` para "inventar" uma versao diferente do `package.json`;
- se o `package.json` estiver em `0.1.2`, a release publicada tambem precisa ser `0.1.2`.

## 2. Validar antes da release

Na raiz do projeto:

```powershell
npm run lint
npm run test
npm run test:e2e
npm run build
```

Se a aplicacao estiver instalada como servico Windows, pare o servico antes da etapa de build para evitar erro do Prisma:

```powershell
.\NotaSyncGCONT.exe stop
```

Se precisar reinstalar dependencias e rebuildar do zero:

```powershell
npm ci
npm run prisma:generate
npm run build
```

Ao final, se voce ainda nao for gerar o pacote imediatamente, religue o servico:

```powershell
.\NotaSyncGCONT.exe start
```

## 3. Gerar o pacote da release

Se voce acabou de executar `npm ci`, `prisma:generate` e `build` manualmente, gere o pacote com `-SkipBuild`:

```powershell
.\deploy\windows\build-release-package.ps1 -SkipBuild
```

Se o pacote da mesma versao ja existir e voce precisar sobrescrever:

```powershell
.\deploy\windows\build-release-package.ps1 -SkipBuild -Force
```

Se voce quiser que o script tente buildar sozinho:

```powershell
.\deploy\windows\build-release-package.ps1
```

Arquivos gerados:

- `releases/notasync-x.y.z-windows.zip`
- `releases/notasync-x.y.z-windows.hash.json`

Exemplo para consultar o tamanho do ZIP em bytes:

```powershell
(Get-Item .\releases\notasync-0.1.3-windows.zip).Length
```

Exemplo para ler hash e metadados:

```powershell
Get-Content .\releases\notasync-0.1.3-windows.hash.json
```

## 4. Publicar a release no GitHub

### 4.1. Fazer commit da versao nova

```powershell
git add package.json package-lock.json
git commit -m "chore: release v0.1.3"
git push origin main
```

Se a branch principal nao for `main`, troque o nome da branch.

### 4.2. Criar a release pelo GitHub Web

No GitHub:

1. abra o repositorio;
2. clique em `Releases`;
3. clique em `Draft a new release`;
4. crie a tag `v0.1.3`;
5. defina o titulo `v0.1.3`;
6. anexe `releases/notasync-0.1.3-windows.zip`;
7. publique a release.

URL esperada do asset:

```text
https://github.com/Renaolol/busca_nfse/releases/download/v0.1.3/notasync-0.1.3-windows.zip
```

### 4.3. Validar o asset publicado

No servidor ou em uma maquina Windows:

```powershell
Invoke-WebRequest "https://github.com/Renaolol/busca_nfse/releases/download/v0.1.3/notasync-0.1.3-windows.zip" -OutFile .\releases\teste-0.1.3.zip
Get-FileHash .\releases\teste-0.1.3.zip -Algorithm SHA256
```

O hash retornado precisa bater com o hash do arquivo local em `releases/notasync-0.1.3-windows.hash.json`.

## 5. Atualizar o manifesto `stable`

Edite:

```text
updates/stable/manifest.json
```

Exemplo:

```json
{
  "app": "notasync-gcont",
  "channel": "stable",
  "version": "0.1.3",
  "publishedAt": "2026-08-06T18:00:00.000Z",
  "windows": {
    "packageUrl": "https://github.com/Renaolol/busca_nfse/releases/download/v0.1.3/notasync-0.1.3-windows.zip",
    "sha256": "HASH_DA_RELEASE",
    "sizeBytes": 1234567
  }
}
```

Campos que precisam bater exatamente com a release:

- `version`
- `windows.packageUrl`
- `windows.sha256`
- `windows.sizeBytes`

Depois salve, commit e push:

```powershell
git add updates/stable/manifest.json
git commit -m "chore: publish stable manifest for v0.1.3"
git push origin main
```

## 6. Validar o manifesto publicado

Abra a URL raw:

```text
https://raw.githubusercontent.com/Renaolol/busca_nfse/main/updates/stable/manifest.json
```

Se quiser evitar cache do navegador:

```text
https://raw.githubusercontent.com/Renaolol/busca_nfse/main/updates/stable/manifest.json?t=202608061800
```

Valide que o conteudo publicado realmente mostra a versao nova.

## 7. Testar o updater em um servidor piloto

No servidor piloto, o `storage/update-config.json` deve apontar para a URL raw do manifesto:

```json
{
  "manifestUrl": "https://raw.githubusercontent.com/Renaolol/busca_nfse/main/updates/stable/manifest.json",
  "serviceName": "NotaSyncGCONT",
  "winSwExecutable": "NotaSyncGCONT.exe",
  "releaseRoot": "releases",
  "backupRoot": "backups"
}
```

Apague o ZIP local antigo da mesma versao, se existir:

```powershell
Remove-Item .\releases\notasync-0.1.3-windows.zip -Force -ErrorAction SilentlyContinue
```

Execute o update manual:

```powershell
.\deploy\windows\update-notasync.ps1 -Force
```

Depois valide a API:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

O retorno deve indicar a versao nova:

```json
{
  "status": "ok",
  "timestamp": "2026-08-06T18:10:00.000Z",
  "version": "0.1.3"
}
```

## 8. Habilitar automacao no servidor

Se o teste piloto passou, instale a tarefa agendada:

```powershell
.\deploy\windows\install-update-task.ps1 -DailyAt 02:30
```

## Checklist rapido

Antes de publicar:

- `package.json` atualizado
- `npm run lint`
- `npm run test`
- `npm run test:e2e`
- `npm run build`
- ZIP gerado com a mesma versao do `package.json`

Depois de publicar:

- release `vX.Y.Z` criada no GitHub
- asset ZIP acessivel por URL direta
- `manifest.json` atualizado
- URL raw mostrando a versao correta
- updater testado em servidor piloto

## Erros comuns

### `Versao do package.json da release (...) difere do manifesto (...)`

Causa:

- o ZIP foi gerado com uma versao no `package.json`, mas o manifesto aponta para outra.

Correcao:

- alinhar a versao do `package.json`, do nome do ZIP, da tag GitHub e do manifesto.

### `Hash SHA256 da release nao confere`

Causa:

- manifesto com hash antigo;
- `packageUrl` apontando para asset errado;
- ZIP da release foi trocado apos publicar.

Correcao:

- baixar o asset publicado manualmente;
- calcular `Get-FileHash`;
- corrigir o manifesto.

### `EPERM ... query_engine-windows.dll.node`

Causa:

- o Prisma estava com DLL bloqueada pelo servico em execucao.

Correcao:

```powershell
.\NotaSyncGCONT.exe stop
npm ci
npm run prisma:generate
npm run build
.\deploy\windows\build-release-package.ps1 -SkipBuild -Force
.\NotaSyncGCONT.exe start
```
