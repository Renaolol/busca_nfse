import {
  mockAlerts,
  mockCertificates,
  mockClients,
  mockRunningExecution,
  mockSearchRuns,
  mockUsers,
  mockXmlFiles
} from './mocks/index.js';

const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const drawerRoot = document.getElementById('drawerRoot');
const toastRoot = document.getElementById('toastRoot');

const navItems = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
  { key: 'clientes', label: 'Clientes', icon: 'users', route: '/clientes' },
  { key: 'certificados', label: 'Certificados', icon: 'shield', route: '/certificados' },
  { key: 'buscas', label: 'Buscas NFS-e', icon: 'search', route: '/buscas' },
  { key: 'xmls', label: 'XMLs Armazenados', icon: 'file', route: '/xmls' },
  { key: 'alertas', label: 'Alertas', icon: 'alert', route: '/alertas' },
  { key: 'configuracoes', label: 'Configuracoes', icon: 'settings', route: '/configuracoes' }
];

const pageMeta = {
  dashboard: {
    title: 'Dashboard',
    description: 'Visao geral da operacao noturna de busca e armazenamento de NFS-e.'
  },
  clientes: {
    title: 'Clientes',
    description: 'Gerencie clientes monitorados para busca automatica de NFS-e.'
  },
  'client-details': {
    title: 'Detalhes do cliente',
    description: 'Acompanhe dados, historico de buscas, XMLs e configuracoes do cliente.'
  },
  certificados: {
    title: 'Certificados',
    description: 'Acompanhe validade, vinculo e status dos certificados digitais.'
  },
  buscas: {
    title: 'Buscas NFS-e',
    description: 'Historico das rotinas automaticas e reprocessamentos manuais.'
  },
  xmls: {
    title: 'XMLs Armazenados',
    description: 'Consulte os arquivos XML de NFS-e salvos no servidor interno.'
  },
  alertas: {
    title: 'Alertas',
    description: 'Acompanhe pendencias que exigem acao da equipe.'
  },
  configuracoes: {
    title: 'Configuracoes',
    description: 'Ajuste parametros da rotina de busca e do armazenamento interno.'
  }
};

const state = {
  route: parseRoute(window.location.hash),
  mobileSidebarOpen: false,
  dataReady: false,
  modal: null,
  drawer: null,
  toasts: [],
  selectedClientIds: new Set(),
  selectedAlertIds: new Set(),
  clients: [],
  certificates: [],
  searchRuns: [],
  runningExecution: null,
  xmlFiles: [],
  alerts: [],
  users: [],
  settings: {
    tab: 'geral',
    geral: {
      nomeAmbiente: 'GCONT - Ambiente Interno',
      modoOperacao: 'Producao',
      statusSistema: 'Operacional'
    },
    rotina: {
      ativa: true,
      horarioInicio: '02:00',
      limiteClientes: 200,
      retryFalha: true,
      maxTentativas: 3,
      intervaloTentativas: 5
    },
    servidor: {
      caminhoBase: '\\\\servidor\\xmls',
      porCliente: true,
      porCnpj: false,
      porAnoMes: true
    },
    notificacoes: {
      alertarCertificados: true,
      diasAntecedencia: 30,
      alertarFalhaBusca: true,
      alertarXmlNaoArmazenado: true,
      canal: 'Somente painel'
    }
  },
  filters: {
    clients: {
      query: '',
      statusBusca: 'Todos',
      certificado: 'Todos',
      municipio: 'Todos'
    },
    runs: {
      periodo: '30',
      cliente: 'Todos',
      municipio: 'Todos',
      status: 'Todos',
      tipo: 'Todos'
    },
    xmls: {
      cliente: 'Todos',
      cnpj: '',
      numero: '',
      emissaoInicio: '',
      emissaoFim: '',
      downloadInicio: '',
      downloadFim: '',
      municipio: 'Todos',
      tipo: 'Todos',
      status: 'Todos',
      caminho: ''
    },
    alerts: {
      severidade: 'Todos',
      tipo: 'Todos',
      status: 'Todos',
      periodo: '30',
      cliente: 'Todos'
    }
  },
  tableState: {
    dashboardSearches: 'loading',
    clients: 'loading',
    certificates: 'loading',
    runs: 'loading',
    xmls: 'loading',
    alerts: 'loading'
  }
};

boot();

function boot() {
  if (!window.location.hash) {
    window.location.hash = '#/dashboard';
    return;
  }

  wireGlobalEvents();
  render();
  void initializeData();
}

async function initializeData() {
  setGlobalLoading(true);
  render();

  await wait(350);

  state.clients = deepClone(mockClients);
  state.certificates = deepClone(mockCertificates);
  state.searchRuns = deepClone(mockSearchRuns);
  state.runningExecution = deepClone(mockRunningExecution);
  state.xmlFiles = deepClone(mockXmlFiles);
  state.alerts = deepClone(mockAlerts);
  state.users = deepClone(mockUsers);

  setGlobalLoading(false);
  render();
}

function wireGlobalEvents() {
  window.addEventListener('hashchange', () => {
    state.route = parseRoute(window.location.hash);
    state.mobileSidebarOpen = false;
    render();
  });

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('submit', onDocumentSubmit);
  document.addEventListener('change', onDocumentChange);
}

function onDocumentClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) {
    return;
  }

  const action = actionNode.getAttribute('data-action');
  if (!action) {
    return;
  }

  event.preventDefault();

  switch (action) {
    case 'navigate': {
      const route = actionNode.getAttribute('data-route');
      if (route) {
        navigate(route);
      }
      return;
    }
    case 'toggle-sidebar': {
      state.mobileSidebarOpen = !state.mobileSidebarOpen;
      render();
      return;
    }
    case 'close-modal': {
      closeModal();
      return;
    }
    case 'close-drawer': {
      closeDrawer();
      return;
    }
    case 'open-new-client-modal': {
      openModal({ kind: 'client-form', mode: 'create' });
      return;
    }
    case 'open-import-client-modal': {
      openModal({ kind: 'import-clients' });
      return;
    }
    case 'client-edit': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      openModal({ kind: 'client-form', mode: 'edit', clientId });
      return;
    }
    case 'client-details': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      navigate(`/clientes/${clientId}`);
      return;
    }
    case 'client-reprocess': {
      const clientId = actionNode.getAttribute('data-client-id');
      const client = findClientById(clientId);
      if (!client) {
        return;
      }
      openModal({
        kind: 'confirm',
        title: 'Reprocessar busca',
        subtitle: 'Deseja reprocessar a busca de NFS-e deste cliente na proxima execucao?',
        confirmLabel: 'Confirmar reprocessamento',
        intent: 'warning',
        payload: { type: 'reprocess-client', clientId: client.id }
      });
      return;
    }
    case 'client-toggle-search': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      const client = findClientById(clientId);
      if (!client) {
        return;
      }
      client.buscaAtiva = !client.buscaAtiva;
      client.buscaStatus = client.buscaAtiva ? 'Ativo' : 'Inativo';
      pushToast(
        `Busca ${client.buscaAtiva ? 'ativada' : 'desativada'} para ${client.razaoSocial}.`,
        client.buscaAtiva ? 'success' : 'info'
      );
      render();
      return;
    }
    case 'clients-toggle-all': {
      const checked = actionNode.checked;
      const filtered = getFilteredClients();
      state.selectedClientIds = checked ? new Set(filtered.map((item) => item.id)) : new Set();
      render();
      return;
    }
    case 'client-select': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      if (actionNode.checked) {
        state.selectedClientIds.add(clientId);
      } else {
        state.selectedClientIds.delete(clientId);
      }
      render();
      return;
    }
    case 'clients-bulk-activate': {
      bulkUpdateClientSearch(true);
      return;
    }
    case 'clients-bulk-deactivate': {
      bulkUpdateClientSearch(false);
      return;
    }
    case 'clients-bulk-reprocess': {
      if (state.selectedClientIds.size === 0) {
        pushToast('Selecione ao menos um cliente para reprocessar.', 'error');
        return;
      }
      openModal({
        kind: 'confirm',
        title: 'Reprocessar clientes selecionados',
        subtitle: `Confirmar reprocessamento de ${state.selectedClientIds.size} cliente(s)?`,
        confirmLabel: 'Reprocessar selecionados',
        intent: 'warning',
        payload: { type: 'reprocess-selected' }
      });
      return;
    }
    case 'certificate-open-create': {
      openModal({ kind: 'certificate-form' });
      return;
    }
    case 'certificate-test': {
      const certificateId = actionNode.getAttribute('data-cert-id');
      if (!certificateId) {
        return;
      }
      simulateCertificateTest(certificateId);
      return;
    }
    case 'certificate-view-client': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      navigate(`/clientes/${clientId}`);
      return;
    }
    case 'certificate-replace': {
      const certId = actionNode.getAttribute('data-cert-id');
      openModal({
        kind: 'confirm',
        title: 'Substituir certificado',
        subtitle: 'Enviar novo arquivo para substituir o atual?',
        confirmLabel: 'Substituir',
        payload: { type: 'replace-certificate', certId }
      });
      return;
    }
    case 'certificate-unlink': {
      const certId = actionNode.getAttribute('data-cert-id');
      openModal({
        kind: 'confirm',
        title: 'Remover vinculo de certificado',
        subtitle: 'Deseja remover o vinculo deste certificado com o cliente atual?',
        confirmLabel: 'Remover vinculo',
        payload: { type: 'unlink-certificate', certId }
      });
      return;
    }
    case 'open-run-details': {
      const runId = actionNode.getAttribute('data-run-id');
      if (!runId) {
        return;
      }
      openDrawer({ kind: 'run-details', runId });
      return;
    }
    case 'run-export': {
      pushToast('Relatorio da execucao exportado (mock).', 'success');
      return;
    }
    case 'run-reprocess-failures': {
      const runId = actionNode.getAttribute('data-run-id');
      openModal({
        kind: 'confirm',
        title: 'Reprocessar falhas',
        subtitle: 'Deseja reprocessar os clientes com falha desta execucao?',
        confirmLabel: 'Reprocessar falhas',
        payload: { type: 'reprocess-run-failures', runId }
      });
      return;
    }
    case 'execution-refresh': {
      refreshRunningExecution();
      return;
    }
    case 'execution-reprocess-client': {
      const clientId = actionNode.getAttribute('data-client-id');
      const client = findClientById(clientId);
      if (client) {
        pushToast(`Cliente ${client.razaoSocial} enviado para fila de reprocessamento.`, 'success');
      }
      return;
    }
    case 'xml-export-list': {
      pushToast('Listagem exportada para CSV (mock).', 'success');
      return;
    }
    case 'xml-details': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      openModal({ kind: 'xml-details', xmlId });
      return;
    }
    case 'xml-view': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      openModal({ kind: 'xml-view', xmlId });
      return;
    }
    case 'xml-download': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      downloadXmlById(xmlId);
      return;
    }
    case 'xml-copy-path': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      const xmlFile = findXmlById(xmlId);
      if (!xmlFile) {
        return;
      }
      void copyToClipboard(xmlFile.caminhoServidor);
      return;
    }
    case 'xml-open-folder': {
      pushToast('Abertura de pasta delegada para o agente local (mock).', 'info');
      return;
    }
    case 'alerts-mark-selected': {
      markSelectedAlertsResolved();
      return;
    }
    case 'alert-select': {
      const alertId = actionNode.getAttribute('data-alert-id');
      if (!alertId) {
        return;
      }
      if (actionNode.checked) {
        state.selectedAlertIds.add(alertId);
      } else {
        state.selectedAlertIds.delete(alertId);
      }
      render();
      return;
    }
    case 'alert-details': {
      const alertId = actionNode.getAttribute('data-alert-id');
      if (!alertId) {
        return;
      }
      openDrawer({ kind: 'alert-details', alertId });
      return;
    }
    case 'alert-resolve': {
      const alertId = actionNode.getAttribute('data-alert-id');
      resolveAlert(alertId);
      return;
    }
    case 'alert-reprocess': {
      const alertId = actionNode.getAttribute('data-alert-id');
      openModal({
        kind: 'confirm',
        title: 'Reprocessar alerta',
        subtitle: 'Confirmar reprocessamento do item relacionado a este alerta?',
        confirmLabel: 'Reprocessar',
        payload: { type: 'reprocess-alert', alertId }
      });
      return;
    }
    case 'settings-switch-tab': {
      const tab = actionNode.getAttribute('data-tab');
      if (!tab) {
        return;
      }
      state.settings.tab = tab;
      render();
      return;
    }
    case 'settings-new-user': {
      openModal({ kind: 'user-form' });
      return;
    }
    case 'drawer-close':
    case 'overlay-close': {
      closeDrawer();
      closeModal();
      return;
    }
    case 'confirm-modal': {
      if (!state.modal || state.modal.kind !== 'confirm') {
        return;
      }
      executeConfirmAction(state.modal.payload);
      closeModal();
      return;
    }
    default:
      return;
  }
}

