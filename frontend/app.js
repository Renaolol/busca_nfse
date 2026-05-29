const state = {
  apiBase: localStorage.getItem('nfseApiBase') || window.location.origin,
  clientId: localStorage.getItem('nfseClientId') || '',
  establishmentId: localStorage.getItem('nfseEstablishmentId') || '',
  certificateId: localStorage.getItem('nfseCertificateId') || '',
  currentMenu: localStorage.getItem('nfseConsoleMenu') || 'menuClientes',
  clientList: [],
  selectedClient: null,
  selectedEstablishment: null,
  selectedCertificates: [],
  lastNotes: [],
  selectedNoteIds: new Set()
};

const apiBaseInput = document.getElementById('apiBase');
const consoleOutput = document.getElementById('consoleOutput');
const clientSelect = document.getElementById('clientSelect');
const pendingBox = document.getElementById('pendingBox');
const certificatesSummary = document.getElementById('certificatesSummary');
const certificatesList = document.getElementById('certificatesList');
const menuButtons = Array.from(document.querySelectorAll('button[data-menu-target]'));
const menuPanels = Array.from(document.querySelectorAll('.menu-panel'));

const ctxClientId = document.getElementById('ctxClientId');
const ctxEstablishmentId = document.getElementById('ctxEstablishmentId');
const ctxCertificateId = document.getElementById('ctxCertificateId');
const summaryRazao = document.getElementById('summaryRazao');
const summaryCnpj = document.getElementById('summaryCnpj');
const summaryIm = document.getElementById('summaryIm');

const createClientCard = document.getElementById('createClientCard');
const editClientCard = document.getElementById('editClientCard');
const certificateCard = document.getElementById('certificateCard');

const clientForm = document.getElementById('clientForm');
const clientEditForm = document.getElementById('clientEditForm');
const certificateForm = document.getElementById('certificateForm');
const searchForm = document.getElementById('searchForm');
const nfseRows = document.getElementById('nfseRows');

const certClientId = document.getElementById('certClientId');
const certEstablishmentId = document.getElementById('certEstablishmentId');
const syncClientId = document.getElementById('syncClientId');

const saveApiBaseBtn = document.getElementById('saveApiBase');
const refreshClientsBtn = document.getElementById('refreshClientsBtn');
const newClientBtn = document.getElementById('newClientBtn');
const editClientBtn = document.getElementById('editClientBtn');
const editCertificateBtn = document.getElementById('editCertificateBtn');
const searchSeparatedBtn = document.getElementById('searchSeparatedBtn');
const notesSelectAllBtn = document.getElementById('notesSelectAll');
const notesClearSelectionBtn = document.getElementById('notesClearSelection');
const notesDownloadXmlSelectedBtn = document.getElementById('notesDownloadXmlSelected');
const notesDownloadDanfseSelectedBtn = document.getElementById('notesDownloadDanfseSelected');

const syncStartBtn = document.getElementById('syncStart');
const syncPauseBtn = document.getElementById('syncPause');
const syncResumeBtn = document.getElementById('syncResume');
const syncStatusBtn = document.getElementById('syncStatus');
const syncRunOnceBtn = document.getElementById('syncRunOnce');
const syncRunFiveBtn = document.getElementById('syncRunFive');
const syncLogsBtn = document.getElementById('syncLogs');
const syncReprocessXmlsBtn = document.getElementById('syncReprocessXmls');
const syncSingleNsuInput = document.getElementById('syncSingleNsuInput');
const syncSingleNsuEnvSelect = document.getElementById('syncSingleNsuEnv');
const syncTestSingleNsuBtn = document.getElementById('syncTestSingleNsu');
const syncModeSelect = document.getElementById('syncMode');

const NFSE_TABLE_COLUMNS = 8;

let selectRequestCounter = 0;

boot();

async function boot() {
  apiBaseInput.value = state.apiBase;
  wireEvents();
  setActiveMenu(state.currentMenu, false);
  fillLinkedInputs();
  renderContext();
  await refreshClientList({ preserveSelection: true, autoSelectFirst: true });
  writeConsole('Frontend pronto.');
}

