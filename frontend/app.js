const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const drawerRoot = document.getElementById('drawerRoot');
const toastRoot = document.getElementById('toastRoot');
const API_TIMEOUT_MS = 20000;
const SEARCH_PAGE_SIZE = 100;
const RESOLVED_ALERTS_STORAGE_KEY = 'gcont:resolved-alerts:v1';
const NIGHTLY_SWEEP_AVAILABLE_SLOTS = ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'];

const navItems = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
  { key: 'clientes', label: 'Clientes', icon: 'users', route: '/clientes' },
  { key: 'certificados', label: 'Certificados', icon: 'shield', route: '/certificados' },
  { key: 'buscas', label: 'Buscas', icon: 'search', route: '/buscas' },
  { key: 'armazenados', label: 'Armazenados', icon: 'file', route: '/xmls' },
  { key: 'alertas', label: 'Alertas', icon: 'alert', route: '/alertas' },
  { key: 'configuracoes', label: 'Configuracoes', icon: 'settings', route: '/configuracoes' }
];

const pageMeta = {
  dashboard: {
    title: 'Dashboard',
    description: 'Visao geral da operacao de busca e armazenamento de NFS-e e NF-e.'
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
    title: 'XMLs NFS-e',
    description: 'Consulte XMLs armazenados de NFS-e no servidor interno.'
  },
  'buscas-nfe': {
    title: 'Buscas NF-e',
    description: 'Gerencie a importacao de XMLs de NF-e por cliente e acompanhe os controles de captura.'
  },
  'xmls-nfe': {
    title: 'XMLs NF-e',
    description: 'Consulte XMLs armazenados de NF-e no servidor interno.'
  },
  'xmls-cte': {
    title: 'XMLs CT-e',
    description: 'Consulte XMLs armazenados de CT-e no servidor interno.'
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
  dataSource: 'api',
  modal: null,
  drawer: null,
  toasts: [],
  selectedClientIds: new Set(),
  selectedAlertIds: new Set(),
  selectedXmlIds: new Set(),
  clients: [],
  certificates: [],
  searchRuns: [],
  runningExecution: null,
  executionMonitor: {
    active: false,
    mode: 'Automatica',
    startedAt: null,
    finishedAt: null,
    currentClientName: null,
    processed: 0,
    total: 0,
    successful: 0,
    failed: 0,
    message: 'Aguardando execucao.',
    updatedAt: null,
    lastXml: null
  },
  manualActivation: {
    running: false,
    stopRequested: false,
    disabling: false
  },
  xmlEventsSyncRunning: false,
  nfeEventsSyncRunning: false,
  cteEventsSyncRunning: false,
  nfeSyncControls: [],
  nfeDocuments: [],
  cteDocuments: [],
  nfeDashboardStats: null,
  cteDashboardStats: null,
  nfeSchedulerStatus: null,
  nfeLastRunReport: null,
  nfeSyncSections: {
    scheduler: true,
    failures: false,
    filters: false,
    simplified: true,
    technical: false
  },
  nfeSearch: {
    hasSearched: false,
    results: [],
    lastQuery: null,
    lastSearchedAt: null,
    page: 1,
    pageSize: SEARCH_PAGE_SIZE,
    total: 0,
    totalPages: 0
  },
  cteSearch: {
    hasSearched: false,
    results: [],
    lastQuery: null,
    lastSearchedAt: null,
    page: 1,
    pageSize: SEARCH_PAGE_SIZE,
    total: 0,
    totalPages: 0
  },
  xmlFiles: [],
  xmlSearch: {
    hasSearched: false,
    results: [],
    lastQuery: null,
    lastSearchedAt: null,
    page: 1,
    pageSize: SEARCH_PAGE_SIZE,
    total: 0,
    totalPages: 0
  },
  alerts: [],
  resolvedAlerts: loadResolvedAlertsStore(),
  establishmentsByClient: {},
  syncByClient: {},
  dashboardStats: null,
  schedulerStatus: null,
  settings: {
    tab: 'geral',
    geral: {
      nomeAmbiente: 'GCONT - Ambiente Interno',
      modoOperacao: 'Producao',
      statusSistema: 'Operacional'
    },
    rotina: {
      ativa: true,
      horariosAtivos: ['02:00'],
      horariosDisponiveis: [...NIGHTLY_SWEEP_AVAILABLE_SLOTS],
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
    },
    danfseReprocessRunning: false
  },
  filters: {
    clients: {
      query: '',
      statusBusca: 'Todos',
      certificado: 'Todos',
      municipio: 'Todos'
    },
    certificates: {
      query: ''
    },
    runs: {
      periodo: '30',
      cliente: 'Todos',
      municipio: 'Todos',
      status: 'Todos',
      tipo: 'Todos'
    },
    nfeSync: {
      cliente: 'Todos',
      status: 'Todos',
      ambiente: 'Todos'
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
      status: 'Todos'
    },
    nfeDocs: {
      cliente: 'Todos',
      tipo: 'Todos',
      cnpj: '',
      numero: '',
      chave: '',
      emissaoInicio: '',
      emissaoFim: '',
      status: 'Todos',
      schemaDoc: 'Todos',
      valorMin: '',
      valorMax: '',
      xmlCompleto: 'Todos',
      ambiente: 'Todos'
    },
    cteDocs: {
      cliente: 'Todos',
      tipo: 'Todos',
      cnpj: '',
      numero: '',
      chave: '',
      emissaoInicio: '',
      emissaoFim: '',
      status: 'Todos',
      schemaDoc: 'Todos',
      valorMin: '',
      valorMax: '',
      xmlCompleto: 'Todos',
      ambiente: 'Todos'
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
    nfeSync: 'loading',
    xmls: 'loading',
    nfeDocs: 'loading',
    cteDocs: 'loading',
    alerts: 'loading'
  },
  sort: {
    xmls: {
      key: 'dataDownload',
      direction: 'desc'
    },
    nfeDocs: {
      key: 'dataEmissao',
      direction: 'desc'
    },
    cteDocs: {
      key: 'dataEmissao',
      direction: 'desc'
    }
  }
};

boot();

function boot() {
  if (!window.location.hash) {
    window.location.hash = '#/dashboard';
    state.route = parseRoute(window.location.hash);
  }

  wireGlobalEvents();
  render();
  void initializeData();
}

async function initializeData() {
  setGlobalLoading(true);
  render();

  await wait(250);

  try {
    await hydrateFromApi();
    state.dataSource = 'api';
  } catch (error) {
    console.error('Falha ao carregar dados reais da API.', error);
    state.dataSource = 'api';
    Object.keys(state.tableState).forEach((key) => {
      state.tableState[key] = 'error';
    });
    state.executionMonitor.message = 'Falha ao carregar dados reais da API.';
    state.executionMonitor.updatedAt = new Date().toISOString();
    pushToast('Nao foi possivel carregar dados reais da API. Verifique backend e banco.', 'error');
  }

  setGlobalLoading(false);
  render();
}

async function hydrateFromApi() {
  const apiClientsRaw = await apiRequest('/clientes');
  if (!Array.isArray(apiClientsRaw)) {
    throw new Error('Resposta inesperada em /clientes');
  }

  const apiClients = apiClientsRaw.map((client) => ({
    ...client,
    cnpj: normalizeDigits(client.cnpj || '')
  }));
  const clientIds = apiClients.map((client) => client.id);

  const [
    establishmentsByClient,
    certificatesByClient,
    allCertificatesRaw,
    syncByClient,
    nfeSyncByClient,
    dashboardStats,
    nfeDashboardStats,
    cteDashboardStats,
    nfeSchedulerStatus,
    nfseDocs,
    nfeDocs,
    cteDocs,
    auditRows,
    schedulerStatus
  ] = await Promise.all([
    fetchJsonByClientId(clientIds, (clientId) => `/clientes/${clientId}/estabelecimentos`, []),
    fetchJsonByClientId(clientIds, (clientId) => `/clientes/${clientId}/certificados`, []),
    apiRequest('/certificados').catch(() => null),
    fetchJsonByClientId(clientIds, (clientId) => `/clientes/${clientId}/sync/status`, { controles: [], logs: [] }),
    fetchJsonByClientId(clientIds, (clientId) => `/nfe/sync/status?clienteId=${encodeURIComponent(clientId)}`, []),
    apiRequest('/nfse/dashboard-stats').catch(() => null),
    apiRequest('/nfe/dashboard-stats').catch(() => null),
    apiRequest('/cte/dashboard-stats').catch(() => null),
    apiRequest('/nfe/sync/scheduler-status').catch(() => null),
    apiRequest(`/nfse?pageSize=${SEARCH_PAGE_SIZE}`).catch(() => []),
    apiRequest(`/nfe?pageSize=${SEARCH_PAGE_SIZE}`).catch(() => []),
    apiRequest(`/cte?pageSize=${SEARCH_PAGE_SIZE}`).catch(() => []),
    apiRequest('/auditoria').catch(() => []),
    apiRequest('/sync/scheduler-status').catch(() => null)
  ]);

  const nfseDocsPage = normalizePaginatedResponse(nfseDocs);
  const nfeDocsPage = normalizePaginatedResponse(nfeDocs);
  const cteDocsPage = normalizePaginatedResponse(cteDocs);

  const clients = buildClientsFromApi(
    apiClients,
    establishmentsByClient,
    certificatesByClient,
    syncByClient,
    nfseDocsPage.items,
    dashboardStats
  );
  const certificates = buildCertificatesFromApi(apiClients, certificatesByClient, allCertificatesRaw);
  const xmlFiles = buildXmlFilesFromApi(nfseDocsPage.items, clients);
  const searchRuns = buildSearchRunsFromApi(syncByClient, clients);
  const nfeDocuments = buildNfeDocumentsFromApi(nfeDocsPage.items, clients);
  const cteDocuments = buildCteDocumentsFromApi(cteDocsPage.items, clients);
  const nfeSyncControls = buildNfeSyncControlsFromApi(nfeSyncByClient, clients, establishmentsByClient);
  const alerts = buildAlertsFromApi(certificates, syncByClient, clients, xmlFiles, auditRows);

  state.clients = clients;
  state.certificates = certificates;
  state.searchRuns = searchRuns;
  state.runningExecution = null;
  state.xmlFiles = xmlFiles;
  state.nfeDocuments = nfeDocuments;
  state.cteDocuments = cteDocuments;
  state.nfeSyncControls = nfeSyncControls;
  state.nfeDashboardStats = nfeDashboardStats;
  state.cteDashboardStats = cteDashboardStats;
  state.nfeSchedulerStatus = nfeSchedulerStatus;
  state.alerts = applyResolvedAlertState(alerts);
  state.establishmentsByClient = establishmentsByClient;
  state.syncByClient = syncByClient;
  state.dashboardStats = dashboardStats;
  state.schedulerStatus = schedulerStatus;
  applySchedulerStatusToSettings(schedulerStatus);
  syncExecutionMonitorWithData();
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

  if (action === 'overlay-close' && event.target !== actionNode) {
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
    case 'toggle-nfe-sync-section': {
      const sectionKey = actionNode.getAttribute('data-section-key');
      if (!sectionKey) {
        return;
      }
      toggleNfeSyncSection(sectionKey);
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
      void toggleClientSearchStatus(clientId);
      return;
    }
    case 'client-toggle-nfe-search': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      void toggleClientNfeSearchStatus(clientId);
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
      void bulkUpdateClientSearch(true);
      return;
    }
    case 'clients-bulk-deactivate': {
      void bulkUpdateClientSearch(false);
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
      openModal({ kind: 'certificate-form', mode: 'create', clientId: actionNode.getAttribute('data-client-id') || '' });
      return;
    }
    case 'certificate-edit': {
      const certId = actionNode.getAttribute('data-cert-id');
      if (!certId) {
        return;
      }
      openModal({ kind: 'certificate-form', mode: 'edit', certId });
      return;
    }
    case 'certificate-test': {
      const certificateId = actionNode.getAttribute('data-cert-id');
      if (!certificateId) {
        return;
      }
      void simulateCertificateTest(certificateId);
      return;
    }
    case 'certificate-download': {
      const certificateId = actionNode.getAttribute('data-cert-id');
      if (!certificateId) {
        return;
      }
      void downloadCertificate(certificateId);
      return;
    }
    case 'certificate-password': {
      const certificateId = actionNode.getAttribute('data-cert-id');
      if (!certificateId) {
        return;
      }
      void revealCertificatePassword(certificateId);
      return;
    }
    case 'copy-certificate-password': {
      if (state.modal?.kind !== 'certificate-password' || !state.modal.senha) {
        return;
      }
      void copyTextToClipboard(state.modal.senha)
        .then(() => pushToast('Senha copiada.', 'success'))
        .catch(() => pushToast('Nao foi possivel copiar a senha.', 'error'));
      return;
    }
    case 'certificate-notes': {
      const certificateId = actionNode.getAttribute('data-cert-id');
      if (!certificateId) {
        return;
      }
      openModal({ kind: 'certificate-notes', certId: certificateId });
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
      if (!certId) {
        return;
      }
      openModal({ kind: 'certificate-form', mode: 'edit', certId, replace: true });
      return;
    }
    case 'certificate-unlink': {
      const certId = actionNode.getAttribute('data-cert-id');
      const cert = state.certificates.find((item) => item.id === certId);
      openModal({
        kind: 'confirm',
        title: cert?.clientId ? 'Remover vinculo de certificado' : 'Desativar certificado',
        subtitle: cert?.clientId
          ? 'Deseja remover o vinculo deste certificado com o cliente atual? O certificado ficara avulso e inativo.'
          : 'Deseja desativar este certificado avulso?',
        confirmLabel: cert?.clientId ? 'Remover vinculo' : 'Desativar',
        payload: { type: 'unlink-certificate', certId }
      });
      return;
    }
    case 'certificate-delete': {
      const certId = actionNode.getAttribute('data-cert-id');
      const cert = state.certificates.find((item) => item.id === certId);
      if (!cert) {
        return;
      }
      openModal({
        kind: 'confirm',
        title: 'Excluir certificado',
        subtitle: 'Deseja excluir este certificado definitivamente?',
        confirmLabel: 'Excluir certificado',
        intent: 'danger',
        payload: { type: 'delete-certificate', certId }
      });
      return;
    }
    case 'certificates-clear-filters': {
      resetCertificatesFilters();
      render();
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
    case 'recover-past-nsus': {
      openModal({
        kind: 'recover-past-nsus'
      });
      return;
    }
    case 'execution-refresh': {
      refreshRunningExecution();
      return;
    }
    case 'execution-monitor-refresh': {
      void refreshExecutionMonitorNow();
      return;
    }
    case 'execution-reprocess-client': {
      const clientId = actionNode.getAttribute('data-client-id');
      const client = findClientById(clientId);
      if (client) {
        if (state.dataSource === 'api') {
          void (async () => {
            try {
              await apiRequest(`/clientes/${client.id}/sync/iniciar`, {
                method: 'POST',
                body: { modo: 'diario' }
              });
              pushToast(`Cliente ${client.razaoSocial} enviado para reprocessamento.`, 'success');
              await refreshApiData();
            } catch (error) {
              pushToast(`Falha ao reprocessar cliente: ${toErrorMessage(error)}`, 'error');
            }
          })();
        } else {
          pushToast(`Cliente ${client.razaoSocial} enviado para fila de reprocessamento.`, 'success');
        }
      }
      return;
    }
    case 'xml-export-list': {
      exportXmlListToCsv();
      return;
    }
    case 'nfe-sync-refresh': {
      void refreshApiData();
      return;
    }
    case 'nfe-enable-auto-search': {
      void enableNfeSearchForAllClients();
      return;
    }
    case 'nfe-disable-auto-search': {
      void disableNfeSearchForAllClients();
      return;
    }
    case 'nfe-run-now': {
      void runNfeSearchNow();
      return;
    }
    case 'nfe-client-enable': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      void enableNfeSearchForClient(clientId);
      return;
    }
    case 'nfe-client-pause': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      void pauseNfeSync({
        clienteId: clientId
      });
      return;
    }
    case 'nfe-sync-clear-filters': {
      resetNfeSyncFilters();
      render();
      return;
    }
    case 'nfe-sync-run-control': {
      const clientId = actionNode.getAttribute('data-client-id');
      const estabelecimentoId = actionNode.getAttribute('data-estabelecimento-id') || '';
      const ambiente = actionNode.getAttribute('data-ambiente') || 'producao';
      if (!clientId) {
        return;
      }
      void runNfeSyncNow({
        clienteId: clientId,
        estabelecimentoId: estabelecimentoId || undefined,
        ambiente,
        limitControles: 1
      });
      return;
    }
    case 'nfe-open-client-xmls': {
      const clientId = actionNode.getAttribute('data-client-id');
      if (!clientId) {
        return;
      }
      void openNfeDocumentsForClient(clientId);
      return;
    }
    case 'stored-docs-switch': {
      const docType = actionNode.getAttribute('data-doc-type');
      navigate(docType === 'nfe' ? '/xmls-nfe' : docType === 'cte' ? '/xmls-cte' : '/xmls');
      return;
    }
    case 'search-type-switch': {
      const searchType = actionNode.getAttribute('data-search-type');
      navigate(searchType === 'nfe' ? '/buscas-nfe' : '/buscas');
      return;
    }
    case 'nfe-sync-pause-control': {
      const clientId = actionNode.getAttribute('data-client-id');
      const ambiente = actionNode.getAttribute('data-ambiente') || 'producao';
      if (!clientId) {
        return;
      }
      void pauseNfeSync({
        clienteId: clientId,
        ambiente
      });
      return;
    }
    case 'nfe-docs-clear-filters': {
      resetNfeDocsSearch();
      render();
      return;
    }
    case 'nfe-docs-run-now-client': {
      void runNfeSyncForCurrentDocumentsClient();
      return;
    }
    case 'nfe-export-list': {
      exportNfeListToCsv();
      return;
    }
    case 'cte-export-list': {
      exportCteListToCsv();
      return;
    }
    case 'nfe-details': {
      const nfeId = actionNode.getAttribute('data-nfe-id');
      if (!nfeId) {
        return;
      }
      openModal({ kind: 'nfe-details', nfeId });
      return;
    }
    case 'nfe-view': {
      const nfeId = actionNode.getAttribute('data-nfe-id');
      if (!nfeId) {
        return;
      }
      void openNfeViewer(nfeId);
      return;
    }
    case 'nfe-download': {
      const nfeId = actionNode.getAttribute('data-nfe-id');
      if (!nfeId) {
        return;
      }
      void downloadNfeXmlById(nfeId);
      return;
    }
    case 'nfe-sync-events': {
      const nfeId = actionNode.getAttribute('data-nfe-id');
      if (!nfeId) {
        return;
      }
      void syncEventsForNfe(nfeId);
      return;
    }
    case 'nfe-sync-events-listed': {
      void syncEventsForListedNfes();
      return;
    }
    case 'cte-docs-clear-filters': {
      resetCteDocsSearch();
      render();
      return;
    }
    case 'cte-docs-sort': {
      const key = actionNode.getAttribute('data-sort-key');
      if (!key) {
        return;
      }
      updateCteSort(key);
      return;
    }
    case 'cte-details': {
      const cteId = actionNode.getAttribute('data-cte-id');
      if (!cteId) {
        return;
      }
      openModal({ kind: 'cte-details', cteId });
      return;
    }
    case 'cte-view': {
      const cteId = actionNode.getAttribute('data-cte-id');
      if (!cteId) {
        return;
      }
      void openCteViewer(cteId);
      return;
    }
    case 'cte-download': {
      const cteId = actionNode.getAttribute('data-cte-id');
      if (!cteId) {
        return;
      }
      void downloadCteXmlById(cteId);
      return;
    }
    case 'cte-sync-events': {
      const cteId = actionNode.getAttribute('data-cte-id');
      if (!cteId) {
        return;
      }
      void syncEventsForCte(cteId);
      return;
    }
    case 'cte-sync-events-listed': {
      void syncEventsForListedCtes();
      return;
    }
    case 'nfe-last-run-view-xml': {
      const clientId = actionNode.getAttribute('data-client-id');
      const catalogoId = Number(actionNode.getAttribute('data-catalogo-id') || '0');
      if (!clientId || !Number.isInteger(catalogoId) || catalogoId <= 0) {
        return;
      }
      void openDominioNfeXmlViewer(clientId, catalogoId);
      return;
    }
    case 'nfe-last-run-import-item': {
      const clientId = actionNode.getAttribute('data-client-id');
      const catalogoId = Number(actionNode.getAttribute('data-catalogo-id') || '0');
      if (!clientId || !Number.isInteger(catalogoId) || catalogoId <= 0) {
        return;
      }
      void importDominioNfeLastRunItems([{ clientId, catalogoId }]);
      return;
    }
    case 'nfe-last-run-import-all': {
      void importAllDominioNfeLastRunItems();
      return;
    }
    case 'dominio-nfe-download-modal': {
      void downloadDominioNfeModalXml();
      return;
    }
    case 'nfe-docs-sort': {
      const key = actionNode.getAttribute('data-sort-key');
      if (!key) {
        return;
      }
      updateNfeSort(key);
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
      void openXmlViewer(xmlId);
      return;
    }
    case 'xml-download': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      void downloadXmlById(xmlId);
      return;
    }
    case 'xml-download-danfse': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      void downloadDanfseByXmlId(xmlId);
      return;
    }
    case 'xml-sync-events': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      void syncEventsForXml(xmlId);
      return;
    }
    case 'xml-select': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      if (actionNode.checked) {
        state.selectedXmlIds.add(xmlId);
      } else {
        state.selectedXmlIds.delete(xmlId);
      }
      render();
      return;
    }
    case 'xmls-toggle-all': {
      const checked = actionNode.checked;
      getFilteredXmls().forEach((xml) => {
        if (!xml.apiNfseId) {
          return;
        }
        if (checked) {
          state.selectedXmlIds.add(xml.id);
        } else {
          state.selectedXmlIds.delete(xml.id);
        }
      });
      render();
      return;
    }
    case 'xmls-batch-download': {
      const tipoArquivo = actionNode.getAttribute('data-tipo-arquivo') || 'ambos';
      void downloadSelectedXmlBatch(tipoArquivo);
      return;
    }
    case 'xmls-sync-events-listed': {
      void syncEventsForListedXmls();
      return;
    }
    case 'xmls-sort': {
      const key = actionNode.getAttribute('data-sort-key');
      if (!key) {
        return;
      }
      updateXmlSort(key);
      return;
    }
    case 'xmls-recover-past-nsus': {
      void recoverPastNsusForCurrentXmlClient();
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
    case 'settings-reprocess-danfse': {
      if (state.settings.danfseReprocessRunning) {
        pushToast('Reprocessamento de DANFSEs ja esta em andamento.', 'info');
        return;
      }

      openModal({
        kind: 'confirm',
        title: 'Reprocessar DANFSEs antigas',
        subtitle: 'Confirmar atualizacao dos PDFs legados ou ausentes para o modelo atual?',
        confirmLabel: 'Reprocessar DANFSEs',
        intent: 'warning',
        payload: { type: 'reprocess-danfses' }
      });
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
      void executeConfirmAction(state.modal.payload);
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
      void submitClientForm(target);
      return;
    }
    case 'recoverPastNsusForm': {
      event.preventDefault();
      const data = new FormData(target);
      const clientId = String(data.get('clienteId') || '').trim();
      closeModal();
      void executeConfirmAction({
        type: 'recover-past-nsus',
        clientId: clientId || null
      });
      return;
    }
    case 'certificatesModalForm': {
      event.preventDefault();
      void submitCertificateForm(target);
      return;
    }
    case 'certificateNotesForm': {
      event.preventDefault();
      void submitCertificateNotesForm(target);
      return;
    }
    case 'runsFilterForm': {
      event.preventDefault();
      applyRunsFilters(target);
      return;
    }
    case 'certificatesFilterForm': {
      event.preventDefault();
      applyCertificatesFilters(target);
      return;
    }
    case 'nfeSyncFilterForm': {
      event.preventDefault();
      applyNfeSyncFilters(target);
      return;
    }
    case 'xmlsFilterForm': {
      event.preventDefault();
      void applyXmlFilters(target);
      return;
    }
    case 'nfeDocsFilterForm': {
      event.preventDefault();
      void applyNfeDocsFilters(target);
      return;
    }
    case 'cteDocsFilterForm': {
      event.preventDefault();
      void applyCteDocsFilters(target);
      return;
    }
    case 'alertsFilterForm': {
      event.preventDefault();
      applyAlertsFilters(target);
      return;
    }
    case 'clientSearchConfigForm': {
      event.preventDefault();
      void submitClientSearchConfigForm(target);
      return;
    }
    case 'settingsGeralForm':
      event.preventDefault();
      pushToast('Configuracoes salvas com sucesso.', 'success');
      return;
    case 'settingsRotinaForm':
      event.preventDefault();
      void submitSettingsRotinaForm(target);
      return;
    case 'settingsServidorForm':
    case 'settingsNotificacoesForm': {
      event.preventDefault();
      pushToast('Configuracoes salvas com sucesso.', 'success');
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
  const nightlyInfo = getNightlyScheduleInfo();

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
          <div>Rotina noturna: ${escapeHtml(nightlyInfo.shortLabel)}</div>
          <div>${escapeHtml(healthStatus.description)}</div>
          <div>Fonte: Banco local</div>
        </div>
        ${statusBadge(nightlyInfo.badgeLabel, nightlyInfo.tone)}
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
    case 'buscas-nfe':
      return renderNfeSyncPage();
    case 'xmls-nfe':
      return renderNfeDocumentsPage();
    case 'xmls-cte':
      return renderCteDocumentsPage();
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
  const dashboardStats = getDashboardStats();
  const nfeStats = getNfeDashboardStats();
  const cteStats = getCteDashboardStats();
  const certsExpiring = state.certificates.filter((cert) => cert.status === 'A vencer').length;
  const latestSearchRows = [...state.clients]
    .sort((a, b) => Date.parse(b.ultimaBusca || 0) - Date.parse(a.ultimaBusca || 0))
    .slice(0, 8);
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

      ${renderSchedulerStatusStrip()}

      <section class="stats-grid">
        ${statCard('users', 'Clientes monitorados', String(dashboardStats.totalClients), `${dashboardStats.activeClients} com busca habilitada`, 'neutral')}
        ${statCard('file', 'NFS-e no banco', String(dashboardStats.totalNfse), 'documentos de servico armazenados', 'neutral')}
        ${statCard('folder', 'XMLs NFS-e', String(dashboardStats.storedXmls), 'arquivos salvos no servidor interno', 'success')}
        ${statCard('file', 'NF-e no banco', String(nfeStats.totalNfe), 'documentos de compra e venda armazenados', 'info')}
        ${statCard('folder', 'XMLs NF-e', String(nfeStats.xmlsCompletos), 'XMLs completos disponiveis no storage', 'info')}
        ${statCard('file', 'CT-e no banco', String(cteStats.totalCte), 'documentos de transporte armazenados', 'info')}
        ${statCard('folder', 'XMLs CT-e', String(cteStats.xmlsCompletos), 'XMLs completos de transporte no storage', 'info')}
        ${statCard('alert', 'Falhas', String(dashboardStats.clientsWithErrors), 'clientes com erro', 'danger')}
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
                  <th>NFS-e</th>
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

function getDashboardStats() {
  const totalClients = state.clients.length;
  const activeClients = state.clients.filter((client) => client.buscaAtiva).length;
  const fallbackTotalNfseByClient = state.clients.reduce((sum, client) => sum + Number(client.xmlsEncontrados || 0), 0);
  const fallbackTotalNfse = Math.max(fallbackTotalNfseByClient, state.xmlFiles.length);
  const fallbackStoredXmls = state.xmlFiles.filter((xml) => xml.statusArmazenamento === 'Armazenado').length;
  const clientsWithErrors = state.clients.filter((client) => client.buscaStatus === 'Erro' || client.statusOperacional === 'Erro').length;
  const totalNfse = Number(state.dashboardStats?.totalNfse ?? fallbackTotalNfse);
  const storedXmls = Number(state.dashboardStats?.storedXmls ?? fallbackStoredXmls);

  return {
    totalClients,
    activeClients,
    totalNfse,
    storedXmls,
    clientsWithErrors
  };
}

function renderClientsPage() {
  const clients = getFilteredClients();
  const municipios = uniqueValues(state.clients.map((client) => client.municipio));

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Clientes',
        description: 'Gerencie clientes monitorados para rotinas automatizadas de NFS-e e importacao de NF-e.',
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
            <button class="btn secondary" type="button" data-action="clients-bulk-activate">Habilitar busca</button>
            <button class="btn secondary" type="button" data-action="clients-bulk-deactivate">Pausar busca</button>
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
                <th>Estabelecimento</th>
                <th>Cursor NF-e</th>
                <th>Certificado</th>
                <th>Busca NFS-e</th>
                <th>Busca NF-e</th>
                <th>Ultima busca</th>
                <th>XMLs encontrados</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRowsOrState({
                key: 'clients',
                colSpan: 12,
                rowsHtml: clients
                  .map((client) => {
                    const establishmentSummary = getClientEstablishmentSummary(client.id);
                    const nfeBaseSummary = getClientNfeBaseSummary(client.id);
                    return `
                      <tr>
                        <td><input type="checkbox" data-action="client-select" data-client-id="${client.id}" ${state.selectedClientIds.has(client.id) ? 'checked' : ''} aria-label="Selecionar ${escapeHtml(client.razaoSocial)}" /></td>
                        <td>
                          <span class="row-title">${escapeHtml(client.razaoSocial)}</span>
                          <span class="row-sub">${escapeHtml(formatCnpj(client.cnpj))}</span>
                        </td>
                        <td>${escapeHtml(client.municipio)} / ${escapeHtml(client.uf)}</td>
                        <td>
                          ${statusBadge(establishmentSummary.statusLabel, establishmentSummary.statusTone)}
                          <span class="row-sub">${escapeHtml(establishmentSummary.detail)}</span>
                        </td>
                        <td>
                          <span class="row-title">${escapeHtml(nfeBaseSummary.displayValue)}</span>
                          <span class="row-sub">${escapeHtml(nfeBaseSummary.detail)}</span>
                        </td>
                        <td>
                          ${statusBadge(client.certificadoStatus, toneFromCertificateStatus(client.certificadoStatus))}
                          <span class="row-sub">${client.certificadoValidade ? `Validade: ${escapeHtml(formatDate(client.certificadoValidade))}` : 'Sem certificado'}</span>
                        </td>
                        <td>${renderClientSearchActivation(client)}</td>
                        <td>${renderClientNfeSearchActivation(client)}</td>
                        <td>${escapeHtml(formatDateTime(client.ultimaBusca))}</td>
                        <td>${escapeHtml(String(client.xmlsEncontrados))}</td>
                        <td>${statusBadge(client.statusOperacional, toneFromStatus(client.statusOperacional))}</td>
                        <td>
                          <div class="table-actions">
                            <button class="icon-btn" data-action="client-details" data-client-id="${client.id}">Ver detalhes</button>
                            <button class="icon-btn" data-action="client-edit" data-client-id="${client.id}">Editar</button>
                            <button class="icon-btn" data-action="client-reprocess" data-client-id="${client.id}">Reprocessar busca</button>
                            <button class="icon-btn" data-action="client-toggle-search" data-client-id="${client.id}">${client.buscaAtiva ? 'Pausar busca' : 'Habilitar busca'}</button>
                            <button class="icon-btn" data-action="client-toggle-nfe-search" data-client-id="${client.id}">${client.buscaNfeAtiva !== false ? 'Pausar NF-e' : 'Habilitar NF-e'}</button>
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
  const establishmentSummary = getClientEstablishmentSummary(client.id);
  const nfeBaseSummary = getClientNfeBaseSummary(client.id);

  return `
    <section class="page-section">
      <div class="page-header">
        <div>
          <button class="btn ghost" type="button" data-action="navigate" data-route="/clientes">${icon('arrow-left')} Voltar</button>
          <h2 class="page-title" style="margin-top:8px;">${escapeHtml(client.razaoSocial)}</h2>
          <p class="page-description">${escapeHtml(formatCnpj(client.cnpj))}</p>
        </div>
        <div class="page-actions">
          ${statusBadge(client.buscaAtiva ? 'Busca habilitada' : 'Busca pausada', client.buscaAtiva ? 'success' : 'neutral')}
          ${statusBadge(client.buscaNfeAtiva !== false ? 'NF-e habilitada' : 'NF-e pausada', client.buscaNfeAtiva !== false ? 'info' : 'neutral')}
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
              ${detailItem('Estabelecimento', establishmentSummary.detail)}
              ${detailItem('Cursor NF-e', nfeBaseSummary.displayValue)}
              ${detailItem('Controles NF-e', nfeBaseSummary.controlsLabel)}
              ${detailItem('Busca NF-e', client.buscaNfeAtiva !== false ? 'Habilitada' : 'Pausada')}
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
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  ${clientXmls.length
                    ? clientXmls
                        .map((xml) => {
                          return `<tr class="${xml.cancelada ? 'xml-row-cancelled' : ''}">
                            <td>${renderNfseNumber(xml)}</td>
                            <td>${escapeHtml(formatDate(xml.dataEmissao))}</td>
                            <td>${escapeHtml(`${xml.prestador} / ${xml.tomador}`)}</td>
                            <td>${escapeHtml(formatCurrency(xml.valor))}</td>
                            <td>
                              <div class="table-actions">
                                <button class="icon-btn" data-action="xml-details" data-xml-id="${xml.id}">Visualizar</button>
                                <button class="icon-btn" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
                                <button class="icon-btn" data-action="xml-download-danfse" data-xml-id="${xml.id}">Baixar DANFSE</button>
                              </div>
                            </td>
                          </tr>`;
                        })
                        .join('')
                    : '<tr><td colspan="5" class="table-state">Nenhum XML encontrado.</td></tr>'}
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
              ${detailItem('Anotacoes', clientCertificate?.anotacoes || '-')}
            </div>
            <div class="table-actions" style="margin-top:12px;">
              ${
                clientCertificate
                  ? `<button class="btn primary" type="button" data-action="certificate-edit" data-cert-id="${escapeHtml(clientCertificate.id)}">Editar certificado</button>`
                  : `<button class="btn primary" type="button" data-action="certificate-open-create" data-client-id="${escapeHtml(client.id)}">Cadastrar certificado</button>`
              }
              <button class="btn secondary" type="button" data-action="certificate-test" data-cert-id="${escapeHtml(clientCertificate?.id || '')}" ${clientCertificate ? '' : 'disabled'}>Testar certificado</button>
              <button class="btn secondary" type="button" data-action="certificate-download" data-cert-id="${escapeHtml(clientCertificate?.id || '')}" ${clientCertificate ? '' : 'disabled'}>Baixar</button>
              <button class="btn secondary" type="button" data-action="certificate-password" data-cert-id="${escapeHtml(clientCertificate?.id || '')}" ${clientCertificate ? '' : 'disabled'}>Ver senha</button>
              <button class="btn secondary" type="button" data-action="certificate-notes" data-cert-id="${escapeHtml(clientCertificate?.id || '')}" ${clientCertificate ? '' : 'disabled'}>Anotacoes</button>
            </div>
          </article>

          <article class="card">
            <h3 class="card-title">Configuracao da busca</h3>
            <form id="clientSearchConfigForm" class="form-grid" style="grid-template-columns:1fr; margin-top:12px;">
              <input type="hidden" name="clientId" value="${escapeHtml(client.id)}" />
              <label class="field-inline">
                <input name="buscaAtiva" type="checkbox" ${client.buscaAtiva ? 'checked' : ''} />
                <span>Cliente habilitado para rotina</span>
              </label>
              <label class="field-inline">
                <input name="buscaNfeAtiva" type="checkbox" ${client.buscaNfeAtiva !== false ? 'checked' : ''} />
                <span>Cliente habilitado para rotinas de NF-e</span>
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

      <article class="card filter-card">
        <h3 class="card-title">Filtro</h3>
        <form id="certificatesFilterForm" class="form-grid">
          <label class="field" style="grid-column: span 2;">
            Buscar por nome ou CNPJ
            <input
              name="query"
              value="${escapeHtml(state.filters.certificates.query)}"
              placeholder="Digite o nome do cliente, apelido do certificado ou CNPJ"
            />
          </label>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Filtrar</button>
            <button class="btn secondary" type="button" data-action="certificates-clear-filters">Limpar</button>
          </div>
        </form>
      </article>

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
                <th>Anotacoes</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRowsOrState({
                key: 'certificates',
                colSpan: 10,
                rowsHtml: certificates
                  .map((cert) => {
                    const rowClass = cert.status === 'Vencido' ? ' style="background:#fff5f5;"' : cert.status === 'A vencer' ? ' style="background:#fffbf0;"' : '';
                    const canDelete = state.dataSource !== 'api' || !cert.ativo;
                    return `<tr${rowClass}>
                      <td>${escapeHtml(cert.cliente)}</td>
                      <td>${escapeHtml(formatCnpj(cert.cnpj))}</td>
                      <td>${escapeHtml(cert.tipo)}</td>
                      <td>${escapeHtml(cert.apelido)}</td>
                      <td>${escapeHtml(formatDate(cert.validade))}</td>
                      <td>${escapeHtml(String(cert.diasRestantes))}</td>
                      <td>${statusBadge(cert.status, toneFromCertificateStatus(cert.status))}</td>
                      <td>${escapeHtml(cert.ultimaValidacao ? formatDateTime(cert.ultimaValidacao) : '-')}</td>
                      <td>${escapeHtml(truncateText(cert.anotacoes || '-', 72))}</td>
                      <td>
                        <div class="table-actions">
                          <button class="icon-btn" data-action="certificate-view-client" data-client-id="${escapeHtml(cert.clientId || '')}" ${cert.clientId ? '' : 'disabled'}>Ver cliente</button>
                          <button class="icon-btn" data-action="certificate-test" data-cert-id="${escapeHtml(cert.id)}">Testar certificado</button>
                          <button class="icon-btn" data-action="certificate-download" data-cert-id="${escapeHtml(cert.id)}">Baixar</button>
                          <button class="icon-btn" data-action="certificate-password" data-cert-id="${escapeHtml(cert.id)}">Ver senha</button>
                          <button class="icon-btn" data-action="certificate-edit" data-cert-id="${escapeHtml(cert.id)}">Editar</button>
                          <button class="icon-btn" data-action="certificate-notes" data-cert-id="${escapeHtml(cert.id)}">Anotacoes</button>
                          <button class="icon-btn" data-action="certificate-replace" data-cert-id="${escapeHtml(cert.id)}">Substituir</button>
                          <button class="icon-btn" data-action="certificate-unlink" data-cert-id="${escapeHtml(cert.id)}" ${cert.clientId || cert.ativo ? '' : 'disabled'}>Remover vinculo</button>
                          <button class="icon-btn" data-action="certificate-delete" data-cert-id="${escapeHtml(cert.id)}" ${canDelete ? '' : 'disabled'}>Excluir certificado</button>
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
          actionButton('Ligar busca automatica agora', 'enable-auto-search', 'primary'),
          actionButton('Desligar busca manual', 'disable-manual-started-search', 'secondary'),
          actionButton('Nova busca manual', 'open-new-manual-run', 'secondary'),
          actionButton('Recuperar NSUs passados', 'recover-past-nsus', 'secondary')
        ]
      })}

      ${renderSearchTypeSwitcher('nfse')}

      ${renderSchedulerStatusStrip()}
      ${renderExecutionMonitorCard()}

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

function renderExecutionMonitorCard() {
  const monitor = state.executionMonitor;
  const statusLabel = monitor.active ? 'Em execucao' : monitor.finishedAt ? 'Concluida' : 'Aguardando';
  const statusTone = monitor.active ? 'info' : monitor.failed > 0 ? 'warning' : monitor.finishedAt ? 'success' : 'neutral';
  const progress = monitor.total > 0 ? Math.min(100, Math.round((monitor.processed / monitor.total) * 100)) : 0;
  const lastXml = monitor.lastXml;

  return `
    <article class="card progress-card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
        <h3 class="card-title">Monitor de execucao</h3>
        ${statusBadge(statusLabel, statusTone)}
      </div>
      <p class="card-subtitle" style="margin-top:4px;">${escapeHtml(monitor.message || 'Aguardando nova execucao de busca.')}</p>
      <div class="progress-track" aria-label="Progresso da execucao">
        <div class="progress-fill" style="width:${progress}%;"></div>
      </div>
      <div class="progress-meta">
        <span>Modo: <strong>${escapeHtml(monitor.mode || '-')}</strong></span>
        <span>Executando para: <strong>${escapeHtml(monitor.currentClientName || '-')}</strong></span>
        <span>Processados: <strong>${monitor.processed}/${monitor.total || '-'}</strong></span>
        <span>Sucessos: <strong>${monitor.successful}</strong></span>
        <span>Falhas: <strong>${monitor.failed}</strong></span>
      </div>
      <div class="card" style="margin-top:12px; border:1px dashed #d8d8de; box-shadow:none;">
        <h4 class="card-title" style="margin:0 0 6px 0;">Ultimo XML baixado</h4>
        ${
          lastXml
            ? `<div class="progress-meta" style="row-gap:8px;">
              <span>Cliente: <strong>${escapeHtml(lastXml.cliente || '-')}</strong></span>
              <span>NFS-e: <strong>${escapeHtml(lastXml.numeroNfse || '-')}</strong></span>
              <span>Emissao: <strong>${escapeHtml(formatDateTime(lastXml.dataEmissao || lastXml.dataDownload))}</strong></span>
              <span>Valor: <strong>${escapeHtml(formatCurrency(lastXml.valor || 0))}</strong></span>
              <span>Tipo: <strong>${escapeHtml(lastXml.tipo || '-')}</strong></span>
            </div>`
            : '<p class="card-subtitle" style="margin:0;">Nenhum XML registrado ainda.</p>'
        }
      </div>
      <div class="table-actions" style="margin-top:12px;">
        <button class="btn secondary" data-action="execution-monitor-refresh">Atualizar painel</button>
      </div>
      <p class="card-subtitle" style="margin-top:8px;">Atualizado em ${escapeHtml(formatDateTime(monitor.updatedAt || new Date().toISOString()))}</p>
    </article>
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

function isNfeSyncSectionOpen(sectionKey, defaultOpen = true) {
  const value = state.nfeSyncSections?.[sectionKey];
  return typeof value === 'boolean' ? value : defaultOpen;
}

function toggleNfeSyncSection(sectionKey) {
  const current = isNfeSyncSectionOpen(sectionKey, true);
  state.nfeSyncSections = {
    ...state.nfeSyncSections,
    [sectionKey]: !current
  };
  render();
}

function renderCollapsibleCard({ sectionKey, title, subtitle = '', contentHtml, defaultOpen = true, className = '' }) {
  const isOpen = isNfeSyncSectionOpen(sectionKey, defaultOpen);

  return `
    <article class="card collapsible-card ${className} ${isOpen ? 'open' : 'closed'}">
      <button class="collapse-trigger" type="button" data-action="toggle-nfe-sync-section" data-section-key="${escapeHtml(sectionKey)}" aria-expanded="${isOpen ? 'true' : 'false'}">
        <div class="collapse-heading">
          <div>
            <h3 class="card-title">${escapeHtml(title)}</h3>
            ${subtitle ? `<p class="card-subtitle">${escapeHtml(subtitle)}</p>` : ''}
          </div>
          <span class="collapse-indicator" aria-hidden="true">${isOpen ? '-' : '+'}</span>
        </div>
      </button>
      ${isOpen ? `<div class="collapse-body">${contentHtml}</div>` : ''}
    </article>
  `;
}

function renderNfeSyncPage() {
  const nfeEligibleClients = getNfeEligibleClients();
  const controls = getFilteredNfeSyncControls();
  const clientRows = getNfeSyncClientRows(controls, nfeEligibleClients);
  const syncStats = getNfeSyncStats();
  const statusOptions = uniqueValues(controls.map((control) => control.status));
  const ambienteOptions = uniqueValues(controls.map((control) => control.ambiente));
  const nfeStats = getNfeDashboardStats();
  const sourceMode = getNfeSourceMode();
  const queueLabel = sourceMode === 'dominio' ? 'prontos para importar XMLs' : 'buscando NF-e futuras';
  const errorLabel = sourceMode === 'dominio' ? 'revisar conexao, cursor ou XMLs' : 'revisar certificado ou API';
  const overviewDescription =
    sourceMode === 'dominio'
      ? 'Ligue a importacao por cliente ou em lote. O backend consulta o banco da Dominio, salva os XMLs no storage local e segue apenas com os registros novos.'
      : 'Ligue a busca por cliente ou em lote. O sistema captura o NSU atual como base e segue apenas com as proximas NF-e de entrada e saida.';
  const simplifiedSubtitle =
    sourceMode === 'dominio'
      ? 'Ao ligar a importacao, o backend resolve os estabelecimentos ativos do cliente e passa a acompanhar novos XMLs no banco da Dominio.'
      : 'Ao ligar a busca, o backend resolve os estabelecimentos ativos do cliente, captura o NSU atual e passa a sincronizar apenas as proximas NF-e.';
  const detailSubtitle =
    sourceMode === 'dominio'
      ? 'Visao detalhada dos controles usados pelo backend para importar XMLs e manter o cursor incremental por estabelecimento.'
      : 'Visao detalhada dos controles realmente mantidos pelo backend para distribuicao DF-e.';
  const clientCursorLabel = sourceMode === 'dominio' ? 'Ult. cursor' : 'Ult. NSU base';
  const controlCursorLabel = sourceMode === 'dominio' ? 'Cursor atual' : 'Ult. NSU consultado';
  const controlProgressLabel = sourceMode === 'dominio' ? 'Cursor salvo' : 'Ult. NSU distribuido';
  const controlMaxLabel = sourceMode === 'dominio' ? 'Maior catalogo' : 'Max NSU';
  const globalRunLabel = sourceMode === 'dominio' ? 'Rodar importacao agora' : 'Rodar busca agora';
  const clientEnableLabel = sourceMode === 'dominio' ? 'Ligar importacao' : 'Ligar busca';
  const rowRunLabel = sourceMode === 'dominio' ? 'Importar agora' : 'Rodar agora';
  const filtersContent = `
    <form id="nfeSyncFilterForm" class="form-grid">
      <label class="field">
        Cliente
        <select name="cliente">${renderOptions(['Todos', ...nfeEligibleClients.map((client) => client.id)], state.filters.nfeSync.cliente, mapClientOptions())}</select>
      </label>
      <label class="field">
        Status
        <select name="status">${renderOptions(['Todos', ...statusOptions], state.filters.nfeSync.status, mapNfeSyncStatusOptions(statusOptions))}</select>
      </label>
      <label class="field">
        Ambiente
        <select name="ambiente">${renderOptions(['Todos', ...ambienteOptions], state.filters.nfeSync.ambiente, {
          Todos: 'Todos',
          producao: 'Producao',
          homologacao: 'Homologacao'
        })}</select>
      </label>
      <div class="stack-actions" style="grid-column: span 3; justify-content:flex-start; align-items:flex-end;">
        <button class="btn primary" type="submit">Filtrar</button>
        <button class="btn secondary" type="button" data-action="nfe-sync-clear-filters">Limpar</button>
      </div>
    </form>
  `;
  const simplifiedContent = `
    <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
      <div>
        <p class="card-subtitle">${escapeHtml(simplifiedSubtitle)}</p>
      </div>
      <button class="btn secondary" type="button" data-action="nfe-sync-refresh">Atualizar painel</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>CNPJ</th>
            <th>Controles</th>
            <th>Ultima execucao</th>
            <th>${escapeHtml(clientCursorLabel)}</th>
            <th>Documentos</th>
            <th>Status</th>
            <th>Acoes</th>
          </tr>
        </thead>
        <tbody>
          ${renderTableRowsOrState({
            key: 'nfeSync',
            colSpan: 8,
            rowsHtml: clientRows
              .map((row) => {
                return `<tr>
                  <td>${escapeHtml(row.cliente)}</td>
                  <td>${escapeHtml(formatCnpj(row.cnpj))}</td>
                  <td>${escapeHtml(String(row.totalControles))}</td>
                  <td>${escapeHtml(formatDateTime(row.ultimaExecucao))}</td>
                  <td>${escapeHtml(row.ultimoNsuConsultado)}</td>
                  <td>${escapeHtml(String(row.totalDocumentosBaixados))}</td>
                  <td>
                    ${statusBadge(row.statusLabel, row.statusTone)}
                    <span class="row-sub">${escapeHtml(row.statusDetail)}</span>
                  </td>
                  <td>
                    <div class="table-actions">
                      <button class="icon-btn" data-action="nfe-client-enable" data-client-id="${row.clientId}">${escapeHtml(clientEnableLabel)}</button>
                      <button class="icon-btn" data-action="nfe-client-pause" data-client-id="${row.clientId}">Pausar</button>
                      <button class="icon-btn" data-action="nfe-open-client-xmls" data-client-id="${row.clientId}">Ver XMLs</button>
                    </div>
                  </td>
                </tr>`;
              })
              .join(''),
            emptyMessage: 'Nenhum cliente encontrado para os filtros informados.'
          })}
        </tbody>
      </table>
    </div>
  `;
  const technicalContent = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Estabelecimento</th>
            <th>CNPJ consulta</th>
            <th>Ambiente</th>
            <th>${escapeHtml(controlCursorLabel)}</th>
            <th>${escapeHtml(controlProgressLabel)}</th>
            <th>${escapeHtml(controlMaxLabel)}</th>
            <th>Documentos</th>
            <th>Ultima execucao</th>
            <th>Status</th>
            <th>Acoes</th>
          </tr>
        </thead>
        <tbody>
          ${renderTableRowsOrState({
            key: 'nfeSync',
            colSpan: 11,
            rowsHtml: controls
              .map((control) => {
                return `<tr>
                  <td>${escapeHtml(control.cliente)}</td>
                  <td>
                    <span class="row-title">${escapeHtml(control.estabelecimento)}</span>
                    <span class="row-sub">${escapeHtml(formatCnpj(control.cnpjEstabelecimento))}</span>
                  </td>
                  <td>${escapeHtml(formatCnpj(control.cnpjConsulta))}</td>
                  <td>${statusBadge(mapNfeAmbienteLabel(control.ambiente), control.ambiente === 'producao' ? 'success' : 'warning')}</td>
                  <td>${escapeHtml(control.ultimoNsuConsultado)}</td>
                  <td>${escapeHtml(control.ultimoNsuDistribuido)}</td>
                  <td>${escapeHtml(control.maxNsu)}</td>
                  <td>${escapeHtml(String(control.totalDocumentosBaixados))}</td>
                  <td>${escapeHtml(formatDateTime(control.ultimaExecucao))}</td>
                  <td>
                    ${statusBadge(mapNfeSyncStatusLabel(control.status), toneFromNfeSyncStatus(control.status))}
                    <span class="row-sub">${escapeHtml(control.ultimaMensagem || '-')}</span>
                  </td>
                  <td>
                    <div class="table-actions">
                      <button class="icon-btn" data-action="nfe-sync-run-control" data-client-id="${control.clientId}" data-estabelecimento-id="${control.estabelecimentoId}" data-ambiente="${control.ambiente}">${escapeHtml(rowRunLabel)}</button>
                      <button class="icon-btn" data-action="nfe-sync-pause-control" data-client-id="${control.clientId}" data-ambiente="${control.ambiente}">Pausar</button>
                    </div>
                  </td>
                </tr>`;
              })
              .join(''),
            emptyMessage: 'Nenhum controle de sincronizacao de NF-e encontrado.'
          })}
        </tbody>
      </table>
    </div>
  `;

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Buscas NF-e',
        description: overviewDescription,
        actions: [
          actionButton('Ligar todos os clientes', 'nfe-enable-auto-search', 'primary'),
          actionButton(globalRunLabel, 'nfe-run-now', 'secondary'),
          actionButton('Pausar todos', 'nfe-disable-auto-search', 'secondary')
        ]
      })}

      ${renderSearchTypeSwitcher('nfe')}

      <section class="stats-grid">
        ${statCard('search', 'Controles ativos', String(syncStats.ativos), queueLabel, 'success')}
        ${statCard('clock', 'Controles pausados', String(syncStats.pausados), 'aguardando retomada', 'neutral')}
        ${statCard('alert', 'Controles com erro', String(syncStats.erros), errorLabel, 'danger')}
        ${statCard('file', 'NF-e no banco', String(nfeStats.totalNfe), `${nfeStats.xmlsCompletos} XML(s) completos`, 'info')}
      </section>

      ${renderCollapsibleCard({
        sectionKey: 'scheduler',
        title: 'Rotina automatica NF-e',
        subtitle: 'Status da origem da captura e dos ciclos automaticos do backend.',
        contentHtml: renderNfeSchedulerStatusCard(),
        defaultOpen: true
      })}
      ${
        sourceMode === 'dominio'
          ? renderCollapsibleCard({
              sectionKey: 'failures',
              title: 'Painel de falhas da importacao',
              subtitle: 'Mostra a ultima execucao manual feita nesta tela.',
              contentHtml: renderNfeLastRunPanel(),
              defaultOpen: false
            })
          : ''
      }
      ${renderCollapsibleCard({
        sectionKey: 'filters',
        title: 'Filtros dos controles',
        subtitle: 'Use os filtros apenas quando precisar refinar a listagem.',
        contentHtml: filtersContent,
        defaultOpen: false,
        className: 'filter-card'
      })}
      ${renderCollapsibleCard({
        sectionKey: 'simplified',
        title: 'Busca simplificada por cliente',
        subtitle: simplifiedSubtitle,
        contentHtml: simplifiedContent,
        defaultOpen: true
      })}
      ${renderCollapsibleCard({
        sectionKey: 'technical',
        title: 'Detalhamento tecnico por estabelecimento',
        subtitle: detailSubtitle,
        contentHtml: technicalContent,
        defaultOpen: false
      })}
    </section>
  `;
}

function renderNfeLastRunPanel() {
  const report = state.nfeLastRunReport;
  const rows = Array.isArray(report?.executionDetails)
    ? report.executionDetails
    : Array.isArray(report?.failureDetails)
      ? report.failureDetails
      : [];

  if (!report) {
    return `
      <p class="card-subtitle" style="margin:0;">O painel e preenchido quando voce roda a importacao manualmente pela tela de Buscas NF-e.</p>
    `;
  }

  return `
    <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
      <p class="card-subtitle" style="margin:0;">Ultima execucao manual em ${escapeHtml(formatDateTime(report.executedAt))}.</p>
      <div class="progress-meta">
        <span>Controles: <strong>${escapeHtml(String(report.processed || 0))}</strong></span>
        <span>XMLs salvos: <strong>${escapeHtml(String(report.documentsSaved || 0))}</strong></span>
        <span>Falhas: <strong>${escapeHtml(String(report.failures || 0))}</strong></span>
      </div>
    </div>
    <div class="table-actions" style="margin-bottom:12px;">
      <button class="btn secondary" type="button" data-action="nfe-last-run-import-all" ${rows.length ? '' : 'disabled'}>Importar todos os itens</button>
    </div>
    ${
      rows.length
        ? `<div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Estabelecimento</th>
                    <th>CNPJ consulta</th>
                    <th>Status</th>
                    <th>ID catalogo</th>
                    <th>Numero NF-e</th>
                    <th>Chave</th>
                    <th>Origem</th>
                    <th>Mensagem</th>
                    <th>Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows
                    .map((row) => {
                      const client = findClientById(row.clientId);
                      const establishment = findEstablishmentById(row.estabelecimentoId);
                      const canHandleXml =
                        row.kind === 'documento' &&
                        Number(row.catalogoId) > 0 &&
                        row.status !== 'ignorado_xml_nao_fiscal';
                      return `<tr>
                        <td>${escapeHtml(client?.razaoSocial || row.clientId || '-')}</td>
                        <td>${escapeHtml(
                          establishment?.razaoSocial || establishment?.municipioNome || row.estabelecimentoId || '-'
                        )}</td>
                        <td>${escapeHtml(formatCnpj(row.cnpjConsulta || ''))}</td>
                        <td>${statusBadge(mapNfeRunItemStatusLabel(row.status), toneFromNfeRunItemStatus(row.status))}</td>
                        <td>${escapeHtml(row.catalogoId ? String(row.catalogoId) : '-')}</td>
                        <td>${escapeHtml(formatNfeFailureNumber(row))}</td>
                        <td>${escapeHtml(row.chaveAcesso || '-')}</td>
                        <td>${escapeHtml(row.kind === 'controle' ? 'Controle' : 'XML')}</td>
                        <td>${escapeHtml(row.mensagem || '-')}</td>
                        <td>
                          ${
                            canHandleXml
                              ? `<div class="table-actions">
                                  <button class="icon-btn" data-action="nfe-last-run-view-xml" data-client-id="${row.clientId}" data-catalogo-id="${row.catalogoId}">Ver XML</button>
                                  <button class="icon-btn" data-action="nfe-last-run-import-item" data-client-id="${row.clientId}" data-catalogo-id="${row.catalogoId}">Importar</button>
                                </div>`
                              : '<span class="row-sub">-</span>'
                          }
                        </td>
                      </tr>`;
                    })
                    .join('')}
                </tbody>
              </table>
            </div>`
        : report.failures > 0
          ? `<div class="table-state error">A execucao registrou falhas, mas o backend nao retornou detalhes suficientes para listar cada item.</div>`
          : `<div class="table-state">Nenhum item detalhado foi retornado para a ultima importacao manual.</div>`
    }
  `;
}

function renderNfeSchedulerStatusCard() {
  const scheduler = state.nfeSchedulerStatus;
  if (!scheduler) {
    return `
      <p class="card-subtitle" style="margin:0;">Status do agendador ainda nao carregado do backend.</p>
    `;
  }

  const autoSync = scheduler.autoSync || {};
  const nightlySweep = scheduler.nightlySweep || {};
  const sourceMode = getNfeSourceMode();
  const autoTone = autoSync.running ? 'info' : autoSync.enabled ? 'success' : 'neutral';
  const nightlyTone = nightlySweep.running ? 'info' : nightlySweep.enabled ? 'success' : 'neutral';

  return `
    <div class="scheduler-strip">
      <div class="scheduler-item">
        <div class="scheduler-heading">
          <span class="scheduler-dot info"></span>
          <strong>Origem da captura</strong>
        </div>
        ${statusBadge(sourceMode === 'dominio' ? 'Banco Dominio' : 'Distribuicao DF-e', 'info')}
        <p>${
          sourceMode === 'dominio'
            ? 'Os controles ativos importam XMLs diretamente do banco da Dominio e salvam os arquivos no storage local.'
            : 'Os controles ativos consultam a distribuicao DF-e e persistem os documentos retornados.'
        }</p>
      </div>
      <div class="scheduler-item">
        <div class="scheduler-heading">
          <span class="scheduler-dot ${autoTone}"></span>
          <strong>Ciclo automatico NF-e</strong>
        </div>
        ${statusBadge(autoSync.running ? 'Executando agora' : autoSync.enabled ? 'Ativo' : 'Inativo', autoTone)}
        <p>${
          sourceMode === 'dominio'
            ? 'Processa controles ativos em segundo plano para importar novos XMLs sem depender de acao manual.'
            : 'Processa controles ativos em segundo plano sem depender de acao manual.'
        }</p>
        <small>Intervalo: ${escapeHtml(formatDurationMs(autoSync.intervalMs || 0))}</small>
      </div>
      <div class="scheduler-item">
        <div class="scheduler-heading">
          <span class="scheduler-dot ${nightlyTone}"></span>
          <strong>Busca noturna NF-e</strong>
        </div>
        ${statusBadge(nightlySweep.running ? 'Executando agora' : nightlySweep.enabled ? 'Ativa' : 'Inativa', nightlyTone)}
        <p>${escapeHtml(
          nightlySweep.activeSlots?.length
            ? `Slots ativos: ${nightlySweep.activeSlots.join(', ')}`
            : 'Nenhum horario ativo configurado.'
        )}</p>
        <small>Proxima execucao: ${escapeHtml(formatDateTime(nightlySweep.nextRunAt || ''))}</small>
      </div>
    </div>
  `;
}

function renderNfeDocumentsPage() {
  const docs = getFilteredNfeDocuments();
  const canShowTable =
    state.nfeSearch.hasSearched || state.tableState.nfeDocs === 'loading' || state.tableState.nfeDocs === 'error';
  const statusOptions = uniqueValues(state.nfeDocuments.map((doc) => doc.statusFiscal).filter(Boolean));
  const schemaOptions = uniqueValues(state.nfeDocuments.map((doc) => doc.schemaDoc).filter(Boolean));
  const selectedClientId = state.filters.nfeDocs.cliente && state.filters.nfeDocs.cliente !== 'Todos' ? state.filters.nfeDocs.cliente : '';

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'XMLs NF-e',
        description: 'Consulte XMLs armazenados de NF-e no servidor interno.',
        actions: [actionButton('Exportar listagem', 'nfe-export-list', 'secondary')]
      })}

      ${renderStoredDocumentsTypeSwitcher('nfe')}

      <article class="card filter-card">
        <h3 class="card-title">Consulta de NF-e</h3>
        <p class="card-subtitle">Selecione uma empresa e refine por emissao, relacionamento e disponibilidade do XML completo.</p>
        <form id="nfeDocsFilterForm" class="form-grid">
          <label class="field">
            Empresa
            <select name="cliente" required>${renderOptions(state.clients.map((client) => client.id), state.filters.nfeDocs.cliente === 'Todos' ? '' : state.filters.nfeDocs.cliente, mapClientOptions(), 'Selecione uma empresa')}</select>
          </label>
          <label class="field">
            Tipo
            <select name="tipo">${renderOptions(['Todos', 'Emitida', 'Recebida'], state.filters.nfeDocs.tipo)}</select>
          </label>
          <label class="field">
            Ambiente
            <select name="ambiente">${renderOptions(['Todos', 'producao', 'homologacao'], state.filters.nfeDocs.ambiente, {
              Todos: 'Todos',
              producao: 'Producao',
              homologacao: 'Homologacao'
            })}</select>
          </label>
          <label class="field">
            Emissao inicio
            <input name="emissaoInicio" type="date" value="${escapeHtml(state.filters.nfeDocs.emissaoInicio)}" />
          </label>
          <label class="field">
            Emissao fim
            <input name="emissaoFim" type="date" value="${escapeHtml(state.filters.nfeDocs.emissaoFim)}" />
          </label>
          <label class="field">
            Status
            <select name="status">${renderOptions(['Todos', ...statusOptions], state.filters.nfeDocs.status)}</select>
          </label>
          <label class="field">
            Schema
            <select name="schemaDoc">${renderOptions(['Todos', ...schemaOptions], state.filters.nfeDocs.schemaDoc)}</select>
          </label>
          <label class="field">
            XML completo
            <select name="xmlCompleto">${renderOptions(['Todos', 'Somente completos', 'Somente resumos'], state.filters.nfeDocs.xmlCompleto)}</select>
          </label>
          <label class="field">
            CNPJ
            <input name="cnpj" value="${escapeHtml(state.filters.nfeDocs.cnpj)}" />
          </label>
          <label class="field">
            Numero NF-e
            <input name="numero" value="${escapeHtml(state.filters.nfeDocs.numero)}" />
          </label>
          <label class="field">
            Chave de acesso
            <input name="chave" value="${escapeHtml(state.filters.nfeDocs.chave)}" maxlength="44" />
          </label>
          <label class="field">
            Valor minimo
            <input name="valorMin" type="number" min="0" step="0.01" value="${escapeHtml(state.filters.nfeDocs.valorMin)}" />
          </label>
          <label class="field">
            Valor maximo
            <input name="valorMax" type="number" min="0" step="0.01" value="${escapeHtml(state.filters.nfeDocs.valorMax)}" />
          </label>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Buscar NF-e</button>
            <button class="btn secondary" type="button" data-action="nfe-docs-clear-filters">Limpar</button>
            <button class="btn secondary" type="button" data-action="nfe-docs-run-now-client" ${selectedClientId ? '' : 'disabled'}>Rodar busca do cliente</button>
          </div>
        </form>
      </article>

      ${
        canShowTable
          ? `${renderNfeSearchSummary()}${renderNfeDocumentsTableCard(docs)}`
          : renderNfeSearchEmptyState()
      }
    </section>
  `;
}

function renderNfeSearchEmptyState() {
  return `
    <article class="card">
      <div class="table-state">
        Selecione a empresa e os filtros desejados, depois clique em <strong>Buscar NF-e</strong>.
      </div>
    </article>
  `;
}

function renderNfeSearchSummary() {
  const query = state.nfeSearch.lastQuery;
  if (!query) {
    return '';
  }

  const client = findClientById(query.cliente);
  const filteredDocs = getFilteredNfeDocuments();
  const totalResults = Number(state.nfeSearch.total || filteredDocs.length || 0);
  const totalValue = sumListedDocumentValues(filteredDocs);
  const periodText =
    query.emissaoInicio || query.emissaoFim
      ? `${formatDate(query.emissaoInicio || '')} ate ${formatDate(query.emissaoFim || '')}`
      : 'Sem filtro de emissao';
  return `
    <article class="card" style="box-shadow:none; border-style:dashed;">
      <div class="progress-meta">
        <span>Empresa: <strong>${escapeHtml(client?.razaoSocial || 'Cliente selecionado')}</strong></span>
        <span>Periodo: <strong>${escapeHtml(periodText)}</strong></span>
        <span>Tipo: <strong>${escapeHtml(query.tipo || 'Todos')}</strong></span>
        <span>Resultado: <strong>${escapeHtml(String(totalResults))} NF-e</strong></span>
        <span>Pagina: <strong>${escapeHtml(`${state.nfeSearch.page}/${Math.max(1, state.nfeSearch.totalPages || 1)}`)}</strong></span>
        <span>Valor somado: <strong>${escapeHtml(formatCurrency(totalValue))}</strong></span>
        <span>Atualizado: <strong>${escapeHtml(formatDateTime(state.nfeSearch.lastSearchedAt || new Date().toISOString()))}</strong></span>
      </div>
    </article>
  `;
}

function renderNfeDocumentsTableCard(docs) {
  const totalValue = sumListedDocumentValues(docs);
  const totalResults = Number(state.nfeSearch.total || docs.length || 0);
  const syncDisabled =
    state.nfeEventsSyncRunning || state.dataSource !== 'api' || state.tableState.nfeDocs === 'loading' || !docs.length
      ? 'disabled'
      : '';
  const syncLabel = state.nfeEventsSyncRunning ? 'Buscando eventos...' : 'Buscar eventos da listagem';

  return `
    <article class="card">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">NF-e encontradas</h3>
          <p class="card-subtitle">Mostrando ${escapeHtml(String(docs.length))} de ${escapeHtml(String(totalResults))} documento(s). Valor total: ${escapeHtml(formatCurrency(totalValue))}.</p>
        </div>
        <div class="table-actions">
          <button class="btn secondary" type="button" data-action="nfe-sync-events-listed" ${syncDisabled}>${escapeHtml(syncLabel)}</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${renderNfeSortHeader('numeroNfe', 'Numero')}
              ${renderNfeSortHeader('cliente', 'Cliente')}
              ${renderNfeSortHeader('tipo', 'Tipo')}
              ${renderNfeSortHeader('contraparte', 'Emitente / destinatario')}
              ${renderNfeSortHeader('dataEmissao', 'Data emissao')}
              ${renderNfeSortHeader('valor', 'Valor')}
              ${renderNfeSortHeader('ambiente', 'Ambiente')}
              ${renderNfeSortHeader('arquivo', 'Arquivo')}
              ${renderNfeSortHeader('status', 'Status')}
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'nfeDocs',
              colSpan: 10,
              rowsHtml: docs
                .map((doc) => {
                  const syncDisabledRow = state.nfeEventsSyncRunning || !canSyncNfeEvents(doc) ? 'disabled' : '';
                  return `<tr>
                    <td>${escapeHtml(doc.numeroNfe || '-')}</td>
                    <td>${escapeHtml(doc.cliente)}</td>
                    <td>${statusBadge(doc.tipo, doc.tipo === 'Emitida' ? 'success' : doc.tipo === 'Recebida' ? 'info' : 'neutral')}</td>
                    <td>
                      <span class="row-title">${escapeHtml(doc.contraparteNome || '-')}</span>
                      <span class="row-sub">${escapeHtml(formatCnpj(doc.contraparteCnpj || ''))}</span>
                    </td>
                    <td>${escapeHtml(formatDateTime(doc.dataEmissao))}</td>
                    <td>${escapeHtml(formatCurrency(doc.valor))}</td>
                    <td>${statusBadge(mapNfeAmbienteLabel(doc.ambiente), doc.ambiente === 'producao' ? 'success' : 'warning')}</td>
                    <td>${renderNfeStorageBadges(doc)}</td>
                    <td>${renderNfeStatusBadges(doc)}</td>
                    <td>
                      <div class="table-actions">
                        <button class="icon-btn" data-action="nfe-details" data-nfe-id="${doc.id}">Visualizar detalhes</button>
                        <button class="icon-btn" data-action="nfe-sync-events" data-nfe-id="${doc.id}" ${syncDisabledRow}>Buscar eventos</button>
                        <button class="icon-btn" data-action="nfe-view" data-nfe-id="${doc.id}">Ver XML</button>
                        <button class="icon-btn" data-action="nfe-download" data-nfe-id="${doc.id}">Baixar XML</button>
                      </div>
                    </td>
                  </tr>`;
                })
                .join(''),
              emptyMessage: 'Nenhuma NF-e encontrada para os filtros informados.'
            })}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderNfeSortHeader(key, label) {
  const isActive = state.sort.nfeDocs.key === key;
  const direction = isActive ? state.sort.nfeDocs.direction : 'none';
  const sortLabel =
    direction === 'asc'
      ? `${label}, ordenado crescente`
      : direction === 'desc'
        ? `${label}, ordenado decrescente`
        : `${label}, ordenar`;

  return `
    <th>
      <button class="sort-header ${isActive ? 'active' : ''}" type="button" data-action="nfe-docs-sort" data-sort-key="${escapeHtml(key)}" aria-label="${escapeHtml(sortLabel)}">
        <span>${escapeHtml(label)}</span>
        <span class="sort-indicator" aria-hidden="true">${direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}</span>
      </button>
    </th>
  `;
}

function renderCteDocumentsPage() {
  const docs = getFilteredCteDocuments();
  const canShowTable =
    state.cteSearch.hasSearched || state.tableState.cteDocs === 'loading' || state.tableState.cteDocs === 'error';
  const statusOptions = uniqueValues(state.cteDocuments.map((doc) => doc.statusFiscal).filter(Boolean));
  const schemaOptions = uniqueValues(state.cteDocuments.map((doc) => doc.schemaDoc).filter(Boolean));

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'XMLs CT-e',
        description: 'Consulte XMLs armazenados de CT-e no servidor interno.',
        actions: [actionButton('Exportar listagem', 'cte-export-list', 'secondary')]
      })}

      ${renderStoredDocumentsTypeSwitcher('cte')}

      <article class="card filter-card">
        <h3 class="card-title">Consulta de CT-e</h3>
        <p class="card-subtitle">Selecione uma empresa e refine por emissao, relacionamento e disponibilidade do XML completo.</p>
        <form id="cteDocsFilterForm" class="form-grid">
          <label class="field">
            Empresa
            <select name="cliente" required>${renderOptions(state.clients.map((client) => client.id), state.filters.cteDocs.cliente === 'Todos' ? '' : state.filters.cteDocs.cliente, mapClientOptions(), 'Selecione uma empresa')}</select>
          </label>
          <label class="field">
            Tipo
            <select name="tipo">${renderOptions(['Todos', 'Emitido', 'Recebido'], state.filters.cteDocs.tipo)}</select>
          </label>
          <label class="field">
            Ambiente
            <select name="ambiente">${renderOptions(['Todos', 'producao', 'homologacao'], state.filters.cteDocs.ambiente, {
              Todos: 'Todos',
              producao: 'Producao',
              homologacao: 'Homologacao'
            })}</select>
          </label>
          <label class="field">
            Emissao inicio
            <input name="emissaoInicio" type="date" value="${escapeHtml(state.filters.cteDocs.emissaoInicio)}" />
          </label>
          <label class="field">
            Emissao fim
            <input name="emissaoFim" type="date" value="${escapeHtml(state.filters.cteDocs.emissaoFim)}" />
          </label>
          <label class="field">
            Status
            <select name="status">${renderOptions(['Todos', ...statusOptions], state.filters.cteDocs.status)}</select>
          </label>
          <label class="field">
            Schema
            <select name="schemaDoc">${renderOptions(['Todos', ...schemaOptions], state.filters.cteDocs.schemaDoc)}</select>
          </label>
          <label class="field">
            XML completo
            <select name="xmlCompleto">${renderOptions(['Todos', 'Somente completos', 'Somente resumos'], state.filters.cteDocs.xmlCompleto)}</select>
          </label>
          <label class="field">
            CNPJ
            <input name="cnpj" value="${escapeHtml(state.filters.cteDocs.cnpj)}" />
          </label>
          <label class="field">
            Numero CT-e
            <input name="numero" value="${escapeHtml(state.filters.cteDocs.numero)}" />
          </label>
          <label class="field">
            Chave de acesso
            <input name="chave" value="${escapeHtml(state.filters.cteDocs.chave)}" maxlength="44" />
          </label>
          <label class="field">
            Valor minimo
            <input name="valorMin" type="number" min="0" step="0.01" value="${escapeHtml(state.filters.cteDocs.valorMin)}" />
          </label>
          <label class="field">
            Valor maximo
            <input name="valorMax" type="number" min="0" step="0.01" value="${escapeHtml(state.filters.cteDocs.valorMax)}" />
          </label>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Buscar CT-e</button>
            <button class="btn secondary" type="button" data-action="cte-docs-clear-filters">Limpar</button>
          </div>
        </form>
      </article>

      ${
        canShowTable
          ? `${renderCteSearchSummary()}${renderCteDocumentsTableCard(docs)}`
          : renderCteSearchEmptyState()
      }
    </section>
  `;
}

function renderCteSearchEmptyState() {
  return `
    <article class="card">
      <div class="table-state">
        Selecione a empresa e os filtros desejados, depois clique em <strong>Buscar CT-e</strong>.
      </div>
    </article>
  `;
}

function renderCteSearchSummary() {
  const query = state.cteSearch.lastQuery;
  if (!query) {
    return '';
  }

  const client = findClientById(query.cliente);
  const filteredDocs = getFilteredCteDocuments();
  const totalResults = Number(state.cteSearch.total || filteredDocs.length || 0);
  const totalValue = sumListedDocumentValues(filteredDocs);
  const periodText =
    query.emissaoInicio || query.emissaoFim
      ? `${formatDate(query.emissaoInicio || '')} ate ${formatDate(query.emissaoFim || '')}`
      : 'Sem filtro de emissao';
  return `
    <article class="card" style="box-shadow:none; border-style:dashed;">
      <div class="progress-meta">
        <span>Empresa: <strong>${escapeHtml(client?.razaoSocial || 'Cliente selecionado')}</strong></span>
        <span>Periodo: <strong>${escapeHtml(periodText)}</strong></span>
        <span>Tipo: <strong>${escapeHtml(query.tipo || 'Todos')}</strong></span>
        <span>Resultado: <strong>${escapeHtml(String(totalResults))} CT-e</strong></span>
        <span>Pagina: <strong>${escapeHtml(`${state.cteSearch.page}/${Math.max(1, state.cteSearch.totalPages || 1)}`)}</strong></span>
        <span>Valor somado: <strong>${escapeHtml(formatCurrency(totalValue))}</strong></span>
        <span>Atualizado: <strong>${escapeHtml(formatDateTime(state.cteSearch.lastSearchedAt || new Date().toISOString()))}</strong></span>
      </div>
    </article>
  `;
}

function renderCteDocumentsTableCard(docs) {
  const totalValue = sumListedDocumentValues(docs);
  const totalResults = Number(state.cteSearch.total || docs.length || 0);
  const syncDisabled =
    state.cteEventsSyncRunning || state.dataSource !== 'api' || state.tableState.cteDocs === 'loading' || !docs.length
      ? 'disabled'
      : '';
  const syncLabel = state.cteEventsSyncRunning ? 'Buscando eventos...' : 'Buscar eventos da listagem';

  return `
    <article class="card">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">CT-e encontrados</h3>
          <p class="card-subtitle">Mostrando ${escapeHtml(String(docs.length))} de ${escapeHtml(String(totalResults))} documento(s). Valor total: ${escapeHtml(formatCurrency(totalValue))}.</p>
        </div>
        <div class="table-actions">
          <button class="btn secondary" type="button" data-action="cte-sync-events-listed" ${syncDisabled}>${escapeHtml(syncLabel)}</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              ${renderCteSortHeader('numeroCte', 'Numero')}
              ${renderCteSortHeader('cliente', 'Cliente')}
              ${renderCteSortHeader('tipo', 'Tipo')}
              ${renderCteSortHeader('contraparte', 'Emitente / destinatario')}
              ${renderCteSortHeader('dataEmissao', 'Data emissao')}
              ${renderCteSortHeader('valor', 'Valor')}
              ${renderCteSortHeader('ambiente', 'Ambiente')}
              ${renderCteSortHeader('arquivo', 'Arquivo')}
              ${renderCteSortHeader('status', 'Status')}
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'cteDocs',
              colSpan: 10,
              rowsHtml: docs
                .map((doc) => {
                  const syncDisabledRow = state.cteEventsSyncRunning || !canSyncCteEvents(doc) ? 'disabled' : '';
                  return `<tr>
                    <td>${escapeHtml(doc.numeroCte || '-')}</td>
                    <td>${escapeHtml(doc.cliente)}</td>
                    <td>${statusBadge(doc.tipo, doc.tipo === 'Emitido' ? 'success' : doc.tipo === 'Recebido' ? 'info' : 'neutral')}</td>
                    <td>
                      <span class="row-title">${escapeHtml(doc.contraparteNome || '-')}</span>
                      <span class="row-sub">${escapeHtml(formatCnpj(doc.contraparteCnpj || ''))}</span>
                    </td>
                    <td>${escapeHtml(formatDateTime(doc.dataEmissao))}</td>
                    <td>${escapeHtml(formatCurrency(doc.valor))}</td>
                    <td>${statusBadge(mapNfeAmbienteLabel(doc.ambiente), doc.ambiente === 'producao' ? 'success' : 'warning')}</td>
                    <td>${renderNfeStorageBadges(doc)}</td>
                    <td>${renderCteStatusBadges(doc)}</td>
                    <td>
                      <div class="table-actions">
                        <button class="icon-btn" data-action="cte-details" data-cte-id="${doc.id}">Visualizar detalhes</button>
                        <button class="icon-btn" data-action="cte-sync-events" data-cte-id="${doc.id}" ${syncDisabledRow}>Buscar eventos</button>
                        <button class="icon-btn" data-action="cte-view" data-cte-id="${doc.id}">Ver XML</button>
                        <button class="icon-btn" data-action="cte-download" data-cte-id="${doc.id}">Baixar XML</button>
                      </div>
                    </td>
                  </tr>`;
                })
                .join(''),
              emptyMessage: 'Nenhum CT-e encontrado para os filtros informados.'
            })}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderCteSortHeader(key, label) {
  const isActive = state.sort.cteDocs.key === key;
  const direction = isActive ? state.sort.cteDocs.direction : 'none';
  const sortLabel =
    direction === 'asc'
      ? `${label}, ordenado crescente`
      : direction === 'desc'
        ? `${label}, ordenado decrescente`
        : `${label}, ordenar`;

  return `
    <th>
      <button class="sort-header ${isActive ? 'active' : ''}" type="button" data-action="cte-docs-sort" data-sort-key="${escapeHtml(key)}" aria-label="${escapeHtml(sortLabel)}">
        <span>${escapeHtml(label)}</span>
        <span class="sort-indicator" aria-hidden="true">${direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}</span>
      </button>
    </th>
  `;
}