function onDocumentSubmit(event) {
  const target = event.target;
  if (!(target instanceof HTMLFormElement)) {
    return;
  }

  switch (target.id) {
    case 'clientsFilterForm': {
      event.preventDefault();
      applyClientsFilters(target);
      return;
    }
    case 'clientForm': {
      event.preventDefault();
      submitClientForm(target);
      return;
    }
    case 'certificatesModalForm': {
      event.preventDefault();
      submitCertificateForm(target);
      return;
    }
    case 'runsFilterForm': {
      event.preventDefault();
      applyRunsFilters(target);
      return;
    }
    case 'xmlsFilterForm': {
      event.preventDefault();
      applyXmlFilters(target);
      return;
    }
    case 'alertsFilterForm': {
      event.preventDefault();
      applyAlertsFilters(target);
      return;
    }
    case 'clientSearchConfigForm': {
      event.preventDefault();
      pushToast('Configuracao de busca salva.', 'success');
      return;
    }
    case 'settingsGeralForm':
    case 'settingsRotinaForm':
    case 'settingsServidorForm':
    case 'settingsNotificacoesForm': {
      event.preventDefault();
      pushToast('Configuracoes salvas com sucesso.', 'success');
      return;
    }
    case 'settingsUserForm': {
      event.preventDefault();
      submitUserForm(target);
      return;
    }
    default:
      return;
  }
}

function onDocumentChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.id === 'clientsFilterStatusBusca') {
    state.filters.clients.statusBusca = target.value;
  }

  if (target.id === 'clientsFilterCertificado') {
    state.filters.clients.certificado = target.value;
  }

  if (target.id === 'clientsFilterMunicipio') {
    state.filters.clients.municipio = target.value;
  }

  if (target.id === 'clientsFilterQuery') {
    state.filters.clients.query = target.value;
  }
}

function render() {
  const page = renderCurrentPage();
  const meta = resolvePageMeta();

  appRoot.innerHTML = `
    <div class="app-shell">
      ${renderSidebar()}
      <div class="main-shell">
        ${renderHeader(meta)}
        <main class="content">${page}</main>
      </div>
    </div>
    ${renderSidebarBackdrop()}
  `;

  modalRoot.innerHTML = renderModal();
  drawerRoot.innerHTML = renderDrawer();
  toastRoot.innerHTML = renderToasts();
}

function renderSidebar() {
  const activeKey = resolveNavKeyByRoute(state.route.name);
  const itemsHtml = navItems
    .map((item) => {
      return `<button class="nav-item ${item.key === activeKey ? 'active' : ''}" data-action="navigate" data-route="${item.route}" aria-label="${escapeHtml(item.label)}">${icon(item.icon)}<span>${escapeHtml(item.label)}</span></button>`;
    })
    .join('');

  return `
    <aside class="sidebar ${state.mobileSidebarOpen ? 'mobile-open' : ''}">
      <div>
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <h1 class="brand-title">NotaSync</h1>
            <p class="brand-subtitle">GCONT Gestao Contabil</p>
          </div>
        </div>
      </div>
      <nav class="sidebar-nav" aria-label="Menu principal">
        ${itemsHtml}
      </nav>
      <footer class="sidebar-footer">
        <div>Ambiente interno</div>
        <div>Servidor local</div>
        <div style="margin-top:8px;"><span class="online-dot"></span>Sistema online</div>
      </footer>
    </aside>
  `;
}

function renderSidebarBackdrop() {
  if (!state.mobileSidebarOpen) {
    return '';
  }

  return '<div class="overlay" data-action="overlay-close" aria-hidden="true"></div>';
}

function renderHeader(meta) {
  const latestRun = state.searchRuns[0];
  const lastRoutineText = latestRun ? `${formatRelativeDate(latestRun.inicio)} as ${formatHour(latestRun.inicio)}` : 'Sem execucao';
  const healthStatus = getSystemHealthStatus();

  return `
    <header class="header">
      <div style="display:flex; gap:10px; align-items:center;">
        <button class="mobile-toggle" type="button" data-action="toggle-sidebar" aria-label="Abrir menu">${icon('menu')}</button>
        <div class="header-left">
          <h1>${escapeHtml(meta.title)}</h1>
          <p>${escapeHtml(meta.description)}</p>
        </div>
      </div>
      <div class="header-right">
        <div class="header-meta">
          <div>Ultima rotina: ${escapeHtml(lastRoutineText)}</div>
          <div>${escapeHtml(healthStatus.description)}</div>
        </div>
        ${statusBadge(healthStatus.label, healthStatus.tone)}
        <div class="avatar" aria-label="Usuario GC">GC</div>
      </div>
    </header>
  `;
}

function renderCurrentPage() {
  if (!state.dataReady) {
    return renderLoadingPage();
  }

  switch (state.route.name) {
    case 'dashboard':
      return renderDashboardPage();
    case 'clientes':
      return renderClientsPage();
    case 'client-details':
      return renderClientDetailsPage(state.route.params.id);
    case 'certificados':
      return renderCertificatesPage();
    case 'buscas':
      return renderSearchRunsPage();
    case 'xmls':
      return renderXmlsPage();
    case 'alertas':
      return renderAlertsPage();
    case 'configuracoes':
      return renderSettingsPage();
    default:
      return renderNotFoundPage();
  }
}

function renderLoadingPage() {
  return `
    <section class="page-section">
      <article class="card">
        <h2 class="card-title">Carregando NotaSync GCONT</h2>
        <p class="card-subtitle">Inicializando estrutura de dashboard, clientes, certificados e monitoramento.</p>
      </article>
      <article class="card table-state loading">Carregando dados...</article>
    </section>
  `;
}

function renderNotFoundPage() {
  return `
    <section class="page-section">
      <article class="card table-state error">
        Pagina nao encontrada.
        <div style="margin-top:10px;"><button class="btn secondary" data-action="navigate" data-route="/dashboard">Voltar ao dashboard</button></div>
      </article>
    </section>
  `;
}