function wireEvents() {
  menuButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const menuId = button.getAttribute('data-menu-target');
      if (!menuId) {
        return;
      }
      setActiveMenu(menuId);
    });
  });

  saveApiBaseBtn.addEventListener('click', async () => {
    state.apiBase = normalizeBaseUrl(apiBaseInput.value);
    localStorage.setItem('nfseApiBase', state.apiBase);
    writeConsole(`API Base URL atualizada: ${state.apiBase}`);
    await refreshClientList({ preserveSelection: true, autoSelectFirst: true });
  });

  refreshClientsBtn.addEventListener('click', async () => {
    await refreshClientList({ preserveSelection: true, autoSelectFirst: true });
  });

  newClientBtn.addEventListener('click', () => {
    toggleCard(createClientCard);
    hideCard(editClientCard);
    hideCard(certificateCard);
  });

  editClientBtn.addEventListener('click', () => {
    if (!state.clientId) {
      showPending(['Selecione um cliente para editar os dados.'], true);
      return;
    }
    fillClientEditForm();
    toggleCard(editClientCard);
    hideCard(createClientCard);
  });

  editCertificateBtn.addEventListener('click', () => {
    if (!state.clientId) {
      showPending(['Selecione um cliente para gerenciar certificados.'], true);
      return;
    }
    updateCertificateSummary(state.selectedCertificates);
    toggleCard(certificateCard);
  });

  clientSelect.addEventListener('change', async (event) => {
    const id = event.target.value;
    if (!id) {
      clearClientContext();
      return;
    }
    await selectClient(id);
  });

  clientForm.addEventListener('submit', onCreateClient);
  clientEditForm.addEventListener('submit', onEditClient);
  certificateForm.addEventListener('submit', onCreateCertificate);
  searchForm.addEventListener('submit', onSearchNfse);
  searchSeparatedBtn.addEventListener('click', onSearchSeparated);
  notesSelectAllBtn.addEventListener('click', () => setVisibleNoteSelection(true));
  notesClearSelectionBtn.addEventListener('click', () => setVisibleNoteSelection(false));
  notesDownloadXmlSelectedBtn.addEventListener('click', () => downloadSelectedNotes('xml'));
  notesDownloadDanfseSelectedBtn.addEventListener('click', () => downloadSelectedNotes('danfse'));

  syncStartBtn.addEventListener('click', () => runSyncAction('iniciar'));
  syncPauseBtn.addEventListener('click', () => runSyncAction('pausar'));
  syncResumeBtn.addEventListener('click', () => runSyncAction('retomar'));
  syncStatusBtn.addEventListener('click', runSyncStatus);
  syncRunOnceBtn.addEventListener('click', () => runSyncNow(1));
  syncRunFiveBtn.addEventListener('click', () => runSyncNow(5));
  syncLogsBtn.addEventListener('click', runSyncLogs);
  syncReprocessXmlsBtn.addEventListener('click', runReprocessXmls);
  syncTestSingleNsuBtn.addEventListener('click', runSingleNsuTest);
}

async function refreshClientList({ preserveSelection, autoSelectFirst }) {
  const clients = await apiCall('/clientes');
  state.clientList = Array.isArray(clients) ? clients : [];

  renderClientSelectOptions(state.clientList);

  if (state.clientList.length === 0) {
    clearClientContext();
    showPending(['Nenhum cliente cadastrado. Clique em "Novo cliente" para iniciar.'], true);
    return;
  }

  const currentClientStillExists = state.clientList.some((item) => item.id === state.clientId);
  const preferredId = preserveSelection && currentClientStillExists ? state.clientId : '';
  const targetId = preferredId || (autoSelectFirst ? state.clientList[0].id : '');

  if (targetId) {
    clientSelect.value = targetId;
    await selectClient(targetId);
  }
}

function renderClientSelectOptions(clients) {
  if (clients.length === 0) {
    clientSelect.innerHTML = '<option value="">Nenhum cliente encontrado</option>';
    return;
  }

  clientSelect.innerHTML = clients
    .map((client) => {
      const cnpj = formatCnpj(client.cnpj || '');
      return `<option value="${escapeHtml(client.id)}">${escapeHtml(client.razaoSocial)} (${escapeHtml(cnpj)})</option>`;
    })
    .join('');
}

async function selectClient(clientId) {
  if (!clientId) {
    clearClientContext();
    return;
  }

  const requestId = ++selectRequestCounter;

  const [client, establishments, certificates, syncStatus] = await Promise.all([
    apiCall(`/clientes/${clientId}`),
    apiCall(`/clientes/${clientId}/estabelecimentos`),
    apiCall(`/clientes/${clientId}/certificados`),
    apiCall(`/clientes/${clientId}/sync/status`)
  ]);

  if (requestId !== selectRequestCounter) {
    return;
  }

  const establishmentList = Array.isArray(establishments) ? establishments : [];
  const certificateList = Array.isArray(certificates) ? certificates : [];

  const selectedEstablishment =
    establishmentList.find((item) => item.ativo) || establishmentList[0] || null;

  const selectedCertificate =
    certificateList.find((item) => item.ativo) || certificateList[0] || null;

  state.clientId = clientId;
  state.selectedClient = client;
  state.selectedEstablishment = selectedEstablishment;
  state.selectedCertificates = certificateList;
  state.establishmentId = selectedEstablishment?.id || '';
  state.certificateId = selectedCertificate?.id || '';

  persistState();
  fillLinkedInputs();
  fillClientEditForm();
  renderContext();
  renderClientSummary();
  updateCertificateSummary(certificateList);

  const notes = await searchClientNotes();
  evaluatePending({
    establishments: establishmentList,
    certificates: certificateList,
    syncStatus,
    notes
  });

  writeConsole('Cliente selecionado', {
    clienteId: clientId,
    estabelecimentoId: state.establishmentId || null,
    certificadoId: state.certificateId || null,
    notas: notes.length
  });
}