function renderStoredDocumentsTypeSwitcher(activeType) {
  const isNfse = activeType === 'nfse';
  const isNfe = activeType === 'nfe';
  const isCte = activeType === 'cte';

  return `
    <article class="card" style="padding-bottom:18px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div>
          <h3 class="card-title">Tipo de documento</h3>
          <p class="card-subtitle">Selecione o tipo de nota para pesquisar. Os filtros mudam conforme o documento escolhido.</p>
        </div>
        <div class="table-actions">
          <button class="btn ${isNfse ? 'primary' : 'secondary'}" type="button" data-action="stored-docs-switch" data-doc-type="nfse">NFS-e</button>
          <button class="btn ${isNfe ? 'primary' : 'secondary'}" type="button" data-action="stored-docs-switch" data-doc-type="nfe">NF-e</button>
          <button class="btn ${isCte ? 'primary' : 'secondary'}" type="button" data-action="stored-docs-switch" data-doc-type="cte">CT-e</button>
        </div>
      </div>
    </article>
  `;
}

function renderSearchTypeSwitcher(activeType) {
  const isNfse = activeType === 'nfse';
  const isNfe = activeType === 'nfe';

  return `
    <article class="card" style="padding-bottom:18px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div>
          <h3 class="card-title">Tipo de busca</h3>
          <p class="card-subtitle">Selecione qual fluxo de busca deseja consultar ou executar.</p>
        </div>
        <div class="table-actions">
          <button class="btn ${isNfse ? 'primary' : 'secondary'}" type="button" data-action="search-type-switch" data-search-type="nfse">NFS-e</button>
          <button class="btn ${isNfe ? 'primary' : 'secondary'}" type="button" data-action="search-type-switch" data-search-type="nfe">NF-e</button>
        </div>
      </div>
    </article>
  `;
}