function renderDashboardPage() {
  const lastRun = state.searchRuns[0] || null;
  const summaryTone = lastRun?.resumoStatus === 'Erro' ? 'danger' : lastRun?.resumoStatus === 'Aviso' ? 'warning' : 'success';
  const activeClientsCount = state.clients.filter((client) => client.buscaAtiva).length;
  const certsExpiring = state.certificates.filter((cert) => cert.status === 'A vencer').length;
  const latestSearchRows = state.clients.slice(0, 8);
  const priorityAlerts = getPriorityAlerts().slice(0, 4);

  return `
    <section class="page-section">
      <article class="card summary-bar">
        <div>
          <h2 class="card-title">Resumo da rotina noturna</h2>
          <p class="card-subtitle">${lastRun ? `Execucao iniciada as ${formatHour(lastRun.inicio)} e finalizada as ${formatHour(lastRun.fim)}.` : 'Sem execucoes recentes.'}</p>
        </div>
        ${statusBadge(lastRun?.status || 'Sem status', summaryTone, 'summary-status')}
      </article>

      <section class="stats-grid">
        ${statCard('users', 'Clientes monitorados', lastRun ? String(lastRun.clientesProcessados) : String(activeClientsCount), 'clientes com busca ativa', 'neutral')}
        ${statCard('file', 'NFS-e encontradas', lastRun ? String(lastRun.xmlsEncontrados) : '0', 'na ultima execucao', 'neutral')}
        ${statCard('folder', 'XMLs armazenados', lastRun ? String(lastRun.xmlsArmazenados) : '0', 'salvos no servidor interno', 'success')}
        ${statCard('alert', 'Falhas', lastRun ? String(lastRun.falhas) : '0', 'clientes com erro', 'danger')}
        ${statCard('shield', 'Certificados a vencer', String(certsExpiring), 'nos proximos 30 dias', 'warning')}
      </section>

      <section class="split-grid">
        <article class="card">
          <h3 class="card-title">Ultimas buscas por cliente</h3>
          <p class="card-subtitle">Clique em uma linha para abrir os detalhes do cliente.</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>CNPJ</th>
                  <th>Municipio</th>
                  <th>Ultima busca</th>
                  <th>XMLs</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${renderTableRowsOrState({
                  key: 'dashboardSearches',
                  colSpan: 6,
                  rowsHtml: latestSearchRows
                    .map((client) => {
                      return `<tr data-action="client-details" data-client-id="${client.id}" style="cursor:pointer;">
                        <td>${escapeHtml(client.razaoSocial)}</td>
                        <td>${escapeHtml(formatCnpj(client.cnpj))}</td>
                        <td>${escapeHtml(client.municipio)}</td>
                        <td>${escapeHtml(formatDateTime(client.ultimaBusca))}</td>
                        <td>${escapeHtml(String(client.xmlsEncontrados))}</td>
                        <td>${statusBadge(client.statusOperacional, toneFromStatus(client.statusOperacional))}</td>
                      </tr>`;
                    })
                    .join(''),
                  emptyMessage: 'Sem clientes com busca registrada.'
                })}
              </tbody>
            </table>
          </div>
        </article>

        <article class="card">
          <h3 class="card-title">Alertas prioritarios</h3>
          <p class="card-subtitle">Pendencias com maior impacto operacional.</p>
          <div class="alert-list">
            ${priorityAlerts.length
              ? priorityAlerts
                  .map((alert) => {
                    return `<article class="alert-row ${alert.severity.toLowerCase()}">
                      <div class="alert-row-header">
                        <p class="alert-row-title">${escapeHtml(alert.titulo)}</p>
                        ${statusBadge(alert.severity, toneFromSeverity(alert.severity))}
                      </div>
                      <p class="alert-row-sub">${escapeHtml(alert.cliente)} • ${escapeHtml(formatDateTime(alert.dataHora))}</p>
                    </article>`;
                  })
                  .join('')
              : '<div class="table-state">Sem alertas prioritarios.</div>'}
          </div>
        </article>
      </section>

      <article class="card timeline-table">
        <h3 class="card-title">Execucoes recentes</h3>
        <p class="card-subtitle">Ultimas rotinas automaticas e manuais.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Inicio</th>
                <th>Fim</th>
                <th>Clientes processados</th>
                <th>XMLs encontrados</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${state.searchRuns
                .slice(0, 5)
                .map((run) => {
                  return `<tr>
                    <td>${escapeHtml(formatDate(run.inicio))}</td>
                    <td>${escapeHtml(formatHour(run.inicio))}</td>
                    <td>${escapeHtml(formatHour(run.fim))}</td>
                    <td>${escapeHtml(String(run.clientesProcessados))}</td>
                    <td>${escapeHtml(String(run.xmlsEncontrados))}</td>
                    <td>${statusBadge(run.status, toneFromRunStatus(run.status))}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderClientsPage() {
  const clients = getFilteredClients();
  const municipios = uniqueValues(state.clients.map((client) => client.municipio));

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Clientes',
        description: 'Gerencie clientes monitorados para busca automatica de NFS-e.',
        actions: [
          actionButton('Novo cliente', 'open-new-client-modal', 'primary'),
          actionButton('Importar clientes', 'open-import-client-modal', 'secondary')
        ]
      })}

      <article class="card filter-card">
        <h3 class="card-title">Filtros</h3>
        <form id="clientsFilterForm" class="form-grid">
          <label class="field" style="grid-column: span 2;">
            Buscar por razao social, CNPJ ou municipio
            <input id="clientsFilterQuery" name="query" value="${escapeHtml(state.filters.clients.query)}" placeholder="Digite para buscar" />
          </label>
          <label class="field">
            Status da busca
            <select id="clientsFilterStatusBusca" name="statusBusca">
              ${renderOptions(['Todos', 'Ativo', 'Inativo', 'Pendente', 'Erro'], state.filters.clients.statusBusca)}
            </select>
          </label>
          <label class="field">
            Certificado
            <select id="clientsFilterCertificado" name="certificado">
              ${renderOptions(['Todos', 'Valido', 'A vencer', 'Vencido', 'Nao cadastrado'], state.filters.clients.certificado)}
            </select>
          </label>
          <label class="field">
            Municipio
            <select id="clientsFilterMunicipio" name="municipio">
              ${renderOptions(['Todos', ...municipios], state.filters.clients.municipio)}
            </select>
          </label>
          <div class="stack-actions" style="grid-column: span 3; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Filtrar</button>
            <button class="btn secondary" type="button" data-action="clients-clear-filters">Limpar</button>
          </div>
        </form>
      </article>

      <article class="card">
        <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
          <div>
            <h3 class="card-title">Clientes cadastrados</h3>
            <p class="card-subtitle">${clients.length} cliente(s) na visao atual.</p>
          </div>
          <div class="table-actions">
            <button class="btn secondary" type="button" data-action="clients-bulk-activate">Ativar busca</button>
            <button class="btn secondary" type="button" data-action="clients-bulk-deactivate">Desativar busca</button>
            <button class="btn primary" type="button" data-action="clients-bulk-reprocess">Reprocessar selecionados</button>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" data-action="clients-toggle-all" ${isAllFilteredClientsSelected(clients) ? 'checked' : ''} aria-label="Selecionar todos" /></th>
                <th>Cliente</th>
                <th>Municipio</th>
                <th>Certificado</th>
                <th>Busca NFS-e</th>
                <th>Ultima busca</th>
                <th>XMLs encontrados</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRowsOrState({
                key: 'clients',
                colSpan: 9,
                rowsHtml: clients
                  .map((client) => {
                    return `
                      <tr>
                        <td><input type="checkbox" data-action="client-select" data-client-id="${client.id}" ${state.selectedClientIds.has(client.id) ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(client.razaoSocial)}" /></td>
                        <td>
                          <span class="row-title">${escapeHtml(client.razaoSocial)}</span>
                          <span class="row-sub">${escapeHtml(formatCnpj(client.cnpj))}</span>
                        </td>
                        <td>${escapeHtml(client.municipio)} / ${escapeHtml(client.uf)}</td>
                        <td>
                          ${statusBadge(client.certificadoStatus, toneFromCertificateStatus(client.certificadoStatus))}
                          <span class="row-sub">${client.certificadoValidade ? `Validade: ${escapeHtml(formatDate(client.certificadoValidade))}` : 'Sem certificado'}</span>
                        </td>
                        <td>${statusBadge(client.buscaAtiva ? 'Ativa' : 'Inativa', client.buscaAtiva ? 'success' : 'neutral')}</td>
                        <td>${escapeHtml(formatDateTime(client.ultimaBusca))}</td>
                        <td>${escapeHtml(String(client.xmlsEncontrados))}</td>
                        <td>${statusBadge(client.statusOperacional, toneFromStatus(client.statusOperacional))}</td>
                        <td>
                          <div class="table-actions">
                            <button class="icon-btn" data-action="client-details" data-client-id="${client.id}">Ver detalhes</button>
                            <button class="icon-btn" data-action="client-edit" data-client-id="${client.id}">Editar</button>
                            <button class="icon-btn" data-action="client-reprocess" data-client-id="${client.id}">Reprocessar busca</button>
                            <button class="icon-btn" data-action="client-toggle-search" data-client-id="${client.id}">${client.buscaAtiva ? 'Desativar busca' : 'Ativar busca'}</button>
                          </div>
                        </td>
                      </tr>
                    `;
                  })
                  .join(''),
                emptyMessage: 'Nenhum cliente encontrado para os filtros informados.'
              })}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderClientDetailsPage(clientId) {
  const client = findClientById(clientId);
  if (!client) {
    return `
      <section class="page-section">
        <article class="card table-state error">
          Cliente nao encontrado.
          <div style="margin-top:10px;"><button class="btn secondary" data-action="navigate" data-route="/clientes">Voltar para clientes</button></div>
        </article>
      </section>
    `;
  }

  const clientCertificate = state.certificates.find((cert) => cert.clientId === client.id) || null;
  const historyRows = getRunHistoryByClient(client.id);
  const clientXmls = state.xmlFiles.filter((xml) => xml.clientId === client.id).slice(0, 6);
  const clientAlerts = state.alerts.filter((alert) => alert.clientId === client.id).slice(0, 5);

  return `
    <section class="page-section">
      <div class="page-header">
        <div>
          <button class="btn ghost" type="button" data-action="navigate" data-route="/clientes">${icon('arrow-left')} Voltar</button>
          <h2 class="page-title" style="margin-top:8px;">${escapeHtml(client.razaoSocial)}</h2>
          <p class="page-description">${escapeHtml(formatCnpj(client.cnpj))}</p>
        </div>
        <div class="page-actions">
          ${statusBadge(client.buscaAtiva ? 'Busca ativa' : 'Busca inativa', client.buscaAtiva ? 'success' : 'neutral')}
          ${statusBadge(client.certificadoStatus === 'Valido' ? 'Certificado valido' : `Certificado ${client.certificadoStatus.toLowerCase()}`, toneFromCertificateStatus(client.certificadoStatus))}
          ${statusBadge(`Ultima busca: ${formatRelativeDate(client.ultimaBusca)} as ${formatHour(client.ultimaBusca)}`, 'info')}
        </div>
      </div>

      <section class="dual-grid">
        <div class="page-section">
          <article class="card">
            <h3 class="card-title">Dados cadastrais</h3>
            <div class="form-grid two" style="margin-top:12px; gap:10px;">
              ${detailItem('Razao social', client.razaoSocial)}
              ${detailItem('Nome fantasia', client.nomeFantasia || '-')}
              ${detailItem('CNPJ', formatCnpj(client.cnpj))}
              ${detailItem('Inscricao municipal', client.inscricaoMunicipal || '-')}
              ${detailItem('Municipio', `${client.municipio} / ${client.uf}`)}
              ${detailItem('Responsavel interno', client.responsavelInterno)}
              ${detailItem('Status do cliente', client.buscaStatus)}
            </div>
          </article>

          <article class="card">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
              <h3 class="card-title">Historico de buscas</h3>
              <button class="btn secondary" type="button" data-action="navigate" data-route="/buscas">Ver todas as execucoes</button>
            </div>
            <div class="table-wrap" style="margin-top:10px;">
              <table>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Inicio</th>
                    <th>Fim</th>
                    <th>XMLs encontrados</th>
                    <th>Status</th>
                    <th>Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  ${historyRows.length
                    ? historyRows
                        .map((row) => {
                          return `<tr>
                            <td>${escapeHtml(formatDate(row.data))}</td>
                            <td>${escapeHtml(formatHour(row.inicio))}</td>
                            <td>${escapeHtml(formatHour(row.fim))}</td>
                            <td>${escapeHtml(String(row.xmlsEncontrados))}</td>
                            <td>${statusBadge(row.status, toneFromStatus(row.status))}</td>
                            <td>${escapeHtml(row.mensagem)}</td>
                          </tr>`;
                        })
                        .join('')
                    : '<tr><td colspan="6" class="table-state">Nenhum historico disponivel.</td></tr>'}
                </tbody>
              </table>
            </div>
          </article>

          <article class="card">
            <h3 class="card-title">Ultimos XMLs encontrados</h3>
            <div class="table-wrap" style="margin-top:10px;">
              <table>
                <thead>
                  <tr>
                    <th>Numero NFS-e</th>
                    <th>Data emissao</th>
                    <th>Prestador/Tomador</th>
                    <th>Valor</th>
                    <th>Caminho no servidor</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  ${clientXmls.length
                    ? clientXmls
                        .map((xml) => {
                          return `<tr>
                            <td>${escapeHtml(xml.numeroNfse)}</td>
                            <td>${escapeHtml(formatDate(xml.dataEmissao))}</td>
                            <td>${escapeHtml(`${xml.prestador} / ${xml.tomador}`)}</td>
                            <td>${escapeHtml(formatCurrency(xml.valor))}</td>
                            <td><code>${escapeHtml(xml.caminhoServidor)}</code></td>
                            <td>
                              <div class="table-actions">
                                <button class="icon-btn" data-action="xml-details" data-xml-id="${xml.id}">Visualizar</button>
                                <button class="icon-btn" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
                                <button class="icon-btn" data-action="xml-open-folder" data-xml-id="${xml.id}">Abrir localizacao</button>
                              </div>
                            </td>
                          </tr>`;
                        })
                        .join('')
                    : '<tr><td colspan="6" class="table-state">Nenhum XML encontrado.</td></tr>'}
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <div class="page-section">
          <article class="card">
            <h3 class="card-title">Certificado digital</h3>
            <div class="form-grid" style="grid-template-columns:1fr; margin-top:12px;">
              ${detailItem('Tipo', clientCertificate?.tipo || 'Nao cadastrado')}
              ${detailItem('Apelido', clientCertificate?.apelido || '-')}
              ${detailItem('Data de validade', clientCertificate?.validade ? formatDate(clientCertificate.validade) : '-')}
              ${detailItem('Status', clientCertificate?.status || 'Nao cadastrado')}
              ${detailItem('Ultima validacao', clientCertificate?.ultimaValidacao ? formatDateTime(clientCertificate.ultimaValidacao) : '-')}
            </div>
            <div class="table-actions" style="margin-top:12px;">
              <button class="btn primary" type="button" data-action="certificate-open-create">Atualizar certificado</button>
              <button class="btn secondary" type="button" data-action="certificate-test" data-cert-id="${escapeHtml(clientCertificate?.id || '')}" ${clientCertificate ? '' : 'disabled'}>Testar certificado</button>
            </div>
          </article>

          <article class="card">
            <h3 class="card-title">Configuracao da busca</h3>
            <form id="clientSearchConfigForm" class="form-grid" style="grid-template-columns:1fr; margin-top:12px;">
              <label class="field-inline">
                <input name="buscaAtiva" type="checkbox" ${client.buscaAtiva ? 'checked' : ''} />
                <span>Busca automatica ativa</span>
              </label>
              <label class="field">
                Horario preferencial
                <input name="horario" type="time" value="${escapeHtml(client.horarioPreferencial || '02:00')}" />
              </label>
              <label class="field">
                Tipo de busca
                <select name="tipoBusca">
                  ${renderOptions(['Emitidas', 'Tomadas', 'Ambas'], client.tipoBusca || 'Ambas')}
                </select>
              </label>
              <label class="field-inline">
                <input name="municipioIntegrado" type="checkbox" ${client.municipioIntegrado ? 'checked' : ''} />
                <span>Municipio integrado</span>
              </label>
              <div class="stack-actions" style="justify-content:flex-start;">
                <button class="btn primary" type="submit">Salvar configuracao</button>
              </div>
            </form>
          </article>

          <article class="card">
            <h3 class="card-title">Alertas do cliente</h3>
            <div class="alert-list" style="margin-top:10px;">
              ${clientAlerts.length
                ? clientAlerts
                    .map((alert) => {
                      return `<article class="alert-row ${alert.severity.toLowerCase()}">
                        <div class="alert-row-header">
                          <p class="alert-row-title">${escapeHtml(alert.titulo)}</p>
                          ${statusBadge(alert.status, toneFromAlertStatus(alert.status))}
                        </div>
                        <p class="alert-row-sub">${escapeHtml(formatDateTime(alert.dataHora))}</p>
                      </article>`;
                    })
                    .join('')
                : '<div class="table-state">Sem alertas recentes para este cliente.</div>'}
            </div>
          </article>
        </div>
      </section>
    </section>
  `;
}