function renderClientSummary() {
  const client = state.selectedClient;
  const establishment = state.selectedEstablishment;

  summaryRazao.textContent = client?.razaoSocial || '-';
  summaryCnpj.textContent = formatCnpj(client?.cnpj || '');
  summaryIm.textContent = establishment?.inscricaoMunicipal || '-';

  const cnpjConsulta = onlyDigits(client?.cnpj || '');
  searchForm.elements.cnpjConsulta.value = cnpjConsulta;
}

function fillClientEditForm() {
  const client = state.selectedClient;
  const establishment = state.selectedEstablishment;

  if (!client) {
    return;
  }

  clientEditForm.razaoSocial.value = client.razaoSocial || '';
  clientEditForm.cnpj.value = onlyDigits(client.cnpj || '');
  clientEditForm.inscricaoMunicipal.value = establishment?.inscricaoMunicipal || '';
}

function updateCertificateSummary(certificates) {
  if (!certificates || certificates.length === 0) {
    certificatesSummary.className = 'status-box warn';
    certificatesSummary.textContent = 'Sem certificado cadastrado para este cliente.';
    certificatesList.innerHTML = '';
    return;
  }

  const ativos = certificates.filter((item) => item.ativo);
  certificatesSummary.className = 'status-box ok';
  certificatesSummary.textContent = `Total: ${certificates.length} certificado(s). Ativo(s): ${ativos.length}.`;
  renderCertificatesList(certificates);
}

function renderCertificatesList(certificates) {
  certificatesList.innerHTML = certificates
    .map((item) => {
      const validadeFim = item.validadeFim ? new Date(item.validadeFim).toLocaleDateString('pt-BR') : '-';
      const status = item.ativo ? 'ativo' : 'inativo';
      const deleteButton = item.ativo
        ? ''
        : `<button class="btn ghost" type="button" data-cert-action="excluir" data-cert-id="${item.id}">Excluir</button>`;

      return `
        <article class="cert-card">
          <h4>${escapeHtml(item.nome || 'Sem nome')} <small>(${escapeHtml(status)})</small></h4>
          <p class="cert-meta">ID: <code>${escapeHtml(item.id)}</code></p>
          <p class="cert-meta">CNPJ titular: ${escapeHtml(formatCnpj(item.cnpjTitular || ''))}</p>
          <p class="cert-meta">Validade fim: ${escapeHtml(validadeFim)}</p>
          <div class="btn-row">
            <button class="btn ghost" type="button" data-cert-action="validar" data-cert-id="${item.id}">Validar</button>
            <button class="btn ghost" type="button" data-cert-action="ativar" data-cert-id="${item.id}">Ativar</button>
            <button class="btn ghost" type="button" data-cert-action="desativar" data-cert-id="${item.id}">Desativar</button>
            ${deleteButton}
          </div>
        </article>
      `;
    })
    .join('');

  certificatesList
    .querySelectorAll('button[data-cert-action]')
    .forEach((button) => button.addEventListener('click', onCertificateActionClick));
}

async function onCertificateActionClick(event) {
  const button = event.currentTarget;
  const action = button.getAttribute('data-cert-action');
  const certificateId = button.getAttribute('data-cert-id');

  if (!action || !certificateId) {
    return;
  }

  let endpoint = '';
  let method = 'POST';
  if (action === 'validar') {
    endpoint = `/certificados/${certificateId}/validar`;
  } else if (action === 'ativar') {
    endpoint = `/certificados/${certificateId}/ativar`;
  } else if (action === 'desativar') {
    endpoint = `/certificados/${certificateId}/desativar`;
  } else if (action === 'excluir') {
    if (!window.confirm('Deseja excluir este certificado inativo?')) {
      return;
    }
    endpoint = `/certificados/${certificateId}`;
    method = 'DELETE';
  }

  if (!endpoint) {
    return;
  }

  if (!state.clientId) {
    showPending(['Selecione um cliente antes de operar certificados.'], true);
    return;
  }

  const result = await apiCall(withClientScope(endpoint), { method });
  if (state.clientId) {
    await selectClient(state.clientId);
  }
  writeConsole(`Acao de certificado: ${action}`, result);
}