function renderXmlsPage() {
  const xmls = getFilteredXmls();
  const xmlSearchCanShowTable =
    state.xmlSearch.hasSearched || state.tableState.xmls === 'loading' || state.tableState.xmls === 'error';
  const xmlSearchSummary =
    state.xmlSearch.hasSearched && state.tableState.xmls !== 'loading' ? renderXmlSearchSummary() : '';
  const selectedClientId = state.filters.xmls.cliente && state.filters.xmls.cliente !== 'Todos' ? state.filters.xmls.cliente : '';

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'XMLs NFS-e',
        description: 'Consulte XMLs armazenados de NFS-e no servidor interno.',
        actions: [actionButton('Exportar listagem', 'xml-export-list', 'secondary')]
      })}

      ${renderStoredDocumentsTypeSwitcher('nfse')}

      <article class="card filter-card">
        <h3 class="card-title">Consulta de NFS-e</h3>
        <p class="card-subtitle">Selecione uma empresa. Se nao informar datas, a listagem busca todos os XMLs armazenados desse cliente.</p>
        <form id="xmlsFilterForm" class="form-grid">
          <label class="field">
            Empresa
            <select name="cliente" required>${renderOptions(state.clients.map((client) => client.id), state.filters.xmls.cliente === 'Todos' ? '' : state.filters.xmls.cliente, mapClientOptions(), 'Selecione uma empresa')}</select>
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
            Tipo
            <select name="tipo">${renderOptions(['Todos', 'Emitida', 'Tomada'], state.filters.xmls.tipo)}</select>
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
            Download inicio
            <input name="downloadInicio" type="date" value="${escapeHtml(state.filters.xmls.downloadInicio)}" />
          </label>
          <label class="field">
            Download fim
            <input name="downloadFim" type="date" value="${escapeHtml(state.filters.xmls.downloadFim)}" />
          </label>
          <label class="field">
            Status do armazenamento
            <select name="status">${renderOptions(['Todos', 'Armazenado', 'Pendente', 'Erro'], state.filters.xmls.status)}</select>
          </label>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Buscar XMLs</button>
            <button class="btn secondary" type="button" data-action="xmls-clear-filters">Limpar</button>
            <button class="btn secondary" type="button" data-action="xmls-recover-past-nsus" ${selectedClientId ? '' : 'disabled'}>Reprocessar NSUs do cliente</button>
          </div>
        </form>
      </article>

      ${
        xmlSearchCanShowTable
          ? `${xmlSearchSummary}${renderXmlsTableCard(xmls)}`
          : renderXmlSearchEmptyState()
      }
    </section>
  `;
}

function renderXmlSearchEmptyState() {
  return `
    <article class="card">
      <div class="table-state">
        Selecione a empresa e o periodo de emissao desejado, depois clique em <strong>Buscar XMLs</strong>.
      </div>
    </article>
  `;
}

function renderXmlSearchSummary() {
  const query = state.xmlSearch.lastQuery;
  if (!query) {
    return '';
  }

  const client = findClientById(query.cliente);
  const filteredXmls = getFilteredXmls();
  const totalResults = Number(state.xmlSearch.total || filteredXmls.length || 0);
  const totalValue = sumListedDocumentValues(filteredXmls);
  const periodText =
    query.emissaoInicio || query.emissaoFim
      ? `${formatDate(query.emissaoInicio || '')} ate ${formatDate(query.emissaoFim || '')}`
      : 'Todos os XMLs armazenados';
  return `
    <article class="card" style="box-shadow:none; border-style:dashed;">
      <div class="progress-meta">
        <span>Empresa: <strong>${escapeHtml(client?.razaoSocial || 'Cliente selecionado')}</strong></span>
        <span>Periodo: <strong>${escapeHtml(periodText)}</strong></span>
        <span>Resultado: <strong>${escapeHtml(String(totalResults))} XML(s)</strong></span>
        <span>Pagina: <strong>${escapeHtml(`${state.xmlSearch.page}/${Math.max(1, state.xmlSearch.totalPages || 1)}`)}</strong></span>
        <span>Valor somado: <strong>${escapeHtml(formatCurrency(totalValue))}</strong></span>
        <span>Atualizado: <strong>${escapeHtml(formatDateTime(state.xmlSearch.lastSearchedAt || new Date().toISOString()))}</strong></span>
      </div>
    </article>
  `;
}

function renderXmlsTableCard(xmls) {
  const selectableXmls = xmls.filter((xml) => Boolean(xml.apiNfseId));
  const selectedVisibleCount = selectableXmls.filter((xml) => state.selectedXmlIds.has(xml.id)).length;
  const allVisibleSelected = selectableXmls.length > 0 && selectedVisibleCount === selectableXmls.length;
  const batchDisabled = selectedVisibleCount > 0 ? '' : 'disabled';
  const totalValue = sumListedDocumentValues(xmls);
  const totalResults = Number(state.xmlSearch.total || xmls.length || 0);
  const syncEventsDisabled =
    state.xmlEventsSyncRunning || state.dataSource !== 'api' || state.tableState.xmls === 'loading' || !xmls.length
      ? 'disabled'
      : '';
  const syncEventsLabel = state.xmlEventsSyncRunning ? 'Buscando eventos...' : 'Buscar eventos da listagem';

  return `
    <article class="card">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">Arquivos encontrados</h3>
          <p class="card-subtitle">Mostrando ${escapeHtml(String(xmls.length))} de ${escapeHtml(String(totalResults))} XML(s). ${selectedVisibleCount} selecionado(s). Valor total: ${escapeHtml(formatCurrency(totalValue))}.</p>
        </div>
        <div class="table-actions">
          <button class="btn secondary" type="button" data-action="xmls-sync-events-listed" ${syncEventsDisabled}>${escapeHtml(syncEventsLabel)}</button>
          <button class="btn secondary" type="button" data-action="xmls-batch-download" data-tipo-arquivo="xml" ${batchDisabled}>Baixar XMLs</button>
          <button class="btn secondary" type="button" data-action="xmls-batch-download" data-tipo-arquivo="danfse" ${batchDisabled}>Baixar DANFSEs</button>
          <button class="btn primary" type="button" data-action="xmls-batch-download" data-tipo-arquivo="ambos" ${batchDisabled}>Baixar XML + DANFSE</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" data-action="xmls-toggle-all" ${allVisibleSelected ? 'checked' : ''} ${selectableXmls.length ? '' : 'disabled'} aria-label="Selecionar todos os XMLs da listagem" />
              </th>
              ${renderXmlSortHeader('numeroNfse', 'Numero NFS-e')}
              ${renderXmlSortHeader('cliente', 'Cliente')}
              ${renderXmlSortHeader('cnpj', 'CNPJ')}
              ${renderXmlSortHeader('municipio', 'Municipio')}
              ${renderXmlSortHeader('dataEmissao', 'Data emissao')}
              ${renderXmlSortHeader('dataDownload', 'Data download')}
              ${renderXmlSortHeader('valor', 'Valor')}
              ${renderXmlSortHeader('tipo', 'Tipo')}
              ${renderXmlSortHeader('status', 'Status')}
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'xmls',
              colSpan: 11,
              rowsHtml: xmls
                .map((xml) => {
                  const xmlSyncDisabled =
                    state.xmlEventsSyncRunning ||
                    state.dataSource !== 'api' ||
                    !xml.apiNfseId ||
                    !xml.clientId ||
                    !xml.estabelecimentoId ||
                    normalizeDigits(xml.chaveAcesso || '').length === 0
                      ? 'disabled'
                      : '';
                  return `<tr class="${xml.cancelada ? 'xml-row-cancelled' : ''}">
                    <td><input type="checkbox" data-action="xml-select" data-xml-id="${escapeHtml(xml.id)}" ${state.selectedXmlIds.has(xml.id) ? 'checked' : ''} ${xml.apiNfseId ? '' : 'disabled'} aria-label="Selecionar NFS-e ${escapeHtml(xml.numeroNfse || '-')}" /></td>
                    <td>${renderNfseNumber(xml)}</td>
                    <td>${escapeHtml(xml.cliente)}</td>
                    <td>${escapeHtml(formatCnpj(xml.cnpj))}</td>
                    <td>${escapeHtml(xml.municipio)}</td>
                    <td>${escapeHtml(formatDate(xml.dataEmissao))}</td>
                    <td>${escapeHtml(formatDateTime(xml.dataDownload))}</td>
                    <td>${escapeHtml(formatCurrency(xml.valor))}</td>
                    <td>${escapeHtml(xml.tipo)}</td>
                    <td>${renderXmlStatusBadges(xml)}</td>
                    <td>
                      <div class="table-actions">
                        <button class="icon-btn" data-action="xml-details" data-xml-id="${xml.id}">Visualizar detalhes</button>
                        <button class="icon-btn" data-action="xml-sync-events" data-xml-id="${xml.id}" ${xmlSyncDisabled}>Buscar eventos</button>
                        <button class="icon-btn" data-action="xml-view" data-xml-id="${xml.id}">Ver XML</button>
                        <button class="icon-btn" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
                        <button class="icon-btn" data-action="xml-download-danfse" data-xml-id="${xml.id}">Baixar DANFSE</button>
                      </div>
                    </td>
                  </tr>`;
                })
                .join(''),
              emptyMessage: 'Nenhum XML encontrado para a empresa e periodo selecionados.'
            })}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderXmlSortHeader(key, label) {
  const isActive = state.sort.xmls.key === key;
  const direction = isActive ? state.sort.xmls.direction : 'none';
  const sortLabel =
    direction === 'asc'
      ? `${label}, ordenado crescente`
      : direction === 'desc'
        ? `${label}, ordenado decrescente`
        : `${label}, ordenar`;

  return `
    <th>
      <button class="sort-header ${isActive ? 'active' : ''}" type="button" data-action="xmls-sort" data-sort-key="${escapeHtml(key)}" aria-label="${escapeHtml(sortLabel)}">
        <span>${escapeHtml(label)}</span>
        <span class="sort-indicator" aria-hidden="true">${direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}</span>
      </button>
    </th>
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
          ${renderTabButton('manutencao', 'Manutencao')}
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
        ${renderSchedulerSettingsPanel()}
        <form id="settingsRotinaForm" class="form-grid three">
          <label class="field-inline" style="grid-column: span 3;">
            <input name="ativa" type="checkbox" ${state.settings.rotina.ativa ? 'checked' : ''} />
            <span>Ativar rotina noturna</span>
          </label>
          <div class="field" style="grid-column: span 3;">
            <span>Horarios ativos da rotina</span>
            <div class="schedule-slot-grid">${renderNightlySlotCheckboxes()}</div>
            <small class="row-sub">Selecione os horarios em que a rotina deve executar automaticamente.</small>
          </div>
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
    case 'manutencao': {
      const running = state.settings.danfseReprocessRunning;
      return `
        <div class="maintenance-list">
          <div class="maintenance-row">
            <div>
              <strong>DANFSEs antigas</strong>
              <span class="row-sub">PDFs legados ou ausentes</span>
            </div>
            <div class="maintenance-actions">
              ${statusBadge(running ? 'Executando' : 'Pronto', running ? 'info' : 'neutral')}
              <button class="btn primary" type="button" data-action="settings-reprocess-danfse" ${running ? 'disabled' : ''}>
                ${running ? 'Reprocessando...' : 'Reprocessar DANFSEs'}
              </button>
            </div>
          </div>
        </div>
      `;
    }
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
          <div class="modal" role="dialog" aria-modal="true">
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
    case 'recover-past-nsus':
      return renderRecoverPastNsusModal();
    case 'import-clients':
      return `
        <div class="overlay" data-action="overlay-close">
          <div class="modal" role="dialog" aria-modal="true">
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
    case 'certificate-password':
      return renderCertificatePasswordModal();
    case 'certificate-notes':
      return renderCertificateNotesModal(state.modal.certId);
    case 'nfe-details':
      return renderNfeDetailsModal(state.modal.nfeId);
    case 'nfe-view':
      return renderNfeViewerModal(state.modal.nfeId);
    case 'cte-details':
      return renderCteDetailsModal(state.modal.cteId);
    case 'cte-view':
      return renderCteViewerModal(state.modal.cteId);
    case 'dominio-nfe-view':
      return renderDominioNfeViewerModal();
    case 'xml-details':
      return renderXmlDetailsModal(state.modal.xmlId);
    case 'xml-view':
      return renderXmlViewerModal(state.modal.xmlId);
    default:
      return '';
  }
}