function renderCertificatesPage() {
  const certificates = getFilteredCertificates();
  const counts = {
    validos: state.certificates.filter((cert) => cert.status === 'Valido').length,
    vencer: state.certificates.filter((cert) => cert.status === 'A vencer').length,
    vencidos: state.certificates.filter((cert) => cert.status === 'Vencido').length,
    semVinculo: state.certificates.filter((cert) => !cert.clientId).length
  };

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Certificados',
        description: 'Acompanhe validade, vinculo e status dos certificados digitais.',
        actions: [actionButton('Cadastrar certificado', 'certificate-open-create', 'primary')]
      })}

      <section class="stats-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        ${statCard('shield', 'Certificados validos', String(counts.validos), 'status regular', 'success')}
        ${statCard('clock', 'A vencer em 30 dias', String(counts.vencer), 'exigem renovacao', 'warning')}
        ${statCard('alert', 'Vencidos', String(counts.vencidos), 'risco imediato', 'danger')}
        ${statCard('users', 'Sem cliente vinculado', String(counts.semVinculo), 'pendente de associacao', 'neutral')}
      </section>

      <article class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>CNPJ</th>
                <th>Tipo</th>
                <th>Apelido</th>
                <th>Validade</th>
                <th>Dias restantes</th>
                <th>Status</th>
                <th>Ultima validacao</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRowsOrState({
                key: 'certificates',
                colSpan: 9,
                rowsHtml: certificates
                  .map((cert) => {
                    const rowClass = cert.status === 'Vencido' ? ' style="background:#fff5f5;"' : cert.status === 'A vencer' ? ' style="background:#fffbf0;"' : '';
                    return `<tr${rowClass}>
                      <td>${escapeHtml(cert.cliente)}</td>
                      <td>${escapeHtml(formatCnpj(cert.cnpj))}</td>
                      <td>${escapeHtml(cert.tipo)}</td>
                      <td>${escapeHtml(cert.apelido)}</td>
                      <td>${escapeHtml(formatDate(cert.validade))}</td>
                      <td>${escapeHtml(String(cert.diasRestantes))}</td>
                      <td>${statusBadge(cert.status, toneFromCertificateStatus(cert.status))}</td>
                      <td>${escapeHtml(cert.ultimaValidacao ? formatDateTime(cert.ultimaValidacao) : '-')}</td>
                      <td>
                        <div class="table-actions">
                          <button class="icon-btn" data-action="certificate-view-client" data-client-id="${escapeHtml(cert.clientId || '')}" ${cert.clientId ? '' : 'disabled'}>Ver cliente</button>
                          <button class="icon-btn" data-action="certificate-test" data-cert-id="${escapeHtml(cert.id)}">Testar certificado</button>
                          <button class="icon-btn" data-action="certificate-replace" data-cert-id="${escapeHtml(cert.id)}">Substituir</button>
                          <button class="icon-btn" data-action="certificate-unlink" data-cert-id="${escapeHtml(cert.id)}">Remover vinculo</button>
                        </div>
                      </td>
                    </tr>`;
                  })
                  .join(''),
                emptyMessage: 'Nenhum certificado para exibir.'
              })}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderSearchRunsPage() {
  const runs = getFilteredRuns();

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Buscas NFS-e',
        description: 'Historico das rotinas automaticas e reprocessamentos manuais.',
        actions: [
          actionButton('Nova busca manual', 'open-new-manual-run', 'primary'),
          actionButton('Agendar reprocessamento', 'open-schedule-reprocess', 'secondary')
        ]
      })}

      <article class="card filter-card">
        <h3 class="card-title">Filtros</h3>
        <form id="runsFilterForm" class="form-grid">
          <label class="field">
            Periodo
            <select name="periodo">${renderOptions(['7', '15', '30', '90'], state.filters.runs.periodo, {
              '7': 'Ultimos 7 dias',
              '15': 'Ultimos 15 dias',
              '30': 'Ultimos 30 dias',
              '90': 'Ultimos 90 dias'
            })}</select>
          </label>
          <label class="field">
            Cliente
            <select name="cliente">${renderOptions(['Todos', ...state.clients.map((client) => client.id)], state.filters.runs.cliente, mapClientOptions())}</select>
          </label>
          <label class="field">
            Municipio
            <select name="municipio">${renderOptions(['Todos', ...uniqueValues(state.clients.map((client) => client.municipio))], state.filters.runs.municipio)}</select>
          </label>
          <label class="field">
            Status
            <select name="status">${renderOptions(['Todos', 'Concluida', 'Concluida com avisos', 'Falha critica', 'Em execucao'], state.filters.runs.status)}</select>
          </label>
          <label class="field">
            Tipo de execucao
            <select name="tipo">${renderOptions(['Todos', 'Automatica', 'Manual', 'Reprocessamento'], state.filters.runs.tipo)}</select>
          </label>
          <div class="stack-actions" style="grid-column: span 3; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Filtrar</button>
            <button class="btn secondary" type="button" data-action="runs-clear-filters">Limpar</button>
          </div>
        </form>
      </article>

      ${renderRunningExecutionCard()}

      <article class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Tipo</th>
                <th>Data</th>
                <th>Inicio</th>
                <th>Fim</th>
                <th>Clientes processados</th>
                <th>XMLs encontrados</th>
                <th>XMLs armazenados</th>
                <th>Falhas</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRowsOrState({
                key: 'runs',
                colSpan: 11,
                rowsHtml: runs
                  .map((run) => {
                    return `<tr>
                      <td><strong>${escapeHtml(run.codigo)}</strong></td>
                      <td>${escapeHtml(run.tipo)}</td>
                      <td>${escapeHtml(formatDate(run.inicio))}</td>
                      <td>${escapeHtml(formatHour(run.inicio))}</td>
                      <td>${escapeHtml(formatHour(run.fim))}</td>
                      <td>${escapeHtml(String(run.clientesProcessados))}</td>
                      <td>${escapeHtml(String(run.xmlsEncontrados))}</td>
                      <td>${escapeHtml(String(run.xmlsArmazenados))}</td>
                      <td>${escapeHtml(String(run.falhas))}</td>
                      <td>${statusBadge(run.status, toneFromRunStatus(run.status))}</td>
                      <td>
                        <div class="table-actions">
                          <button class="icon-btn" data-action="open-run-details" data-run-id="${run.id}">Ver detalhes</button>
                          <button class="icon-btn" data-action="run-export" data-run-id="${run.id}">Exportar relatorio</button>
                          <button class="icon-btn" data-action="run-reprocess-failures" data-run-id="${run.id}">Reprocessar falhas</button>
                        </div>
                      </td>
                    </tr>`;
                  })
                  .join(''),
                emptyMessage: 'Nenhuma execucao encontrada para os filtros aplicados.'
              })}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderRunningExecutionCard() {
  const run = state.runningExecution;
  if (!run || run.status !== 'Em execucao') {
    return '';
  }

  return `
    <article class="card progress-card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <h3 class="card-title">Busca em execucao</h3>
        ${statusBadge('Em execucao', 'info')}
      </div>
      <div class="progress-track" aria-label="Progresso da execucao">
        <div class="progress-fill" style="width:${run.progressoPercentual}%;"></div>
      </div>
      <div class="progress-meta">
        <span>Cliente atual: <strong>${escapeHtml(run.clienteAtual)}</strong></span>
        <span>Processados: <strong>${run.processados}/${run.totalClientes}</strong></span>
        <span>Tempo estimado: <strong>${run.tempoEstimadoMin} min</strong></span>
      </div>
      <div>
        <button class="btn secondary" data-action="execution-refresh">Atualizar status</button>
      </div>
    </article>
  `;
}

function renderXmlsPage() {
  const xmls = getFilteredXmls();

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'XMLs Armazenados',
        description: 'Consulte os arquivos XML de NFS-e salvos no servidor interno.',
        actions: [actionButton('Exportar listagem', 'xml-export-list', 'secondary')]
      })}

      <article class="card filter-card">
        <h3 class="card-title">Filtros</h3>
        <form id="xmlsFilterForm" class="form-grid">
          <label class="field">
            Cliente
            <select name="cliente">${renderOptions(['Todos', ...state.clients.map((client) => client.id)], state.filters.xmls.cliente, mapClientOptions())}</select>
          </label>
          <label class="field">
            CNPJ
            <input name="cnpj" value="${escapeHtml(state.filters.xmls.cnpj)}" />
          </label>
          <label class="field">
            Numero da NFS-e
            <input name="numero" value="${escapeHtml(state.filters.xmls.numero)}" />
          </label>
          <label class="field">
            Municipio
            <select name="municipio">${renderOptions(['Todos', ...uniqueValues(state.xmlFiles.map((xml) => xml.municipio))], state.filters.xmls.municipio)}</select>
          </label>
          <label class="field">
            Emissao inicio
            <input name="emissaoInicio" type="date" value="${escapeHtml(state.filters.xmls.emissaoInicio)}" />
          </label>
          <label class="field">
            Emissao fim
            <input name="emissaoFim" type="date" value="${escapeHtml(state.filters.xmls.emissaoFim)}" />
          </label>
          <label class="field">
            Download inicio
            <input name="downloadInicio" type="date" value="${escapeHtml(state.filters.xmls.downloadInicio)}" />
          </label>
          <label class="field">
            Download fim
            <input name="downloadFim" type="date" value="${escapeHtml(state.filters.xmls.downloadFim)}" />
          </label>
          <label class="field">
            Tipo
            <select name="tipo">${renderOptions(['Todos', 'Emitida', 'Tomada'], state.filters.xmls.tipo)}</select>
          </label>
          <label class="field">
            Status do armazenamento
            <select name="status">${renderOptions(['Todos', 'Armazenado', 'Pendente', 'Erro'], state.filters.xmls.status)}</select>
          </label>
          <label class="field" style="grid-column: span 2;">
            Caminho no servidor
            <input name="caminho" value="${escapeHtml(state.filters.xmls.caminho)}" />
          </label>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Filtrar</button>
            <button class="btn secondary" type="button" data-action="xmls-clear-filters">Limpar</button>
          </div>
        </form>
      </article>

      <article class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Numero NFS-e</th>
                <th>Cliente</th>
                <th>CNPJ</th>
                <th>Municipio</th>
                <th>Data emissao</th>
                <th>Data download</th>
                <th>Valor</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Caminho no servidor</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRowsOrState({
                key: 'xmls',
                colSpan: 11,
                rowsHtml: xmls
                  .map((xml) => {
                    return `<tr>
                      <td>${escapeHtml(xml.numeroNfse)}</td>
                      <td>${escapeHtml(xml.cliente)}</td>
                      <td>${escapeHtml(formatCnpj(xml.cnpj))}</td>
                      <td>${escapeHtml(xml.municipio)}</td>
                      <td>${escapeHtml(formatDate(xml.dataEmissao))}</td>
                      <td>${escapeHtml(formatDateTime(xml.dataDownload))}</td>
                      <td>${escapeHtml(formatCurrency(xml.valor))}</td>
                      <td>${escapeHtml(xml.tipo)}</td>
                      <td>${statusBadge(xml.statusArmazenamento, toneFromStorageStatus(xml.statusArmazenamento))}</td>
                      <td><code>${escapeHtml(xml.caminhoServidor)}</code></td>
                      <td>
                        <div class="table-actions">
                          <button class="icon-btn" data-action="xml-details" data-xml-id="${xml.id}">Visualizar detalhes</button>
                          <button class="icon-btn" data-action="xml-view" data-xml-id="${xml.id}">Ver XML</button>
                          <button class="icon-btn" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
                          <button class="icon-btn" data-action="xml-copy-path" data-xml-id="${xml.id}">Copiar caminho</button>
                          <button class="icon-btn" data-action="xml-open-folder" data-xml-id="${xml.id}">Abrir pasta</button>
                        </div>
                      </td>
                    </tr>`;
                  })
                  .join(''),
                emptyMessage: 'Nenhum XML encontrado para os filtros aplicados.'
              })}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  `;
}

function renderAlertsPage() {
  const filteredAlerts = getFilteredAlerts();

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Alertas',
        description: 'Acompanhe pendencias que exigem acao da equipe.',
        actions: [actionButton('Marcar selecionados como resolvidos', 'alerts-mark-selected', 'secondary')]
      })}

      <section class="stats-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
        ${statCard('alert', 'Criticos', String(state.alerts.filter((alert) => alert.severity === 'Critico' && alert.status !== 'Resolvido').length), 'pendentes de acao', 'danger')}
        ${statCard('clock', 'Atencao', String(state.alerts.filter((alert) => alert.severity === 'Atencao' && alert.status !== 'Resolvido').length), 'em acompanhamento', 'warning')}
        ${statCard('info', 'Informativos', String(state.alerts.filter((alert) => alert.severity === 'Informativo' && alert.status !== 'Resolvido').length), 'baixo impacto', 'neutral')}
        ${statCard('check', 'Resolvidos hoje', String(state.alerts.filter((alert) => alert.status === 'Resolvido').length), 'encerrados no dia', 'success')}
      </section>

      <section class="layout-with-side">
        <article class="card">
          <h3 class="card-title">Filtros</h3>
          <form id="alertsFilterForm" class="form-grid" style="grid-template-columns:1fr; margin-top:10px;">
            <label class="field">
              Severidade
              <select name="severidade">${renderOptions(['Todos', 'Critico', 'Atencao', 'Informativo'], state.filters.alerts.severidade)}</select>
            </label>
            <label class="field">
              Tipo
              <select name="tipo">${renderOptions(['Todos', 'Certificado', 'Prefeitura', 'XML', 'Cliente', 'Servidor', 'Busca'], state.filters.alerts.tipo)}</select>
            </label>
            <label class="field">
              Status
              <select name="status">${renderOptions(['Todos', 'Aberto', 'Em analise', 'Resolvido'], state.filters.alerts.status)}</select>
            </label>
            <label class="field">
              Periodo
              <select name="periodo">${renderOptions(['7', '15', '30', '90'], state.filters.alerts.periodo, {
                '7': 'Ultimos 7 dias',
                '15': 'Ultimos 15 dias',
                '30': 'Ultimos 30 dias',
                '90': 'Ultimos 90 dias'
              })}</select>
            </label>
            <label class="field">
              Cliente
              <select name="cliente">${renderOptions(['Todos', ...state.clients.map((client) => client.id)], state.filters.alerts.cliente, mapClientOptions())}</select>
            </label>
            <div class="stack-actions" style="justify-content:flex-start;">
              <button class="btn primary" type="submit">Filtrar</button>
              <button class="btn secondary" type="button" data-action="alerts-clear-filters">Limpar</button>
            </div>
          </form>
        </article>

        <article class="alert-main-list">
          ${renderAlertCards(filteredAlerts)}
        </article>
      </section>
    </section>
  `;
}