function evaluatePending({ establishments, certificates, syncStatus, notes }) {
  const issues = [];

  if (!establishments.length) {
    issues.push('Cliente sem estabelecimento principal.');
  }

  if (!certificates.length) {
    issues.push('Cliente sem certificado cadastrado. Use "Editar certificados" para adicionar.');
  }

  if (!syncStatus?.controles || syncStatus.controles.length === 0) {
    issues.push('Sincronizacao ainda nao iniciada para este cliente.');
  }

  if (!notes.length) {
    issues.push('Cliente sem notas no banco local. Rode a sincronizacao para popular as NFS-e.');
  }

  if (issues.length === 0) {
    showPending(['Cliente pronto: dados, certificado, sync e notas disponiveis.'], false, true);
  } else {
    showPending(issues, true);
  }
}

function showPending(messages, isWarning, isSuccess = false) {
  pendingBox.className = 'status-box';
  if (isWarning) {
    pendingBox.classList.add('warn');
  }
  if (isSuccess) {
    pendingBox.classList.add('ok');
  }

  pendingBox.innerHTML = messages
    .map((message) => `<div>${escapeHtml(message)}</div>`)
    .join('');
}

function clearClientContext() {
  state.clientId = '';
  state.establishmentId = '';
  state.certificateId = '';
  state.selectedClient = null;
  state.selectedEstablishment = null;
  state.selectedCertificates = [];
  state.lastNotes = [];
  state.selectedNoteIds = new Set();

  persistState();
  fillLinkedInputs();
  renderContext();

  summaryRazao.textContent = '-';
  summaryCnpj.textContent = '-';
  summaryIm.textContent = '-';
  certificatesSummary.className = 'status-box muted';
  certificatesSummary.textContent = 'Sem leitura de certificados ainda.';
  nfseRows.innerHTML = `<tr><td colspan="${NFSE_TABLE_COLUMNS}">Nenhum resultado ainda.</td></tr>`;
}