function renderRecoverPastNsusModal() {
  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Recuperar NSUs passados</h3>
          <p class="modal-subtitle">Selecione um cliente para recuperar apenas as lacunas dele ou mantenha todos os clientes.</p>
        </div>
        <form id="recoverPastNsusForm">
          <div class="modal-body">
            <div class="form-grid">
              <label class="field" style="grid-column: span 2;">
                Cliente
                <select name="clienteId">
                  <option value="">Todos os clientes</option>
                  ${state.clients
                    .map((client) => {
                      return `<option value="${escapeHtml(client.id)}">${escapeHtml(client.razaoSocial)} - ${escapeHtml(formatCnpj(client.cnpj))}</option>`;
                    })
                    .join('')}
                </select>
              </label>
              <p class="card-subtitle" style="grid-column: span 2; margin:0;">
                A rotina varre NSUs ja consultados, pula notas que ja existem e consulta o ADN apenas para lacunas. A execucao pode demorar.
              </p>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" type="button" data-action="close-modal">Cancelar</button>
            <button class="btn primary" type="submit">Iniciar recuperacao</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderClientFormModal() {
  const client = state.modal.mode === 'edit' ? findClientById(state.modal.clientId) : null;
  const municipioValue = getEditableValue(client?.municipio);
  const ufValue = getEditableValue(client?.uf);
  const responsavelInternoValue = getEditableValue(client?.responsavelInterno);

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">${state.modal.mode === 'edit' ? 'Editar cliente' : 'Novo cliente'}</h3>
          <p class="modal-subtitle">Preencha os dados cadastrais e defina separadamente as rotinas de NFS-e e NF-e.</p>
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
                <input name="municipio" required value="${escapeHtml(municipioValue)}" />
              </label>
              <label class="field">
                UF
                <input name="uf" maxlength="2" required value="${escapeHtml(ufValue)}" />
              </label>
              <label class="field" style="grid-column: span 2;">
                Responsavel interno
                <input name="responsavelInterno" value="${escapeHtml(responsavelInternoValue)}" />
              </label>
              <label class="field-inline" style="grid-column: span 2;">
                <input name="buscaAtiva" type="checkbox" ${client?.buscaAtiva ?? true ? 'checked' : ''} />
                <span>Cliente habilitado para rotina</span>
              </label>
              <label class="field-inline" style="grid-column: span 2;">
                <input name="buscaNfeAtiva" type="checkbox" ${client?.buscaNfeAtiva ?? true ? 'checked' : ''} />
                <span>Cliente habilitado para busca de NF-e</span>
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
  const mode = state.modal.mode || 'create';
  const cert = mode === 'edit' ? findCertificateById(state.modal.certId) : null;
  if (mode === 'edit' && !cert) {
    return '';
  }
  const draft = state.modal.draft || {};
  const selectedClientId = draft.clientId ?? (mode === 'edit' ? cert?.clientId || '' : state.modal.clientId || '');
  const apelidoValue = draft.apelido ?? cert?.apelido ?? '';
  const cnpjTitularValue = draft.cnpjTitular ?? cert?.cnpj ?? '';
  const senhaValue = draft.senha ?? '';
  const anotacoesValue = draft.anotacoes ?? cert?.anotacoes ?? '';
  const autoValidity = state.dataSource === 'api';
  const title = mode === 'edit' ? (state.modal.replace ? 'Substituir certificado' : 'Editar certificado') : 'Cadastrar certificado';
  const subtitle =
    mode === 'edit'
      ? 'Atualize cadastro, vinculo e arquivo quando necessario.'
      : 'Cadastre o A1 para uso na rotina ou como controle interno sem cliente vinculado.';
  const fileRequired = mode !== 'edit';
  const passwordLabel = mode === 'edit' ? 'Nova senha' : 'Senha';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <p class="modal-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <form id="certificatesModalForm">
          <div class="modal-body">
            <input type="hidden" name="mode" value="${escapeHtml(mode)}" />
            <input type="hidden" name="certId" value="${escapeHtml(cert?.id || '')}" />
            <div class="form-grid two">
              <label class="field">
                Cliente
                <select name="clientId">${renderOptions(state.clients.map((client) => client.id), selectedClientId, mapClientOptions(), 'Sem cliente vinculado')}</select>
              </label>
              <label class="field">
                Apelido
                <input name="apelido" required value="${escapeHtml(apelidoValue)}" />
              </label>
              <label class="field">
                CNPJ titular
                <input name="cnpjTitular" maxlength="18" value="${escapeHtml(cnpjTitularValue)}" />
              </label>
              <label class="field">
                Tipo
                <input name="tipo" value="${escapeHtml(cert?.tipo || 'A1')}" disabled />
              </label>
              <label class="field">
                Arquivo do certificado
                <input name="arquivo" type="file" accept=".pfx,.p12" ${fileRequired ? 'required' : ''} />
                ${draft.fileName ? `<span class="row-sub">Selecionado: ${escapeHtml(draft.fileName)}</span>` : ''}
              </label>
              <label class="field">
                ${escapeHtml(passwordLabel)}
                <input name="senha" type="password" ${mode === 'create' ? 'required' : ''} value="${escapeHtml(senhaValue)}" />
              </label>
              ${
                autoValidity
                  ? `<label class="field">
                Data de validade
                <input value="Preenchimento automatico pelo certificado" disabled />
              </label>`
                  : `<label class="field">
                Data de validade
                <input name="validade" type="date" required />
              </label>`
              }
              <label class="field" style="grid-column: span 2;">
                Anotacoes
                <textarea name="anotacoes">${escapeHtml(anotacoesValue)}</textarea>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" type="button" data-action="close-modal">Cancelar</button>
            <button class="btn primary" type="submit">${mode === 'edit' ? 'Salvar alteracoes' : 'Salvar certificado'}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderCertificateNotesModal(certId) {
  const cert = state.certificates.find((item) => item.id === certId);
  if (!cert) {
    return '';
  }

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Anotacoes do certificado</h3>
          <p class="modal-subtitle">${escapeHtml(cert.apelido)} - ${escapeHtml(cert.cliente || 'Sem cliente vinculado')}</p>
        </div>
        <form id="certificateNotesForm">
          <div class="modal-body">
            <input type="hidden" name="certId" value="${escapeHtml(cert.id)}" />
            <label class="field">
              Anotacoes
              <textarea name="anotacoes">${escapeHtml(cert.anotacoes || '')}</textarea>
            </label>
          </div>
          <div class="modal-footer">
            <button class="btn secondary" type="button" data-action="close-modal">Cancelar</button>
            <button class="btn primary" type="submit">Salvar anotacoes</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderCertificatePasswordModal() {
  const certName = state.modal.certName || 'Certificado';
  const clientName = state.modal.clientName || 'Sem cliente vinculado';
  const senha = state.modal.senha || '';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Senha do certificado</h3>
          <p class="modal-subtitle">${escapeHtml(certName)} - ${escapeHtml(clientName)}</p>
        </div>
        <div class="modal-body">
          <label class="field">
            Senha cadastrada
            <input type="text" readonly value="${escapeHtml(senha)}" />
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" type="button" data-action="close-modal">Fechar</button>
          <button class="btn primary" type="button" data-action="copy-certificate-password">Copiar senha</button>
        </div>
      </div>
    </div>
  `;
}

function renderNfeDetailsModal(nfeId) {
  const doc = findNfeById(nfeId);
  if (!doc) {
    return '';
  }
  const syncEventsDisabled = state.nfeEventsSyncRunning || !canSyncNfeEvents(doc) ? 'disabled' : '';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Detalhes da NF-e ${escapeHtml(doc.numeroNfe || doc.chaveAcesso)}</h3>
          <p class="modal-subtitle">Resumo do documento armazenado para consulta interna.</p>
        </div>
        <div class="modal-body">
          <div class="form-grid two">
            ${detailItem('Cliente', doc.cliente)}
            ${detailItem('Tipo', doc.tipo)}
            ${detailItem('Chave de acesso', doc.chaveAcesso)}
            ${detailItem('Numero NF-e', doc.numeroNfe || '-')}
            ${detailItem('Serie / modelo', `${doc.serie || '-'} / ${doc.modelo || '-'}`)}
            ${detailItem('Ambiente', mapNfeAmbienteLabel(doc.ambiente))}
            ${detailItem('Emitente', `${doc.emitenteNome || '-'}${doc.emitenteCnpj ? ` (${formatCnpj(doc.emitenteCnpj)})` : ''}`)}
            ${detailItem('Destinatario', `${doc.destinatarioNome || '-'}${doc.destinatarioCnpj ? ` (${formatCnpj(doc.destinatarioCnpj)})` : ''}`)}
            ${detailItem('Data de emissao', formatDateTime(doc.dataEmissao))}
            ${detailItem('Data de autorizacao', formatDateTime(doc.dataAutorizacao))}
            ${detailItem('Valor total', formatCurrency(doc.valor))}
            ${detailItem('Schema', doc.schemaDoc || '-')}
            ${detailItem('Arquivo completo', doc.xmlCompletoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Resumo disponivel', doc.resumoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Status fiscal', doc.statusFiscal || '-')}
            ${detailItem('Resumo de eventos', doc.eventosResumo || '-')}
            ${detailItem('Caminho XML', doc.caminhoServidor || '-')}
          </div>
          <div style="margin-top:18px;">
            <small style="color:#606062; display:block; margin-bottom:8px;">Eventos vinculados</small>
            ${renderXmlEventsList(doc.eventos)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="nfe-sync-events" data-nfe-id="${doc.id}" ${syncEventsDisabled}>Buscar eventos</button>
          <button class="btn secondary" data-action="nfe-view" data-nfe-id="${doc.id}">Ver conteudo XML</button>
          <button class="btn primary" data-action="nfe-download" data-nfe-id="${doc.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderNfeViewerModal(nfeId) {
  const doc = findNfeById(nfeId);
  if (!doc) {
    return '';
  }

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Visualizador XML - NF-e ${escapeHtml(doc.numeroNfe || doc.chaveAcesso)}</h3>
          <p class="modal-subtitle">Visualizacao formatada para leitura interna.</p>
        </div>
        <div class="modal-body">
          <pre class="xml-viewer">${escapeHtml(formatXml(doc.conteudoXml))}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">Fechar</button>
          <button class="btn primary" data-action="nfe-download" data-nfe-id="${doc.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderCteDetailsModal(cteId) {
  const doc = findCteById(cteId);
  if (!doc) {
    return '';
  }
  const syncEventsDisabled = state.cteEventsSyncRunning || !canSyncCteEvents(doc) ? 'disabled' : '';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Detalhes do CT-e ${escapeHtml(doc.numeroCte || doc.chaveAcesso)}</h3>
          <p class="modal-subtitle">Resumo do documento armazenado para consulta interna.</p>
        </div>
        <div class="modal-body">
          <div class="form-grid two">
            ${detailItem('Cliente', doc.cliente)}
            ${detailItem('Tipo', doc.tipo)}
            ${detailItem('Chave de acesso', doc.chaveAcesso)}
            ${detailItem('Numero CT-e', doc.numeroCte || '-')}
            ${detailItem('Serie / modelo', `${doc.serie || '-'} / ${doc.modelo || '-'}`)}
            ${detailItem('Ambiente', mapNfeAmbienteLabel(doc.ambiente))}
            ${detailItem('Emitente', `${doc.emitenteNome || '-'}${doc.emitenteCnpj ? ` (${formatCnpj(doc.emitenteCnpj)})` : ''}`)}
            ${detailItem('Destinatario', `${doc.destinatarioNome || '-'}${doc.destinatarioCnpj ? ` (${formatCnpj(doc.destinatarioCnpj)})` : ''}`)}
            ${detailItem('Data de emissao', formatDateTime(doc.dataEmissao))}
            ${detailItem('Data de autorizacao', formatDateTime(doc.dataAutorizacao))}
            ${detailItem('Valor total', formatCurrency(doc.valor))}
            ${detailItem('Schema', doc.schemaDoc || '-')}
            ${detailItem('Arquivo completo', doc.xmlCompletoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Resumo disponivel', doc.resumoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Status fiscal', doc.statusFiscal || '-')}
            ${detailItem('Resumo de eventos', doc.eventosResumo || '-')}
            ${detailItem('Caminho XML', doc.caminhoServidor || '-')}
          </div>
          <div style="margin-top:18px;">
            <small style="color:#606062; display:block; margin-bottom:8px;">Eventos vinculados</small>
            ${renderXmlEventsList(doc.eventos)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="cte-sync-events" data-cte-id="${doc.id}" ${syncEventsDisabled}>Buscar eventos</button>
          <button class="btn secondary" data-action="cte-view" data-cte-id="${doc.id}">Ver conteudo XML</button>
          <button class="btn primary" data-action="cte-download" data-cte-id="${doc.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderCteViewerModal(cteId) {
  const doc = findCteById(cteId);
  if (!doc) {
    return '';
  }

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Visualizador XML - CT-e ${escapeHtml(doc.numeroCte || doc.chaveAcesso)}</h3>
          <p class="modal-subtitle">Visualizacao formatada para leitura interna.</p>
        </div>
        <div class="modal-body">
          <pre class="xml-viewer">${escapeHtml(formatXml(doc.conteudoXml))}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">Fechar</button>
          <button class="btn primary" data-action="cte-download" data-cte-id="${doc.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderDominioNfeViewerModal() {
  if (state.modal?.kind !== 'dominio-nfe-view') {
    return '';
  }

  const payload = state.modal.payload || null;
  if (!payload?.xml) {
    return '';
  }

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Visualizador XML - Dominio ${escapeHtml(payload.numeroNfe || payload.catalogoId || '')}</h3>
          <p class="modal-subtitle">Catalogo ${escapeHtml(String(payload.catalogoId || '-'))}${payload.chaveAcesso ? ` - chave ${escapeHtml(payload.chaveAcesso)}` : ''}</p>
        </div>
        <div class="modal-body">
          <pre class="xml-viewer">${escapeHtml(formatXml(payload.xml))}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">Fechar</button>
          <button class="btn primary" data-action="dominio-nfe-download-modal">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderXmlDetailsModal(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    return '';
  }
  const syncEventsDisabled =
    state.xmlEventsSyncRunning ||
    state.dataSource !== 'api' ||
    !xml.apiNfseId ||
    !xml.clientId ||
    !xml.estabelecimentoId ||
    normalizeDigits(xml.chaveAcesso || '').length === 0
      ? 'disabled'
      : '';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true">
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
            ${detailItem('Codigo do servico prestado', xml.codigoServicoPrestado || '-')}
            ${detailItem('Descricao do servico', xml.descricaoServico || '-')}
            ${detailItem('Status de armazenamento', xml.statusArmazenamento)}
            ${detailItem('Situacao fiscal', xml.statusFiscal || '-')}
            ${detailItem('Data de cancelamento', xml.dataCancelamento ? formatDateTime(xml.dataCancelamento) : '-')}
            ${detailItem('Resumo de eventos', xml.eventosResumo || '-')}
          </div>
          <div style="margin-top:18px;">
            <small style="color:#606062; display:block; margin-bottom:8px;">Eventos vinculados</small>
            ${renderXmlEventsList(xml.eventos)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="xml-sync-events" data-xml-id="${xml.id}" ${syncEventsDisabled}>Buscar eventos</button>
          <button class="btn secondary" data-action="xml-view" data-xml-id="${xml.id}">Ver conteudo XML</button>
          <button class="btn secondary" data-action="xml-download-danfse" data-xml-id="${xml.id}">Baixar DANFSE</button>
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
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Visualizador XML - NFS-e ${escapeHtml(xml.numeroNfse)}</h3>
          <p class="modal-subtitle">Visualizacao formatada para leitura interna.</p>
        </div>
        <div class="modal-body">
          <pre class="xml-viewer">${escapeHtml(formatXml(xml.conteudoXml))}</pre>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">Fechar</button>
          <button class="btn secondary" data-action="xml-download-danfse" data-xml-id="${xml.id}">Baixar DANFSE</button>
          <button class="btn primary" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
        </div>
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

function renderSchedulerStatusStrip() {
  const nightly = getNightlyScheduleInfo();
  const autoSync = getAutoSyncInfo();
  const dailySync = getDailySyncInfo();

  return `
    <article class="card scheduler-strip">
      <div class="scheduler-item">
        <div class="scheduler-heading">
          <span class="scheduler-dot ${nightly.tone}"></span>
          <strong>Rotina noturna</strong>
        </div>
        ${statusBadge(nightly.badgeLabel, nightly.tone)}
        <p>${escapeHtml(nightly.description)}</p>
        <small>Proxima execucao: ${escapeHtml(nightly.nextRunText)}</small>
      </div>
      <div class="scheduler-item">
        <div class="scheduler-heading">
          <span class="scheduler-dot ${autoSync.tone}"></span>
          <strong>Ciclo automatico</strong>
        </div>
        ${statusBadge(autoSync.badgeLabel, autoSync.tone)}
        <p>${escapeHtml(autoSync.description)}</p>
        <small>Intervalo: ${escapeHtml(autoSync.intervalText)}</small>
      </div>
      <div class="scheduler-item">
        <div class="scheduler-heading">
          <span class="scheduler-dot ${dailySync.tone}"></span>
          <strong>Lote de busca</strong>
        </div>
        ${statusBadge(dailySync.badgeLabel, dailySync.tone)}
        <p>${escapeHtml(dailySync.description)}</p>
        <small>${escapeHtml(dailySync.detailText)}</small>
      </div>
      <div class="scheduler-item">
        <div class="scheduler-heading">
          <span class="scheduler-dot ${state.executionMonitor.active ? 'info' : 'neutral'}"></span>
          <strong>Execucao agora</strong>
        </div>
        ${statusBadge(state.executionMonitor.active ? 'Executando agora' : 'Nada em execucao', state.executionMonitor.active ? 'info' : 'neutral')}
        <p>${escapeHtml(state.executionMonitor.currentClientName ? `Empresa atual: ${state.executionMonitor.currentClientName}` : 'Nenhum cliente sendo consultado neste momento.')}</p>
        <small>${escapeHtml(state.executionMonitor.message || 'Aguardando proxima execucao.')}</small>
      </div>
    </article>
  `;
}

function renderSchedulerSettingsPanel() {
  const nightly = getNightlyScheduleInfo();
  const autoSync = getAutoSyncInfo();
  const dailySync = getDailySyncInfo();

  return `
    <div class="scheduler-settings">
      <div>
        <span class="row-sub">Rotina noturna</span>
        <div class="scheduler-settings-title">${statusBadge(nightly.badgeLabel, nightly.tone)} <strong>${escapeHtml(nightly.shortLabel)}</strong></div>
        <p>${escapeHtml(nightly.description)}</p>
      </div>
      <div>
        <span class="row-sub">Ciclo automatico</span>
        <div class="scheduler-settings-title">${statusBadge(autoSync.badgeLabel, autoSync.tone)} <strong>${escapeHtml(autoSync.intervalText)}</strong></div>
        <p>${escapeHtml(autoSync.description)}</p>
      </div>
      <div>
        <span class="row-sub">Lote de busca</span>
        <div class="scheduler-settings-title">${statusBadge(dailySync.badgeLabel, dailySync.tone)} <strong>${escapeHtml(dailySync.detailText)}</strong></div>
        <p>${escapeHtml(dailySync.description)}</p>
      </div>
    </div>
  `;
}

function renderNightlySlotCheckboxes() {
  const availableSlots = state.settings.rotina.horariosDisponiveis?.length
    ? state.settings.rotina.horariosDisponiveis
    : NIGHTLY_SWEEP_AVAILABLE_SLOTS;
  const activeSlots = new Set(state.settings.rotina.horariosAtivos || []);

  return availableSlots
    .map(
      (slot) => `
        <label class="schedule-slot-option">
          <input name="activeSlots" type="checkbox" value="${escapeHtml(slot)}" ${activeSlots.has(slot) ? 'checked' : ''} />
          <span>${escapeHtml(slot)}</span>
        </label>
      `
    )
    .join('');
}

function renderClientSearchActivation(client) {
  const label = client.buscaAtiva ? 'Habilitada' : 'Pausada';
  const tone = client.buscaAtiva ? 'success' : 'neutral';
  const detail = client.buscaAtiva ? 'entra nas rotinas elegiveis' : 'nao entra nas rotinas';

  return `
    <div class="stack-mini">
      ${statusBadge(label, tone)}
      <span class="row-sub">${escapeHtml(detail)}</span>
    </div>
  `;
}

function renderClientNfeSearchActivation(client) {
  const label = client.buscaNfeAtiva !== false ? 'Habilitada' : 'Pausada';
  const tone = client.buscaNfeAtiva !== false ? 'info' : 'neutral';
  const sourceMode = getNfeSourceMode();
  const detail =
    client.buscaNfeAtiva !== false
      ? sourceMode === 'dominio'
        ? 'participa da importacao via banco Dominio'
        : 'participa da distribuicao DF-e'
      : 'excluida das rotinas de NF-e';

  return `
    <div class="stack-mini">
      ${statusBadge(label, tone)}
      <span class="row-sub">${escapeHtml(detail)}</span>
    </div>
  `;
}

function statusBadge(text, tone, extraClass = '') {
  const normalizedTone = ['success', 'warning', 'danger', 'info', 'neutral'].includes(tone) ? tone : 'neutral';
  return `<span class="chip ${normalizedTone} ${extraClass}">${escapeHtml(text)}</span>`;
}

function renderNfseNumber(xml) {
  const numero = escapeHtml(xml.numeroNfse || '-');
  const cancelBadge = xml.cancelada ? statusBadge('Cancelada', 'danger', 'nfse-cancel-chip') : '';
  return `<div class="nfse-number-cell"><strong>${numero}</strong>${cancelBadge}</div>`;
}

function renderXmlStatusBadges(xml) {
  const badges = [statusBadge(xml.statusArmazenamento, toneFromStorageStatus(xml.statusArmazenamento))];
  if (xml.cancelada) {
    badges.push(statusBadge('Cancelada', 'danger', 'nfse-cancel-chip'));
  } else if (xml.statusFiscal && xml.statusFiscal !== '-') {
    badges.push(statusBadge(xml.statusFiscal, toneFromFiscalStatus(xml.statusFiscal)));
  }

  return `<div class="status-stack">${badges.join('')}</div>`;
}

function renderNfeStorageBadges(doc) {
  const badges = [];
  if (doc.xmlCompletoDisponivel) {
    badges.push(statusBadge('XML completo', 'success'));
  }
  if (doc.resumoDisponivel) {
    badges.push(statusBadge('Resumo', 'info'));
  }
  if (!badges.length) {
    badges.push(statusBadge('Sem arquivo', 'neutral'));
  }
  return `<div class="status-stack">${badges.join('')}</div>`;
}

function renderNfeStatusBadges(doc) {
  const badges = [];
  if (doc.statusFiscal && doc.statusFiscal !== '-') {
    badges.push(statusBadge(doc.statusFiscal, toneFromFiscalStatus(doc.statusFiscal)));
  }
  badges.push(statusBadge(doc.tipo, doc.tipo === 'Emitida' ? 'success' : doc.tipo === 'Recebida' ? 'info' : 'neutral'));
  return `<div class="status-stack">${badges.join('')}</div>`;
}

function renderCteStatusBadges(doc) {
  const badges = [];
  if (doc.statusFiscal && doc.statusFiscal !== '-') {
    badges.push(statusBadge(doc.statusFiscal, toneFromFiscalStatus(doc.statusFiscal)));
  }
  badges.push(statusBadge(doc.tipo, doc.tipo === 'Emitido' ? 'success' : doc.tipo === 'Recebido' ? 'info' : 'neutral'));
  return `<div class="status-stack">${badges.join('')}</div>`;
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
    '/buscas-nfe': 'buscas-nfe',
    '/xmls-nfe': 'xmls-nfe',
    '/xmls-cte': 'xmls-cte',
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
  if (routeName === 'buscas-nfe' || routeName === 'buscas') {
    return 'buscas';
  }
  if (routeName === 'xmls' || routeName === 'xmls-nfe' || routeName === 'xmls-cte') {
    return 'armazenados';
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

async function toggleClientSearchStatus(clientId) {
  const client = findClientById(clientId);
  if (!client) {
    return;
  }

  if (state.dataSource === 'api') {
    const active = !client.buscaAtiva;
    try {
      await apiRequest(`/clientes/${clientId}/${active ? 'ativar' : 'pausar'}`, {
        method: 'POST'
      });
      pushToast(`Busca ${active ? 'habilitada' : 'pausada'} para ${client.razaoSocial}.`, active ? 'success' : 'info');
      await refreshApiData();
    } catch (error) {
      pushToast(`Falha ao atualizar status de busca: ${toErrorMessage(error)}`, 'error');
    }
    return;
  }

  client.buscaAtiva = !client.buscaAtiva;
  client.buscaStatus = client.buscaAtiva ? 'Ativo' : 'Inativo';
  pushToast(`Busca ${client.buscaAtiva ? 'habilitada' : 'pausada'} para ${client.razaoSocial}.`, client.buscaAtiva ? 'success' : 'info');
  render();
}

async function toggleClientNfeSearchStatus(clientId) {
  const client = findClientById(clientId);
  if (!client) {
    return;
  }

  if (state.dataSource === 'api') {
    const active = client.buscaNfeAtiva === false;
    try {
      await apiRequest(`/clientes/${clientId}/nfe/${active ? 'ativar' : 'pausar'}`, {
        method: 'POST'
      });
      pushToast(
        `Busca de NF-e ${active ? 'habilitada' : 'pausada'} para ${client.razaoSocial}.`,
        active ? 'success' : 'info'
      );
      await refreshApiData();
    } catch (error) {
      pushToast(`Falha ao atualizar busca de NF-e: ${toErrorMessage(error)}`, 'error');
    }
    return;
  }

  client.buscaNfeAtiva = client.buscaNfeAtiva === false;
  pushToast(
    `Busca de NF-e ${client.buscaNfeAtiva ? 'habilitada' : 'pausada'} para ${client.razaoSocial}.`,
    client.buscaNfeAtiva ? 'success' : 'info'
  );
  render();
}

async function bulkUpdateClientSearch(active) {
  if (state.selectedClientIds.size === 0) {
    pushToast('Selecione clientes para aplicacao em massa.', 'error');
    return;
  }

  if (state.dataSource === 'api') {
    const clientIds = Array.from(state.selectedClientIds);
    let success = 0;
    let failure = 0;

    for (const clientId of clientIds) {
      try {
        await apiRequest(`/clientes/${clientId}/${active ? 'ativar' : 'pausar'}`, {
          method: 'POST'
        });
        success += 1;
      } catch {
        failure += 1;
      }
    }

    await refreshApiData();
    pushToast(
      `${success} cliente(s) atualizado(s) para busca ${active ? 'ativa' : 'inativa'}${failure ? `, ${failure} falha(s)` : ''}.`,
      failure ? 'error' : 'success'
    );
    return;
  }

  state.clients.forEach((client) => {
    if (state.selectedClientIds.has(client.id)) {
      client.buscaAtiva = active;
      client.buscaStatus = active ? 'Ativo' : 'Inativo';
    }
  });

  pushToast(`${state.selectedClientIds.size} cliente(s) atualizado(s): busca ${active ? 'ativa' : 'inativa'}.`, 'success');
  render();
}

async function submitClientForm(form) {
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
    buscaAtiva: formData.get('buscaAtiva') === 'on',
    buscaNfeAtiva: formData.get('buscaNfeAtiva') === 'on'
  };

  if (payload.cnpj.length !== 14) {
    pushToast('Informe um CNPJ com 14 digitos.', 'error');
    return;
  }

  if (state.dataSource === 'api') {
    const apiPayload = {
      razaoSocial: payload.razaoSocial,
      nomeFantasia: payload.nomeFantasia || undefined,
      cnpj: payload.cnpj,
      inscricaoMunicipal: payload.inscricaoMunicipal || undefined,
      municipioNome: payload.municipio || undefined,
      responsavelInterno: payload.responsavelInterno || undefined,
      ativo: payload.buscaAtiva,
      nfeHabilitado: payload.buscaNfeAtiva
    };

    const responsavelEmail = sanitizeEmail(payload.responsavelInterno);
    if (responsavelEmail) {
      apiPayload.emailResponsavel = responsavelEmail;
    }

    try {
      if (mode === 'edit') {
        await apiRequest(`/clientes/${clientId}`, {
          method: 'PATCH',
          body: apiPayload
        });
        pushToast('Cliente atualizado com sucesso.', 'success');
      } else {
        await apiRequest('/clientes', {
          method: 'POST',
          body: apiPayload
        });
        pushToast('Cliente criado com sucesso.', 'success');
      }

      closeModal();
      await refreshApiData();
      return;
    } catch (error) {
      pushToast(`Falha ao salvar cliente: ${toErrorMessage(error)}`, 'error');
      return;
    }
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
      id: createBrowserId(),
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

async function submitClientSearchConfigForm(form) {
  const formData = new FormData(form);
  const clientId = String(formData.get('clientId') || '').trim();
  const client = findClientById(clientId);
  if (!client) {
    pushToast('Cliente nao encontrado.', 'error');
    return;
  }

  const buscaAtiva = formData.get('buscaAtiva') === 'on';
  const buscaNfeAtiva = formData.get('buscaNfeAtiva') === 'on';

  if (state.dataSource === 'api') {
    try {
      await apiRequest(`/clientes/${clientId}`, {
        method: 'PATCH',
        body: {
          ativo: buscaAtiva,
          nfeHabilitado: buscaNfeAtiva
        }
      });
      pushToast('Configuracao de busca salva.', 'success');
      await refreshApiData();
    } catch (error) {
      pushToast(`Falha ao salvar configuracao: ${toErrorMessage(error)}`, 'error');
    }
    return;
  }

  client.buscaAtiva = buscaAtiva;
  client.buscaStatus = buscaAtiva ? 'Ativo' : 'Inativo';
  client.buscaNfeAtiva = buscaNfeAtiva;
  pushToast('Configuracao de busca salva.', 'success');
  render();
}

function getFilteredCertificates() {
  const query = String(state.filters.certificates.query || '').trim().toLowerCase();
  const digitsQuery = normalizeDigits(query);

  return [...state.certificates]
    .filter((cert) => {
      if (!query) {
        return true;
      }

      const searchableName = `${cert.cliente || ''} ${cert.apelido || ''}`.toLowerCase();
      const searchableCnpj = normalizeDigits(cert.cnpj || '');

      return searchableName.includes(query) || (digitsQuery && searchableCnpj.includes(digitsQuery));
    })
    .sort((a, b) => a.diasRestantes - b.diasRestantes);
}

function applyCertificatesFilters(form) {
  const data = new FormData(form);
  state.filters.certificates = {
    query: String(data.get('query') || '').trim()
  };
  state.tableState.certificates = 'data';
  render();
}

function resetCertificatesFilters() {
  state.filters.certificates = {
    query: ''
  };
  state.tableState.certificates = 'data';
}

async function simulateCertificateTest(certificateId) {
  const cert = state.certificates.find((item) => item.id === certificateId);
  if (!cert) {
    pushToast('Certificado nao encontrado.', 'error');
    return;
  }

  if (state.dataSource === 'api') {
    pushToast(`Testando certificado ${cert.apelido}...`, 'info');
    try {
      const result = await apiRequest(`/certificados/${certificateId}/validar${buildCertificateScopeQuery(cert)}`, {
        method: 'POST'
      });
      const valido = Boolean(result?.valido);
      const motivos = Array.isArray(result?.motivos) ? result.motivos : [];
      pushToast(
        valido ? `Certificado ${cert.apelido} validado com sucesso.` : `Falha na validacao: ${motivos.join(', ') || 'motivo nao informado'}.`,
        valido ? 'success' : 'error'
      );
    } catch (error) {
      pushToast(`Falha ao validar certificado: ${toErrorMessage(error)}`, 'error');
    }
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

async function submitCertificateForm(form) {
  const formData = new FormData(form);
  const mode = String(formData.get('mode') || 'create');
  const certId = String(formData.get('certId') || '');
  const cert = mode === 'edit' ? findCertificateById(certId) : null;
  const clientId = String(formData.get('clientId') || '');
  const client = findClientById(clientId);
  const cnpjTitular = normalizeDigits(String(formData.get('cnpjTitular') || client?.cnpj || ''));
  const senha = String(formData.get('senha') || '');
  const selectedFile = formData.get('arquivo');
  const draftFile = state.modal?.draft?.file instanceof File ? state.modal.draft.file : null;
  const file = selectedFile instanceof File && selectedFile.size > 0 ? selectedFile : draftFile;
  const hasFile = file instanceof File && file.size > 0;

  persistCertificateFormDraft(form, file);

  if (clientId && !client) {
    pushToast('Cliente selecionado nao foi encontrado.', 'error');
    return;
  }

  if (mode === 'edit' && !cert) {
    pushToast('Certificado nao encontrado para edicao.', 'error');
    return;
  }

  if (cnpjTitular.length !== 14) {
    pushToast('Informe um CNPJ titular com 14 digitos.', 'error');
    return;
  }

  if (state.dataSource === 'api') {
    if (mode !== 'edit' && !hasFile) {
      pushToast('Selecione um arquivo de certificado valido.', 'error');
      return;
    }

    if (hasFile && !senha) {
      pushToast('Informe a senha do certificado selecionado.', 'error');
      return;
    }

    try {
      const primaryEstablishmentId = client?.estabelecimentoIdPrincipal || state.establishmentsByClient?.[clientId]?.[0]?.id || null;
      const estabelecimentoId =
        mode === 'edit' && cert?.clientId === clientId ? cert.estabelecimentoId || primaryEstablishmentId : primaryEstablishmentId;
      const anotacoes = String(formData.get('anotacoes') || '').trim();
      const body = {
        nome: String(formData.get('apelido') || 'Certificado'),
        clienteId: clientId || (mode === 'edit' ? null : undefined),
        cnpjTitular,
        estabelecimentoId: estabelecimentoId || (mode === 'edit' ? null : undefined),
        anotacoes: anotacoes || (mode === 'edit' ? null : undefined)
      };

      if (hasFile) {
        body.arquivoBase64 = await fileToBase64(file);
        body.senha = senha;
      } else if (mode === 'edit' && senha) {
        body.senha = senha;
      }

      let usedReplacementFallback = false;
      let response;

      if (mode === 'edit') {
        try {
          response = await apiRequest(`/certificados/${cert.id}${buildCertificateScopeQuery(cert)}`, {
            method: 'PATCH',
            body
          });
        } catch (error) {
          if (!hasFile || !isMissingCertificatePatchRoute(error)) {
            throw error;
          }

          usedReplacementFallback = true;
          response = await createCertificateReplacement(clientId, body, cert.id);
        }
      } else {
        response = await apiRequest(clientId ? `/clientes/${clientId}/certificados` : '/certificados', {
          method: 'POST',
          body
        });
      }

      closeModal();
      const detectedValidity = response?.validadeFim || response?.validadeInicio;
      if (detectedValidity) {
        pushToast(
          usedReplacementFallback
            ? `Certificado substituido. Validade detectada: ${formatDate(detectedValidity)}.`
            : mode === 'edit'
            ? `Certificado atualizado. Validade detectada: ${formatDate(detectedValidity)}.`
            : `Certificado cadastrado. Validade detectada: ${formatDate(detectedValidity)}.`,
          'success'
        );
      } else {
        pushToast(
          usedReplacementFallback
            ? 'Certificado substituido com sucesso.'
            : mode === 'edit'
              ? 'Certificado atualizado com sucesso.'
              : 'Certificado cadastrado com sucesso.',
          'success'
        );
      }
      await refreshApiData();
    } catch (error) {
      pushToast(`Falha ao ${mode === 'edit' ? 'atualizar' : 'cadastrar'} certificado: ${toErrorMessage(error)}`, 'error');
    }
    return;
  }

  const validade = String(formData.get('validade') || '');
  const dias = daysUntil(validade);
  const status = dias < 0 ? 'Vencido' : dias <= 30 ? 'A vencer' : 'Valido';

  const mockPayload = {
    id: cert?.id || `cert-${Math.random().toString(16).slice(2, 8)}`,
    clientId: clientId || null,
    cliente: client?.razaoSocial || 'Sem cliente vinculado',
    cnpj: cnpjTitular,
    tipo: String(formData.get('tipo') || 'A1'),
    apelido: String(formData.get('apelido') || 'Sem apelido'),
    validade,
    diasRestantes: dias,
    status,
    ultimaValidacao: new Date().toISOString(),
    ativo: true,
    anotacoes: String(formData.get('anotacoes') || '').trim()
  };

  if (mode === 'edit' && cert) {
    Object.assign(cert, mockPayload);
  } else {
    state.certificates.unshift(mockPayload);
  }

  if (client) {
    client.certificadoStatus = status === 'Valido' ? 'Valido' : status === 'A vencer' ? 'A vencer' : 'Vencido';
    client.certificadoValidade = validade;
  }

  closeModal();
  pushToast(mode === 'edit' ? 'Certificado atualizado com sucesso (mock).' : 'Certificado cadastrado com sucesso (mock).', 'success');
  render();
}

function persistCertificateFormDraft(form, file) {
  if (!state.modal || state.modal.kind !== 'certificate-form') {
    return;
  }

  const formData = new FormData(form);
  const selectedFile = file instanceof File && file.size > 0 ? file : null;

  state.modal = {
    ...state.modal,
    draft: {
      clientId: String(formData.get('clientId') || ''),
      apelido: String(formData.get('apelido') || ''),
      cnpjTitular: String(formData.get('cnpjTitular') || ''),
      senha: String(formData.get('senha') || ''),
      anotacoes: String(formData.get('anotacoes') || ''),
      file: selectedFile,
      fileName: selectedFile?.name || ''
    }
  };
}

async function createCertificateReplacement(clientId, body, certificateId) {
  return await apiRequest(clientId ? `/clientes/${clientId}/certificados` : '/certificados', {
    method: 'POST',
    body: {
      ...body,
      substituirCertificadoId: certificateId
    }
  });
}

function isMissingCertificatePatchRoute(error) {
  const message = toErrorMessage(error);
  return message.includes('HTTP 404') && message.includes('Cannot PATCH /certificados/');
}

async function submitCertificateNotesForm(form) {
  const formData = new FormData(form);
  const certId = String(formData.get('certId') || '');
  const cert = state.certificates.find((item) => item.id === certId);
  if (!cert) {
    pushToast('Certificado nao encontrado.', 'error');
    return;
  }

  const anotacoes = String(formData.get('anotacoes') || '').trim();

  if (state.dataSource === 'api') {
    try {
      const updated = await apiRequest(`/certificados/${cert.id}/anotacoes${buildCertificateScopeQuery(cert)}`, {
        method: 'PATCH',
        body: {
          anotacoes: anotacoes || undefined
        }
      });
      cert.anotacoes = updated?.anotacoes || '';
      closeModal();
      pushToast('Anotacoes salvas.', 'success');
      await refreshApiData();
    } catch (error) {
      pushToast(`Falha ao salvar anotacoes: ${toErrorMessage(error)}`, 'error');
    }
    return;
  }

  cert.anotacoes = anotacoes;
  closeModal();
  pushToast('Anotacoes salvas (mock).', 'success');
  render();
}

async function downloadCertificate(certificateId) {
  const cert = state.certificates.find((item) => item.id === certificateId);
  if (!cert) {
    pushToast('Certificado nao encontrado.', 'error');
    return;
  }

  if (state.dataSource === 'api') {
    try {
      const payload = await apiRequest(`/certificados/${cert.id}/download${buildCertificateScopeQuery(cert)}`);
      downloadFromPayload(payload, `certificado-${toSafeFileName(cert.apelido)}.pfx`);
      pushToast(`Download do certificado ${cert.apelido} iniciado.`, 'success');
    } catch (error) {
      pushToast(`Falha ao baixar certificado: ${toErrorMessage(error)}`, 'error');
    }
    return;
  }

  const blob = new Blob(['certificado mock'], { type: 'application/x-pkcs12' });
  triggerBrowserDownload(`certificado-${toSafeFileName(cert.apelido)}.pfx`, blob);
  pushToast(`Download do certificado ${cert.apelido} iniciado (mock).`, 'success');
}

async function revealCertificatePassword(certificateId) {
  const cert = state.certificates.find((item) => item.id === certificateId);
  if (!cert) {
    pushToast('Certificado nao encontrado.', 'error');
    return;
  }

  if (state.dataSource === 'api') {
    try {
      const payload = await apiRequest(`/certificados/${cert.id}/senha${buildCertificateScopeQuery(cert)}`, {
        method: 'POST'
      });
      openModal({
        kind: 'certificate-password',
        certId: cert.id,
        certName: cert.apelido,
        clientName: cert.cliente,
        senha: String(payload?.senha || '')
      });
    } catch (error) {
      pushToast(`Falha ao consultar senha do certificado: ${toErrorMessage(error)}`, 'error');
    }
    return;
  }

  openModal({
    kind: 'certificate-password',
    certId: cert.id,
    certName: cert.apelido,
    clientName: cert.cliente,
    senha: 'senha-mock'
  });
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

function applyNfeSyncFilters(form) {
  const data = new FormData(form);
  state.filters.nfeSync = {
    cliente: String(data.get('cliente') || 'Todos'),
    status: String(data.get('status') || 'Todos'),
    ambiente: String(data.get('ambiente') || 'Todos')
  };
  state.tableState.nfeSync = 'data';
  render();
}

function getFilteredNfeSyncControls() {
  const { cliente, status, ambiente } = state.filters.nfeSync;
  const enabledClientIds = new Set(getNfeEligibleClients().map((client) => client.id));

  return state.nfeSyncControls.filter((control) => {
    if (!enabledClientIds.has(control.clientId)) {
      return false;
    }

    const matchesClient = cliente === 'Todos' || control.clientId === cliente;
    const matchesStatus = status === 'Todos' || control.status === status;
    const matchesAmbiente = ambiente === 'Todos' || control.ambiente === ambiente;
    return matchesClient && matchesStatus && matchesAmbiente;
  });
}

function getNfeSyncStats() {
  const enabledClientIds = new Set(getNfeEligibleClients().map((client) => client.id));

  return state.nfeSyncControls.reduce(
    (acc, control) => {
      if (!enabledClientIds.has(control.clientId)) {
        return acc;
      }

      if (control.status === 'ativo') {
        acc.ativos += 1;
      } else if (control.status === 'pausado') {
        acc.pausados += 1;
      } else if (String(control.status || '').startsWith('erro')) {
        acc.erros += 1;
      }
      return acc;
    },
    { ativos: 0, pausados: 0, erros: 0 }
  );
}

function getNfeEligibleClients() {
  return state.clients.filter((client) => client.buscaNfeAtiva !== false);
}

function getNfeDashboardStats() {
  return {
    totalNfe: Number(state.nfeDashboardStats?.totalNfe || state.nfeDocuments.length || 0),
    xmlsCompletos: Number(
      state.nfeDashboardStats?.xmlsCompletos ||
        state.nfeDocuments.filter((doc) => doc.xmlCompletoDisponivel).length ||
        0
    )
  };
}

function getCteDashboardStats() {
  return {
    totalCte: Number(state.cteDashboardStats?.totalCte || state.cteDocuments.length || 0),
    xmlsCompletos: Number(
      state.cteDashboardStats?.xmlsCompletos ||
        state.cteDocuments.filter((doc) => doc.xmlCompletoDisponivel).length ||
        0
    )
  };
}

function getNfeSyncClientRows(controls = state.nfeSyncControls, clients = getNfeEligibleClients()) {
  return clients.map((client) => {
    const rows = (Array.isArray(controls) ? controls : []).filter((control) => control.clientId === client.id);
    const activeCount = rows.filter((control) => control.status === 'ativo').length;
    const pausedCount = rows.filter((control) => control.status === 'pausado').length;
    const errorCount = rows.filter((control) => String(control.status || '').startsWith('erro')).length;
    const latestControl = [...rows].sort((a, b) => Date.parse(b.ultimaExecucao || 0) - Date.parse(a.ultimaExecucao || 0))[0] || null;
    const totalDocuments = rows.reduce((sum, control) => sum + Number(control.totalDocumentosBaixados || 0), 0);
    let statusLabel = 'Nao inicializada';
    let statusTone = 'neutral';
    let statusDetail = 'Nenhum controle de NF-e criado ainda.';

    if (errorCount > 0) {
      statusLabel = 'Com erro';
      statusTone = 'danger';
      statusDetail = `${errorCount} controle(s) com erro.`;
    } else if (activeCount > 0) {
      statusLabel = 'Ligada';
      statusTone = 'success';
      statusDetail = `${activeCount} controle(s) ativo(s).`;
    } else if (pausedCount > 0) {
      statusLabel = 'Pausada';
      statusTone = 'neutral';
      statusDetail = `${pausedCount} controle(s) pausado(s).`;
    }

    return {
      clientId: client.id,
      cliente: client.razaoSocial,
      cnpj: client.cnpj,
      totalControles: rows.length,
      ultimaExecucao: latestControl?.ultimaExecucao || null,
      ultimoNsuConsultado: latestControl?.ultimoNsuConsultado || '-',
      totalDocumentosBaixados: totalDocuments,
      statusLabel,
      statusTone,
      statusDetail
    };
  });
}

function getClientEstablishmentSummary(clientId) {
  const establishments = Array.isArray(state.establishmentsByClient?.[clientId]) ? state.establishmentsByClient[clientId] : [];
  const activeRows = establishments.filter((item) => item?.ativo);
  const primary = activeRows[0] || establishments[0] || null;

  if (!primary) {
    return {
      total: 0,
      activeCount: 0,
      statusLabel: 'Sem cadastro',
      statusTone: 'danger',
      detail: 'Nenhum estabelecimento vinculado'
    };
  }

  const primaryLabel = primary.razaoSocial || formatCnpj(primary.cnpj) || primary.municipioNome || 'Estabelecimento principal';

  if (!activeRows.length) {
    return {
      total: establishments.length,
      activeCount: 0,
      statusLabel: 'Sem ativo',
      statusTone: 'neutral',
      detail: `${primaryLabel} - ${establishments.length} cadastrado(s)`
    };
  }

  return {
    total: establishments.length,
    activeCount: activeRows.length,
    statusLabel: activeRows.length === 1 ? '1 ativo' : `${activeRows.length} ativos`,
    statusTone: 'success',
    detail: `${primaryLabel} - ${establishments.length} cadastrado(s)`
  };
}

function getClientNfeBaseSummary(clientId, controls = state.nfeSyncControls) {
  const sourceMode = getNfeSourceMode();
  const client = findClientById(clientId);
  const rows = (Array.isArray(controls) ? controls : []).filter((control) => control.clientId === clientId);

  if (!rows.length) {
    return {
      displayValue: 'Nao inicializado',
      detail:
        client?.buscaNfeAtiva === false
          ? 'Busca de NF-e desabilitada para este cliente'
          : sourceMode === 'dominio'
            ? 'Ative a importacao para iniciar a leitura incremental do banco da Dominio'
            : 'Ative a busca para capturar o NSU atual',
      controlsLabel: 'Nenhum controle criado'
    };
  }

  const nsuValues = rows
    .map((control) => String(control.ultimoNsuConsultado ?? '').trim())
    .filter((value) => value && value !== '-');
  const distinctNsuValues = [...new Set(nsuValues)];
  const latestControl =
    [...rows].sort((a, b) => {
      const dateDiff = Date.parse(b.ultimaExecucao || 0) - Date.parse(a.ultimaExecucao || 0);
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return String(b.id || '').localeCompare(String(a.id || ''));
    })[0] || rows[0];
  const displayValue =
    distinctNsuValues.length === 1
      ? formatInteger(distinctNsuValues[0])
      : formatInteger(latestControl?.ultimoNsuConsultado || distinctNsuValues[0] || '0');
  const detail =
    sourceMode === 'dominio'
      ? `${rows.length} controle(s) com cursores independentes por estabelecimento`
      : distinctNsuValues.length > 1
        ? `${rows.length} controle(s) com NSUs independentes`
        : `${rows.length} controle(s) configurado(s) para NF-e`;

  return {
    displayValue,
    detail,
    controlsLabel: `${rows.length} controle(s)`
  };
}

async function enableNfeSearchForAllClients() {
  try {
    const result = await apiRequest('/nfe/sync/ativar-todos', {
      method: 'POST',
      body: {}
    });
    const failureDetails = extractNfeActivationFailureMessages(result?.detalhes);
    pushToast(
      `${getNfeSourceMode() === 'dominio' ? 'Importacao NF-e ligada' : 'NF-e ligada'} para ${Number(result?.clientesComSucesso || 0)} cliente(s). Controles preparados: ${Number(result?.controlesCriadosOuReativados || 0)}.${
        failureDetails ? ` ${failureDetails}` : ''
      }`,
      Number(result?.falhas || 0) > 0 ? 'error' : 'success'
    );
    await refreshApiData();
  } catch (error) {
    pushToast(`Falha ao ligar busca de NF-e em lote: ${toErrorMessage(error)}`, 'error');
  }
}

async function enableNfeSearchForClient(clientId) {
  try {
    const result = await apiRequest('/nfe/sync/ativar', {
      method: 'POST',
      body: {
        clienteId: clientId
      }
    });
    const failureDetails = extractNfeActivationFailureMessages(result?.detalhes);
    pushToast(
      `${getNfeSourceMode() === 'dominio' ? 'Importacao NF-e ligada' : 'NF-e ligada'} para o cliente: ${Number(result?.controlesCriadosOuReativados || 0)} controle(s) preparado(s).${
        failureDetails ? ` ${failureDetails}` : ''
      }`,
      Number(result?.falhas || 0) > 0 ? 'error' : 'success'
    );
    await refreshApiData();
  } catch (error) {
    pushToast(`Falha ao ligar busca de NF-e: ${toErrorMessage(error)}`, 'error');
  }
}

function extractNfeActivationFailureMessages(details) {
  const rows = Array.isArray(details) ? details : [];
  const messages = rows
    .filter((item) => item?.status === 'falha' && item?.mensagem)
    .map((item) => String(item.mensagem).trim())
    .filter(Boolean);

  if (!messages.length) {
    return '';
  }

  const uniqueMessages = [...new Set(messages)];
  const preview = uniqueMessages.slice(0, 2).join(' | ');
  return `Motivo: ${preview}${uniqueMessages.length > 2 ? ' | ...' : ''}`;
}

async function disableNfeSearchForAllClients() {
  const clientIds = [...new Set(state.nfeSyncControls.map((control) => control.clientId).filter(Boolean))];
  if (!clientIds.length) {
    pushToast('Nao ha controles de NF-e ativos para pausar.', 'info');
    return;
  }

  let success = 0;
  let failure = 0;
  for (const clientId of clientIds) {
    try {
      await apiRequest('/nfe/sync/pausar', {
        method: 'POST',
        body: {
          clienteId: clientId
        }
      });
      success += 1;
    } catch {
      failure += 1;
    }
  }

  await refreshApiData();
  pushToast(
    `Busca de NF-e pausada para ${success} cliente(s)${failure ? `, com ${failure} falha(s)` : ''}.`,
    failure ? 'error' : 'success'
  );
}

async function runNfeSearchNow() {
  try {
    pushToast(
      `${getNfeSourceMode() === 'dominio' ? 'Importacao' : 'Busca'} de NF-e iniciada para todos os controles ativos. Aguarde a conclusao.`,
      'info'
    );
    const result = await apiRequest('/nfe/sync/rodar-agora-geral', {
      method: 'POST'
    });
    state.nfeLastRunReport = buildNfeRunReport(result);
    pushToast(
      buildNfeRunToastMessage(
        getNfeSourceMode() === 'dominio' ? 'Importacao de NF-e executada' : 'Busca de NF-e executada',
        result
      ),
      Number(result?.failures || 0) > 0 ? 'error' : 'success'
    );
    await refreshApiData();
  } catch (error) {
    pushToast(`Falha ao executar busca de NF-e: ${toErrorMessage(error)}`, 'error');
  }
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

async function runNfeSyncNow(payload) {
  try {
    const client = payload?.clienteId ? findClientById(payload.clienteId) : null;
    pushToast(
      `${
        getNfeSourceMode() === 'dominio' ? 'Importacao' : 'Busca'
      } de NF-e iniciada${client ? ` para ${client.razaoSocial}` : ''}. Aguarde a conclusao da operacao.`,
      'info'
    );
    const response = await apiRequest('/nfe/sync/rodar-agora', {
      method: 'POST',
      body: payload
    });
    state.nfeLastRunReport = buildNfeRunReport(response);
    pushToast(
      buildNfeRunToastMessage(
        getNfeSourceMode() === 'dominio' ? 'Importacao NF-e executada' : 'Sincronizacao NF-e executada',
        response
      ),
      Number(response?.failures || 0) > 0 ? 'error' : 'success'
    );
    await refreshApiData();
  } catch (error) {
    pushToast(`Falha ao executar sincronizacao NF-e: ${toErrorMessage(error)}`, 'error');
  }
}

function buildNfeRunReport(response) {
  return {
    executedAt: new Date().toISOString(),
    processed: Number(response?.processed || 0),
    documentsSaved: Number(response?.documentsSaved || 0),
    failures: Number(response?.failures || 0),
    executionDetails: Array.isArray(response?.executionDetails) ? response.executionDetails : [],
    failureDetails: Array.isArray(response?.failureDetails) ? response.failureDetails : []
  };
}

function buildNfeRunToastMessage(prefix, response) {
  const failures = Number(response?.failures || 0);
  return `${prefix}: ${Number(response?.processed || 0)} controle(s), ${Number(response?.documentsSaved || 0)} documento(s) salvo(s).${
    failures ? ` ${failures} falha(s) registrada(s) no painel.` : ''
  }`;
}

function mapNfeRunItemStatusLabel(status) {
  switch (status) {
    case 'persistido':
      return 'Importado';
    case 'ignorado_sem_vinculo':
      return 'Sem vinculo';
    case 'ignorado_xml_nao_fiscal':
      return 'Ignorado';
    case 'falha':
      return 'Falha';
    default:
      return status || '-';
  }
}

function toneFromNfeRunItemStatus(status) {
  switch (status) {
    case 'persistido':
      return 'success';
    case 'ignorado_sem_vinculo':
      return 'warning';
    case 'ignorado_xml_nao_fiscal':
      return 'neutral';
    case 'falha':
      return 'danger';
    default:
      return 'neutral';
  }
}

async function openDominioNfeXmlViewer(clientId, catalogoId) {
  try {
    const payload = await apiRequest('/nfe/dominio/xml', {
      method: 'POST',
      body: {
        clienteId: clientId,
        catalogoId
      }
    });
    openModal({
      kind: 'dominio-nfe-view',
      payload
    });
  } catch (error) {
    pushToast(`Falha ao carregar XML do catalogo ${catalogoId}: ${toErrorMessage(error)}`, 'error');
  }
}

async function downloadDominioNfeModalXml() {
  if (state.modal?.kind !== 'dominio-nfe-view' || !state.modal.payload?.xml) {
    return;
  }

  const payload = state.modal.payload;
  const blob = new Blob([payload.xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = payload.fileName || `DOMINIO-NFE-${payload.catalogoId || 'xml'}.xml`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  pushToast(`Download do XML do catalogo ${payload.catalogoId || '-'} iniciado.`, 'success');
}

function getLastRunDocumentItems() {
  const report = state.nfeLastRunReport;
  const rows = Array.isArray(report?.executionDetails)
    ? report.executionDetails
    : Array.isArray(report?.failureDetails)
      ? report.failureDetails
      : [];

  return rows.filter(
    (row) => row?.kind === 'documento' && Number(row.catalogoId) > 0 && row.status !== 'ignorado_xml_nao_fiscal'
  );
}

async function importAllDominioNfeLastRunItems() {
  const items = getLastRunDocumentItems().map((row) => ({
    clientId: row.clientId,
    catalogoId: Number(row.catalogoId)
  }));

  if (!items.length) {
    pushToast('Nao ha itens do catalogo disponiveis para importar nesta execucao.', 'info');
    return;
  }

  await importDominioNfeLastRunItems(items);
}

async function importDominioNfeLastRunItems(items) {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      clientId: String(item?.clientId || ''),
      catalogoId: Number(item?.catalogoId || 0)
    }))
    .filter((item) => item.clientId && Number.isInteger(item.catalogoId) && item.catalogoId > 0);

  if (!normalizedItems.length) {
    pushToast('Nenhum item valido foi informado para importacao.', 'error');
    return;
  }

  const grouped = normalizedItems.reduce((acc, item) => {
    if (!acc[item.clientId]) {
      acc[item.clientId] = [];
    }
    acc[item.clientId].push(item.catalogoId);
    return acc;
  }, {});

  let imported = 0;
  let failures = 0;

  for (const [clientId, catalogoIds] of Object.entries(grouped)) {
    try {
      const uniqueCatalogoIds = [...new Set(catalogoIds)];
      const response = await apiRequest('/nfe/importar-dominio', {
        method: 'POST',
        body: {
          clienteId: clientId,
          catalogoIds: uniqueCatalogoIds,
          limit: uniqueCatalogoIds.length
        }
      });
      imported += Number(response?.xmlsPersistidos || 0);
      failures += Number(response?.falhas || 0);
      mergeDominioImportResultIntoLastRunReport(clientId, response);
    } catch (error) {
      failures += catalogoIds.length;
      pushToast(`Falha ao importar catalogos do cliente: ${toErrorMessage(error)}`, 'error');
    }
  }

  pushToast(
    `Reimportacao concluida: ${imported} XML(s) importado(s)${failures ? `, ${failures} falha(s)` : ''}.`,
    failures ? 'error' : 'success'
  );
  await refreshApiData();
}

function mergeDominioImportResultIntoLastRunReport(clientId, response) {
  if (!state.nfeLastRunReport || !Array.isArray(state.nfeLastRunReport.executionDetails)) {
    return;
  }

  const details = Array.isArray(response?.detalhes) ? response.detalhes : [];
  if (!details.length) {
    return;
  }

  const byCatalogoId = new Map(
    details.map((detail) => [
      Number(detail?.catalogoId || 0),
      {
        status: detail?.status || 'falha',
        mensagem: detail?.mensagem || '',
        chaveAcesso: detail?.chaveAcesso || '',
        numeroNfe: detail?.numeroNfe || '',
        serie: detail?.serie || '',
        modelo: detail?.modelo || ''
      }
    ])
  );

  state.nfeLastRunReport.executionDetails = state.nfeLastRunReport.executionDetails.map((row) => {
    if (row.clientId !== clientId || row.kind !== 'documento') {
      return row;
    }
    const updated = byCatalogoId.get(Number(row.catalogoId || 0));
    if (!updated) {
      return row;
    }
    return {
      ...row,
      status: updated.status,
      mensagem: updated.mensagem,
      chaveAcesso: updated.chaveAcesso || row.chaveAcesso,
      numeroNfe: updated.numeroNfe || row.numeroNfe,
      serie: updated.serie || row.serie,
      modelo: updated.modelo || row.modelo
    };
  });

  state.nfeLastRunReport.failureDetails = state.nfeLastRunReport.executionDetails.filter((row) => row.status === 'falha');
  state.nfeLastRunReport.failures = state.nfeLastRunReport.failureDetails.length;
  render();
}

async function pauseNfeSync(payload) {
  try {
    const response = await apiRequest('/nfe/sync/pausar', {
      method: 'POST',
      body: payload
    });
    pushToast(`${response?.total || 0} controle(s) de NF-e pausado(s).`, 'success');
    await refreshApiData();
  } catch (error) {
    pushToast(`Falha ao pausar busca de NF-e: ${toErrorMessage(error)}`, 'error');
  }
}

async function applyNfeDocsFilters(form) {
  const data = new FormData(form);
  state.filters.nfeDocs = {
    cliente: String(data.get('cliente') || ''),
    tipo: String(data.get('tipo') || 'Todos'),
    cnpj: normalizeDigits(String(data.get('cnpj') || '')),
    numero: String(data.get('numero') || '').trim(),
    chave: normalizeDigits(String(data.get('chave') || '')),
    emissaoInicio: String(data.get('emissaoInicio') || ''),
    emissaoFim: String(data.get('emissaoFim') || ''),
    status: String(data.get('status') || 'Todos'),
    schemaDoc: String(data.get('schemaDoc') || 'Todos'),
    valorMin: String(data.get('valorMin') || '').trim(),
    valorMax: String(data.get('valorMax') || '').trim(),
    xmlCompleto: String(data.get('xmlCompleto') || 'Todos'),
    ambiente: String(data.get('ambiente') || 'Todos')
  };

  await executeNfeDocsSearch();
}

async function applyCteDocsFilters(form) {
  const data = new FormData(form);
  state.filters.cteDocs = {
    cliente: String(data.get('cliente') || ''),
    tipo: String(data.get('tipo') || 'Todos'),
    cnpj: normalizeDigits(String(data.get('cnpj') || '')),
    numero: String(data.get('numero') || '').trim(),
    chave: normalizeDigits(String(data.get('chave') || '')),
    emissaoInicio: String(data.get('emissaoInicio') || ''),
    emissaoFim: String(data.get('emissaoFim') || ''),
    status: String(data.get('status') || 'Todos'),
    schemaDoc: String(data.get('schemaDoc') || 'Todos'),
    valorMin: String(data.get('valorMin') || '').trim(),
    valorMax: String(data.get('valorMax') || '').trim(),
    xmlCompleto: String(data.get('xmlCompleto') || 'Todos'),
    ambiente: String(data.get('ambiente') || 'Todos')
  };

  await executeCteDocsSearch();
}

async function openNfeDocumentsForClient(clientId) {
  if (!findClientById(clientId)) {
    pushToast('Cliente nao encontrado para abrir os XMLs de NF-e.', 'error');
    return;
  }

  resetNfeDocsSearch();
  state.filters.nfeDocs.cliente = clientId;
  navigate('/xmls-nfe');
  render();
  await executeNfeDocsSearch();
}

async function runNfeSyncForCurrentDocumentsClient() {
  const clientId = state.filters.nfeDocs.cliente && state.filters.nfeDocs.cliente !== 'Todos' ? state.filters.nfeDocs.cliente : '';
  if (!clientId) {
    pushToast('Selecione uma empresa para rodar a busca de NF-e.', 'error');
    return;
  }

  await runNfeSyncNow({ clienteId: clientId });
}

async function recoverPastNsusForCurrentXmlClient() {
  const clientId = state.filters.xmls.cliente && state.filters.xmls.cliente !== 'Todos' ? state.filters.xmls.cliente : '';
  if (!clientId) {
    pushToast('Selecione uma empresa para reprocessar os NSUs.', 'error');
    return;
  }

  await runPastNsuRecovery(clientId);
}

async function runPastNsuRecovery(clientId = null) {
  const selectedClient = clientId ? findClientById(clientId) : null;

  if (clientId && !selectedClient) {
    pushToast('Cliente nao encontrado para reprocessamento de NSUs.', 'error');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast(
      `Recuperacao de NSUs iniciada para ${selectedClient?.razaoSocial || 'todos os clientes'}. Aguarde a conclusao da operacao.`,
      'info'
    );
    startExecutionMonitor('Recuperacao', selectedClient ? 1 : state.clients.length || 1, 'Recuperando NSUs passados (mock)...');
    state.executionMonitor.currentClientName = selectedClient?.razaoSocial || 'Todos os clientes';
    finishExecutionMonitor('Recuperacao mock finalizada.');
    pushToast('Recuperacao de NSUs passados iniciada (mock).', 'success');
    return;
  }

  try {
    pushToast(
      `Recuperacao de NSUs iniciada para ${selectedClient?.razaoSocial || 'todos os clientes'}. Esta operacao pode demorar.`,
      'info'
    );
    startExecutionMonitor(
      'Recuperacao',
      selectedClient ? 1 : state.clients.length || 1,
      'Reprocessando NSUs ja consultados. Notas existentes serao ignoradas...'
    );
    state.executionMonitor.currentClientName = selectedClient?.razaoSocial || 'Todos os controles';
    state.executionMonitor.updatedAt = new Date().toISOString();
    render();

    const result = await apiRequest('/sync/reprocessar-nsus-passados', {
      method: 'POST',
      body: clientId ? { clienteId: clientId } : {},
      timeoutMs: 10 * 60 * 1000
    });

    state.executionMonitor.total = Number(result?.controlesEncontrados || state.executionMonitor.total || 0);
    state.executionMonitor.processed = Number(result?.controlesProcessados || 0);
    state.executionMonitor.successful = Number(result?.documentosSalvos || 0);
    state.executionMonitor.failed = Number(result?.falhas || 0);
    state.executionMonitor.message = 'Recuperacao concluida. Atualizando painel...';
    state.executionMonitor.updatedAt = new Date().toISOString();
    render();

    await refreshApiData();
    finishExecutionMonitor(
      `Recuperacao finalizada. NSUs consultados: ${Number(result?.nsusConsultados || 0)}. XMLs salvos: ${Number(result?.documentosSalvos || 0)}. Ja existentes: ${Number(result?.nsusIgnoradosComDocumento || 0) + Number(result?.documentosIgnoradosExistentes || 0)}.`
    );
    pushToast(
      `Recuperacao concluida: ${Number(result?.documentosSalvos || 0)} XML(s) salvo(s), ${Number(result?.nsusConsultados || 0)} NSU(s) consultado(s).`,
      Number(result?.falhas || 0) > 0 ? 'error' : 'success'
    );
  } catch (error) {
    state.executionMonitor.failed += 1;
    finishExecutionMonitor('Recuperacao de NSUs finalizada com falha.');
    pushToast(`Falha ao recuperar NSUs passados: ${toErrorMessage(error)}`, 'error');
  }
}

async function executeNfeDocsSearch() {
  if (!state.filters.nfeDocs.cliente) {
    resetNfeDocsSearch();
    pushToast('Selecione uma empresa para buscar NF-e.', 'error');
    render();
    return;
  }

  if (
    state.filters.nfeDocs.emissaoInicio &&
    state.filters.nfeDocs.emissaoFim &&
    Date.parse(state.filters.nfeDocs.emissaoInicio) > Date.parse(state.filters.nfeDocs.emissaoFim)
  ) {
    resetNfeDocsSearch();
    pushToast('A data inicial nao pode ser maior que a data final.', 'error');
    render();
    return;
  }

  state.nfeSearch.hasSearched = true;
  state.nfeSearch.results = [];
  state.nfeSearch.lastQuery = { ...state.filters.nfeDocs };
  state.nfeSearch.page = 1;
  state.tableState.nfeDocs = 'loading';
  render();

  try {
    const query = buildNfeSearchQuery(state.filters.nfeDocs, 1, SEARCH_PAGE_SIZE, true);
    const payload = normalizePaginatedResponse(await apiRequest(`/nfe?${query.toString()}`));
    const mapped = buildNfeDocumentsFromApi(payload.items, state.clients);
    state.nfeDocuments = mergeNfeDocumentsById(state.nfeDocuments, mapped);
    state.nfeSearch.results = getFilteredNfeDocumentsFromSource(mapped);
    state.nfeSearch.lastSearchedAt = new Date().toISOString();
    state.nfeSearch.total = payload.total;
    state.nfeSearch.totalPages = payload.totalPages;
    state.nfeSearch.page = 1;
    state.nfeSearch.pageSize = payload.pageSize;
    state.tableState.nfeDocs = 'data';
    reportIfListingCapped('NF-e', payload);
  } catch (error) {
    state.nfeSearch.results = [];
    state.nfeSearch.total = 0;
    state.nfeSearch.totalPages = 0;
    state.tableState.nfeDocs = 'error';
    pushToast(`Falha ao buscar NF-e: ${toErrorMessage(error)}`, 'error');
  }

  render();
}

async function executeCteDocsSearch() {
  if (!state.filters.cteDocs.cliente) {
    resetCteDocsSearch();
    pushToast('Selecione uma empresa para buscar CT-e.', 'error');
    render();
    return;
  }

  if (
    state.filters.cteDocs.emissaoInicio &&
    state.filters.cteDocs.emissaoFim &&
    Date.parse(state.filters.cteDocs.emissaoInicio) > Date.parse(state.filters.cteDocs.emissaoFim)
  ) {
    resetCteDocsSearch();
    pushToast('A data inicial nao pode ser maior que a data final.', 'error');
    render();
    return;
  }

  state.cteSearch.hasSearched = true;
  state.cteSearch.results = [];
  state.cteSearch.lastQuery = { ...state.filters.cteDocs };
  state.cteSearch.page = 1;
  state.tableState.cteDocs = 'loading';
  render();

  try {
    const query = buildCteSearchQuery(state.filters.cteDocs, 1, SEARCH_PAGE_SIZE, true);
    const payload = normalizePaginatedResponse(await apiRequest(`/cte?${query.toString()}`));
    const mapped = buildCteDocumentsFromApi(payload.items, state.clients);
    state.cteDocuments = mergeCteDocumentsById(state.cteDocuments, mapped);
    state.cteSearch.results = getFilteredCteDocumentsFromSource(mapped);
    state.cteSearch.lastSearchedAt = new Date().toISOString();
    state.cteSearch.total = payload.total;
    state.cteSearch.totalPages = payload.totalPages;
    state.cteSearch.page = 1;
    state.cteSearch.pageSize = payload.pageSize;
    state.tableState.cteDocs = 'data';
    reportIfListingCapped('CT-e', payload);
  } catch (error) {
    state.cteSearch.results = [];
    state.cteSearch.total = 0;
    state.cteSearch.totalPages = 0;
    state.tableState.cteDocs = 'error';
    pushToast(`Falha ao buscar CT-e: ${toErrorMessage(error)}`, 'error');
  }

  render();
}

async function applyXmlFilters(form) {
  const data = new FormData(form);
  state.selectedXmlIds = new Set();
  state.filters.xmls = {
    cliente: String(data.get('cliente') || ''),
    cnpj: normalizeDigits(String(data.get('cnpj') || '')),
    numero: String(data.get('numero') || '').trim(),
    emissaoInicio: String(data.get('emissaoInicio') || ''),
    emissaoFim: String(data.get('emissaoFim') || ''),
    downloadInicio: String(data.get('downloadInicio') || ''),
    downloadFim: String(data.get('downloadFim') || ''),
    municipio: String(data.get('municipio') || 'Todos'),
    tipo: String(data.get('tipo') || 'Todos'),
    status: String(data.get('status') || 'Todos')
  };

  if (!state.filters.xmls.cliente) {
    state.xmlSearch.hasSearched = false;
    state.xmlSearch.results = [];
    state.xmlSearch.lastQuery = null;
    state.xmlSearch.total = 0;
    state.xmlSearch.totalPages = 0;
    state.xmlSearch.page = 1;
    state.tableState.xmls = 'data';
    pushToast('Selecione uma empresa para buscar XMLs.', 'error');
    render();
    return;
  }

  if (
    state.filters.xmls.emissaoInicio &&
    state.filters.xmls.emissaoFim &&
    Date.parse(state.filters.xmls.emissaoInicio) > Date.parse(state.filters.xmls.emissaoFim)
  ) {
    state.xmlSearch.hasSearched = false;
    state.xmlSearch.results = [];
    state.xmlSearch.lastQuery = null;
    state.xmlSearch.total = 0;
    state.xmlSearch.totalPages = 0;
    state.xmlSearch.page = 1;
    state.tableState.xmls = 'data';
    pushToast('A data inicial nao pode ser maior que a data final.', 'error');
    render();
    return;
  }

  state.xmlSearch.hasSearched = true;
  state.xmlSearch.results = [];
  state.xmlSearch.lastQuery = { ...state.filters.xmls };
  state.xmlSearch.page = 1;
  state.xmlSearch.pageSize = SEARCH_PAGE_SIZE;
  state.tableState.xmls = 'loading';
  render();

  if (state.dataSource !== 'api') {
    state.xmlSearch.results = getFilteredXmlsFromSource(state.xmlFiles);
    state.xmlSearch.lastSearchedAt = new Date().toISOString();
    state.xmlSearch.total = state.xmlSearch.results.length;
    state.xmlSearch.totalPages = state.xmlSearch.results.length ? 1 : 0;
    state.tableState.xmls = 'data';
    render();
    return;
  }

  await executeXmlSearch();
}

function buildXmlSearchQuery(filters, page = 1, pageSize = SEARCH_PAGE_SIZE, all = false) {
  const query = new URLSearchParams();
  query.set('clienteId', filters.cliente);
  if (all) {
    query.set('all', 'true');
  } else {
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
  }

  if (filters.emissaoInicio) {
    query.set('dataInicio', `${filters.emissaoInicio}T00:00:00.000Z`);
  }

  if (filters.emissaoFim) {
    query.set('dataFim', `${filters.emissaoFim}T23:59:59.999Z`);
  }

  const client = findClientById(filters.cliente);
  if (client?.cnpj && filters.tipo !== 'Todos') {
    query.set('cnpjConsulta', normalizeDigits(client.cnpj));
    query.set('tipoRelacao', filters.tipo === 'Emitida' ? 'emitidas' : 'tomadas');
  }

  if (filters.cnpj) {
    query.set('cnpj', filters.cnpj);
  }

  if (filters.numero) {
    query.set('numeroNfse', filters.numero);
  }

  if (filters.municipio !== 'Todos') {
    query.set('municipio', filters.municipio);
  }

  if (filters.downloadInicio) {
    query.set('downloadInicio', `${filters.downloadInicio}T00:00:00.000Z`);
  }

  if (filters.downloadFim) {
    query.set('downloadFim', `${filters.downloadFim}T23:59:59.999Z`);
  }

  if (filters.status !== 'Todos') {
    query.set('statusArmazenamento', filters.status);
  }

  return query;
}

function buildNfeSearchQuery(filters, page = 1, pageSize = SEARCH_PAGE_SIZE, all = false) {
  const query = new URLSearchParams();
  query.set('clienteId', filters.cliente);
  if (all) {
    query.set('all', 'true');
  } else {
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
  }

  if (filters.emissaoInicio) {
    query.set('dataInicio', `${filters.emissaoInicio}T00:00:00.000Z`);
  }

  if (filters.emissaoFim) {
    query.set('dataFim', `${filters.emissaoFim}T23:59:59.999Z`);
  }

  const client = findClientById(filters.cliente);
  if (client?.cnpj) {
    query.set('cnpjConsulta', normalizeDigits(client.cnpj));
    if (filters.tipo === 'Emitida') {
      query.set('tipoRelacao', 'emitidas');
    } else if (filters.tipo === 'Recebida') {
      query.set('tipoRelacao', 'recebidas');
    }
  }

  if (filters.status !== 'Todos') {
    query.set('status', filters.status);
  }

  if (filters.cnpj) {
    query.set('cnpj', filters.cnpj);
  }

  if (filters.schemaDoc !== 'Todos') {
    query.set('schemaDoc', filters.schemaDoc);
  }

  if (filters.numero) {
    query.set('numeroNfe', filters.numero);
  }

  if (filters.chave) {
    query.set('chaveAcesso', filters.chave);
  }

  if (filters.ambiente !== 'Todos') {
    query.set('ambiente', filters.ambiente);
  }

  if (filters.valorMin) {
    query.set('valorMin', filters.valorMin);
  }

  if (filters.valorMax) {
    query.set('valorMax', filters.valorMax);
  }

  if (filters.xmlCompleto === 'Somente completos') {
    query.set('somenteXmlCompleto', 'true');
  }

  if (filters.xmlCompleto === 'Somente resumos') {
    query.set('somenteResumos', 'true');
  }

  return query;
}

function buildCteSearchQuery(filters, page = 1, pageSize = SEARCH_PAGE_SIZE, all = false) {
  const query = new URLSearchParams();
  query.set('clienteId', filters.cliente);
  if (all) {
    query.set('all', 'true');
  } else {
    query.set('page', String(page));
    query.set('pageSize', String(pageSize));
  }

  if (filters.emissaoInicio) {
    query.set('dataInicio', `${filters.emissaoInicio}T00:00:00.000Z`);
  }

  if (filters.emissaoFim) {
    query.set('dataFim', `${filters.emissaoFim}T23:59:59.999Z`);
  }

  const client = findClientById(filters.cliente);
  if (client?.cnpj) {
    query.set('cnpjConsulta', normalizeDigits(client.cnpj));
    if (filters.tipo === 'Emitido') {
      query.set('tipoRelacao', 'emitidos');
    } else if (filters.tipo === 'Recebido') {
      query.set('tipoRelacao', 'recebidos');
    }
  }

  if (filters.status !== 'Todos') {
    query.set('status', filters.status);
  }

  if (filters.cnpj) {
    query.set('cnpj', filters.cnpj);
  }

  if (filters.schemaDoc !== 'Todos') {
    query.set('schemaDoc', filters.schemaDoc);
  }

  if (filters.numero) {
    query.set('numeroCte', filters.numero);
  }

  if (filters.chave) {
    query.set('chaveAcesso', filters.chave);
  }

  if (filters.ambiente !== 'Todos') {
    query.set('ambiente', filters.ambiente);
  }

  if (filters.valorMin) {
    query.set('valorMin', filters.valorMin);
  }

  if (filters.valorMax) {
    query.set('valorMax', filters.valorMax);
  }

  if (filters.xmlCompleto === 'Somente completos') {
    query.set('somenteXmlCompleto', 'true');
  }

  if (filters.xmlCompleto === 'Somente resumos') {
    query.set('somenteResumos', 'true');
  }

  return query;
}

function mergeXmlFilesById(existing, incoming) {
  const byId = new Map();
  [...existing, ...incoming].forEach((xml) => {
    if (xml?.id) {
      byId.set(xml.id, xml);
    }
  });
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.dataDownload || 0) - Date.parse(a.dataDownload || 0));
}

function mergeNfeDocumentsById(existing, incoming) {
  const byId = new Map();
  [...existing, ...incoming].forEach((doc) => {
    if (doc?.id) {
      byId.set(doc.id, doc);
    }
  });
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.dataEmissao || 0) - Date.parse(a.dataEmissao || 0));
}

function mergeCteDocumentsById(existing, incoming) {
  const byId = new Map();
  [...existing, ...incoming].forEach((doc) => {
    if (doc?.id) {
      byId.set(doc.id, doc);
    }
  });
  return Array.from(byId.values()).sort((a, b) => Date.parse(b.dataEmissao || 0) - Date.parse(a.dataEmissao || 0));
}

function getFilteredXmls() {
  if (!state.xmlSearch.hasSearched) {
    return [];
  }

  return sortXmls(getFilteredXmlsFromSource(state.xmlSearch.results));
}

function getFilteredXmlsFromSource(source) {
  const filters = state.filters.xmls;
  const xmlSource = Array.isArray(source) ? source : [];

  return xmlSource.filter((xml) => {
    const matchesClient = filters.cliente === 'Todos' || !filters.cliente || xml.clientId === filters.cliente;
    const matchesCnpj = !filters.cnpj || normalizeDigits(xml.cnpj).includes(filters.cnpj);
    const matchesNumero = !filters.numero || String(xml.numeroNfse).includes(filters.numero);
    const matchesMunicipio = filters.municipio === 'Todos' || xml.municipio === filters.municipio;
    const matchesTipo = filters.tipo === 'Todos' || xml.tipo === filters.tipo;
    const matchesStatus = filters.status === 'Todos' || xml.statusArmazenamento === filters.status;

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
      matchesEmissaoInicio &&
      matchesEmissaoFim &&
      matchesDownloadInicio &&
      matchesDownloadFim
    );
  });
}

function getFilteredNfeDocuments() {
  if (!state.nfeSearch.hasSearched) {
    return [];
  }

  return sortNfeDocuments(getFilteredNfeDocumentsFromSource(state.nfeSearch.results));
}

function getFilteredCteDocuments() {
  if (!state.cteSearch.hasSearched) {
    return [];
  }

  return sortCteDocuments(getFilteredCteDocumentsFromSource(state.cteSearch.results));
}

function getFilteredNfeDocumentsFromSource(source) {
  const filters = state.filters.nfeDocs;
  const docsSource = Array.isArray(source) ? source : [];

  return docsSource.filter((doc) => {
    const matchesClient = filters.cliente === 'Todos' || !filters.cliente || doc.clientId === filters.cliente;
    const matchesTipo = filters.tipo === 'Todos' || doc.tipo === filters.tipo;
    const matchesCnpj =
      !filters.cnpj ||
      normalizeDigits(doc.emitenteCnpj || '').includes(filters.cnpj) ||
      normalizeDigits(doc.destinatarioCnpj || '').includes(filters.cnpj) ||
      normalizeDigits(doc.contraparteCnpj || '').includes(filters.cnpj);
    const matchesNumero = !filters.numero || String(doc.numeroNfe || '').includes(filters.numero);
    const matchesChave = !filters.chave || String(doc.chaveAcesso || '').includes(filters.chave);
    const matchesStatus = filters.status === 'Todos' || doc.statusFiscal === filters.status;
    const matchesSchema = filters.schemaDoc === 'Todos' || doc.schemaDoc === filters.schemaDoc;
    const matchesAmbiente = filters.ambiente === 'Todos' || doc.ambiente === filters.ambiente;
    const matchesXmlCompleto =
      filters.xmlCompleto === 'Todos' ||
      (filters.xmlCompleto === 'Somente completos' && doc.xmlCompletoDisponivel) ||
      (filters.xmlCompleto === 'Somente resumos' && !doc.xmlCompletoDisponivel);

    const emissaoDate = Date.parse(doc.dataEmissao);
    const matchesEmissaoInicio = !filters.emissaoInicio || emissaoDate >= Date.parse(`${filters.emissaoInicio}T00:00:00`);
    const matchesEmissaoFim = !filters.emissaoFim || emissaoDate <= Date.parse(`${filters.emissaoFim}T23:59:59`);

    return (
      matchesClient &&
      matchesTipo &&
      matchesCnpj &&
      matchesNumero &&
      matchesChave &&
      matchesStatus &&
      matchesSchema &&
      matchesAmbiente &&
      matchesXmlCompleto &&
      matchesEmissaoInicio &&
      matchesEmissaoFim
    );
  });
}

function getFilteredCteDocumentsFromSource(source) {
  const filters = state.filters.cteDocs;
  const docsSource = Array.isArray(source) ? source : [];

  return docsSource.filter((doc) => {
    const matchesClient = filters.cliente === 'Todos' || !filters.cliente || doc.clientId === filters.cliente;
    const matchesTipo = filters.tipo === 'Todos' || doc.tipo === filters.tipo;
    const matchesCnpj =
      !filters.cnpj ||
      normalizeDigits(doc.emitenteCnpj || '').includes(filters.cnpj) ||
      normalizeDigits(doc.destinatarioCnpj || '').includes(filters.cnpj) ||
      normalizeDigits(doc.contraparteCnpj || '').includes(filters.cnpj);
    const matchesNumero = !filters.numero || String(doc.numeroCte || '').includes(filters.numero);
    const matchesChave = !filters.chave || String(doc.chaveAcesso || '').includes(filters.chave);
    const matchesStatus = filters.status === 'Todos' || doc.statusFiscal === filters.status;
    const matchesSchema = filters.schemaDoc === 'Todos' || doc.schemaDoc === filters.schemaDoc;
    const matchesAmbiente = filters.ambiente === 'Todos' || doc.ambiente === filters.ambiente;
    const matchesXmlCompleto =
      filters.xmlCompleto === 'Todos' ||
      (filters.xmlCompleto === 'Somente completos' && doc.xmlCompletoDisponivel) ||
      (filters.xmlCompleto === 'Somente resumos' && !doc.xmlCompletoDisponivel);

    const emissaoDate = Date.parse(doc.dataEmissao);
    const matchesEmissaoInicio = !filters.emissaoInicio || emissaoDate >= Date.parse(`${filters.emissaoInicio}T00:00:00`);
    const matchesEmissaoFim = !filters.emissaoFim || emissaoDate <= Date.parse(`${filters.emissaoFim}T23:59:59`);

    return (
      matchesClient &&
      matchesTipo &&
      matchesCnpj &&
      matchesNumero &&
      matchesChave &&
      matchesStatus &&
      matchesSchema &&
      matchesAmbiente &&
      matchesXmlCompleto &&
      matchesEmissaoInicio &&
      matchesEmissaoFim
    );
  });
}

function updateXmlSort(key) {
  const current = state.sort.xmls;
  state.sort.xmls = {
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
  };
  render();
}

function updateNfeSort(key) {
  const current = state.sort.nfeDocs;
  state.sort.nfeDocs = {
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
  };
  render();
}

function updateCteSort(key) {
  const current = state.sort.cteDocs;
  state.sort.cteDocs = {
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
  };
  render();
}

function sortXmls(xmls) {
  const sort = state.sort.xmls;
  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;

  return [...xmls].sort((a, b) => {
    const comparison = compareXmlSortValues(getXmlSortValue(a, sort.key), getXmlSortValue(b, sort.key));
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    return compareXmlSortValues(getXmlSortValue(a, 'numeroNfse'), getXmlSortValue(b, 'numeroNfse'));
  });
}

function sortNfeDocuments(docs) {
  const sort = state.sort.nfeDocs;
  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;

  return [...docs].sort((a, b) => {
    const comparison = compareXmlSortValues(getNfeSortValue(a, sort.key), getNfeSortValue(b, sort.key));
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    return compareXmlSortValues(getNfeSortValue(a, 'chaveAcesso'), getNfeSortValue(b, 'chaveAcesso'));
  });
}

function sortCteDocuments(docs) {
  const sort = state.sort.cteDocs;
  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;

  return [...docs].sort((a, b) => {
    const comparison = compareXmlSortValues(getCteSortValue(a, sort.key), getCteSortValue(b, sort.key));
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    return compareXmlSortValues(getCteSortValue(a, 'chaveAcesso'), getCteSortValue(b, 'chaveAcesso'));
  });
}

function getXmlSortValue(xml, key) {
  switch (key) {
    case 'numeroNfse':
      return toSortableNumber(xml.numeroNfse);
    case 'cliente':
      return xml.cliente || '';
    case 'cnpj':
      return normalizeDigits(xml.cnpj || '');
    case 'municipio':
      return xml.municipio || '';
    case 'dataEmissao':
      return toSortableDate(xml.dataEmissao);
    case 'dataDownload':
      return toSortableDate(xml.dataDownload);
    case 'valor':
      return Number(xml.valor || 0);
    case 'tipo':
      return xml.tipo || '';
    case 'status':
      return `${xml.cancelada ? 'cancelada' : 'autorizada'} ${xml.statusArmazenamento || ''}`;
    default:
      return '';
  }
}

function getNfeSortValue(doc, key) {
  switch (key) {
    case 'chaveAcesso':
      return normalizeDigits(doc.chaveAcesso || '');
    case 'numeroNfe':
      return toSortableNumber(doc.numeroNfe);
    case 'cliente':
      return doc.cliente || '';
    case 'tipo':
      return doc.tipo || '';
    case 'contraparte':
      return doc.contraparteNome || '';
    case 'dataEmissao':
      return toSortableDate(doc.dataEmissao);
    case 'valor':
      return Number(doc.valor || 0);
    case 'ambiente':
      return doc.ambiente || '';
    case 'arquivo':
      return `${doc.xmlCompletoDisponivel ? '1' : '0'}${doc.resumoDisponivel ? '1' : '0'}`;
    case 'status':
      return doc.statusFiscal || '';
    default:
      return '';
  }
}

function getCteSortValue(doc, key) {
  switch (key) {
    case 'chaveAcesso':
      return normalizeDigits(doc.chaveAcesso || '');
    case 'numeroCte':
      return toSortableNumber(doc.numeroCte);
    case 'cliente':
      return doc.cliente || '';
    case 'tipo':
      return doc.tipo || '';
    case 'contraparte':
      return doc.contraparteNome || '';
    case 'dataEmissao':
      return toSortableDate(doc.dataEmissao);
    case 'valor':
      return Number(doc.valor || 0);
    case 'ambiente':
      return doc.ambiente || '';
    case 'arquivo':
      return `${doc.xmlCompletoDisponivel ? '1' : '0'}${doc.resumoDisponivel ? '1' : '0'}`;
    case 'status':
      return doc.statusFiscal || '';
    default:
      return '';
  }
}

function compareXmlSortValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  return String(a).localeCompare(String(b), 'pt-BR', {
    numeric: true,
    sensitivity: 'base'
  });
}

function toSortableNumber(value) {
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function toSortableDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resetXmlSearch() {
  state.selectedXmlIds = new Set();
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
    status: 'Todos'
  };
  state.xmlSearch.hasSearched = false;
  state.xmlSearch.results = [];
  state.xmlSearch.lastQuery = null;
  state.xmlSearch.lastSearchedAt = null;
  state.xmlSearch.page = 1;
  state.xmlSearch.pageSize = SEARCH_PAGE_SIZE;
  state.xmlSearch.total = 0;
  state.xmlSearch.totalPages = 0;
  state.tableState.xmls = 'data';
}

function resetNfeSyncFilters() {
  state.filters.nfeSync = {
    cliente: 'Todos',
    status: 'Todos',
    ambiente: 'Todos'
  };
  state.tableState.nfeSync = 'data';
}

function resetNfeDocsSearch() {
  state.filters.nfeDocs = {
    cliente: 'Todos',
    tipo: 'Todos',
    cnpj: '',
    numero: '',
    chave: '',
    emissaoInicio: '',
    emissaoFim: '',
    status: 'Todos',
    schemaDoc: 'Todos',
    valorMin: '',
    valorMax: '',
    xmlCompleto: 'Todos',
    ambiente: 'Todos'
  };
  state.nfeSearch.hasSearched = false;
  state.nfeSearch.results = [];
  state.nfeSearch.lastQuery = null;
  state.nfeSearch.lastSearchedAt = null;
  state.nfeSearch.page = 1;
  state.nfeSearch.pageSize = SEARCH_PAGE_SIZE;
  state.nfeSearch.total = 0;
  state.nfeSearch.totalPages = 0;
  state.tableState.nfeDocs = 'data';
}

function resetCteDocsSearch() {
  state.filters.cteDocs = {
    cliente: 'Todos',
    tipo: 'Todos',
    cnpj: '',
    numero: '',
    chave: '',
    emissaoInicio: '',
    emissaoFim: '',
    status: 'Todos',
    schemaDoc: 'Todos',
    valorMin: '',
    valorMax: '',
    xmlCompleto: 'Todos',
    ambiente: 'Todos'
  };
  state.cteSearch.hasSearched = false;
  state.cteSearch.results = [];
  state.cteSearch.lastQuery = null;
  state.cteSearch.lastSearchedAt = null;
  state.cteSearch.page = 1;
  state.cteSearch.pageSize = SEARCH_PAGE_SIZE;
  state.cteSearch.total = 0;
  state.cteSearch.totalPages = 0;
  state.tableState.cteDocs = 'data';
}

function reportIfListingCapped(entityLabel, payload) {
  if (payload.total > payload.items.length) {
    pushToast(
      `Exibindo ${payload.items.length} de ${payload.total} ${entityLabel} (limite de seguranca da listagem completa atingido; refine os filtros para ver o restante).`,
      'info'
    );
  }
}

async function executeXmlSearch() {
  if (!state.filters.xmls.cliente || state.dataSource !== 'api') {
    return;
  }

  state.xmlSearch.hasSearched = true;
  state.xmlSearch.results = [];
  state.tableState.xmls = 'loading';
  render();

  try {
    const query = buildXmlSearchQuery(state.filters.xmls, 1, SEARCH_PAGE_SIZE, true);
    const payload = normalizePaginatedResponse(await apiRequest(`/nfse?${query.toString()}`));
    const xmls = buildXmlFilesFromApi(payload.items, state.clients);
    state.xmlFiles = mergeXmlFilesById(state.xmlFiles, xmls);
    state.xmlSearch.results = getFilteredXmlsFromSource(xmls);
    state.xmlSearch.lastSearchedAt = new Date().toISOString();
    state.xmlSearch.page = 1;
    state.xmlSearch.pageSize = payload.pageSize;
    state.xmlSearch.total = payload.total;
    state.xmlSearch.totalPages = payload.totalPages;
    state.tableState.xmls = 'data';
    reportIfListingCapped('nota(s)', payload);
  } catch (error) {
    state.xmlSearch.results = [];
    state.xmlSearch.total = 0;
    state.xmlSearch.totalPages = 0;
    state.tableState.xmls = 'error';
    pushToast(`Falha ao buscar XMLs: ${toErrorMessage(error)}`, 'error');
  }

  render();
}

function normalizePaginatedResponse(payload) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      total: payload.length,
      page: 1,
      pageSize: payload.length || SEARCH_PAGE_SIZE,
      totalPages: payload.length ? 1 : 0
    };
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const total = Number(payload?.total ?? items.length ?? 0);
  const page = Number(payload?.page ?? 1);
  const pageSize = Number(payload?.pageSize ?? SEARCH_PAGE_SIZE);
  const totalPages = Number(payload?.totalPages ?? (pageSize > 0 ? Math.ceil(total / pageSize) : 0));

  return {
    items,
    total,
    page,
    pageSize,
    totalPages
  };
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
      markAlertAsResolved(alert);
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

  markAlertAsResolved(alert);
  pushToast(`Alerta "${alert.titulo}" resolvido.`, 'success');
  render();
}

async function executeConfirmAction(payload) {
  if (!payload || !payload.type) {
    return;
  }

  switch (payload.type) {
    case 'reprocess-client': {
      const client = findClientById(payload.clientId);
      if (client) {
        if (state.dataSource === 'api') {
          try {
            await apiRequest(`/clientes/${client.id}/sync/iniciar`, {
              method: 'POST',
              body: { modo: 'diario' }
            });
            pushToast(`Reprocessamento iniciado para ${client.razaoSocial}.`, 'success');
            await refreshApiData();
          } catch (error) {
            pushToast(`Falha ao reprocessar cliente: ${toErrorMessage(error)}`, 'error');
          }
          return;
        }

        pushToast(`Cliente ${client.razaoSocial} marcado para reprocessamento na proxima execucao.`, 'success');
      }
      return;
    }
    case 'reprocess-selected': {
      if (state.dataSource === 'api') {
        const clientIds = Array.from(state.selectedClientIds);
        let success = 0;
        let failure = 0;
        for (const clientId of clientIds) {
          try {
            await apiRequest(`/clientes/${clientId}/sync/iniciar`, {
              method: 'POST',
              body: { modo: 'diario' }
            });
            success += 1;
          } catch {
            failure += 1;
          }
        }
        pushToast(
          `${success} cliente(s) enviados para reprocessamento${failure ? `, ${failure} falha(s)` : ''}.`,
          failure ? 'error' : 'success'
        );
        await refreshApiData();
        return;
      }

      pushToast(`${state.selectedClientIds.size} cliente(s) enviados para reprocessamento.`, 'success');
      return;
    }
    case 'recover-past-nsus': {
      await runPastNsuRecovery(payload.clientId || null);
      return;
    }
    case 'replace-certificate': {
      pushToast('Fluxo de substituicao iniciado (mock).', 'info');
      return;
    }
    case 'unlink-certificate': {
      const cert = state.certificates.find((item) => item.id === payload.certId);
      if (cert) {
        if (state.dataSource === 'api') {
          try {
            const actionPath = cert.clientId ? 'desvincular' : 'desativar';
            await apiRequest(`/certificados/${cert.id}/${actionPath}${buildCertificateScopeQuery(cert)}`, {
              method: 'POST'
            });
            pushToast(cert.clientId ? 'Vinculo removido. Agora voce pode manter o certificado como avulso ou exclui-lo.' : 'Certificado desativado.', 'success');
            await refreshApiData();
          } catch (error) {
            pushToast(`Falha ao remover vinculo: ${toErrorMessage(error)}`, 'error');
          }
          return;
        }
        cert.clientId = null;
        cert.cliente = 'Sem cliente vinculado';
        cert.cnpj = '-';
        pushToast('Vinculo do certificado removido.', 'success');
        render();
      }
      return;
    }
    case 'delete-certificate': {
      const cert = state.certificates.find((item) => item.id === payload.certId);
      if (!cert) {
        return;
      }

      if (state.dataSource === 'api') {
        if (cert.ativo) {
          pushToast('Remova o vinculo (desative) antes de excluir o certificado.', 'error');
          return;
        }

        try {
          await apiRequest(`/certificados/${cert.id}${buildCertificateScopeQuery(cert)}`, {
            method: 'DELETE'
          });
          pushToast('Certificado excluido com sucesso.', 'success');
          await refreshApiData();
        } catch (error) {
          pushToast(`Falha ao excluir certificado: ${toErrorMessage(error)}`, 'error');
        }
        return;
      }

      state.certificates = state.certificates.filter((item) => item.id !== cert.id);
      pushToast('Certificado excluido.', 'success');
      render();
      return;
    }
    case 'reprocess-run-failures': {
      if (state.dataSource === 'api') {
        try {
          await apiRequest('/sync/rodar-agora', { method: 'POST' });
          pushToast('Reprocessamento de falhas iniciado.', 'success');
          await refreshApiData();
        } catch (error) {
          pushToast(`Falha ao reprocessar: ${toErrorMessage(error)}`, 'error');
        }
        return;
      }

      pushToast('Falhas da execucao enviadas para reprocessamento.', 'success');
      return;
    }
    case 'reprocess-alert': {
      if (state.dataSource === 'api') {
        try {
          await apiRequest('/sync/rodar-agora', { method: 'POST' });
          pushToast('Reprocessamento solicitado com sucesso.', 'success');
          await refreshApiData();
        } catch (error) {
          pushToast(`Falha ao solicitar reprocessamento: ${toErrorMessage(error)}`, 'error');
        }
        return;
      }

      pushToast('Reprocessamento solicitado para o alerta selecionado.', 'success');
      return;
    }
    case 'reprocess-danfses': {
      await reprocessLegacyDanfses();
      return;
    }
    default:
      return;
  }
}

async function reprocessLegacyDanfses() {
  if (state.settings.danfseReprocessRunning) {
    pushToast('Reprocessamento de DANFSEs ja esta em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('DANFSEs antigas reprocessadas (mock).', 'success');
    return;
  }

  state.settings.danfseReprocessRunning = true;
  render();
  pushToast('Reprocessamento de DANFSEs iniciado.', 'info');

  try {
    const result = await apiRequest('/nfse/reprocessar-danfses', {
      method: 'POST',
      body: {
        somenteLegadas: true,
        lote: 100
      },
      timeoutMs: 30 * 60 * 1000
    });

    await refreshApiData();

    const regeneradas = Number(result?.regeneradas || 0);
    const ignoradas = Number(result?.ignoradas || 0);
    const falhas = Number(result?.falhas || 0);
    pushToast(
      `DANFSEs: ${regeneradas} atualizada(s), ${ignoradas} ja no modelo novo, ${falhas} falha(s).`,
      falhas ? 'error' : 'success'
    );
  } catch (error) {
    pushToast(`Falha ao reprocessar DANFSEs: ${toErrorMessage(error)}`, 'error');
  } finally {
    state.settings.danfseReprocessRunning = false;
    render();
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
    id: createBrowserId(),
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

function createBrowserId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const randomValues = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(16))
    : null;

  if (randomValues) {
    randomValues[6] = (randomValues[6] & 0x0f) | 0x40;
    randomValues[8] = (randomValues[8] & 0x3f) | 0x80;
    const hex = Array.from(randomValues, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function refreshApiData() {
  if (state.dataSource !== 'api') {
    render();
    return;
  }

  try {
    await hydrateFromApi();
  } catch (error) {
    pushToast(`Falha ao atualizar dados reais: ${toErrorMessage(error)}`, 'error');
  }
  render();
}

async function refreshExecutionMonitorNow() {
  if (state.dataSource === 'api') {
    await refreshApiData();
  }
  syncExecutionMonitorWithData();
  render();
}

async function submitSettingsRotinaForm(form) {
  const data = new FormData(form);
  const activeSlots = data
    .getAll('activeSlots')
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  state.settings.rotina.ativa = data.get('ativa') === 'on';
  state.settings.rotina.horariosAtivos = activeSlots;
  state.settings.rotina.limiteClientes = Number(data.get('limiteClientes') || state.settings.rotina.limiteClientes || 200);
  state.settings.rotina.retryFalha = data.get('retryFalha') === 'on';
  state.settings.rotina.maxTentativas = Number(data.get('maxTentativas') || state.settings.rotina.maxTentativas || 3);
  state.settings.rotina.intervaloTentativas = Number(
    data.get('intervaloTentativas') || state.settings.rotina.intervaloTentativas || 5
  );

  if (state.dataSource !== 'api') {
    pushToast('Configuracoes da rotina salvas no modo mock.', 'success');
    render();
    return;
  }

  try {
    const schedulerStatus = await apiRequest('/sync/scheduler-settings', {
      method: 'PUT',
      body: {
        enabled: state.settings.rotina.ativa,
        activeSlots
      }
    });

    state.schedulerStatus = schedulerStatus;
    applySchedulerStatusToSettings(schedulerStatus);
    render();
    pushToast('Rotina noturna atualizada com sucesso.', 'success');
  } catch (error) {
    pushToast(`Falha ao salvar rotina noturna: ${toErrorMessage(error)}`, 'error');
  }
}

async function pauseSyncForAllClients(clients) {
  const targets = Array.isArray(clients) ? clients.filter((client) => client && client.id) : [];
  if (!targets.length) {
    return {
      clientsProcessed: 0,
      clientsPaused: 0,
      controlsPaused: 0,
      failed: 0
    };
  }

  const results = await mapWithConcurrency(targets, 6, async (client) => {
    try {
      const result = await apiRequest(`/clientes/${client.id}/sync/pausar`, { method: 'POST' });
      const total = Number(result?.total || 0);
      return { ok: true, total };
    } catch (error) {
      return { ok: false, message: toErrorMessage(error) };
    }
  });

  let clientsPaused = 0;
  let controlsPaused = 0;
  let failed = 0;

  results.forEach((item) => {
    if (!item?.ok) {
      failed += 1;
      return;
    }

    if (item.total > 0) {
      clientsPaused += 1;
      controlsPaused += item.total;
    }
  });

  return {
    clientsProcessed: targets.length,
    clientsPaused,
    controlsPaused,
    failed
  };
}

function startExecutionMonitor(mode, total, message) {
  state.executionMonitor.active = true;
  state.executionMonitor.mode = mode;
  state.executionMonitor.startedAt = new Date().toISOString();
  state.executionMonitor.finishedAt = null;
  state.executionMonitor.currentClientName = null;
  state.executionMonitor.processed = 0;
  state.executionMonitor.total = total;
  state.executionMonitor.successful = 0;
  state.executionMonitor.failed = 0;
  state.executionMonitor.message = message || 'Iniciando execucao...';
  state.executionMonitor.updatedAt = new Date().toISOString();
  state.executionMonitor.lastXml = state.executionMonitor.lastXml || getLastXmlSummary();
  render();
}

function updateExecutionMonitorStep(clientName, success, message) {
  state.executionMonitor.currentClientName = clientName || state.executionMonitor.currentClientName;
  state.executionMonitor.processed += 1;
  if (success) {
    state.executionMonitor.successful += 1;
  } else {
    state.executionMonitor.failed += 1;
  }
  state.executionMonitor.message = message || state.executionMonitor.message;
  state.executionMonitor.updatedAt = new Date().toISOString();
  render();
}

function finishExecutionMonitor(message) {
  state.executionMonitor.active = false;
  state.executionMonitor.finishedAt = new Date().toISOString();
  state.executionMonitor.message = message || 'Execucao finalizada.';
  state.executionMonitor.updatedAt = new Date().toISOString();
  syncExecutionMonitorWithData();
  render();
}

function syncExecutionMonitorWithData() {
  const lastXml = getLastXmlSummary();
  if (lastXml) {
    state.executionMonitor.lastXml = lastXml;
  }

  const latestActivity = getLatestSyncActivitySummary();
  if (!latestActivity) {
    return;
  }

  state.executionMonitor.currentClientName = latestActivity.clientName || state.executionMonitor.currentClientName;
  state.executionMonitor.updatedAt = latestActivity.createdAt || new Date().toISOString();

  if (!state.executionMonitor.active) {
    state.executionMonitor.message = latestActivity.message || 'Ultima atividade de sincronizacao registrada.';
  }
}

function getLastXmlSummary() {
  if (!Array.isArray(state.xmlFiles) || state.xmlFiles.length === 0) {
    return null;
  }

  const latest = [...state.xmlFiles].sort((a, b) => Date.parse(b.dataDownload || 0) - Date.parse(a.dataDownload || 0))[0];
  if (!latest) {
    return null;
  }

  return {
    cliente: latest.cliente,
    numeroNfse: latest.numeroNfse,
    dataEmissao: latest.dataEmissao,
    dataDownload: latest.dataDownload,
    valor: latest.valor,
    tipo: latest.tipo
  };
}

function getLatestSyncActivitySummary() {
  let latest = null;

  Object.entries(state.syncByClient || {}).forEach(([clientId, payload]) => {
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
    const row = logs[0];
    if (!row?.createdAt) {
      return;
    }

    if (!latest || Date.parse(row.createdAt) > Date.parse(latest.createdAt || 0)) {
      const client = state.clients.find((item) => item.id === clientId);
      latest = {
        clientId,
        clientName: client?.razaoSocial || 'Cliente nao identificado',
        createdAt: row.createdAt,
        status: row.status || '',
        message: row.mensagem || 'Sem mensagem'
      };
    }
  });

  return latest;
}

async function fetchJsonByClientId(clientIds, buildPath, fallbackValue) {
  const entries = await mapWithConcurrency(clientIds, 8, async (clientId) => {
    try {
      const data = await apiRequest(buildPath(clientId));
      return [clientId, data];
    } catch {
      return [clientId, deepClone(fallbackValue)];
    }
  });

  return Object.fromEntries(entries);
}

async function mapWithConcurrency(items, limit, worker) {
  if (!items.length) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(limit, items.length));
  const result = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: safeLimit }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      result[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(runners);
  return result;
}

function applySchedulerStatusToSettings(schedulerStatus) {
  const nightly = schedulerStatus?.nightlySweep;
  if (!nightly) {
    return;
  }

  state.settings.rotina.ativa = Boolean(nightly.enabled);
  state.settings.rotina.horariosAtivos = Array.isArray(nightly.activeSlots) ? [...nightly.activeSlots] : [];
  state.settings.rotina.horariosDisponiveis =
    Array.isArray(nightly.availableSlots) && nightly.availableSlots.length
      ? [...nightly.availableSlots]
      : [...NIGHTLY_SWEEP_AVAILABLE_SLOTS];
}

function getNightlyScheduleInfo() {
  const nightly = state.schedulerStatus?.nightlySweep;
  if (!nightly) {
    return {
      enabled: false,
      running: false,
      tone: 'neutral',
      badgeLabel: 'Status nao carregado',
      shortLabel: 'Nao carregada',
      description: 'Status da rotina noturna ainda nao foi carregado pelo backend.',
      nextRunText: '-'
    };
  }

  const enabled = Boolean(nightly.enabled);
  const running = Boolean(nightly.running);
  const activeSlots = Array.isArray(nightly.activeSlots) ? nightly.activeSlots : [];
  const activeSlotsText = activeSlots.length ? activeSlots.join(', ') : 'Nenhum horario selecionado';
  const timezone = formatTimezoneOffset(nightly.timezoneOffsetMinutes);
  const nextRunText = nightly.nextRunAt ? formatDateTime(nightly.nextRunAt) : '-';

  if (running) {
    return {
      enabled,
      running,
      tone: 'info',
      badgeLabel: 'Executando agora',
      shortLabel: activeSlotsText,
      description: `Rotina noturna em execucao. Slots ativos: ${activeSlotsText} (${timezone}).`,
      nextRunText
    };
  }

  if (enabled && activeSlots.length > 0) {
    return {
      enabled,
      running,
      tone: 'success',
      badgeLabel: 'Ativa',
      shortLabel: `${activeSlotsText} ${timezone}`,
      description: `Agendada para executar diariamente nos horarios ${activeSlotsText} (${timezone}).`,
      nextRunText
    };
  }

  if (enabled) {
    return {
      enabled,
      running,
      tone: 'warning',
      badgeLabel: 'Sem horarios',
      shortLabel: 'Nenhum horario ativo',
      description: 'A rotina noturna esta habilitada, mas nao possui horarios selecionados.',
      nextRunText
    };
  }

  return {
    enabled,
    running,
    tone: 'neutral',
    badgeLabel: 'Inativa',
    shortLabel: 'Inativa',
    description: 'Rotina noturna desativada nas variaveis de ambiente.',
    nextRunText: '-'
  };
}

function getAutoSyncInfo() {
  const autoSync = state.schedulerStatus?.autoSync;
  if (!autoSync) {
    return {
      tone: 'neutral',
      badgeLabel: 'Status nao carregado',
      description: 'Status do ciclo automatico ainda nao foi carregado pelo backend.',
      intervalText: '-'
    };
  }

  if (autoSync.running) {
    return {
      tone: 'info',
      badgeLabel: 'Executando agora',
      description: 'Processando controles ativos que estao elegiveis neste momento.',
      intervalText: formatDurationMs(autoSync.intervalMs)
    };
  }

  if (autoSync.enabled) {
    return {
      tone: 'success',
      badgeLabel: 'Ativo',
      description: 'Verifica periodicamente clientes com busca habilitada e proxima execucao vencida.',
      intervalText: formatDurationMs(autoSync.intervalMs)
    };
  }

  return {
    tone: 'neutral',
    badgeLabel: 'Inativo',
    description: 'Ciclo automatico desativado nas variaveis de ambiente.',
    intervalText: formatDurationMs(autoSync.intervalMs)
  };
}

function getDailySyncInfo() {
  const dailySync = state.schedulerStatus?.dailySync;
  if (!dailySync) {
    return {
      tone: 'neutral',
      badgeLabel: 'Status nao carregado',
      description: 'Configuracao de lote ainda nao foi carregada pelo backend.',
      detailText: '-'
    };
  }

  const maxNsu = Math.max(1, Number(dailySync.maxNsuPerRun || 1));
  const requestIntervalText = formatDurationMs(dailySync.requestIntervalMs);
  const cooldownText = formatDurationMs(dailySync.successCooldownMs);
  const rateLimitText = dailySync.rateLimitCooldownUntil
    ? `Rate limit ativo ate ${formatDateTime(dailySync.rateLimitCooldownUntil)}`
    : `Cooldown anti-429: ${formatDurationMs(dailySync.rateLimitCooldownMs)}`;

  if (dailySync.stopOnFirstDocument) {
    return {
      tone: 'warning',
      badgeLabel: '1 XML por ciclo',
      description: 'Modo conservador ativo: para apos o primeiro XML encontrado.',
      detailText: `Consulta a cada ${requestIntervalText}; retomada em ${cooldownText}`
    };
  }

  return {
    tone: 'success',
    badgeLabel: `Ate ${maxNsu} NSUs`,
    description: `Processa varios NSUs por lote e agenda um respiro apos sincronizar documentos.`,
    detailText: `Consulta a cada ${requestIntervalText}; ${rateLimitText}`
  };
}

function buildClientsFromApi(apiClients, establishmentsByClient, certificatesByClient, syncByClient, nfseDocs, dashboardStats = null) {
  const fallbackTotalNfseByClient = (Array.isArray(nfseDocs) ? nfseDocs : []).reduce((acc, doc) => {
    const clientId = doc?.clienteId;
    if (clientId) {
      acc[clientId] = (acc[clientId] || 0) + 1;
    }
    return acc;
  }, {});
  const totalNfseByClient = (Array.isArray(dashboardStats?.byClient) ? dashboardStats.byClient : []).reduce((acc, row) => {
    if (row?.clienteId) {
      acc[row.clienteId] = Number(row.totalNfse || 0);
    }
    return acc;
  }, {});

  return apiClients.map((client) => {
    const establishments = Array.isArray(establishmentsByClient[client.id]) ? establishmentsByClient[client.id] : [];
    const certs = Array.isArray(certificatesByClient[client.id]) ? certificatesByClient[client.id] : [];
    const sync = syncByClient[client.id] || { controles: [], logs: [] };
    const controles = Array.isArray(sync.controles) ? sync.controles : [];
    const logs = Array.isArray(sync.logs) ? sync.logs : [];
    const latestLog = logs[0] || null;
    const latestControl = controles[0] || null;
    const primaryEstablishment = establishments.find((item) => item.ativo) || establishments[0] || null;
    const certificateSummary = summarizeCertificateStatus(certs);
    const buscaStatus = deriveClientSearchStatus(controles, Boolean(client.ativo));
    const buscaNfeAtiva = client.nfeHabilitado !== false;

    return {
      id: client.id,
      razaoSocial: client.razaoSocial || '-',
      nomeFantasia: client.nomeFantasia || '',
      cnpj: normalizeDigits(client.cnpj || ''),
      inscricaoMunicipal: primaryEstablishment?.inscricaoMunicipal || '',
      municipio: primaryEstablishment?.municipioNome || '-',
      uf: '-',
      responsavelInterno: client.responsavelInterno || client.emailResponsavel || '-',
      buscaAtiva: buscaStatus === 'Ativo',
      buscaNfeAtiva,
      buscaStatus,
      ultimaBusca: latestLog?.createdAt || latestControl?.ultimaExecucao || client.updatedAt || client.createdAt,
      xmlsEncontrados: totalNfseByClient[client.id] ?? fallbackTotalNfseByClient[client.id] ?? 0,
      certificadoStatus: certificateSummary.status,
      certificadoValidade: certificateSummary.validade,
      statusOperacional: deriveClientOperationalStatus(latestLog),
      horarioPreferencial: '02:00',
      tipoBusca: 'Ambas',
      municipioIntegrado: Boolean(primaryEstablishment?.municipioNome),
      estabelecimentoIdPrincipal: primaryEstablishment?.id || null
    };
  });
}

function buildCertificatesFromApi(apiClients, certificatesByClient, allCertificatesRaw = null) {
  const clientById = Object.fromEntries(apiClients.map((client) => [client.id, client]));
  const resultById = new Map();
  const globalCertificates = Array.isArray(allCertificatesRaw) ? allCertificatesRaw : null;

  if (globalCertificates) {
    globalCertificates.forEach((cert) => {
      const mapped = mapCertificateFromApi(cert, clientById, cert.clienteId || null);
      resultById.set(mapped.id, mapped);
    });
  }

  for (const [clientId, certsRaw] of Object.entries(certificatesByClient || {})) {
    const certs = Array.isArray(certsRaw) ? certsRaw : [];

    certs.forEach((cert) => {
      const mapped = mapCertificateFromApi(cert, clientById, cert.clienteId || clientId);
      if (!resultById.has(mapped.id)) {
        resultById.set(mapped.id, mapped);
      }
    });
  }

  return Array.from(resultById.values()).sort((a, b) => a.diasRestantes - b.diasRestantes);
}

function mapCertificateFromApi(cert, clientById, fallbackClientId = null) {
  const clientId = cert?.clienteId || fallbackClientId || null;
  const client = clientId ? clientById[clientId] : null;
  const validade = cert?.validadeFim || cert?.validadeInicio || null;
  const days = validade ? daysUntil(validade) : 9999;

  return {
    id: cert.id,
    clientId,
    estabelecimentoId: cert.estabelecimentoId || null,
    cliente: client?.razaoSocial || (clientId ? 'Cliente nao identificado' : 'Sem cliente vinculado'),
    cnpj: normalizeDigits(cert.cnpjTitular || client?.cnpj || ''),
    tipo: cert.tipo || 'A1',
    apelido: cert.nome || 'Sem apelido',
    validade,
    diasRestantes: days,
    status: deriveCertificateStatus(cert, days),
    ultimaValidacao: cert.updatedAt || cert.createdAt || null,
    ativo: Boolean(cert.ativo),
    anotacoes: cert.anotacoes || ''
  };
}

function buildXmlFilesFromApi(nfseDocs, clients) {
  const docs = Array.isArray(nfseDocs) ? nfseDocs : [];
  const clientById = Object.fromEntries(clients.map((client) => [client.id, client]));

  return docs
    .map((doc) => {
      const client = clientById[doc.clienteId] || null;
      const clientCnpj = normalizeDigits(client?.cnpj || '');
      const cnpjPrestador = normalizeDigits(doc.cnpjPrestador || '');
      const cnpjTomador = normalizeDigits(doc.cnpjTomador || '');
      const eventos = Array.isArray(doc.eventos) ? doc.eventos : [];
      const cancelamentoEvento = eventos.find(isCancelamentoEventoApi) || null;
      const dataCancelamento = doc.dataCancelamento || cancelamentoEvento?.dataEvento || null;
      const statusFiscal = resolveFiscalStatus(doc.status, dataCancelamento, cancelamentoEvento);
      const cancelada = normalizeSearchText(statusFiscal).includes('cancel');
      const codigoServicoPrestado = composeCodigoServicoPrestado(doc);

      let tipo = 'Emitida';
      if (clientCnpj && cnpjTomador === clientCnpj) {
        tipo = 'Tomada';
      } else if (clientCnpj && cnpjPrestador === clientCnpj) {
        tipo = 'Emitida';
      } else if (!clientCnpj && cnpjTomador && !cnpjPrestador) {
        tipo = 'Tomada';
      }

      return {
        id: `xml-${doc.id}`,
        apiNfseId: doc.id,
        clientId: doc.clienteId,
        estabelecimentoId: doc.estabelecimentoId || null,
        cliente: client?.razaoSocial || 'Cliente nao identificado',
        cnpj: normalizeDigits(client?.cnpj || doc.cnpjPrestador || doc.cnpjTomador || ''),
        municipio: doc.municipioPrestacaoNome || client?.municipio || '-',
        numeroNfse: doc.numeroNfse || (doc.chaveAcesso ? String(doc.chaveAcesso).slice(-8) : '-'),
        codigoVerificacao: '-',
        chaveAcesso: doc.chaveAcesso || '',
        ambiente: doc.ambiente || 'producao',
        dataEmissao: doc.dataEmissao || doc.createdAt || doc.updatedAt,
        dataDownload: doc.updatedAt || doc.createdAt || doc.dataEmissao,
        valor: toNumber(doc.valorServico),
        tipo,
        statusArmazenamento: doc.xmlPath ? 'Armazenado' : 'Erro',
        statusFiscal,
        cancelada,
        dataCancelamento,
        codigoServicoPrestado,
        descricaoServico: doc.descricaoServico || '-',
        eventos,
        eventosResumo: buildEventosResumo(eventos),
        caminhoServidor: doc.xmlPath || '-',
        prestador: doc.razaoSocialPrestador || '-',
        tomador: doc.razaoSocialTomador || '-',
        iss: toNumber(doc.valorIss),
        conteudoXml: null
      };
    })
    .sort((a, b) => Date.parse(b.dataDownload || 0) - Date.parse(a.dataDownload || 0));
}

function composeCodigoServicoPrestado(doc) {
  const codigoNacional = String(doc?.codigoServicoNacional || '').trim();
  const codigoMunicipal = String(doc?.itemListaServico || '').trim();

  if (codigoNacional && codigoMunicipal && codigoNacional !== codigoMunicipal) {
    return `${codigoNacional} / ${codigoMunicipal}`;
  }
  if (codigoNacional) {
    return codigoNacional;
  }
  if (codigoMunicipal) {
    return codigoMunicipal;
  }
  return '-';
}

function resolveFiscalStatus(status, dataCancelamento, cancelamentoEvento) {
  const normalized = normalizeSearchText(status);
  if (dataCancelamento || cancelamentoEvento || normalized.includes('cancel') || normalized === '101') {
    return 'Cancelada';
  }
  if (normalized === '100' || normalized.includes('autoriz')) {
    return 'Autorizada';
  }
  return status ? String(status) : '-';
}

function isCancelamentoEventoApi(evento) {
  const tipoEvento = normalizeSearchText(evento?.tipoEvento);
  const descricao = normalizeSearchText(evento?.descricao);
  return (
    tipoEvento === 'e101101' ||
    tipoEvento.includes('cancelamento') ||
    tipoEvento.includes('cancelada') ||
    descricao.includes('cancelamento') ||
    descricao.includes('cancelada')
  );
}

function buildEventosResumo(eventos) {
  if (!Array.isArray(eventos) || eventos.length === 0) {
    return '';
  }

  return eventos
    .slice(0, 3)
    .map((evento) => {
      const descricao = formatEventoResumoLabel(evento);
      const data = evento.dataEvento ? ` em ${formatDateTime(evento.dataEvento)}` : '';
      return `${descricao}${data}`;
    })
    .join(' / ');
}

function renderXmlEventsList(eventos) {
  if (!Array.isArray(eventos) || eventos.length === 0) {
    return `<div style="padding:12px 14px; border:1px solid #e4e5e7; border-radius:12px; background:#fafafb; color:#606062;">Nenhum evento vinculado.</div>`;
  }

  return `
    <div style="display:grid; gap:10px;">
      ${eventos
        .map((evento) => {
          const title = formatEventoCardTitle(evento);
          const tipo = evento?.tipoEvento ? String(evento.tipoEvento).trim() : '-';
          const descricao = evento?.descricao ? String(evento.descricao).trim() : '-';
          const dataEvento = evento?.dataEvento ? formatDateTime(evento.dataEvento) : '-';
          return `
            <article style="padding:12px 14px; border:1px solid #e4e5e7; border-radius:12px; background:#fafafb;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:6px;">
                <strong>${escapeHtml(title)}</strong>
                <span class="chip ${isCancelamentoEventoApi(evento) ? 'danger' : 'info'}">${escapeHtml(tipo)}</span>
              </div>
              <div style="display:grid; gap:4px;">
                <span><small style="color:#606062;">Data</small> <strong>${escapeHtml(dataEvento)}</strong></span>
                <span><small style="color:#606062;">Descricao</small> <strong>${escapeHtml(descricao)}</strong></span>
              </div>
            </article>
          `;
        })
        .join('')}
    </div>
  `;
}

function formatEventoResumoLabel(evento) {
  if (isCancelamentoEventoApi(evento)) {
    return 'Cancelamento';
  }

  const descricao = String(evento?.descricao || '').trim();
  if (descricao) {
    return descricao;
  }

  const tipoEvento = String(evento?.tipoEvento || '').trim();
  return tipoEvento || 'Evento';
}

function formatEventoCardTitle(evento) {
  if (isCancelamentoEventoApi(evento)) {
    return 'Evento de cancelamento';
  }

  const descricao = String(evento?.descricao || '').trim();
  if (descricao) {
    return descricao;
  }

  const tipoEvento = String(evento?.tipoEvento || '').trim();
  return tipoEvento ? `Evento ${tipoEvento}` : 'Evento fiscal';
}

function buildNfeDocumentsFromApi(nfeDocs, clients) {
  const docs = Array.isArray(nfeDocs) ? nfeDocs : [];
  const clientById = Object.fromEntries(clients.map((client) => [client.id, client]));

  return docs
    .map((doc) => {
      const client = clientById[doc.clienteId] || null;
      const tipo = mapNfeTipoLabel(doc.tipoRelacao);
      const eventos = Array.isArray(doc.eventos) ? doc.eventos : [];
      const cancelamentoEvento = eventos.find(isCancelamentoEventoApi) || null;
      const emitenteCnpj = normalizeDigits(doc.cnpjEmitente || '');
      const destinatarioCnpj = normalizeDigits(doc.cnpjDestinatario || '');
      const contraparteNome = tipo === 'Emitida' ? doc.razaoSocialDestinatario : doc.razaoSocialEmitente;
      const contraparteCnpj = tipo === 'Emitida' ? destinatarioCnpj : emitenteCnpj;
      const statusFiscal = resolveFiscalStatus(doc.status, cancelamentoEvento?.dataEvento || null, cancelamentoEvento);

      return {
        id: `nfe-${doc.id}`,
        apiNfeId: doc.id,
        clientId: doc.clienteId,
        cliente: client?.razaoSocial || 'Cliente nao identificado',
        estabelecimentoId: doc.estabelecimentoId || null,
        chaveAcesso: doc.chaveAcesso || '-',
        numeroNfe: doc.numeroNfe || '-',
        serie: doc.serie || '-',
        modelo: doc.modelo || '-',
        ambiente: doc.ambiente || 'producao',
        dataEmissao: doc.dataEmissao || doc.createdAt || doc.updatedAt,
        dataAutorizacao: doc.dataAutorizacao || doc.updatedAt || doc.createdAt,
        valor: toNumber(doc.valorTotal),
        tipo,
        statusFiscal,
        schemaDoc: doc.schemaDoc || '-',
        xmlCompletoDisponivel: Boolean(doc.xmlCompletoDisponivel),
        resumoDisponivel: Boolean(doc.resumoDisponivel),
        caminhoServidor: doc.xmlCompletoPath || doc.xmlResumoPath || '-',
        emitenteNome: doc.razaoSocialEmitente || '-',
        emitenteCnpj,
        destinatarioNome: doc.razaoSocialDestinatario || '-',
        destinatarioCnpj,
        contraparteNome: contraparteNome || '-',
        contraparteCnpj,
        eventos,
        eventosResumo: buildEventosResumo(eventos),
        conteudoXml: null
      };
    })
    .sort((a, b) => Date.parse(b.dataEmissao || 0) - Date.parse(a.dataEmissao || 0));
}

function buildCteDocumentsFromApi(cteDocs, clients) {
  const docs = Array.isArray(cteDocs) ? cteDocs : [];
  const clientById = Object.fromEntries(clients.map((client) => [client.id, client]));

  return docs
    .map((doc) => {
      const client = clientById[doc.clienteId] || null;
      const tipo = mapCteTipoLabel(doc.tipoRelacao);
      const eventos = Array.isArray(doc.eventos) ? doc.eventos : [];
      const cancelamentoEvento = eventos.find(isCancelamentoEventoApi) || null;
      const emitenteCnpj = normalizeDigits(doc.cnpjEmitente || '');
      const destinatarioCnpj = normalizeDigits(doc.cnpjDestinatario || '');
      const contraparteNome = tipo === 'Emitido' ? doc.razaoSocialDestinatario : doc.razaoSocialEmitente;
      const contraparteCnpj = tipo === 'Emitido' ? destinatarioCnpj : emitenteCnpj;
      const statusFiscal = resolveFiscalStatus(doc.status, cancelamentoEvento?.dataEvento || null, cancelamentoEvento);

      return {
        id: `cte-${doc.id}`,
        apiCteId: doc.id,
        clientId: doc.clienteId,
        cliente: client?.razaoSocial || 'Cliente nao identificado',
        estabelecimentoId: doc.estabelecimentoId || null,
        chaveAcesso: doc.chaveAcesso || '-',
        numeroCte: doc.numeroNfe || '-',
        serie: doc.serie || '-',
        modelo: doc.modelo || '-',
        ambiente: doc.ambiente || 'producao',
        dataEmissao: doc.dataEmissao || doc.createdAt || doc.updatedAt,
        dataAutorizacao: doc.dataAutorizacao || doc.updatedAt || doc.createdAt,
        valor: toNumber(doc.valorTotal),
        tipo,
        statusFiscal,
        schemaDoc: doc.schemaDoc || '-',
        xmlCompletoDisponivel: Boolean(doc.xmlCompletoDisponivel),
        resumoDisponivel: Boolean(doc.resumoDisponivel),
        caminhoServidor: doc.xmlCompletoPath || doc.xmlResumoPath || '-',
        emitenteNome: doc.razaoSocialEmitente || '-',
        emitenteCnpj,
        destinatarioNome: doc.razaoSocialDestinatario || '-',
        destinatarioCnpj,
        contraparteNome: contraparteNome || '-',
        contraparteCnpj,
        eventos,
        eventosResumo: buildEventosResumo(eventos),
        conteudoXml: null
      };
    })
    .sort((a, b) => Date.parse(b.dataEmissao || 0) - Date.parse(a.dataEmissao || 0));
}

function buildNfeSyncControlsFromApi(nfeSyncByClient, clients, establishmentsByClient) {
  const clientById = Object.fromEntries(clients.map((client) => [client.id, client]));
  const establishmentById = {};

  Object.values(establishmentsByClient || {}).forEach((rows) => {
    const items = Array.isArray(rows) ? rows : [];
    items.forEach((item) => {
      if (item?.id) {
        establishmentById[item.id] = item;
      }
    });
  });

  return Object.entries(nfeSyncByClient || {})
    .flatMap(([clientId, rows]) => {
      const controls = Array.isArray(rows) ? rows : [];
      return controls.map((control) => {
        const client = clientById[clientId] || null;
        const establishment = establishmentById[control.estabelecimentoId] || null;

        return {
          id: control.id,
          clientId,
          cliente: client?.razaoSocial || 'Cliente nao identificado',
          estabelecimentoId: control.estabelecimentoId,
          estabelecimento: establishment?.razaoSocial || establishment?.municipioNome || 'Estabelecimento',
          cnpjEstabelecimento: normalizeDigits(establishment?.cnpj || ''),
          cnpjConsulta: normalizeDigits(control.cnpjConsulta || ''),
          ambiente: control.ambiente || 'producao',
          ultimoNsuConsultado: String(control.ultimoNsuConsultado ?? '0'),
          ultimoNsuDistribuido: String(control.ultimoNsuDistribuido ?? '0'),
          maxNsu: String(control.maxNsu ?? '0'),
          status: control.status || 'ativo',
          ultimaExecucao: control.ultimaExecucao || null,
          ultimaMensagem: control.ultimaMensagem || '',
          totalDocumentosBaixados: Number(control.totalDocumentosBaixados || 0)
        };
      });
    })
    .sort((a, b) => Date.parse(b.ultimaExecucao || 0) - Date.parse(a.ultimaExecucao || 0));
}

function buildSearchRunsFromApi(syncByClient, clients) {
  const clientById = Object.fromEntries(clients.map((client) => [client.id, client]));
  const flatLogs = [];

  Object.entries(syncByClient || {}).forEach(([clientId, payload]) => {
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
    logs.slice(0, 30).forEach((log) => {
      flatLogs.push({ clientId, log });
    });
  });

  flatLogs.sort((a, b) => Date.parse(b.log?.createdAt || 0) - Date.parse(a.log?.createdAt || 0));

  return flatLogs.slice(0, 30).map((entry, index) => {
    const client = clientById[entry.clientId];
    const logDate = entry.log?.createdAt || new Date().toISOString();
    const statusInfo = mapLogToRunStatus(entry.log?.status);
    const xmlCount = entry.log?.status === 'sucesso' ? 1 : 0;
    const codigo = `RUN-${compactDate(logDate)}-${String(index + 1).padStart(3, '0')}`;

    return {
      id: `run-${entry.log?.id || index}`,
      codigo,
      tipo: 'Automatica',
      data: formatIsoDate(logDate),
      inicio: logDate,
      fim: logDate,
      clientesProcessados: 1,
      xmlsEncontrados: xmlCount,
      xmlsArmazenados: xmlCount,
      falhas: statusInfo.hasFailure ? 1 : 0,
      status: statusInfo.runStatus,
      resumoStatus: statusInfo.summary,
      detalhes: [
        {
          clientId: client?.id || entry.clientId,
          cliente: client?.razaoSocial || 'Cliente nao identificado',
          cnpj: client?.cnpj || '',
          municipio: client?.municipio || '-',
          xmlsEncontrados: xmlCount,
          status: statusInfo.clientStatus,
          mensagem: entry.log?.mensagem || '-'
        }
      ]
    };
  });
}

function buildAlertsFromApi(certificates, syncByClient, clients, xmlFiles, auditRows) {
  const alerts = [];
  const clientById = Object.fromEntries(clients.map((client) => [client.id, client]));

  certificates.forEach((cert) => {
    if (cert.status === 'Vencido') {
      alerts.push({
        id: `cert-vencido-${cert.id}`,
        severity: 'Critico',
        tipo: 'Certificado',
        titulo: 'Certificado vencido',
        descricao: `Certificado ${cert.apelido} esta vencido e pode bloquear a sincronizacao.`,
        clientId: cert.clientId,
        cliente: cert.cliente,
        dataHora: cert.ultimaValidacao || new Date().toISOString(),
        status: 'Aberto',
        origem: 'validacao-certificado',
        mensagemTecnica: 'validade_fim expirada',
        sugestaoAcao: 'Atualizar certificado digital do cliente.',
        historicoTentativas: [],
        allowsReprocess: true
      });
    } else if (cert.status === 'A vencer') {
      alerts.push({
        id: `cert-vencer-${cert.id}`,
        severity: 'Atencao',
        tipo: 'Certificado',
        titulo: `Certificado vence em ${Math.max(cert.diasRestantes, 0)} dia(s)`,
        descricao: `Planejar renovacao do certificado ${cert.apelido}.`,
        clientId: cert.clientId,
        cliente: cert.cliente,
        dataHora: cert.ultimaValidacao || new Date().toISOString(),
        status: 'Em analise',
        origem: 'monitor-validade',
        mensagemTecnica: `validade_fim=${cert.validade || '-'}`,
        sugestaoAcao: 'Solicitar renovacao antes do vencimento.',
        historicoTentativas: [],
        allowsReprocess: false
      });
    }
  });

  Object.entries(syncByClient || {}).forEach(([clientId, payload]) => {
    const controles = Array.isArray(payload?.controles) ? payload.controles : [];
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
    const erroStatusByControleId = new Map(
      controles
        .filter((controle) => isSyncControlErrorStatus(controle?.status))
        .map((controle) => [controle.id, String(controle.status || '')])
    );
    const latestErrorLogByControlId = new Map();

    logs
      .filter((log) => String(log?.status || '').startsWith('erro'))
      .forEach((log) => {
        const controleId = String(log?.controleSyncId || '');
        if (!controleId || !erroStatusByControleId.has(controleId) || latestErrorLogByControlId.has(controleId)) {
          return;
        }
        latestErrorLogByControlId.set(controleId, log);
      });

    [...latestErrorLogByControlId.values()].slice(0, 10).forEach((log) => {
      const isCertError = log.status === 'erro_certificado';
      const client = clientById[clientId];
      alerts.push({
        id: `sync-${log.id}`,
        severity: 'Critico',
        tipo: isCertError ? 'Certificado' : 'Prefeitura',
        titulo: isCertError ? 'Falha de certificado na sincronizacao' : 'Falha de sincronizacao na API',
        descricao: log.mensagem || 'Falha registrada durante sincronizacao.',
        clientId,
        cliente: client?.razaoSocial || 'Cliente nao identificado',
        dataHora: log.createdAt || new Date().toISOString(),
        status: 'Aberto',
        origem: 'sync-log',
        mensagemTecnica: log.mensagem || '-',
        sugestaoAcao: isCertError ? 'Verificar certificado ativo e validade.' : 'Reprocessar sincronizacao e verificar conectividade.',
        historicoTentativas: [],
        allowsReprocess: true
      });
    });
  });

  xmlFiles
    .filter((xml) => xml.statusArmazenamento !== 'Armazenado')
    .slice(0, 20)
    .forEach((xml) => {
      alerts.push({
        id: `xml-storage-${xml.id}`,
        severity: 'Atencao',
        tipo: 'XML',
        titulo: 'XML encontrado, mas nao armazenado',
        descricao: `NFS-e ${xml.numeroNfse} sem armazenamento confirmado no servidor.`,
        clientId: xml.clientId,
        cliente: xml.cliente,
        dataHora: xml.dataDownload || new Date().toISOString(),
        status: 'Aberto',
        origem: 'storage-writer',
        mensagemTecnica: xml.caminhoServidor || '-',
        sugestaoAcao: 'Reprocessar download e validar permissao de escrita.',
        historicoTentativas: [],
        allowsReprocess: true
      });
    });

  (Array.isArray(auditRows) ? auditRows : [])
    .slice(0, 10)
    .forEach((row) => {
      if (!row?.clienteId) {
        return;
      }
      if (row?.acao !== 'create' && row?.acao !== 'update') {
        return;
      }
      const client = clientById[row.clienteId];
      alerts.push({
        id: `audit-${row.id}`,
        severity: 'Informativo',
        tipo: 'Cliente',
        titulo: `Evento de auditoria: ${row.acao}`,
        descricao: `${row.entidade || 'registro'} alterado no sistema.`,
        clientId: row.clienteId,
        cliente: client?.razaoSocial || 'Cliente nao identificado',
        dataHora: row.createdAt || new Date().toISOString(),
        status: 'Em analise',
        origem: 'auditoria',
        mensagemTecnica: row.userAgent || '-',
        sugestaoAcao: 'Registrar acompanhamento interno, se necessario.',
        historicoTentativas: [],
        allowsReprocess: false
      });
    });

  return alerts.sort((a, b) => Date.parse(b.dataHora || 0) - Date.parse(a.dataHora || 0)).slice(0, 120);
}

function applyResolvedAlertState(alerts) {
  const nextStore = {};

  alerts.forEach((alert) => {
    const fingerprint = buildAlertFingerprint(alert);
    const persisted = state.resolvedAlerts[alert.id];
    if (persisted?.fingerprint === fingerprint) {
      alert.status = 'Resolvido';
      nextStore[alert.id] = persisted;
      return;
    }

    if (alert.status === 'Resolvido') {
      nextStore[alert.id] = {
        fingerprint,
        resolvedAt: new Date().toISOString()
      };
    }
  });

  state.resolvedAlerts = nextStore;
  saveResolvedAlertsStore(nextStore);
  return alerts;
}

function markAlertAsResolved(alert) {
  alert.status = 'Resolvido';
  state.resolvedAlerts[alert.id] = {
    fingerprint: buildAlertFingerprint(alert),
    resolvedAt: new Date().toISOString()
  };
  saveResolvedAlertsStore(state.resolvedAlerts);
}

function buildAlertFingerprint(alert) {
  return JSON.stringify([
    alert.id,
    alert.origem || '',
    alert.dataHora || '',
    alert.titulo || '',
    alert.descricao || '',
    alert.mensagemTecnica || ''
  ]);
}

function loadResolvedAlertsStore() {
  try {
    const raw = window.localStorage.getItem(RESOLVED_ALERTS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Falha ao carregar alertas resolvidos do navegador.', error);
    return {};
  }
}

function saveResolvedAlertsStore(store) {
  try {
    window.localStorage.setItem(RESOLVED_ALERTS_STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    console.warn('Falha ao persistir alertas resolvidos no navegador.', error);
  }
}

function isSyncControlErrorStatus(status) {
  return String(status || '').startsWith('erro_');
}

function summarizeCertificateStatus(certsRaw) {
  const certs = Array.isArray(certsRaw) ? certsRaw : [];
  if (!certs.length) {
    return { status: 'Nao cadastrado', validade: null };
  }

  const sorted = [...certs].sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  const active = sorted.find((item) => item.ativo) || sorted[0];
  const validade = active.validadeFim || active.validadeInicio || null;
  const days = validade ? daysUntil(validade) : 9999;

  return {
    status: deriveCertificateStatus(active, days),
    validade
  };
}

function deriveClientSearchStatus(controlesRaw, clientIsActive) {
  const controles = Array.isArray(controlesRaw) ? controlesRaw : [];
  if (!controles.length) {
    return clientIsActive ? 'Ativo' : 'Inativo';
  }

  const statuses = controles.map((item) => String(item.status || '').toLowerCase());
  if (statuses.some((status) => status.startsWith('erro'))) {
    return 'Erro';
  }
  if (statuses.includes('ativo')) {
    return 'Ativo';
  }
  if (statuses.includes('pausado')) {
    return 'Inativo';
  }

  return 'Pendente';
}

function deriveClientOperationalStatus(latestLog) {
  if (!latestLog || !latestLog.status) {
    return 'Pendente';
  }

  const normalized = String(latestLog.status).toLowerCase();
  if (normalized === 'sucesso') {
    return 'Sucesso';
  }
  if (normalized.startsWith('erro')) {
    return 'Erro';
  }
  if (normalized === 'sem_documento') {
    return 'Aviso';
  }
  if (normalized === 'rate_limit') {
    return 'Aviso';
  }

  return 'Pendente';
}

function deriveCertificateStatus(cert, precomputedDays) {
  if (!cert?.ativo) {
    return 'Nao validado';
  }

  const days = Number.isFinite(precomputedDays) ? precomputedDays : daysUntil(cert.validadeFim);
  if (Number.isFinite(days)) {
    if (days < 0) {
      return 'Vencido';
    }
    if (days <= 30) {
      return 'A vencer';
    }
  }

  return 'Valido';
}

function mapLogToRunStatus(logStatus) {
  const status = String(logStatus || '').toLowerCase();
  if (status === 'sucesso') {
    return {
      runStatus: 'Concluida',
      summary: 'Sucesso',
      clientStatus: 'Sucesso',
      hasFailure: false
    };
  }

  if (status === 'sem_documento') {
    return {
      runStatus: 'Concluida com avisos',
      summary: 'Aviso',
      clientStatus: 'Pendente',
      hasFailure: false
    };
  }

  if (status.startsWith('erro')) {
    return {
      runStatus: 'Falha critica',
      summary: 'Erro',
      clientStatus: 'Erro',
      hasFailure: true
    };
  }

  return {
    runStatus: 'Concluida com avisos',
    summary: 'Aviso',
    clientStatus: 'Aviso',
    hasFailure: false
  };
}

async function apiRequest(path, options = {}) {
  const { method = 'GET', body, timeoutMs = API_TIMEOUT_MS } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {};
    const init = {
      method,
      headers,
      signal: controller.signal
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(path, init);
    if (!response.ok) {
      const errorText = await safeReadResponseText(response);
      throw new Error(`HTTP ${response.status}${errorText ? ` - ${errorText}` : ''}`);
    }

    if (response.status === 204) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }

    return await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Tempo limite excedido na chamada da API');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function safeReadResponseText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function sanitizeEmail(value) {
  if (!value) {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function getEditableValue(value) {
  const normalized = String(value || '').trim();
  return normalized === '-' ? '' : normalized;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '00000000';
  }
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function formatIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'erro inesperado';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      if (commaIndex >= 0) {
        resolve(result.slice(commaIndex + 1));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo do certificado'));
    reader.readAsDataURL(file);
  });
}

function findClientById(clientId) {
  if (!clientId) {
    return null;
  }
  return state.clients.find((client) => client.id === clientId) || null;
}

function findEstablishmentById(establishmentId) {
  if (!establishmentId) {
    return null;
  }

  for (const rows of Object.values(state.establishmentsByClient || {})) {
    const establishment = (Array.isArray(rows) ? rows : []).find((item) => item?.id === establishmentId);
    if (establishment) {
      return establishment;
    }
  }

  return null;
}

function formatNfeFailureNumber(failure) {
  const numero = String(failure?.numeroNfe || '').trim();
  const serie = String(failure?.serie || '').trim();

  if (numero && serie) {
    return `${numero} / serie ${serie}`;
  }

  if (numero) {
    return numero;
  }

  return '-';
}

function findCertificateById(certId) {
  if (!certId) {
    return null;
  }
  return state.certificates.find((cert) => cert.id === certId) || null;
}

function buildCertificateScopeQuery(cert) {
  return cert?.clientId ? `?clienteId=${encodeURIComponent(cert.clientId)}` : '';
}

function findXmlById(xmlId) {
  if (!xmlId) {
    return null;
  }
  return state.xmlSearch.results.find((xml) => xml.id === xmlId) || state.xmlFiles.find((xml) => xml.id === xmlId) || null;
}

function findNfeById(nfeId) {
  if (!nfeId) {
    return null;
  }
  return state.nfeSearch.results.find((doc) => doc.id === nfeId) || state.nfeDocuments.find((doc) => doc.id === nfeId) || null;
}

function findCteById(cteId) {
  if (!cteId) {
    return null;
  }
  return state.cteSearch.results.find((doc) => doc.id === cteId) || state.cteDocuments.find((doc) => doc.id === cteId) || null;
}

function canSyncNfeEvents(doc) {
  return Boolean(
    state.dataSource === 'api' &&
      doc?.apiNfeId &&
      doc?.clientId &&
      doc?.estabelecimentoId &&
      normalizeDigits(doc?.chaveAcesso || '').length > 0
  );
}

function canSyncCteEvents(doc) {
  return Boolean(
    state.dataSource === 'api' &&
      doc?.apiCteId &&
      doc?.clientId &&
      doc?.estabelecimentoId &&
      normalizeDigits(doc?.chaveAcesso || '').length > 0
  );
}

function mapClientOptions() {
  return state.clients.reduce((acc, client) => {
    acc[client.id] = `${client.razaoSocial} (${formatCnpj(client.cnpj)})`;
    return acc;
  }, {});
}

function getNfeSourceMode() {
  return state.nfeSchedulerStatus?.sourceMode === 'dominio' ? 'dominio' : 'distribuicao';
}

function mapNfeSyncStatusOptions(statuses) {
  return ['Todos', ...(Array.isArray(statuses) ? statuses : [])].reduce((acc, status) => {
    acc[status] = status === 'Todos' ? 'Todos' : mapNfeSyncStatusLabel(status);
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

function toneFromNfeSyncStatus(status) {
  if (status === 'ativo') {
    return 'success';
  }
  if (status === 'pausado') {
    return 'neutral';
  }
  if (String(status || '').startsWith('erro')) {
    return 'danger';
  }
  return 'warning';
}

function mapNfeSyncStatusLabel(status) {
  const labels = {
    ativo: 'Ativo',
    pausado: 'Pausado',
    erro_api: 'Erro de API',
    erro_autorizacao: 'Erro de autorizacao',
    erro_certificado: 'Erro de certificado'
  };
  return labels[status] || status || '-';
}

function mapNfeAmbienteLabel(ambiente) {
  return ambiente === 'homologacao' ? 'Homologacao' : 'Producao';
}

function mapNfeTipoLabel(tipoRelacao) {
  if (tipoRelacao === 'emitida') {
    return 'Emitida';
  }
  if (tipoRelacao === 'recebida') {
    return 'Recebida';
  }
  return 'Nao identificado';
}

function mapCteTipoLabel(tipoRelacao) {
  if (tipoRelacao === 'emitida') {
    return 'Emitido';
  }
  if (tipoRelacao === 'recebida') {
    return 'Recebido';
  }
  return 'Nao identificado';
}

function toneFromFiscalStatus(status) {
  const normalized = normalizeSearchText(status);
  if (normalized.includes('cancel')) {
    return 'danger';
  }
  if (normalized.includes('autoriz')) {
    return 'success';
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

function formatTimeFromHourMinute(hour, minute) {
  const normalizedHour = Number.isInteger(Number(hour)) ? Number(hour) : 0;
  const normalizedMinute = Number.isInteger(Number(minute)) ? Number(minute) : 0;
  return `${String(Math.max(0, Math.min(23, normalizedHour))).padStart(2, '0')}:${String(Math.max(0, Math.min(59, normalizedMinute))).padStart(2, '0')}`;
}

function formatTimezoneOffset(offsetMinutes) {
  const value = Number(offsetMinutes || 0);
  const sign = value >= 0 ? '+' : '-';
  const abs = Math.abs(value);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

function formatDurationMs(value) {
  const ms = Number(value || 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    return '-';
  }

  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  }

  const minutes = Math.round(ms / 60000);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
}

function formatCurrency(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function sumListedDocumentValues(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => sum + toNumber(item?.valor), 0);
}

function formatInteger(value) {
  const digits = String(value ?? '').trim();
  if (!digits || digits === '-') {
    return '-';
  }

  if (/^\d+$/.test(digits)) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) {
    return digits;
  }

  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(numeric);
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

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function truncateText(value, maxLength) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
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

async function openNfeViewer(nfeId) {
  const doc = findNfeById(nfeId);
  if (!doc) {
    pushToast('NF-e nao encontrada.', 'error');
    return;
  }

  try {
    await ensureNfeContentLoaded(doc);
    openModal({ kind: 'nfe-view', nfeId });
  } catch (error) {
    pushToast(`Falha ao carregar XML da NF-e: ${toErrorMessage(error)}`, 'error');
  }
}

async function downloadNfeXmlById(nfeId) {
  const doc = findNfeById(nfeId);
  if (!doc) {
    pushToast('NF-e nao encontrada.', 'error');
    return;
  }

  try {
    await ensureNfeContentLoaded(doc);
  } catch (error) {
    pushToast(`Falha ao baixar XML da NF-e: ${toErrorMessage(error)}`, 'error');
    return;
  }

  const blob = new Blob([doc.conteudoXml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nfe-${doc.chaveAcesso}.xml`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  pushToast(`Download da NF-e ${doc.numeroNfe || doc.chaveAcesso} iniciado.`, 'success');
}

async function openCteViewer(cteId) {
  const doc = findCteById(cteId);
  if (!doc) {
    pushToast('CT-e nao encontrado.', 'error');
    return;
  }

  try {
    await ensureCteContentLoaded(doc);
    openModal({ kind: 'cte-view', cteId });
  } catch (error) {
    pushToast(`Falha ao carregar XML do CT-e: ${toErrorMessage(error)}`, 'error');
  }
}

async function downloadCteXmlById(cteId) {
  const doc = findCteById(cteId);
  if (!doc) {
    pushToast('CT-e nao encontrado.', 'error');
    return;
  }

  try {
    await ensureCteContentLoaded(doc);
  } catch (error) {
    pushToast(`Falha ao baixar XML do CT-e: ${toErrorMessage(error)}`, 'error');
    return;
  }

  const blob = new Blob([doc.conteudoXml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `cte-${doc.chaveAcesso}.xml`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  pushToast(`Download do CT-e ${doc.numeroCte || doc.chaveAcesso} iniciado.`, 'success');
}

async function openXmlViewer(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    pushToast('XML nao encontrado.', 'error');
    return;
  }

  try {
    await ensureXmlContentLoaded(xml);
    openModal({ kind: 'xml-view', xmlId });
  } catch (error) {
    pushToast(`Falha ao carregar XML: ${toErrorMessage(error)}`, 'error');
  }
}

async function downloadXmlById(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    pushToast('XML nao encontrado.', 'error');
    return;
  }

  if (xml.apiNfseId && xml.clientId) {
    try {
      const payload = await apiRequest('/nfse/download-lote', {
        method: 'POST',
        body: {
          ids: [xml.apiNfseId],
          tipoArquivo: 'xml',
          clienteId: xml.clientId
        },
        timeoutMs: 60000
      });
      downloadFromPayload(payload, `nfse-${xml.numeroNfse || xml.chaveAcesso}-xmls.zip`);
      const included = Number(payload?.totalArquivosIncluidos || 0);
      pushToast(`Download dos XMLs da NFS-e ${xml.numeroNfse || xml.chaveAcesso} iniciado (${included} arquivo(s)).`, 'success');
      return;
    } catch (error) {
      pushToast(`Falha ao baixar XMLs da NFS-e: ${toErrorMessage(error)}`, 'error');
      return;
    }
  }

  try {
    await ensureXmlContentLoaded(xml);
  } catch (error) {
    pushToast(`Falha ao baixar XML: ${toErrorMessage(error)}`, 'error');
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

async function downloadDanfseByXmlId(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    pushToast('NFS-e nao encontrada para DANFSE.', 'error');
    return;
  }

  if (!xml.apiNfseId || !xml.clientId) {
    pushToast('DANFSE indisponivel para este registro.', 'error');
    return;
  }

  try {
    const payload = await apiRequest(`/nfse/${xml.apiNfseId}/danfse?clienteId=${encodeURIComponent(xml.clientId)}`);
    downloadFromPayload(payload, `DANFSE-${xml.numeroNfse}.pdf`);
    pushToast(`Download do DANFSE ${xml.numeroNfse} iniciado.`, 'success');
  } catch (error) {
    pushToast(`Falha ao baixar DANFSE: ${toErrorMessage(error)}`, 'error');
  }
}

async function downloadSelectedXmlBatch(tipoArquivo = 'ambos') {
  const allowedTypes = ['ambos', 'xml', 'danfse'];
  const normalizedType = allowedTypes.includes(tipoArquivo) ? tipoArquivo : 'ambos';
  const selectedXmls = getFilteredXmls().filter((xml) => state.selectedXmlIds.has(xml.id) && xml.apiNfseId);

  if (!selectedXmls.length) {
    pushToast('Selecione ao menos uma NFS-e da listagem atual.', 'error');
    return;
  }

  const ids = [...new Set(selectedXmls.map((xml) => xml.apiNfseId))];
  const clientIds = [...new Set(selectedXmls.map((xml) => xml.clientId).filter(Boolean))];
  const body = {
    ids,
    tipoArquivo: normalizedType
  };

  if (clientIds.length === 1) {
    body.clienteId = clientIds[0];
  }

  try {
    const payload = await apiRequest('/nfse/download-lote', {
      method: 'POST',
      body,
      timeoutMs: 2 * 60 * 1000
    });
    downloadFromPayload(payload, `nfse-lote-${normalizedType}.zip`);
    const errorsCount = Array.isArray(payload?.erros) ? payload.erros.length : 0;
    const included = Number(payload?.totalArquivosIncluidos || 0);
    pushToast(
      `Download em lote iniciado: ${included} arquivo(s) no ZIP${errorsCount ? `, ${errorsCount} aviso(s)` : ''}.`,
      errorsCount ? 'info' : 'success'
    );
  } catch (error) {
    pushToast(`Falha ao baixar lote: ${toErrorMessage(error)}`, 'error');
  }
}

async function syncEventsForListedXmls() {
  if (state.xmlEventsSyncRunning) {
    pushToast('A sincronizacao de eventos da listagem ja esta em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A sincronizacao de eventos so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const listedXmls = getFilteredXmls();
  if (!listedXmls.length) {
    pushToast('Nao ha NFS-e listadas para sincronizar eventos.', 'error');
    return;
  }

  const targets = listedXmls.filter(
    (xml) => xml.apiNfseId && xml.clientId && xml.estabelecimentoId && normalizeDigits(xml.chaveAcesso || '').length > 0
  );

  if (!targets.length) {
    pushToast('A listagem atual nao possui NFS-e aptas para sincronizacao de eventos.', 'error');
    return;
  }

  const clientIds = [...new Set(targets.map((xml) => xml.clientId).filter(Boolean))];
  if (clientIds.length !== 1) {
    pushToast('A sincronizacao da listagem exige uma unica empresa no resultado atual.', 'error');
    return;
  }

  const documentoIds = [...new Set(targets.map((xml) => xml.apiNfseId).filter(Boolean))];

  state.xmlEventsSyncRunning = true;
  render();
  pushToast(`Sincronizando eventos para ${documentoIds.length} NFS-e listada(s)...`, 'info');

  try {
    const summary = await requestNfseEventsSync(clientIds[0], documentoIds);
    await refreshXmlSearchAfterEventsSync();
    pushToast(buildEventsSyncSummaryMessage(summary), eventsSyncToastTone(summary));
  } finally {
    state.xmlEventsSyncRunning = false;
    render();
  }
}

async function syncEventsForXml(xmlId) {
  if (state.xmlEventsSyncRunning) {
    pushToast('A sincronizacao de eventos ja esta em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A sincronizacao de eventos so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const xml = findXmlById(xmlId);
  if (!xml) {
    pushToast('NFS-e nao encontrada para sincronizacao de eventos.', 'error');
    return;
  }

  if (!xml.apiNfseId || !xml.clientId || !xml.estabelecimentoId || normalizeDigits(xml.chaveAcesso || '').length === 0) {
    pushToast('Esta NFS-e nao possui dados suficientes para consultar eventos.', 'error');
    return;
  }

  state.xmlEventsSyncRunning = true;
  render();
  pushToast(`Sincronizando eventos da NFS-e ${xml.numeroNfse || xml.chaveAcesso || xml.id}...`, 'info');

  try {
    const summary = await requestNfseEventsSync(xml.clientId, [xml.apiNfseId]);
    await refreshXmlSearchAfterEventsSync();
    pushToast(buildEventsSyncSummaryMessage(summary), eventsSyncToastTone(summary));
  } finally {
    state.xmlEventsSyncRunning = false;
    render();
  }
}

async function requestNfseEventsSync(clienteId, documentoIds) {
  return apiRequest('/nfse/eventos/sincronizar', {
    method: 'POST',
    body: {
      clienteId,
      documentoIds,
      somenteSemEventos: false,
      limit: documentoIds.length
    },
    timeoutMs: Math.max(60000, documentoIds.length * 20000)
  });
}

async function syncEventsForListedNfes() {
  if (state.nfeEventsSyncRunning) {
    pushToast('A sincronizacao de eventos da listagem de NF-e ja esta em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A sincronizacao de eventos so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const docs = getFilteredNfeDocuments();
  if (!docs.length) {
    pushToast('Nao ha NF-e listadas para sincronizar eventos.', 'error');
    return;
  }

  const targets = docs.filter((doc) => canSyncNfeEvents(doc));
  if (!targets.length) {
    pushToast('A listagem atual nao possui NF-e aptas para sincronizacao de eventos.', 'error');
    return;
  }

  const clientIds = [...new Set(targets.map((doc) => doc.clientId).filter(Boolean))];
  if (clientIds.length !== 1) {
    pushToast('A sincronizacao da listagem exige uma unica empresa no resultado atual.', 'error');
    return;
  }

  const documentoIds = [...new Set(targets.map((doc) => doc.apiNfeId).filter(Boolean))];
  state.nfeEventsSyncRunning = true;
  render();
  pushToast(`Sincronizando eventos para ${documentoIds.length} NF-e listada(s)...`, 'info');

  try {
    const summary = await requestNfeEventsSync(clientIds[0], documentoIds);
    await refreshNfeSearchAfterEventsSync();
    pushToast(buildDocumentEventsSyncSummaryMessage('NF-e', summary), eventsSyncToastTone(summary));
  } finally {
    state.nfeEventsSyncRunning = false;
    render();
  }
}

async function syncEventsForNfe(nfeId) {
  if (state.nfeEventsSyncRunning) {
    pushToast('A sincronizacao de eventos de NF-e ja esta em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A sincronizacao de eventos so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const doc = findNfeById(nfeId);
  if (!doc) {
    pushToast('NF-e nao encontrada para sincronizacao de eventos.', 'error');
    return;
  }

  if (!canSyncNfeEvents(doc)) {
    pushToast('Esta NF-e nao possui dados suficientes para consultar eventos.', 'error');
    return;
  }

  state.nfeEventsSyncRunning = true;
  render();
  pushToast(`Sincronizando eventos da NF-e ${doc.numeroNfe || doc.chaveAcesso || doc.id}...`, 'info');

  try {
    const summary = await requestNfeEventsSync(doc.clientId, [doc.apiNfeId]);
    await refreshNfeSearchAfterEventsSync();
    pushToast(buildDocumentEventsSyncSummaryMessage('NF-e', summary), eventsSyncToastTone(summary));
  } finally {
    state.nfeEventsSyncRunning = false;
    render();
  }
}

async function requestNfeEventsSync(clienteId, documentoIds) {
  return apiRequest('/nfe/eventos/sincronizar', {
    method: 'POST',
    body: {
      clienteId,
      documentoIds,
      somenteSemEventos: false,
      limit: documentoIds.length
    },
    timeoutMs: Math.max(60000, documentoIds.length * 20000)
  });
}

async function refreshNfeSearchAfterEventsSync() {
  if (state.nfeSearch.hasSearched && state.nfeSearch.lastQuery) {
    await executeNfeDocsSearch();
    return;
  }

  await refreshApiData();
}

async function syncEventsForListedCtes() {
  if (state.cteEventsSyncRunning) {
    pushToast('A sincronizacao de eventos da listagem de CT-e ja esta em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A sincronizacao de eventos so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const docs = getFilteredCteDocuments();
  if (!docs.length) {
    pushToast('Nao ha CT-e listados para sincronizar eventos.', 'error');
    return;
  }

  const targets = docs.filter((doc) => canSyncCteEvents(doc));
  if (!targets.length) {
    pushToast('A listagem atual nao possui CT-e aptos para sincronizacao de eventos.', 'error');
    return;
  }

  const clientIds = [...new Set(targets.map((doc) => doc.clientId).filter(Boolean))];
  if (clientIds.length !== 1) {
    pushToast('A sincronizacao da listagem exige uma unica empresa no resultado atual.', 'error');
    return;
  }

  const documentoIds = [...new Set(targets.map((doc) => doc.apiCteId).filter(Boolean))];
  state.cteEventsSyncRunning = true;
  render();
  pushToast(`Sincronizando eventos para ${documentoIds.length} CT-e listado(s)...`, 'info');

  try {
    const summary = await requestCteEventsSync(clientIds[0], documentoIds);
    await refreshCteSearchAfterEventsSync();
    pushToast(buildDocumentEventsSyncSummaryMessage('CT-e', summary), eventsSyncToastTone(summary));
  } finally {
    state.cteEventsSyncRunning = false;
    render();
  }
}

async function syncEventsForCte(cteId) {
  if (state.cteEventsSyncRunning) {
    pushToast('A sincronizacao de eventos de CT-e ja esta em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A sincronizacao de eventos so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const doc = findCteById(cteId);
  if (!doc) {
    pushToast('CT-e nao encontrado para sincronizacao de eventos.', 'error');
    return;
  }

  if (!canSyncCteEvents(doc)) {
    pushToast('Este CT-e nao possui dados suficientes para consultar eventos.', 'error');
    return;
  }

  state.cteEventsSyncRunning = true;
  render();
  pushToast(`Sincronizando eventos do CT-e ${doc.numeroCte || doc.chaveAcesso || doc.id}...`, 'info');

  try {
    const summary = await requestCteEventsSync(doc.clientId, [doc.apiCteId]);
    await refreshCteSearchAfterEventsSync();
    pushToast(buildDocumentEventsSyncSummaryMessage('CT-e', summary), eventsSyncToastTone(summary));
  } finally {
    state.cteEventsSyncRunning = false;
    render();
  }
}

async function requestCteEventsSync(clienteId, documentoIds) {
  return apiRequest('/cte/eventos/sincronizar', {
    method: 'POST',
    body: {
      clienteId,
      documentoIds,
      somenteSemEventos: false,
      limit: documentoIds.length
    },
    timeoutMs: Math.max(60000, documentoIds.length * 20000)
  });
}

async function refreshCteSearchAfterEventsSync() {
  if (state.cteSearch.hasSearched && state.cteSearch.lastQuery) {
    await executeCteDocsSearch();
    return;
  }

  await refreshApiData();
}

async function refreshXmlSearchAfterEventsSync() {
  if (state.xmlSearch.hasSearched && state.xmlSearch.lastQuery) {
    await executeXmlSearch();
    return;
  }

  await loadInitialData();
}

function buildEventsSyncSummaryMessage(summary) {
  return buildDocumentEventsSyncSummaryMessage('nota', summary);
}

function buildDocumentEventsSyncSummaryMessage(documentLabel, summary) {
  const failureMessages = (Array.isArray(summary?.detalhes) ? summary.detalhes : [])
    .filter((detail) => detail?.status === 'falha_api' || detail?.status === 'falha_certificado')
    .map((detail) => String(detail?.mensagem || '').trim())
    .filter(Boolean);
  const uniqueFailureMessages = [...new Set(failureMessages)];

  return `Eventos sincronizados: ${summary?.eventosImportados || 0} importado(s), ${summary?.documentosComEventos || 0} ${documentLabel}(s) com eventos, ${summary?.falhas || 0} falha(s).${
    uniqueFailureMessages.length ? ` Motivo: ${uniqueFailureMessages.slice(0, 2).join(' | ')}${uniqueFailureMessages.length > 2 ? ' | ...' : ''}` : ''
  }`;
}

function eventsSyncToastTone(summary) {
  if (summary?.falhas > 0) {
    return 'error';
  }

  if (summary?.eventosImportados > 0) {
    return 'success';
  }

  return 'info';
}

function exportXmlListToCsv() {
  if (!state.xmlSearch.hasSearched) {
    pushToast('Busque os XMLs antes de exportar a listagem.', 'error');
    return;
  }

  const xmls = getFilteredXmls();
  if (!xmls.length) {
    pushToast('Nao ha XMLs na listagem atual para exportar.', 'error');
    return;
  }

  const header = [
    'Numero NFS-e',
    'Cliente',
    'CNPJ',
    'Municipio',
    'Data emissao',
    'Data download',
    'Valor',
    'Tipo',
    'Status armazenamento',
    'Situacao fiscal',
    'Data cancelamento',
    'Prestador',
    'Tomador',
    'ISS',
    'Codigo verificacao'
  ];
  const rows = xmls.map((xml) => [
    xml.numeroNfse,
    xml.cliente,
    formatCnpj(xml.cnpj),
    xml.municipio,
    formatDate(xml.dataEmissao),
    formatDateTime(xml.dataDownload),
    formatCurrency(xml.valor),
    xml.tipo,
    xml.statusArmazenamento,
    xml.statusFiscal,
    xml.dataCancelamento ? formatDateTime(xml.dataCancelamento) : '',
    xml.prestador,
    xml.tomador,
    formatCurrency(xml.iss),
    xml.codigoVerificacao
  ]);
  const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(';')).join('\r\n');
  const client = findClientById(state.xmlSearch.lastQuery?.cliente);
  const start = state.xmlSearch.lastQuery?.emissaoInicio || 'inicio';
  const end = state.xmlSearch.lastQuery?.emissaoFim || 'fim';
  const clientName = toSafeFileName(client?.razaoSocial || 'cliente');
  const fileName = `xmls-${clientName}-${start}-${end}.csv`;
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });

  triggerBrowserDownload(fileName, blob);
  pushToast(`${xmls.length} XML(s) exportado(s) para CSV.`, 'success');
}

function exportNfeListToCsv() {
  if (!state.nfeSearch.hasSearched) {
    pushToast('Busque as NF-e antes de exportar a listagem.', 'error');
    return;
  }

  const docs = getFilteredNfeDocuments();
  if (!docs.length) {
    pushToast('Nao ha NF-e na listagem atual para exportar.', 'error');
    return;
  }

  const header = [
    'Chave de acesso',
    'Numero NF-e',
    'Cliente',
    'Tipo',
    'Ambiente',
    'Data emissao',
    'Data autorizacao',
    'Valor total',
    'Status',
    'Schema',
    'Emitente',
    'CNPJ emitente',
    'Destinatario',
    'CNPJ destinatario',
    'Arquivo completo',
    'Resumo disponivel'
  ];
  const rows = docs.map((doc) => [
    doc.chaveAcesso,
    doc.numeroNfe,
    doc.cliente,
    doc.tipo,
    mapNfeAmbienteLabel(doc.ambiente),
    formatDateTime(doc.dataEmissao),
    formatDateTime(doc.dataAutorizacao),
    formatCurrency(doc.valor),
    doc.statusFiscal,
    doc.schemaDoc,
    doc.emitenteNome,
    formatCnpj(doc.emitenteCnpj),
    doc.destinatarioNome,
    formatCnpj(doc.destinatarioCnpj),
    doc.xmlCompletoDisponivel ? 'Sim' : 'Nao',
    doc.resumoDisponivel ? 'Sim' : 'Nao'
  ]);
  const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(';')).join('\r\n');
  const client = findClientById(state.nfeSearch.lastQuery?.cliente);
  const start = state.nfeSearch.lastQuery?.emissaoInicio || 'inicio';
  const end = state.nfeSearch.lastQuery?.emissaoFim || 'fim';
  const clientName = toSafeFileName(client?.razaoSocial || 'cliente');
  const fileName = `nfe-${clientName}-${start}-${end}.csv`;
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });

  triggerBrowserDownload(fileName, blob);
  pushToast(`${docs.length} NF-e exportada(s) para CSV.`, 'success');
}

function exportCteListToCsv() {
  if (!state.cteSearch.hasSearched) {
    pushToast('Busque os CT-e antes de exportar a listagem.', 'error');
    return;
  }

  const docs = getFilteredCteDocuments();
  if (!docs.length) {
    pushToast('Nao ha CT-e na listagem atual para exportar.', 'error');
    return;
  }

  const header = [
    'Chave de acesso',
    'Numero CT-e',
    'Cliente',
    'Tipo',
    'Ambiente',
    'Data emissao',
    'Data autorizacao',
    'Valor total',
    'Status',
    'Schema',
    'Emitente',
    'CNPJ emitente',
    'Destinatario',
    'CNPJ destinatario',
    'Arquivo completo',
    'Resumo disponivel'
  ];
  const rows = docs.map((doc) => [
    doc.chaveAcesso,
    doc.numeroCte,
    doc.cliente,
    doc.tipo,
    mapNfeAmbienteLabel(doc.ambiente),
    formatDateTime(doc.dataEmissao),
    formatDateTime(doc.dataAutorizacao),
    formatCurrency(doc.valor),
    doc.statusFiscal,
    doc.schemaDoc,
    doc.emitenteNome,
    formatCnpj(doc.emitenteCnpj),
    doc.destinatarioNome,
    formatCnpj(doc.destinatarioCnpj),
    doc.xmlCompletoDisponivel ? 'Sim' : 'Nao',
    doc.resumoDisponivel ? 'Sim' : 'Nao'
  ]);
  const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(';')).join('\r\n');
  const client = findClientById(state.cteSearch.lastQuery?.cliente);
  const start = state.cteSearch.lastQuery?.emissaoInicio || 'inicio';
  const end = state.cteSearch.lastQuery?.emissaoFim || 'fim';
  const clientName = toSafeFileName(client?.razaoSocial || 'cliente');
  const fileName = `cte-${clientName}-${start}-${end}.csv`;
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });

  triggerBrowserDownload(fileName, blob);
  pushToast(`${docs.length} CT-e exportado(s) para CSV.`, 'success');
}

function escapeCsvCell(value) {
  const normalized = String(value ?? '').replaceAll('"', '""');
  return `"${normalized}"`;
}

function toSafeFileName(value) {
  return String(value || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .toLowerCase() || 'arquivo';
}

async function ensureXmlContentLoaded(xml) {
  if (xml.conteudoXml) {
    return;
  }

  if (!xml.apiNfseId || !xml.clientId) {
    throw new Error('Documento sem referencia para recuperar XML na API');
  }

  const result = await apiRequest(`/nfse/${xml.apiNfseId}/xml?clienteId=${encodeURIComponent(xml.clientId)}`);
  const rawXml = result?.xml || (result?.contentBase64 ? atob(result.contentBase64) : '');
  if (!rawXml) {
    throw new Error('Conteudo XML vazio');
  }

  xml.conteudoXml = rawXml;
}

async function ensureNfeContentLoaded(doc) {
  if (doc.conteudoXml) {
    return;
  }

  if (!doc.apiNfeId || !doc.clientId) {
    throw new Error('Documento sem referencia para recuperar XML na API');
  }

  const result = await apiRequest(`/nfe/${doc.apiNfeId}/xml?clienteId=${encodeURIComponent(doc.clientId)}`);
  const rawXml = result?.xml || (result?.contentBase64 ? atob(result.contentBase64) : '');
  if (!rawXml) {
    throw new Error('Conteudo XML vazio');
  }

  doc.conteudoXml = rawXml;
}

async function ensureCteContentLoaded(doc) {
  if (doc.conteudoXml) {
    return;
  }

  if (!doc.apiCteId || !doc.clientId) {
    throw new Error('Documento sem referencia para recuperar XML na API');
  }

  const result = await apiRequest(`/cte/${doc.apiCteId}/xml?clienteId=${encodeURIComponent(doc.clientId)}`);
  const rawXml = result?.xml || (result?.contentBase64 ? atob(result.contentBase64) : '');
  if (!rawXml) {
    throw new Error('Conteudo XML vazio');
  }

  doc.conteudoXml = rawXml;
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
  for (let index = 0; index < len; index += 1) {
    bytes[index] = binary.charCodeAt(index);
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

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) {
    throw new Error('Falha ao copiar texto');
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
  resetXmlSearch();
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
  const node = event.target.closest('[data-action="enable-auto-search"]');
  if (!node) {
    return;
  }

  if (state.manualActivation.running) {
    pushToast('Ja existe uma ativacao manual em andamento.', 'info');
    return;
  }

  if (state.dataSource !== 'api') {
    startExecutionMonitor('Automatica', state.clients.length || 1, 'Executando busca automatica (mock)...');
    state.executionMonitor.currentClientName = state.clients[0]?.razaoSocial || 'Cliente exemplo';
    state.executionMonitor.lastXml = getLastXmlSummary();
    finishExecutionMonitor('Busca automatica mock finalizada.');
    pushToast('Busca automatica habilitada (mock).', 'success');
    return;
  }

  void (async () => {
    const clients = [...state.clients];
    if (!clients.length) {
      pushToast('Nenhum cliente disponivel para ativar busca automatica.', 'error');
      return;
    }

    state.manualActivation.running = true;
    state.manualActivation.stopRequested = false;
    startExecutionMonitor(
      'Automatica',
      clients.length,
      `Ativando busca automatica e executando sincronizacao para ${clients.length} cliente(s)...`
    );
    pushToast(`Ativando busca automatica para ${clients.length} cliente(s)...`, 'info');

    let resumed = 0;
    let initialized = 0;
    let failed = 0;
    let interrupted = false;

    try {
      for (let index = 0; index < clients.length; index += 1) {
        if (state.manualActivation.stopRequested) {
          interrupted = true;
          break;
        }

        const client = clients[index];
        state.executionMonitor.currentClientName = client.razaoSocial;
        state.executionMonitor.message = `Executando para empresa ${client.razaoSocial}`;
        state.executionMonitor.updatedAt = new Date().toISOString();
        render();

        try {
          const resumedResult = await apiRequest(`/clientes/${client.id}/sync/retomar`, { method: 'POST' });
          const resumedCount = Number(resumedResult?.total || 0);
          if (resumedCount > 0) {
            resumed += 1;
            updateExecutionMonitorStep(client.razaoSocial, true, `Sync retomado para ${client.razaoSocial}.`);
            continue;
          }

          await apiRequest(`/clientes/${client.id}/sync/iniciar`, {
            method: 'POST',
            body: { modo: 'diario' }
          });
          initialized += 1;
          updateExecutionMonitorStep(client.razaoSocial, true, `Sync inicializado para ${client.razaoSocial}.`);
        } catch {
          failed += 1;
          updateExecutionMonitorStep(client.razaoSocial, false, `Falha ao ativar sync para ${client.razaoSocial}.`);
        }

        if ((index + 1) % 3 === 0 || index === clients.length - 1 || state.manualActivation.stopRequested) {
          await refreshApiData();
          syncExecutionMonitorWithData();
          render();
        }
      }

      if (interrupted || state.manualActivation.stopRequested) {
        return;
      }

      try {
        state.executionMonitor.message = 'Disparando execucao imediata da busca...';
        state.executionMonitor.updatedAt = new Date().toISOString();
        render();
        await apiRequest('/sync/rodar-agora', { method: 'POST' });
      } catch {
        // Ignora erro aqui: os inicios individuais podem ter disparado execucao.
      }

      await refreshApiData();
      finishExecutionMonitor('Execucao concluida. Consulte o ultimo XML baixado no painel.');
      pushToast(
        `Busca automatica ligada para ${resumed + initialized} cliente(s) (${resumed} retomados, ${initialized} inicializados)${failed ? `, ${failed} falha(s)` : ''}.`,
        failed ? 'error' : 'success'
      );
    } finally {
      state.manualActivation.running = false;
      state.manualActivation.stopRequested = false;
    }
  })();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="open-new-manual-run"]');
  if (!node) {
    return;
  }
  if (state.dataSource !== 'api') {
    startExecutionMonitor('Manual', 1, 'Executando busca manual (mock)...');
    state.executionMonitor.currentClientName = 'Lote manual';
    state.executionMonitor.lastXml = getLastXmlSummary();
    finishExecutionMonitor('Busca manual mock finalizada.');
    pushToast('Nova busca manual agendada (mock).', 'success');
    return;
  }

  void (async () => {
    try {
      const totalAtivos = state.clients.filter((client) => client.buscaAtiva).length || state.clients.length;
      startExecutionMonitor('Manual', totalAtivos, 'Executando busca manual para clientes ativos...');
      state.executionMonitor.currentClientName = 'Processamento em lote';
      state.executionMonitor.updatedAt = new Date().toISOString();
      render();

      const result = await apiRequest('/sync/rodar-agora', { method: 'POST' });

      state.executionMonitor.processed = Number(result?.processed || state.executionMonitor.processed || 0);
      state.executionMonitor.successful = state.executionMonitor.processed;
      state.executionMonitor.failed = 0;
      state.executionMonitor.message = 'Busca manual concluida. Atualizando painel...';
      state.executionMonitor.updatedAt = new Date().toISOString();
      render();

      pushToast('Busca manual executada com sucesso.', 'success');
      await refreshApiData();
      finishExecutionMonitor(
        `Busca manual finalizada. Clientes processados: ${Number(result?.processed || 0)}. XMLs salvos: ${Number(result?.documentsSaved || 0)}.`
      );
    } catch (error) {
      state.executionMonitor.failed += 1;
      finishExecutionMonitor('Busca manual finalizada com falha.');
      pushToast(`Falha ao executar busca manual: ${toErrorMessage(error)}`, 'error');
    }
  })();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="disable-manual-started-search"]');
  if (!node) {
    return;
  }

  if (state.manualActivation.disabling) {
    pushToast('Desligamento da busca ja esta em andamento.', 'info');
    return;
  }

  state.manualActivation.stopRequested = true;

  if (state.dataSource !== 'api') {
    finishExecutionMonitor('Busca manual desligada (mock).');
    pushToast('Busca manual desligada (mock).', 'success');
    state.manualActivation.stopRequested = false;
    return;
  }

  void (async () => {
    const clients = [...state.clients];
    if (!clients.length) {
      pushToast('Nenhum cliente disponivel para pausar sincronizacao.', 'error');
      state.manualActivation.stopRequested = false;
      return;
    }

    state.manualActivation.disabling = true;
    startExecutionMonitor('Automatica', clients.length, `Desligando busca para ${clients.length} cliente(s)...`);
    state.executionMonitor.currentClientName = 'Pausando sincronizacoes';
    state.executionMonitor.updatedAt = new Date().toISOString();
    render();

    try {
      const summary = await pauseSyncForAllClients(clients);
      await refreshApiData();
      finishExecutionMonitor(
        `Busca desligada. Clientes pausados: ${summary.clientsPaused}/${summary.clientsProcessed}. Controles pausados: ${summary.controlsPaused}.`
      );
      pushToast(
        `Busca desligada para ${summary.clientsPaused} cliente(s)${summary.failed ? `, com ${summary.failed} falha(s)` : ''}.`,
        summary.failed ? 'error' : 'success'
      );
    } finally {
      state.manualActivation.disabling = false;
      state.manualActivation.stopRequested = false;
    }
  })();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="open-schedule-reprocess"]');
  if (!node) {
    return;
  }
  if (state.dataSource !== 'api') {
    pushToast('Reprocessamento agendado para a proxima janela noturna (mock).', 'success');
    return;
  }

  void (async () => {
    try {
      await apiRequest('/sync/rodar-agora', { method: 'POST' });
      pushToast('Reprocessamento iniciado para controles ativos.', 'success');
      await refreshApiData();
    } catch (error) {
      pushToast(`Falha ao iniciar reprocessamento: ${toErrorMessage(error)}`, 'error');
    }
  })();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="settings-test-run"]');
  if (!node) {
    return;
  }
  if (state.dataSource !== 'api') {
    pushToast('Teste da rotina noturna iniciado (mock).', 'info');
    return;
  }

  void (async () => {
    try {
      await apiRequest('/sync/rodar-agora', { method: 'POST' });
      pushToast('Execucao de teste disparada com sucesso.', 'success');
      await refreshApiData();
    } catch (error) {
      pushToast(`Falha ao executar teste: ${toErrorMessage(error)}`, 'error');
    }
  })();
});

document.addEventListener('click', (event) => {
  const node = event.target.closest('[data-action="settings-test-storage"]');
  if (!node) {
    return;
  }
  pushToast('Conexao com servidor validada com sucesso (mock).', 'success');
});