function renderAlertCards(alerts) {
  if (state.tableState.alerts === 'loading') {
    return '<article class="card table-state loading">Carregando alertas...</article>';
  }

  if (state.tableState.alerts === 'error') {
    return '<article class="card table-state error">Falha ao carregar alertas. Tente novamente.</article>';
  }

  if (!alerts.length) {
    return '<article class="card table-state">Nenhum alerta encontrado para os filtros selecionados.</article>';
  }

  return alerts
    .map((alert) => {
      return `
        <article class="alert-main-card">
          <div class="alert-row-header">
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="checkbox" data-action="alert-select" data-alert-id="${alert.id}" ${state.selectedAlertIds.has(alert.id) ? 'checked' : ''} aria-label="Selecionar alerta ${escapeHtml(alert.titulo)}" />
              <p class="alert-row-title">${escapeHtml(alert.titulo)}</p>
            </div>
            ${statusBadge(alert.severity, toneFromSeverity(alert.severity))}
          </div>
          <p class="alert-row-sub">${escapeHtml(alert.descricao)}</p>
          <p class="alert-row-sub">Cliente: ${escapeHtml(alert.cliente)} • ${escapeHtml(formatDateTime(alert.dataHora))} • ${statusBadge(alert.status, toneFromAlertStatus(alert.status))}</p>
          <div class="table-actions">
            <button class="icon-btn" data-action="alert-details" data-alert-id="${alert.id}">Ver detalhes</button>
            <button class="icon-btn" data-action="alert-resolve" data-alert-id="${alert.id}">Marcar como resolvido</button>
            ${alert.allowsReprocess ? `<button class="icon-btn" data-action="alert-reprocess" data-alert-id="${alert.id}">Reprocessar</button>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

function renderSettingsPage() {
  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Configuracoes',
        description: 'Ajuste parametros da rotina de busca e do armazenamento interno.',
        actions: []
      })}

      <article class="card">
        <div class="tabs">
          ${renderTabButton('geral', 'Geral')}
          ${renderTabButton('rotina', 'Rotina noturna')}
          ${renderTabButton('servidor', 'Servidor de XMLs')}
          ${renderTabButton('notificacoes', 'Notificacoes')}
          ${renderTabButton('usuarios', 'Usuarios e permissoes')}
        </div>
        ${renderSettingsTabPanel()}
      </article>
    </section>
  `;
}

function renderSettingsTabPanel() {
  switch (state.settings.tab) {
    case 'geral':
      return `
        <form id="settingsGeralForm" class="form-grid three">
          <label class="field">
            Nome do ambiente
            <input name="nomeAmbiente" value="${escapeHtml(state.settings.geral.nomeAmbiente)}" />
          </label>
          <label class="field">
            Modo de operacao
            <select name="modoOperacao">${renderOptions(['Producao', 'Homologacao'], state.settings.geral.modoOperacao)}</select>
          </label>
          <label class="field">
            Status do sistema
            <input name="statusSistema" value="${escapeHtml(state.settings.geral.statusSistema)}" />
          </label>
          <div class="stack-actions" style="grid-column: span 3; justify-content:flex-start;">
            <button class="btn primary" type="submit">Salvar alteracoes</button>
          </div>
        </form>
      `;
    case 'rotina':
      return `
        <form id="settingsRotinaForm" class="form-grid three">
          <label class="field-inline" style="grid-column: span 3;">
            <input name="ativa" type="checkbox" ${state.settings.rotina.ativa ? 'checked' : ''} />
            <span>Ativar busca automatica</span>
          </label>
          <label class="field">
            Horario de inicio
            <input name="horarioInicio" type="time" value="${escapeHtml(state.settings.rotina.horarioInicio)}" />
          </label>
          <label class="field">
            Limite de clientes por execucao
            <input name="limiteClientes" type="number" min="1" value="${escapeHtml(String(state.settings.rotina.limiteClientes))}" />
          </label>
          <label class="field-inline" style="align-self:end;">
            <input name="retryFalha" type="checkbox" ${state.settings.rotina.retryFalha ? 'checked' : ''} />
            <span>Tentar novamente em caso de falha</span>
          </label>
          <label class="field">
            Numero maximo de tentativas
            <input name="maxTentativas" type="number" min="1" value="${escapeHtml(String(state.settings.rotina.maxTentativas))}" />
          </label>
          <label class="field">
            Intervalo entre tentativas (min)
            <input name="intervaloTentativas" type="number" min="1" value="${escapeHtml(String(state.settings.rotina.intervaloTentativas))}" />
          </label>
          <div class="stack-actions" style="grid-column: span 3; justify-content:flex-start;">
            <button class="btn primary" type="submit">Salvar rotina</button>
            <button class="btn secondary" type="button" data-action="settings-test-run">Executar teste agora</button>
          </div>
        </form>
      `;
    case 'servidor':
      return `
        <form id="settingsServidorForm" class="form-grid two">
          <label class="field" style="grid-column: span 2;">
            Caminho base do servidor
            <input name="caminhoBase" value="${escapeHtml(state.settings.servidor.caminhoBase)}" />
          </label>
          <label class="field-inline">
            <input name="porCliente" type="checkbox" ${state.settings.servidor.porCliente ? 'checked' : ''} />
            <span>Organizar por cliente</span>
          </label>
          <label class="field-inline">
            <input name="porCnpj" type="checkbox" ${state.settings.servidor.porCnpj ? 'checked' : ''} />
            <span>Organizar por CNPJ</span>
          </label>
          <label class="field-inline" style="grid-column: span 2;">
            <input name="porAnoMes" type="checkbox" ${state.settings.servidor.porAnoMes ? 'checked' : ''} />
            <span>Organizar por ano/mes</span>
          </label>
          <div class="path-preview" style="grid-column: span 2;">\\servidor\\xmls\\CLIENTE\\2026\\06\\nfse-123.xml</div>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start;">
            <button class="btn secondary" type="button" data-action="settings-test-storage">Testar acesso</button>
            <button class="btn primary" type="submit">Salvar configuracao</button>
          </div>
        </form>
      `;
    case 'notificacoes':
      return `
        <form id="settingsNotificacoesForm" class="form-grid two">
          <label class="field-inline">
            <input name="alertarCertificados" type="checkbox" ${state.settings.notificacoes.alertarCertificados ? 'checked' : ''} />
            <span>Alertar certificados vencendo</span>
          </label>
          <label class="field">
            Dias antes do vencimento
            <input name="diasAntecedencia" type="number" min="1" value="${escapeHtml(String(state.settings.notificacoes.diasAntecedencia))}" />
          </label>
          <label class="field-inline">
            <input name="alertarFalhaBusca" type="checkbox" ${state.settings.notificacoes.alertarFalhaBusca ? 'checked' : ''} />
            <span>Alertar falha de busca</span>
          </label>
          <label class="field-inline">
            <input name="alertarXmlNaoArmazenado" type="checkbox" ${state.settings.notificacoes.alertarXmlNaoArmazenado ? 'checked' : ''} />
            <span>Alertar XML nao armazenado</span>
          </label>
          <label class="field" style="grid-column: span 2;">
            Canal de notificacao
            <select name="canal">${renderOptions(['Somente painel', 'E-mail', 'Outro canal futuro'], state.settings.notificacoes.canal)}</select>
          </label>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start;">
            <button class="btn primary" type="submit">Salvar notificacoes</button>
          </div>
        </form>
      `;
    case 'usuarios':
      return `
        <div class="page-section">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
            <h3 class="card-title">Usuarios e permissoes</h3>
            <button class="btn primary" data-action="settings-new-user">Novo usuario</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                ${state.users
                  .map((user) => {
                    return `<tr>
                      <td>${escapeHtml(user.nome)}</td>
                      <td>${escapeHtml(user.email)}</td>
                      <td>${statusBadge(user.perfil, 'neutral')}</td>
                      <td>${statusBadge(user.status, user.status === 'Ativo' ? 'success' : 'neutral')}</td>
                      <td><button class="icon-btn" data-action="settings-user-edit" data-user-id="${user.id}">Editar</button></td>
                    </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          </div>
        </div>
      `;
    default:
      return '';
  }
}

function renderModal() {
  if (!state.modal) {
    return '';
  }

  switch (state.modal.kind) {
    case 'confirm':
      return `
        <div class="overlay" data-action="overlay-close">
          <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
            <div class="modal-header">
              <h3 class="modal-title">${escapeHtml(state.modal.title)}</h3>
              <p class="modal-subtitle">${escapeHtml(state.modal.subtitle)}</p>
            </div>
            <div class="modal-footer">
              <button class="btn secondary" data-action="close-modal">Cancelar</button>
              <button class="btn primary" data-action="confirm-modal">${escapeHtml(state.modal.confirmLabel || 'Confirmar')}</button>
            </div>
          </div>
        </div>
      `;
    case 'import-clients':
      return `
        <div class="overlay" data-action="overlay-close">
          <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
            <div class="modal-header">
              <h3 class="modal-title">Importar clientes</h3>
              <p class="modal-subtitle">Este fluxo ainda sera integrado ao backend. No momento, a acao e simulada.</p>
            </div>
            <div class="modal-body">
              <p>Formato esperado futuro: planilha CSV com razao social, CNPJ, municipio, UF e responsavel.</p>
            </div>
            <div class="modal-footer">
              <button class="btn secondary" data-action="close-modal">Fechar</button>
            </div>
          </div>
        </div>
      `;
    case 'client-form':
      return renderClientFormModal();
    case 'certificate-form':
      return renderCertificateFormModal();
    case 'xml-details':
      return renderXmlDetailsModal(state.modal.xmlId);
    case 'xml-view':
      return renderXmlViewerModal(state.modal.xmlId);
    case 'user-form':
      return renderUserFormModal();
    default:
      return '';
  }
}

function renderClientFormModal() {
  const client = state.modal.mode === 'edit' ? findClientById(state.modal.clientId) : null;
  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">${state.modal.mode === 'edit' ? 'Editar cliente' : 'Novo cliente'}</h3>
          <p class="modal-subtitle">Preencha os dados cadastrais e o status de busca automatica.</p>
        </div>
        <form id="clientForm">
          <div class="modal-body">
            <input type="hidden" name="mode" value="${escapeHtml(state.modal.mode)}" />
            <input type="hidden" name="clientId" value="${escapeHtml(client?.id || '')}" />
            <div class="form-grid two">
              <label class="field">
                Razao social
                <input name="razaoSocial" required value="${escapeHtml(client?.razaoSocial || '')}" />
              </label>
              <label class="field">
                Nome fantasia
                <input name="nomeFantasia" value="${escapeHtml(client?.nomeFantasia || '')}" />
              </label>
              <label class="field">
                CNPJ
                <input name="cnpj" required value="${escapeHtml(client?.cnpj || '')}" />
              </label>
              <label class="field">
                Inscricao municipal
                <input name="inscricaoMunicipal" value="${escapeHtml(client?.inscricaoMunicipal || '')}" />
              </label>
              <label class="field">
                Municipio
                <input name="municipio" required value="${escapeHtml(client?.municipio || '')}" />
              </label>
              <label class="field">
                UF
                <input name="uf" maxlength="2" required value="${escapeHtml(client?.uf || '')}" />
              </label>
              <label class="field" style="grid-column: span 2;">
                Responsavel interno
                <input name="responsavelInterno" value="${escapeHtml(client?.responsavelInterno || '')}" />
              </label>
              <label class="field-inline" style="grid-column: span 2;">
                <input name="buscaAtiva" type="checkbox" ${client?.buscaAtiva ?? true ? 'checked' : ''} />
                <span>Busca automatica ativa</span>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" type="button" data-action="close-modal">Cancelar</button>
            <button class="btn primary" type="submit">${state.modal.mode === 'edit' ? 'Salvar alteracoes' : 'Cadastrar cliente'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderCertificateFormModal() {
  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">Cadastrar certificado</h3>
          <p class="modal-subtitle">Formulario preparado para integracao com backend de certificados.</p>
        </div>
        <form id="certificatesModalForm">
          <div class="modal-body">
            <div class="form-grid two">
              <label class="field">
                Cliente
                <select name="clientId" required>${renderOptions(state.clients.map((client) => client.id), '', mapClientOptions(), 'Selecione')}</select>
              </label>
              <label class="field">
                Apelido
                <input name="apelido" required />
              </label>
              <label class="field">
                Arquivo do certificado
                <input name="arquivo" type="file" accept=".pfx,.p12" required />
              </label>
              <label class="field">
                Senha
                <input name="senha" type="password" required />
              </label>
              <label class="field">
                Tipo
                <input name="tipo" value="A1" required />
              </label>
              <label class="field">
                Data de validade
                <input name="validade" type="date" required />
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" type="button" data-action="close-modal">Cancelar</button>
            <button class="btn primary" type="submit">Salvar certificado</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderXmlDetailsModal(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    return '';
  }

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">Detalhes da NFS-e ${escapeHtml(xml.numeroNfse)}</h3>
          <p class="modal-subtitle">Informacoes de armazenamento do XML no servidor interno.</p>
        </div>
        <div class="modal-body">
          <div class="form-grid two">
            ${detailItem('Numero NFS-e', xml.numeroNfse)}
            ${detailItem('Codigo verificacao', xml.codigoVerificacao)}
            ${detailItem('Data de emissao', formatDateTime(xml.dataEmissao))}
            ${detailItem('Prestador', xml.prestador)}
            ${detailItem('Tomador', xml.tomador)}
            ${detailItem('Valor dos servicos', formatCurrency(xml.valor))}
            ${detailItem('ISS', formatCurrency(xml.iss))}
            ${detailItem('Municipio', xml.municipio)}
            ${detailItem('Status de armazenamento', xml.statusArmazenamento)}
            <div style="grid-column: span 2;">
              <small style="color:#606062; display:block; margin-bottom:4px;">Caminho completo</small>
              <code>${escapeHtml(xml.caminhoServidor)}</code>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="xml-view" data-xml-id="${xml.id}">Ver conteudo XML</button>
          <button class="btn primary" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderXmlViewerModal(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    return '';
  }

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">Visualizador XML - NFS-e ${escapeHtml(xml.numeroNfse)}</h3>
          <p class="modal-subtitle">Visualizacao formatada (mock) para leitura interna.</p>
        </div>
        <div class="modal-body">
          <pre class="xml-viewer">${escapeHtml(formatXml(xml.conteudoXml))}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">Fechar</button>
          <button class="btn primary" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderUserFormModal() {
  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3 class="modal-title">Novo usuario</h3>
          <p class="modal-subtitle">Cadastro interno de usuario e perfil de acesso.</p>
        </div>
        <form id="settingsUserForm">
          <div class="modal-body">
            <div class="form-grid two">
              <label class="field">
                Nome
                <input name="nome" required />
              </label>
              <label class="field">
                E-mail
                <input name="email" type="email" required />
              </label>
              <label class="field">
                Perfil
                <select name="perfil">${renderOptions(['Administrador', 'Operador fiscal', 'Consulta'], 'Operador fiscal')}</select>
              </label>
              <label class="field">
                Status
                <select name="status">${renderOptions(['Ativo', 'Inativo'], 'Ativo')}</select>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" type="button" data-action="close-modal">Cancelar</button>
            <button class="btn primary" type="submit">Salvar usuario</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderDrawer() {
  if (!state.drawer) {
    return '';
  }

  if (state.drawer.kind === 'run-details') {
    const run = state.searchRuns.find((item) => item.id === state.drawer.runId);
    if (!run) {
      return '';
    }

    const detalhes = Array.isArray(run.detalhes) ? run.detalhes : [];

    return `
      <div class="drawer-shell">
        <div class="drawer-backdrop" data-action="close-drawer"></div>
        <aside class="drawer-panel" role="dialog" aria-modal="true">
          <header class="drawer-header">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
              <div>
                <h3 class="drawer-title">${escapeHtml(run.codigo)}</h3>
                <p class="card-subtitle">Detalhes da execucao ${escapeHtml(run.tipo.toLowerCase())}</p>
              </div>
              ${statusBadge(run.status, toneFromRunStatus(run.status))}
            </div>
          </header>
          <div class="drawer-body">
            <section class="kpi-grid">
              ${kpiItem('Clientes processados', run.clientesProcessados)}
              ${kpiItem('Sucessos', Math.max(run.clientesProcessados - run.falhas, 0))}
              ${kpiItem('Avisos/Erros', run.falhas)}
              ${kpiItem('Tempo total', `${diffMinutes(run.inicio, run.fim)} min`)}
            </section>

            <section class="card" style="padding:0;">
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>CNPJ</th>
                      <th>Municipio</th>
                      <th>XMLs encontrados</th>
                      <th>Status</th>
                      <th>Mensagem</th>
                      <th>Acao</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${detalhes.length
                      ? detalhes
                          .map((item) => {
                            return `<tr>
                              <td>${escapeHtml(item.cliente)}</td>
                              <td>${escapeHtml(formatCnpj(item.cnpj))}</td>
                              <td>${escapeHtml(item.municipio)}</td>
                              <td>${escapeHtml(String(item.xmlsEncontrados))}</td>
                              <td>${statusBadge(item.status, toneFromStatus(item.status))}</td>
                              <td>${escapeHtml(item.mensagem)}</td>
                              <td><button class="icon-btn" data-action="execution-reprocess-client" data-client-id="${escapeHtml(item.clientId || '')}">Reprocessar cliente</button></td>
                            </tr>`;
                          })
                          .join('')
                      : '<tr><td colspan="7" class="table-state">Sem detalhamento por cliente.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </aside>
      </div>
    `;
  }

  if (state.drawer.kind === 'alert-details') {
    const alert = state.alerts.find((item) => item.id === state.drawer.alertId);
    if (!alert) {
      return '';
    }

    return `
      <div class="drawer-shell">
        <div class="drawer-backdrop" data-action="close-drawer"></div>
        <aside class="drawer-panel" role="dialog" aria-modal="true">
          <header class="drawer-header">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
              <h3 class="drawer-title">${escapeHtml(alert.titulo)}</h3>
              ${statusBadge(alert.severity, toneFromSeverity(alert.severity))}
            </div>
          </header>
          <div class="drawer-body">
            <article class="card">
              <div class="form-grid two">
                ${detailItem('Severidade', alert.severity)}
                ${detailItem('Cliente', alert.cliente)}
                ${detailItem('Origem', alert.origem)}
                ${detailItem('Status', alert.status)}
                <div style="grid-column: span 2;">${detailItem('Mensagem tecnica', alert.mensagemTecnica)}</div>
                <div style="grid-column: span 2;">${detailItem('Sugestao de acao', alert.sugestaoAcao)}</div>
              </div>
            </article>
            <article class="card">
              <h4 class="card-title">Historico de tentativas</h4>
              <ul>
                ${alert.historicoTentativas.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}
              </ul>
              <div class="table-actions" style="margin-top:10px;">
                <button class="btn secondary" data-action="alert-resolve" data-alert-id="${alert.id}">Marcar como resolvido</button>
                ${alert.allowsReprocess ? `<button class="btn primary" data-action="alert-reprocess" data-alert-id="${alert.id}">Reprocessar</button>` : ''}
              </div>
            </article>
          </div>
        </aside>
      </div>
    `;
  }

  return '';
}

function renderToasts() {
  if (!state.toasts.length) {
    return '';
  }

  return `
    <div class="toast-stack">
      ${state.toasts
        .map((toast) => {
          return `<article class="toast ${toast.tone}">${escapeHtml(toast.message)}</article>`;
        })
        .join('')}
    </div>
  `;
}

function renderPageHeader({ title, description, actions }) {
  return `
    <div class="page-header">
      <div>
        <h2 class="page-title">${escapeHtml(title)}</h2>
        <p class="page-description">${escapeHtml(description)}</p>
      </div>
      <div class="page-actions">${actions.join('')}</div>
    </div>
  `;
}

function actionButton(label, action, variant) {
  return `<button class="btn ${variant}" type="button" data-action="${action}">${escapeHtml(label)}</button>`;
}

function statCard(iconKey, label, value, caption, tone) {
  const cardToneClass = tone === 'danger' ? 'danger' : tone === 'success' ? 'success' : '';
  return `
    <article class="card stat-card ${cardToneClass}">
      <div class="stat-icon">${icon(iconKey)}</div>
      <p class="stat-value">${escapeHtml(value)}</p>
      <p class="stat-label"><strong>${escapeHtml(label)}</strong><br />${escapeHtml(caption)}</p>
    </article>
  `;
}

function statusBadge(text, tone, extraClass = '') {
  const normalizedTone = ['success', 'warning', 'danger', 'info', 'neutral'].includes(tone) ? tone : 'neutral';
  return `<span class="chip ${normalizedTone} ${extraClass}">${escapeHtml(text)}</span>`;
}

function renderTableRowsOrState({ key, colSpan, rowsHtml, emptyMessage }) {
  const tableState = state.tableState[key];
  if (tableState === 'loading') {
    return `<tr><td colspan="${colSpan}" class="table-state loading">Carregando...</td></tr>`;
  }
  if (tableState === 'error') {
    return `<tr><td colspan="${colSpan}" class="table-state error">Falha ao carregar dados. Tente novamente.</td></tr>`;
  }
  if (!rowsHtml) {
    return `<tr><td colspan="${colSpan}" class="table-state">${escapeHtml(emptyMessage)}</td></tr>`;
  }
  return rowsHtml;
}

function renderTabButton(tabKey, label) {
  return `<button class="tab-btn ${state.settings.tab === tabKey ? 'active' : ''}" data-action="settings-switch-tab" data-tab="${tabKey}">${escapeHtml(label)}</button>`;
}

function detailItem(label, value) {
  return `<div><small style="color:#606062; display:block; margin-bottom:4px;">${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function kpiItem(label, value) {
  return `<article class="kpi-item"><small>${escapeHtml(label)}</small><strong>${escapeHtml(String(value))}</strong></article>`;
}

function setGlobalLoading(value) {
  state.dataReady = !value;
  Object.keys(state.tableState).forEach((key) => {
    state.tableState[key] = value ? 'loading' : 'data';
  });
}

function parseRoute(hash) {
  const raw = (hash || '#/dashboard').replace(/^#/, '') || '/dashboard';
  const clientMatch = raw.match(/^\/clientes\/([^/]+)$/);
  if (clientMatch) {
    return { name: 'client-details', params: { id: clientMatch[1] } };
  }

  const map = {
    '/dashboard': 'dashboard',
    '/clientes': 'clientes',
    '/certificados': 'certificados',
    '/buscas': 'buscas',
    '/xmls': 'xmls',
    '/alertas': 'alertas',
    '/configuracoes': 'configuracoes'
  };

  return { name: map[raw] || 'dashboard', params: {} };
}

function navigate(path) {
  window.location.hash = `#${path}`;
}

function resolvePageMeta() {
  if (state.route.name === 'client-details') {
    const client = findClientById(state.route.params.id);
    if (client) {
      return {
        title: client.razaoSocial,
        description: `Detalhes operacionais do cliente ${formatCnpj(client.cnpj)}.`
      };
    }
  }

  return pageMeta[state.route.name] || pageMeta.dashboard;
}

function resolveNavKeyByRoute(routeName) {
  if (routeName === 'client-details') {
    return 'clientes';
  }
  return routeName;
}

function applyClientsFilters(form) {
  const formData = new FormData(form);
  state.filters.clients = {
    query: String(formData.get('query') || '').trim(),
    statusBusca: String(formData.get('statusBusca') || 'Todos'),
    certificado: String(formData.get('certificado') || 'Todos'),
    municipio: String(formData.get('municipio') || 'Todos')
  };
  state.selectedClientIds = new Set();

  if (state.filters.clients.query.toLowerCase() === '__erro__') {
    state.tableState.clients = 'error';
  } else {
    state.tableState.clients = 'data';
  }

  render();
}

function getFilteredClients() {
  const { query, statusBusca, certificado, municipio } = state.filters.clients;

  return state.clients.filter((client) => {
    const matchesQuery =
      !query ||
      `${client.razaoSocial} ${client.cnpj} ${client.municipio}`.toLowerCase().includes(query.toLowerCase());

    const matchesStatus = statusBusca === 'Todos' || client.buscaStatus === statusBusca;
    const matchesCertificate = certificado === 'Todos' || client.certificadoStatus === certificado;
    const matchesMunicipio = municipio === 'Todos' || client.municipio === municipio;

    return matchesQuery && matchesStatus && matchesCertificate && matchesMunicipio;
  });
}

function isAllFilteredClientsSelected(filteredClients) {
  if (!filteredClients.length) {
    return false;
  }

  return filteredClients.every((client) => state.selectedClientIds.has(client.id));
}

function bulkUpdateClientSearch(active) {
  if (state.selectedClientIds.size === 0) {
    pushToast('Selecione clientes para aplicacao em massa.', 'error');
    return;
  }

  state.clients.forEach((client) => {
    if (state.selectedClientIds.has(client.id)) {
      client.buscaAtiva = active;
      client.buscaStatus = active ? 'Ativo' : 'Inativo';
    }
  });

  pushToast(
    `${state.selectedClientIds.size} cliente(s) atualizado(s): busca ${active ? 'ativa' : 'inativa'}.`,
    'success'
  );
  render();
}

function submitClientForm(form) {
  const formData = new FormData(form);
  const mode = String(formData.get('mode') || 'create');
  const clientId = String(formData.get('clientId') || '');
  const payload = {
    razaoSocial: String(formData.get('razaoSocial') || '').trim(),
    nomeFantasia: String(formData.get('nomeFantasia') || '').trim(),
    cnpj: normalizeDigits(String(formData.get('cnpj') || '')),
    inscricaoMunicipal: String(formData.get('inscricaoMunicipal') || '').trim(),
    municipio: String(formData.get('municipio') || '').trim(),
    uf: String(formData.get('uf') || '').trim().toUpperCase(),
    responsavelInterno: String(formData.get('responsavelInterno') || '').trim(),
    buscaAtiva: formData.get('buscaAtiva') === 'on'
  };

  if (payload.cnpj.length !== 14) {
    pushToast('Informe um CNPJ com 14 digitos.', 'error');
    return;
  }

  if (mode === 'edit') {
    const client = findClientById(clientId);
    if (!client) {
      pushToast('Cliente nao encontrado para edicao.', 'error');
      return;
    }

    Object.assign(client, {
      ...payload,
      buscaStatus: payload.buscaAtiva ? 'Ativo' : 'Inativo'
    });
    pushToast('Cliente atualizado com sucesso.', 'success');
  } else {
    const newClient = {
      id: crypto.randomUUID(),
      ...payload,
      buscaStatus: payload.buscaAtiva ? 'Ativo' : 'Inativo',
      ultimaBusca: new Date().toISOString(),
      xmlsEncontrados: 0,
      certificadoStatus: 'Nao cadastrado',
      certificadoValidade: null,
      statusOperacional: 'Pendente',
      horarioPreferencial: '02:00',
      tipoBusca: 'Ambas',
      municipioIntegrado: false
    };

    state.clients.unshift(newClient);
    pushToast('Cliente criado com sucesso.', 'success');
  }

  closeModal();
  render();
}

function getFilteredCertificates() {
  return [...state.certificates].sort((a, b) => a.diasRestantes - b.diasRestantes);
}

function simulateCertificateTest(certificateId) {
  const cert = state.certificates.find((item) => item.id === certificateId);
  if (!cert) {
    pushToast('Certificado nao encontrado.', 'error');
    return;
  }

  pushToast(`Testando certificado ${cert.apelido}...`, 'info');
  setTimeout(() => {
    const success = cert.status !== 'Vencido' && cert.status !== 'Erro de senha';
    pushToast(
      success
        ? `Certificado ${cert.apelido} validado com sucesso.`
        : `Falha na validacao do certificado ${cert.apelido}.`,
      success ? 'success' : 'error'
    );
  }, 1200);
}

function submitCertificateForm(form) {
  const formData = new FormData(form);
  const clientId = String(formData.get('clientId') || '');
  const client = findClientById(clientId);
  if (!client) {
    pushToast('Selecione um cliente valido para vincular o certificado.', 'error');
    return;
  }

  const validade = String(formData.get('validade') || '');
  const dias = daysUntil(validade);
  const status = dias < 0 ? 'Vencido' : dias <= 30 ? 'A vencer' : 'Valido';

  state.certificates.unshift({
    id: `cert-${Math.random().toString(16).slice(2, 8)}`,
    clientId,
    cliente: client.razaoSocial,
    cnpj: client.cnpj,
    tipo: String(formData.get('tipo') || 'A1'),
    apelido: String(formData.get('apelido') || 'Sem apelido'),
    validade,
    diasRestantes: dias,
    status,
    ultimaValidacao: new Date().toISOString()
  });

  client.certificadoStatus = status === 'Valido' ? 'Valido' : status === 'A vencer' ? 'A vencer' : 'Vencido';
  client.certificadoValidade = validade;

  closeModal();
  pushToast('Certificado cadastrado com sucesso (mock).', 'success');
  render();
}

function applyRunsFilters(form) {
  const data = new FormData(form);
  state.filters.runs = {
    periodo: String(data.get('periodo') || '30'),
    cliente: String(data.get('cliente') || 'Todos'),
    municipio: String(data.get('municipio') || 'Todos'),
    status: String(data.get('status') || 'Todos'),
    tipo: String(data.get('tipo') || 'Todos')
  };
  state.tableState.runs = 'data';
  render();
}

function getFilteredRuns() {
  const { periodo, cliente, municipio, status, tipo } = state.filters.runs;
  const now = Date.now();
  const days = Number(periodo || '30');

  return state.searchRuns.filter((run) => {
    const runDate = Date.parse(run.inicio);
    const withinPeriod = Number.isFinite(days) ? now - runDate <= days * 24 * 60 * 60 * 1000 : true;
    const matchesTipo = tipo === 'Todos' || run.tipo === tipo;
    const matchesStatus = status === 'Todos' || run.status === status;

    let matchesClient = true;
    if (cliente !== 'Todos') {
      matchesClient = run.detalhes.some((detail) => detail.clientId === cliente);
    }

    let matchesMunicipio = true;
    if (municipio !== 'Todos') {
      matchesMunicipio = run.detalhes.some((detail) => detail.municipio === municipio);
    }

    return withinPeriod && matchesTipo && matchesStatus && matchesClient && matchesMunicipio;
  });
}

function refreshRunningExecution() {
  if (!state.runningExecution) {
    return;
  }

  if (state.runningExecution.status !== 'Em execucao') {
    pushToast('Nao existe execucao em andamento.', 'info');
    return;
  }

  const next = Math.min(100, state.runningExecution.progressoPercentual + Math.floor(Math.random() * 18 + 6));
  state.runningExecution.progressoPercentual = next;
  state.runningExecution.processados = Math.min(
    state.runningExecution.totalClientes,
    Math.round((next / 100) * state.runningExecution.totalClientes)
  );
  state.runningExecution.tempoEstimadoMin = Math.max(2, state.runningExecution.tempoEstimadoMin - 2);

  if (next >= 100) {
    state.runningExecution.status = 'Concluida';
    pushToast('Busca manual concluida com sucesso.', 'success');
  } else {
    pushToast('Status da execucao atualizado.', 'info');
  }

  render();
}

function applyXmlFilters(form) {
  const data = new FormData(form);
  state.filters.xmls = {
    cliente: String(data.get('cliente') || 'Todos'),
    cnpj: normalizeDigits(String(data.get('cnpj') || '')),
    numero: String(data.get('numero') || '').trim(),
    emissaoInicio: String(data.get('emissaoInicio') || ''),
    emissaoFim: String(data.get('emissaoFim') || ''),
    downloadInicio: String(data.get('downloadInicio') || ''),
    downloadFim: String(data.get('downloadFim') || ''),
    municipio: String(data.get('municipio') || 'Todos'),
    tipo: String(data.get('tipo') || 'Todos'),
    status: String(data.get('status') || 'Todos'),
    caminho: String(data.get('caminho') || '').trim().toLowerCase()
  };

  state.tableState.xmls = 'data';
  render();
}

function getFilteredXmls() {
  const filters = state.filters.xmls;

  return state.xmlFiles.filter((xml) => {
    const matchesClient = filters.cliente === 'Todos' || xml.clientId === filters.cliente;
    const matchesCnpj = !filters.cnpj || normalizeDigits(xml.cnpj).includes(filters.cnpj);
    const matchesNumero = !filters.numero || String(xml.numeroNfse).includes(filters.numero);
    const matchesMunicipio = filters.municipio === 'Todos' || xml.municipio === filters.municipio;
    const matchesTipo = filters.tipo === 'Todos' || xml.tipo === filters.tipo;
    const matchesStatus = filters.status === 'Todos' || xml.statusArmazenamento === filters.status;
    const matchesPath = !filters.caminho || xml.caminhoServidor.toLowerCase().includes(filters.caminho);

    const emDate = Date.parse(xml.dataEmissao);
    const dlDate = Date.parse(xml.dataDownload);

    const matchesEmissaoInicio = !filters.emissaoInicio || emDate >= Date.parse(`${filters.emissaoInicio}T00:00:00`);
    const matchesEmissaoFim = !filters.emissaoFim || emDate <= Date.parse(`${filters.emissaoFim}T23:59:59`);
    const matchesDownloadInicio = !filters.downloadInicio || dlDate >= Date.parse(`${filters.downloadInicio}T00:00:00`);
    const matchesDownloadFim = !filters.downloadFim || dlDate <= Date.parse(`${filters.downloadFim}T23:59:59`);

    return (
      matchesClient &&
      matchesCnpj &&
      matchesNumero &&
      matchesMunicipio &&
      matchesTipo &&
      matchesStatus &&
      matchesPath &&
      matchesEmissaoInicio &&
      matchesEmissaoFim &&
      matchesDownloadInicio &&
      matchesDownloadFim
    );
  });
}

function applyAlertsFilters(form) {
  const data = new FormData(form);
  state.filters.alerts = {
    severidade: String(data.get('severidade') || 'Todos'),
    tipo: String(data.get('tipo') || 'Todos'),
    status: String(data.get('status') || 'Todos'),
    periodo: String(data.get('periodo') || '30'),
    cliente: String(data.get('cliente') || 'Todos')
  };

  state.tableState.alerts = 'data';
  state.selectedAlertIds = new Set();
  render();
}

function getFilteredAlerts() {
  const { severidade, tipo, status, periodo, cliente } = state.filters.alerts;
  const now = Date.now();
  const days = Number(periodo || '30');

  return state.alerts.filter((alert) => {
    const at = Date.parse(alert.dataHora);
    const withinPeriod = Number.isFinite(days) ? now - at <= days * 24 * 60 * 60 * 1000 : true;
    const matchesSeverity = severidade === 'Todos' || alert.severity === severidade;
    const matchesType = tipo === 'Todos' || alert.tipo === tipo;
    const matchesStatus = status === 'Todos' || alert.status === status;
    const matchesClient = cliente === 'Todos' || alert.clientId === cliente;

    return withinPeriod && matchesSeverity && matchesType && matchesStatus && matchesClient;
  });
}

function markSelectedAlertsResolved() {
  if (state.selectedAlertIds.size === 0) {
    pushToast('Selecione alertas para marcar como resolvidos.', 'error');
    return;
  }

  state.alerts.forEach((alert) => {
    if (state.selectedAlertIds.has(alert.id)) {
      alert.status = 'Resolvido';
    }
  });

  pushToast(`${state.selectedAlertIds.size} alerta(s) marcado(s) como resolvido(s).`, 'success');
  state.selectedAlertIds = new Set();
  render();
}

function resolveAlert(alertId) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) {
    return;
  }

  alert.status = 'Resolvido';
  pushToast(`Alerta "${alert.titulo}" resolvido.`, 'success');
  render();
}

function submitUserForm(form) {
  const data = new FormData(form);
  state.users.unshift({
    id: `usr-${Math.random().toString(16).slice(2, 8)}`,
    nome: String(data.get('nome') || '').trim(),
    email: String(data.get('email') || '').trim(),
    perfil: String(data.get('perfil') || 'Consulta'),
    status: String(data.get('status') || 'Ativo')
  });

  closeModal();
  pushToast('Usuario cadastrado com sucesso.', 'success');
  render();
}

function executeConfirmAction(payload) {
  if (!payload || !payload.type) {
    return;
  }

  switch (payload.type) {
    case 'reprocess-client': {
      const client = findClientById(payload.clientId);
      if (client) {
        pushToast(`Cliente ${client.razaoSocial} marcado para reprocessamento na proxima execucao.`, 'success');
      }
      return;
    }
    case 'reprocess-selected': {
      pushToast(`${state.selectedClientIds.size} cliente(s) enviados para reprocessamento.`, 'success');
      return;
    }
    case 'replace-certificate': {
      pushToast('Fluxo de substituicao iniciado (mock).', 'info');
      return;
    }
    case 'unlink-certificate': {
      const cert = state.certificates.find((item) => item.id === payload.certId);
      if (cert) {
        cert.clientId = null;
        cert.cliente = 'Sem cliente vinculado';
        cert.cnpj = '-';
        pushToast('Vinculo do certificado removido.', 'success');
        render();
      }
      return;
    }
    case 'reprocess-run-failures': {
      pushToast('Falhas da execucao enviadas para reprocessamento.', 'success');
      return;
    }
    case 'reprocess-alert': {
      pushToast('Reprocessamento solicitado para o alerta selecionado.', 'success');
      return;
    }
    default:
      return;
  }
}

function getRunHistoryByClient(clientId) {
  const rows = [];

  state.searchRuns.forEach((run) => {
    run.detalhes.forEach((detail) => {
      if (detail.clientId === clientId) {
        rows.push({
          data: run.inicio,
          inicio: run.inicio,
          fim: run.fim,
          xmlsEncontrados: detail.xmlsEncontrados,
          status: detail.status,
          mensagem: detail.mensagem
        });
      }
    });
  });

  return rows.slice(0, 8);
}

function getSystemHealthStatus() {
  const criticalOpen = state.alerts.filter((alert) => alert.severity === 'Critico' && alert.status !== 'Resolvido').length;
  if (criticalOpen > 0) {
    return {
      label: 'Operacional com atencao',
      tone: 'warning',
      description: `${criticalOpen} alerta(s) critico(s) em aberto`
    };
  }

  return {
    label: 'Operacional',
    tone: 'success',
    description: 'Sem eventos criticos ativos'
  };
}

function getPriorityAlerts() {
  const severityOrder = { Critico: 1, Atencao: 2, Informativo: 3 };
  return [...state.alerts]
    .filter((alert) => alert.status !== 'Resolvido')
    .sort((a, b) => {
      const severityDiff = (severityOrder[a.severity] || 99) - (severityOrder[b.severity] || 99);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      return Date.parse(b.dataHora) - Date.parse(a.dataHora);
    });
}

function openModal(modal) {
  state.modal = modal;
  render();
}

function closeModal() {
  if (!state.modal) {
    return;
  }
  state.modal = null;
  render();
}

function openDrawer(drawer) {
  state.drawer = drawer;
  render();
}

function closeDrawer() {
  if (!state.drawer) {
    return;
  }
  state.drawer = null;
  render();
}

function pushToast(message, tone = 'info') {
  const toast = {
    id: crypto.randomUUID(),
    message,
    tone: ['success', 'error', 'info'].includes(tone) ? tone : 'info'
  };

  state.toasts = [...state.toasts, toast].slice(-4);
  render();

  setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== toast.id);
    render();
  }, 3200);
}

function findClientById(clientId) {
  if (!clientId) {
    return null;
  }
  return state.clients.find((client) => client.id === clientId) || null;
}

function findXmlById(xmlId) {
  if (!xmlId) {
    return null;
  }
  return state.xmlFiles.find((xml) => xml.id === xmlId) || null;
}

function mapClientOptions() {
  return state.clients.reduce((acc, client) => {
    acc[client.id] = `${client.razaoSocial} (${formatCnpj(client.cnpj)})`;
    return acc;
  }, {});
}

function renderOptions(values, selectedValue, labels = {}, placeholder = '') {
  const options = [];
  if (placeholder) {
    options.push(`<option value="">${escapeHtml(placeholder)}</option>`);
  }

  values.forEach((value) => {
    const selected = String(value) === String(selectedValue) ? 'selected' : '';
    const label = labels[value] || value;
    options.push(`<option value="${escapeHtml(String(value))}" ${selected}>${escapeHtml(String(label))}</option>`);
  });

  return options.join('');
}

function toneFromStatus(status) {
  if (status === 'Sucesso') {
    return 'success';
  }
  if (status === 'Aviso') {
    return 'warning';
  }
  if (status === 'Erro') {
    return 'danger';
  }
  if (status === 'Pendente') {
    return 'neutral';
  }
  return 'neutral';
}

function toneFromRunStatus(status) {
  if (status === 'Concluida') {
    return 'success';
  }
  if (status === 'Concluida com avisos') {
    return 'warning';
  }
  if (status === 'Falha critica') {
    return 'danger';
  }
  if (status === 'Em execucao') {
    return 'info';
  }
  return 'neutral';
}

function toneFromCertificateStatus(status) {
  if (status === 'Valido') {
    return 'success';
  }
  if (status === 'A vencer') {
    return 'warning';
  }
  if (status === 'Vencido' || status === 'Erro de senha') {
    return 'danger';
  }
  return 'neutral';
}

function toneFromStorageStatus(status) {
  if (status === 'Armazenado') {
    return 'success';
  }
  if (status === 'Pendente') {
    return 'warning';
  }
  if (status === 'Erro') {
    return 'danger';
  }
  return 'neutral';
}

function toneFromSeverity(severity) {
  if (severity === 'Critico') {
    return 'danger';
  }
  if (severity === 'Atencao') {
    return 'warning';
  }
  return 'info';
}

function toneFromAlertStatus(status) {
  if (status === 'Resolvido') {
    return 'success';
  }
  if (status === 'Em analise') {
    return 'warning';
  }
  if (status === 'Aberto') {
    return 'danger';
  }
  return 'neutral';
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
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

function formatRelativeDate(value) {
  const date = new Date(value);
  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return 'Hoje';
  }

  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return 'Ontem';
  }

  return formatDate(date);
}