async function onCreateClient(event) {
  event.preventDefault();
  const form = event.currentTarget;

  const payload = {
    razaoSocial: form.razaoSocial.value.trim(),
    cnpj: onlyDigits(form.cnpj.value),
    inscricaoMunicipal: form.inscricaoMunicipal.value.trim() || undefined
  };

  const result = await apiCall('/clientes', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  hideCard(createClientCard);
  await refreshClientList({ preserveSelection: false, autoSelectFirst: false });
  if (result?.id) {
    clientSelect.value = result.id;
    await selectClient(result.id);
  }

  writeConsole('Cliente criado', result);
}

async function onEditClient(event) {
  event.preventDefault();

  if (!state.clientId) {
    showPending(['Selecione um cliente antes de editar.'], true);
    return;
  }

  const payload = {
    razaoSocial: clientEditForm.razaoSocial.value.trim(),
    cnpj: onlyDigits(clientEditForm.cnpj.value),
    inscricaoMunicipal: clientEditForm.inscricaoMunicipal.value.trim() || undefined
  };

  const result = await apiCall(`/clientes/${state.clientId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

  await refreshClientList({ preserveSelection: true, autoSelectFirst: true });
  writeConsole('Cliente atualizado', result);
}

async function onCreateCertificate(event) {
  event.preventDefault();

  if (!state.clientId || !state.establishmentId) {
    showPending(['Selecione um cliente com estabelecimento antes de cadastrar certificado.'], true);
    return;
  }

  const fileInput = document.getElementById('certFile');
  const file = fileInput.files?.[0];
  if (!file) {
    showPending(['Selecione um arquivo .pfx/.p12 para cadastrar certificado.'], true);
    return;
  }

  try {
    const arquivoBase64 = await fileToBase64(file);
    const payload = {
      nome: certificateForm.nome.value.trim(),
      cnpjTitular: onlyDigits(certificateForm.cnpjTitular.value),
      estabelecimentoId: state.establishmentId,
      arquivoBase64,
      senha: certificateForm.senha.value
    };

    const result = await apiCall(`/clientes/${state.clientId}/certificados`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    await selectClient(state.clientId);
    showPending(['Certificado salvo com sucesso.'], false, true);
    writeConsole('Certificado cadastrado', result);
  } catch (error) {
    showPending([`Falha ao salvar certificado: ${extractErrorMessage(error)}`], true);
  }
}

async function runSyncAction(action) {
  if (!state.clientId) {
    showPending(['Selecione um cliente para executar sincronizacao.'], true);
    return;
  }

  let body;
  if (action === 'iniciar') {
    body = JSON.stringify({
      modo: syncModeSelect?.value === 'diario' ? 'diario' : 'historico'
    });
  }

  const result = await apiCall(`/clientes/${state.clientId}/sync/${action}`, {
    method: 'POST',
    body
  });

  await selectClient(state.clientId);
  writeConsole(`Sync ${action} executado`, result);
}

async function runSyncStatus() {
  if (!state.clientId) {
    showPending(['Selecione um cliente para consultar status de sync.'], true);
    return;
  }

  const result = await apiCall(`/clientes/${state.clientId}/sync/status`);
  writeConsole('Status de sync', result);
}

async function runSyncNow(times) {
  if (!state.clientId) {
    showPending(['Selecione um cliente antes de rodar sync manual.'], true);
    return;
  }

  const results = [];
  for (let i = 0; i < times; i += 1) {
    const res = await apiCall('/sync/rodar-agora', { method: 'POST' });
    results.push({ ciclo: i + 1, ...res });
  }

  await selectClient(state.clientId);
  writeConsole(`Sync manual executado ${times}x`, results);
}

async function runSyncLogs() {
  if (!state.clientId) {
    showPending(['Selecione um cliente para consultar os logs de sync.'], true);
    return;
  }

  const result = await apiCall(withClientScope('/sync/logs'));
  writeConsole('Logs de sync', result);
}

async function runReprocessXmls() {
  if (!state.clientId) {
    showPending(['Selecione um cliente antes de reprocessar XMLs.'], true);
    return;
  }

  const payload = {
    clienteId: state.clientId,
    ambiente: 'producao',
    limit: 1000,
    somenteIncompletos: false,
    regenerarDanfse: true
  };

  const result = await apiCall('/nfse/reprocessar-xmls', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  await selectClient(state.clientId);
  writeConsole('Reprocessamento de XMLs finalizado', result);
}

async function runSingleNsuTest() {
  if (!state.clientId || !state.establishmentId) {
    showPending(['Selecione um cliente com estabelecimento para testar um NSU.'], true);
    return;
  }

  const nsu = String(syncSingleNsuInput.value || '').trim();
  if (!/^\d+$/.test(nsu)) {
    showPending(['Informe um NSU numerico valido para o teste.'], true);
    return;
  }
  const ambiente = syncSingleNsuEnvSelect?.value === 'producao' ? 'producao' : 'producao_restrita';

  try {
    const result = await apiCall('/sync/testar-nsu', {
      method: 'POST',
      body: JSON.stringify({
        clienteId: state.clientId,
        estabelecimentoId: state.establishmentId,
        nsu,
        ambiente
      })
    });

    if (result?.hasDocument) {
      showPending([`Teste NSU ${nsu} (${ambiente}): documento encontrado.`], false, true);
    } else {
      showPending([`Teste NSU ${nsu} (${ambiente}): sem documento para este NSU.`], false);
    }

    writeConsole(`Teste de NSU ${nsu} (${ambiente})`, result);
  } catch (error) {
    showPending([`Falha ao testar NSU: ${extractErrorMessage(error)}`], true);
  }
}

async function onSearchNfse(event) {
  event.preventDefault();
  if (!state.clientId) {
    showPending(['Selecione um cliente para pesquisar notas.'], true);
    return;
  }

  const query = buildSearchQueryString();
  const result = await apiCall(`/nfse${query ? `?${query}` : ''}`);
  state.lastNotes = Array.isArray(result) ? result : [];
  renderNfseRows(state.lastNotes);
  writeConsole('Resultado da pesquisa NFS-e', result);
}

async function onSearchSeparated() {
  if (!state.clientId) {
    showPending(['Selecione um cliente para pesquisar notas separadas.'], true);
    return;
  }

  const cnpjConsulta = onlyDigits(searchForm.elements.cnpjConsulta.value);
  if (!cnpjConsulta || cnpjConsulta.length !== 14) {
    showPending(['Informe CNPJ consulta com 14 digitos para separar emitidas e tomadas.'], true);
    return;
  }

  const query = buildSearchQueryString();
  const result = await apiCall(`/nfse/separadas${query ? `?${query}` : ''}`);
  renderSeparatedRows(result);
  writeConsole('Resultado separado por relacao', result);
}

async function searchClientNotes() {
  if (!state.clientId) {
    state.lastNotes = [];
    return [];
  }

  const result = await apiCall(`/nfse?clienteId=${encodeURIComponent(state.clientId)}`);
  const notes = Array.isArray(result) ? result : [];
  state.lastNotes = notes;
  renderNfseRows(notes);
  return notes;
}

function buildSearchQueryString() {
  const params = new URLSearchParams();
  const fields = [
    'clienteId',
    'cnpjPrestador',
    'cnpjTomador',
    'cnpjConsulta',
    'tipoRelacao',
    'status',
    'competencia',
    'dataInicio',
    'dataFim',
    'valorMin',
    'valorMax'
  ];

  fields.forEach((key) => {
    const raw = searchForm.elements[key].value?.trim();
    if (raw) {
      params.set(key, key.includes('cnpj') ? onlyDigits(raw) : raw);
    }
  });

  if (!params.get('clienteId') && state.clientId) {
    params.set('clienteId', state.clientId);
  }

  return params.toString();
}

function renderNfseRows(items) {
  if (!Array.isArray(items) || items.length === 0) {
    state.selectedNoteIds = new Set();
    nfseRows.innerHTML = `<tr><td colspan="${NFSE_TABLE_COLUMNS}">Nenhum resultado encontrado.</td></tr>`;
    return;
  }

  keepSelectedIdsVisible(items.map((item) => item.id));
  nfseRows.innerHTML = items
    .map((item) => {
      const checked = state.selectedNoteIds.has(item.id) ? 'checked' : '';
      return `<tr>
        <td><input type="checkbox" class="note-select" data-note-id="${item.id}" ${checked} /></td>
        <td>${escapeHtml(item.numeroNfse ?? '-')}</td>
        <td>${escapeHtml(formatEmissionDate(item.dataEmissao))}</td>
        <td>${escapeHtml(item.status ?? '-')}</td>
        <td>${escapeHtml(formatParty(item.razaoSocialPrestador, item.cnpjPrestador))}</td>
        <td>${escapeHtml(formatParty(item.razaoSocialTomador, item.cnpjTomador))}</td>
        <td>${escapeHtml(formatCurrencyValue(item.valorServico))}</td>
        <td>
          <button class="btn ghost" type="button" data-action="xml" data-id="${item.id}">XML</button>
          <button class="btn ghost" type="button" data-action="danfse" data-id="${item.id}">DANFSE</button>
        </td>
      </tr>`;
    })
    .join('');

  wireSelectionCheckboxes();
  wireDownloadButtons();
}

function renderSeparatedRows(payload) {
  const emitidas = Array.isArray(payload?.emitidas) ? payload.emitidas : [];
  const tomadas = Array.isArray(payload?.tomadas) ? payload.tomadas : [];

  if (emitidas.length === 0 && tomadas.length === 0) {
    state.selectedNoteIds = new Set();
    nfseRows.innerHTML = `<tr><td colspan="${NFSE_TABLE_COLUMNS}">Nenhum resultado encontrado para o CNPJ informado.</td></tr>`;
    return;
  }

  keepSelectedIdsVisible([...emitidas, ...tomadas].map((item) => item.id));
  const groupRow = (title) =>
    `<tr class="group-row"><td colspan="${NFSE_TABLE_COLUMNS}"><strong>${escapeHtml(title)}</strong></td></tr>`;

  const itemRows = (items) =>
    items
      .map((item) => {
        const checked = state.selectedNoteIds.has(item.id) ? 'checked' : '';
        return `<tr>
          <td><input type="checkbox" class="note-select" data-note-id="${item.id}" ${checked} /></td>
          <td>${escapeHtml(item.numeroNfse ?? '-')}</td>
          <td>${escapeHtml(formatEmissionDate(item.dataEmissao))}</td>
          <td>${escapeHtml(item.status ?? '-')}</td>
          <td>${escapeHtml(formatParty(item.razaoSocialPrestador, item.cnpjPrestador))}</td>
          <td>${escapeHtml(formatParty(item.razaoSocialTomador, item.cnpjTomador))}</td>
          <td>${escapeHtml(formatCurrencyValue(item.valorServico))}</td>
          <td>
            <button class="btn ghost" type="button" data-action="xml" data-id="${item.id}">XML</button>
            <button class="btn ghost" type="button" data-action="danfse" data-id="${item.id}">DANFSE</button>
          </td>
        </tr>`;
      })
      .join('');

  nfseRows.innerHTML = [
    groupRow(`Emitidas (${emitidas.length})`),
    emitidas.length
      ? itemRows(emitidas)
      : `<tr><td colspan="${NFSE_TABLE_COLUMNS}">Nenhuma nota emitida.</td></tr>`,
    groupRow(`Tomadas (${tomadas.length})`),
    tomadas.length
      ? itemRows(tomadas)
      : `<tr><td colspan="${NFSE_TABLE_COLUMNS}">Nenhuma nota tomada.</td></tr>`
  ].join('');

  wireSelectionCheckboxes();
  wireDownloadButtons();
}

function wireDownloadButtons() {
  nfseRows.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const action = btn.getAttribute('data-action');
      if (!id) {
        return;
      }
      try {
        if (action === 'xml') {
          const xml = await apiCall(withClientScope(`/nfse/${id}/xml`));
          downloadFromPayload(xml, `NFSE-${id}.xml`);
          writeConsole(`XML da NFS-e ${id}`, xml);
          return;
        }

        if (action === 'danfse') {
          const danfse = await apiCall(withClientScope(`/nfse/${id}/danfse`));
          downloadFromPayload(danfse, `DANFSE-${id}.pdf`);
          writeConsole(`DANFSE da NFS-e ${id}`, danfse);
        }
      } catch (error) {
        showPending([`Falha ao baixar arquivo da NFS-e ${id}: ${extractErrorMessage(error)}`], true);
      }
    });
  });
}

function wireSelectionCheckboxes() {
  nfseRows.querySelectorAll('input.note-select[data-note-id]').forEach((input) => {
    input.addEventListener('change', () => {
      const noteId = input.getAttribute('data-note-id');
      if (!noteId) {
        return;
      }
      if (input.checked) {
        state.selectedNoteIds.add(noteId);
      } else {
        state.selectedNoteIds.delete(noteId);
      }
    });
  });
}

function keepSelectedIdsVisible(visibleIds) {
  const visibleSet = new Set((visibleIds || []).filter(Boolean));
  const nextSelection = new Set();
  state.selectedNoteIds.forEach((id) => {
    if (visibleSet.has(id)) {
      nextSelection.add(id);
    }
  });
  state.selectedNoteIds = nextSelection;
}

function setVisibleNoteSelection(checked) {
  const visibleInputs = Array.from(nfseRows.querySelectorAll('input.note-select[data-note-id]'));
  if (visibleInputs.length === 0) {
    return;
  }

  visibleInputs.forEach((input) => {
    const noteId = input.getAttribute('data-note-id');
    if (!noteId) {
      return;
    }
    input.checked = checked;
    if (checked) {
      state.selectedNoteIds.add(noteId);
    } else {
      state.selectedNoteIds.delete(noteId);
    }
  });
}

async function downloadSelectedNotes(type) {
  const selectedIds = Array.from(state.selectedNoteIds);
  if (selectedIds.length === 0) {
    showPending(['Selecione ao menos uma nota para baixar em lote.'], true);
    return;
  }

  let success = 0;
  let failed = 0;
  for (const noteId of selectedIds) {
    try {
      if (type === 'xml') {
        const xml = await apiCall(withClientScope(`/nfse/${noteId}/xml`));
        downloadFromPayload(xml, `NFSE-${noteId}.xml`);
      } else {
        const danfse = await apiCall(withClientScope(`/nfse/${noteId}/danfse`));
        downloadFromPayload(danfse, `DANFSE-${noteId}.pdf`);
      }
      success += 1;
    } catch {
      failed += 1;
    }
  }

  const actionLabel = type === 'xml' ? 'XML' : 'DANFSE';
  if (failed > 0) {
    showPending(
      [
        `Download em lote concluido com alertas: ${success} ${actionLabel} baixado(s), ${failed} falha(s).`
      ],
      true
    );
  } else {
    showPending(
      [`Download em lote concluido: ${success} ${actionLabel} baixado(s).`],
      false,
      true
    );
  }

  writeConsole(`Download em lote (${actionLabel})`, {
    totalSelecionadas: selectedIds.length,
    sucesso: success,
    falhas: failed
  });
}

function resolveRelacao(item) {
  const cnpjConsulta = onlyDigits(searchForm.elements.cnpjConsulta.value);
  if (!cnpjConsulta) {
    return '-';
  }

  const prestador = onlyDigits(item.cnpjPrestador);
  const tomador = onlyDigits(item.cnpjTomador);

  if (prestador === cnpjConsulta && tomador === cnpjConsulta) {
    return 'emitida/tomada';
  }
  if (prestador === cnpjConsulta) {
    return 'emitida';
  }
  if (tomador === cnpjConsulta) {
    return 'tomada';
  }

  return '-';
}

async function apiCall(path, options = {}) {
  const url = `${state.apiBase}${path}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body
  });

  const text = await response.text();
  const data = tryParseJson(text);

  if (!response.ok) {
    const payload = data || { statusCode: response.status, message: text };
    const message = extractApiMessage(payload) || `Erro ${response.status} em ${path}`;
    writeConsole(`Erro ${response.status} em ${path}`, payload, true);
    const error = new Error(message);
    error.statusCode = response.status;
    error.payload = payload;
    throw error;
  }

  return data ?? text;
}

