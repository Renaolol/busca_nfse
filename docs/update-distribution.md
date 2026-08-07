# Distribuicao de Atualizacoes

Este guia define um fluxo de atualizacao para implantar o app em outros escritorios de contabilidade sem depender de novo acesso remoto da GCONT.

## Objetivo

Cada escritorio continua rodando o sistema localmente, na propria rede interna, mas passa a consultar um endpoint central de releases hospedado pela GCONT.

O fluxo recomendado e `pull`:

1. A GCONT publica uma nova release.
2. O servidor local do escritorio consulta um manifesto HTTPS.
3. Se houver nova versao, ele baixa o pacote.
4. O proprio servidor aplica a atualizacao, reinicia o servico e registra resultado localmente.

## Componentes da solucao

### 1. Pacote de release Windows

Script:

```powershell
.\deploy\windows\build-release-package.ps1
```

Esse script gera em `releases\`:

- `notasync-x.y.z-windows.zip`
- `notasync-x.y.z-windows.hash.json`

O pacote inclui apenas os caminhos necessarios para reinstalar a aplicacao sem tocar em:

- `.env`
- `storage`
- `logs`
- `NotaSyncGCONT.exe`
- `NotaSyncGCONT.xml`

### 2. Manifesto de release

Script:

```bash
npm run release:manifest -- \
  --channel stable \
  --win-package-url https://updates.seudominio.com/notasync/0.1.0/notasync-0.1.0-windows.zip \
  --win-package-sha256 HASH_DA_RELEASE \
  --win-package-size 12345678 \
  --docker-image registry.seudominio.com/notasync \
  --docker-tag 0.1.0 \
  --out release-manifest-stable.json
```

Estrutura esperada:

```json
{
  "app": "notasync-gcont",
  "channel": "stable",
  "version": "0.1.0",
  "publishedAt": "2026-08-06T12:00:00.000Z",
  "windows": {
    "packageUrl": "https://updates.seudominio.com/notasync/0.1.0/notasync-0.1.0-windows.zip",
    "sha256": "abc123",
    "sizeBytes": 12345678
  }
}
```

### 3. Atualizador local

Script:

```powershell
.\deploy\windows\update-notasync.ps1
```

Comportamento:

1. Lê `storage/update-config.json`.
2. Baixa o manifesto central.
3. Compara a versao instalada com a versao publicada.
4. Baixa a release ZIP.
5. Valida SHA256.
6. Gera backup ZIP da versao atual.
7. Para o servico Windows.
8. Copia os arquivos da nova release.
9. Roda:

```powershell
npm ci
npm run prisma:generate
npm run build
npm run prisma:deploy
```

10. Reinicia o servico.
11. Se houver falha, restaura automaticamente a release anterior.

O resultado da ultima atualizacao fica em:

```text
storage/update-state.json
```

### 4. Tarefa agendada do Windows

Script:

```powershell
.\deploy\windows\install-update-task.ps1 -DailyAt 02:30
```

Esse script registra uma tarefa em nome do `SYSTEM` para executar o updater diariamente.

## Setup no escritorio

### 1. Instalar o app normalmente

Siga `docs/windows-service.md`.

### 2. Criar configuracao local de update

Copie:

```text
deploy/windows/update-config.example.json
```

para:

```text
storage/update-config.json
```

Exemplo:

```json
{
  "manifestUrl": "https://raw.githubusercontent.com/Renaolol/busca_nfse/main/updates/stable/manifest.json",
  "serviceName": "NotaSyncGCONT",
  "winSwExecutable": "NotaSyncGCONT.exe",
  "releaseRoot": "releases",
  "backupRoot": "backups"
}
```

### 3. Registrar a tarefa de atualizacao

```powershell
.\deploy\windows\install-update-task.ps1 -DailyAt 02:30
```

### 4. Testar manualmente

```powershell
.\deploy\windows\update-notasync.ps1 -Force
```

## Processo de publicacao pela GCONT

### 1. Fechar a versao

- Atualize `package.json`.
- Gere a build.
- Rode os comandos obrigatorios do projeto.

### 2. Gerar o pacote

```powershell
.\deploy\windows\build-release-package.ps1 -Version 0.1.0
```

### 3. Calcular e publicar hash

O script ja grava `notasync-x.y.z-windows.hash.json` com `sha256` e `sizeBytes`.

### 4. Publicar arquivos

Publique em um endpoint HTTPS controlado pela GCONT:

- ZIP da release
- manifesto `manifest.json`
- opcionalmente release notes

### 5. Virar o canal `stable`

Atualize o `manifest.json` do canal `stable` para apontar para a nova versao.

Com isso, os escritorios puxam a nova release automaticamente no horario da tarefa local.

## Boas praticas operacionais

- Use HTTPS obrigatoriamente.
- Hospede o manifesto e o ZIP em infraestrutura controlada pela GCONT.
- Se quiser restringir download, use URL assinada ou token de leitura.
- Nunca empacote `.env`, certificados, storage ou banco no ZIP.
- Mantenha backup do banco antes de liberar releases com migration Prisma.
- Libere primeiro em 1 escritorio piloto antes de abrir o canal `stable`.
- Mantenha versionamento semantico (`x.y.z`) para facilitar rollback e suporte.

## Docker

O repositorio ja possui `Dockerfile` e `docker-compose.yml`. Para futuras implantacoes em clientes novos, o caminho mais simples de operacao tende a ser:

1. publicar imagem versionada em registry privado;
2. agendar `docker compose pull` + `docker compose up -d`;
3. manter o mesmo manifesto para dizer qual tag Docker esta em `stable`.

Nesta etapa, a implementacao minima ficou focada no fluxo de Windows Service, porque ele ja existe no projeto e reduz o tempo para iniciar a distribuicao entre escritorios.