function formatHour(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatCurrency(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatCnpj(value) {
  const digits = normalizeDigits(String(value || ''));
  if (digits.length !== 14) {
    return value || '-';
  }

  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function diffMinutes(start, end) {
  const diff = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(diff) || diff <= 0) {
    return 0;
  }
  return Math.round(diff / 60000);
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function daysUntil(dateString) {
  const target = Date.parse(dateString);
  if (!Number.isFinite(target)) {
    return 0;
  }

  const diff = target - Date.now();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function deepClone(input) {
  return JSON.parse(JSON.stringify(input));
}

function downloadXmlById(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    pushToast('XML nao encontrado.', 'error');
    return;
  }

  const blob = new Blob([xml.conteudoXml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nfse-${xml.numeroNfse}.xml`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  pushToast(`Download do XML ${xml.numeroNfse} iniciado.`, 'success');
}

async function copyToClipboard(text) {
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    pushToast('Caminho copiado para a area de transferencia.', 'success');
  } catch {
    pushToast('Nao foi possivel copiar automaticamente. Copie manualmente.', 'error');
  }
}

function formatXml(xml) {
  if (!xml) {
    return '';
  }

  const sanitized = xml.replace(/>\s*</g, '><').trim();
  const parts = sanitized.split(/(?=<)/g);
  let depth = 0;

  return parts
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) {
        return '';
      }

      if (trimmed.startsWith('</')) {
        depth = Math.max(depth - 1, 0);
      }

      const line = `${'  '.repeat(depth)}${trimmed}`;

      if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.includes('</')) {
        depth += 1;
      }

      return line;
    })
    .filter(Boolean)
    .join('\n');
}

function icon(name) {
  const icons = {
    dashboard:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="2"></rect><rect x="13" y="3" width="8" height="5" rx="2"></rect><rect x="13" y="10" width="8" height="11" rx="2"></rect><rect x="3" y="13" width="8" height="8" rx="2"></rect></svg>',
    users:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 8v6"></path><path d="M23 11h-6"></path></svg>',
    shield:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 4v5c0 5-3.5 8.7-8 10-4.5-1.3-8-5-8-10V7l8-4z"></path></svg>',
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-3.5-3.5"></path></svg>',
    file:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path></svg>',
    alert:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4"></path><circle cx="12" cy="17" r="1"></circle></svg>',
    settings:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 0 1 0 2.8 2 2 0 0 1-2.8 0l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"></path></svg>',
    menu:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"></path><path d="M3 12h18"></path><path d="M3 18h18"></path></svg>',
    'arrow-left':
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"></path></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path></svg>',
    info:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><circle cx="12" cy="8" r="1"></circle></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6L9 17l-5-5"></path></svg>'
  };

  return icons[name] || icons.info;
}

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="clients-clear-filters"]');
  if (!node) {
    return;
  }
  state.filters.clients = { query: '', statusBusca: 'Todos', certificado: 'Todos', municipio: 'Todos' };
  state.selectedClientIds = new Set();
  state.tableState.clients = 'data';
  render();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="runs-clear-filters"]');
  if (!node) {
    return;
  }
  state.filters.runs = { periodo: '30', cliente: 'Todos', municipio: 'Todos', status: 'Todos', tipo: 'Todos' };
  state.tableState.runs = 'data';
  render();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="xmls-clear-filters"]');
  if (!node) {
    return;
  }
  state.filters.xmls = {
    cliente: 'Todos',
    cnpj: '',
    numero: '',
    emissaoInicio: '',
    emissaoFim: '',
    downloadInicio: '',
    downloadFim: '',
    municipio: 'Todos',
    tipo: 'Todos',
    status: 'Todos',
    caminho: ''
  };
  state.tableState.xmls = 'data';
  render();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="alerts-clear-filters"]');
  if (!node) {
    return;
  }
  state.filters.alerts = {
    severidade: 'Todos',
    tipo: 'Todos',
    status: 'Todos',
    periodo: '30',
    cliente: 'Todos'
  };
  state.selectedAlertIds = new Set();
  state.tableState.alerts = 'data';
  render();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="open-new-manual-run"]');
  if (!node) {
    return;
  }
  pushToast('Nova busca manual agendada (mock).', 'success');
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="open-schedule-reprocess"]');
  if (!node) {
    return;
  }
  pushToast('Reprocessamento agendado para a proxima janela noturna (mock).', 'success');
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="settings-test-run"]');
  if (!node) {
    return;
  }
  pushToast('Teste da rotina noturna iniciado (mock).', 'info');
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="settings-test-storage"]');
  if (!node) {
    return;
  }
  pushToast('Conexao com servidor validada com sucesso (mock).', 'success');
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="settings-user-edit"]');
  if (!node) {
    return;
  }
  pushToast('Edicao de usuario sera integrada em fluxo dedicado.', 'info');
});