function withClientScope(path) {
  if (!state.clientId) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}clienteId=${encodeURIComponent(state.clientId)}`;
}

function downloadFromPayload(payload, fallbackName) {
  if (!payload?.contentBase64) {
    throw new Error('Resposta sem conteudo para download.');
  }

  const fileName = payload.fileName || fallbackName || 'download.bin';
  const contentType = payload.contentType || 'application/octet-stream';
  const blob = base64ToBlob(payload.contentBase64, contentType);
  triggerBrowserDownload(fileName, blob);
}

function base64ToBlob(base64, contentType) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
}

function triggerBrowserDownload(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function extractApiMessage(payload) {
  if (!payload) {
    return '';
  }

  if (Array.isArray(payload.message)) {
    return payload.message.join('; ');
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message.trim();
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error.trim();
  }

  return '';
}

function extractErrorMessage(error) {
  if (!error) {
    return 'Erro inesperado.';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  const payloadMessage = extractApiMessage(error.payload);
  if (payloadMessage) {
    return payloadMessage;
  }

  return 'Erro inesperado.';
}

function fillLinkedInputs() {
  certClientId.value = state.clientId;
  certEstablishmentId.value = state.establishmentId;
  syncClientId.value = state.clientId;
  searchForm.elements.clienteId.value = state.clientId;

  if (state.selectedClient?.cnpj) {
    certificateForm.cnpjTitular.value = onlyDigits(state.selectedClient.cnpj);
  }
}

function renderContext() {
  ctxClientId.textContent = state.clientId || '-';
  ctxEstablishmentId.textContent = state.establishmentId || '-';
  ctxCertificateId.textContent = state.certificateId || '-';
}

function persistState() {
  localStorage.setItem('nfseClientId', state.clientId);
  localStorage.setItem('nfseEstablishmentId', state.establishmentId);
  localStorage.setItem('nfseCertificateId', state.certificateId);
}

function setActiveMenu(menuId, persist = true) {
  const hasPanel = menuPanels.some((panel) => panel.id === menuId);
  const targetMenuId = hasPanel ? menuId : 'menuClientes';

  menuPanels.forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== targetMenuId);
  });

  menuButtons.forEach((button) => {
    const isActive = button.getAttribute('data-menu-target') === targetMenuId;
    button.classList.toggle('active', isActive);
  });

  state.currentMenu = targetMenuId;
  if (persist) {
    localStorage.setItem('nfseConsoleMenu', targetMenuId);
  }
}

function writeConsole(title, payload = null, isError = false) {
  const stamp = new Date().toISOString();
  const banner = `${isError ? '[ERROR]' : '[INFO]'} ${stamp} - ${title}`;
  const body = payload ? `\n${JSON.stringify(payload, null, 2)}` : '';
  consoleOutput.textContent = `${banner}${body}`;
}

function toggleCard(element) {
  element.classList.toggle('hidden');
}

function hideCard(element) {
  element.classList.add('hidden');
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '') || window.location.origin;
}

function formatCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length !== 14) {
    return digits || '-';
  }

  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatParty(nome, cnpj) {
  const nomeLimpo = String(nome || '').trim();
  const cnpjFormatado = formatCnpj(cnpj || '');

  if (!nomeLimpo && cnpjFormatado === '-') {
    return '-';
  }

  if (!nomeLimpo) {
    return cnpjFormatado;
  }

  if (cnpjFormatado === '-') {
    return nomeLimpo;
  }

  return `${nomeLimpo} (${cnpjFormatado})`;
}

function formatCurrencyValue(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const numeric = toNumericValue(value);
  if (numeric === null || Number.isNaN(numeric)) {
    return '-';
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(numeric);
}

function toNumericValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    return parseLocalizedNumber(value);
  }

  if (typeof value === 'object') {
    if (typeof value.$numberDecimal === 'string') {
      return parseLocalizedNumber(value.$numberDecimal);
    }

    if (typeof value.value === 'number' || typeof value.value === 'string') {
      return toNumericValue(value.value);
    }

    if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
      return parseLocalizedNumber(value.toString());
    }

    const serialized = JSON.stringify(value);
    if (!serialized) {
      return null;
    }

    const match = serialized.match(/-?\d+(?:[.,]\d+)?/);
    return match ? parseLocalizedNumber(match[0]) : null;
  }

  return null;
}

function parseLocalizedNumber(raw) {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return null;
  }

  let sanitized = normalized.replace(/\s/g, '').replace(/[^\d,.\-+eE]/g, '');
  if (!sanitized) {
    return null;
  }

  const hasComma = sanitized.includes(',');
  const hasDot = sanitized.includes('.');

  if (hasComma && hasDot) {
    if (sanitized.lastIndexOf(',') > sanitized.lastIndexOf('.')) {
      sanitized = sanitized.replace(/\./g, '').replace(/,/g, '.');
    } else {
      sanitized = sanitized.replace(/,/g, '');
    }
  } else if (hasComma) {
    sanitized = sanitized.replace(/,/g, '.');
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatEmissionDate(value) {
  if (!value) {
    return '-';
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function tryParseJson(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Falha ao ler certificado.'));
        return;
      }
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Falha ao converter certificado para Base64.'));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
