const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const drawerRoot = document.getElementById('drawerRoot');
const toastRoot = document.getElementById('toastRoot');
const API_TIMEOUT_MS = 20000;
const SEARCH_PAGE_SIZE = 100;
const DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 60000;
const AUTH_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const AUTH_ACTIVE_REQUEST_WINDOW_MS = 30 * 1000;
const AUTH_ACTIVITY_PING_INTERVAL_MS = 60 * 1000;
const AUTH_STORAGE_KEY = 'gcont:auth:v1';
const THEME_STORAGE_KEY = 'gcont:theme:v1';
const RESOLVED_ALERTS_STORAGE_KEY = 'gcont:resolved-alerts:v1';
const COMPARE_SPED_HISTORY_STORAGE_KEY = 'gcont:compare-sped-history:v1';
const COMPARE_SPED_HISTORY_LIMIT = 10;
const XML_READER30_NFE_COLUMN_ORDER_STORAGE_KEY = 'gcont:xml-reader30-nfe-column-order:v1';
const XML_READER30_NFE_COLUMN_WIDTHS_STORAGE_KEY = 'gcont:xml-reader30-nfe-column-widths:v1';
const XML_READER30_NFE_REGIME_STORAGE_KEY = 'gcont:xml-reader30-nfe-regime:v1';
const XML_READER30_SCROLL_SELECTORS = ['.xml-reader30-top-scroll', '.xml-reader30-pan-scroll'];
const XML_READER30_NFE_DEFAULT_COLUMN_ORDER = [
  'select',
  'numeroNf',
  'statusNf',
  'nfCancelada',
  'dataEmissao',
  'produto',
  'quantidade',
  'valorUnitario',
  'valorTotal',
  'valorTotalNfXml',
  'icmsStRet',
  'cstCsosn',
  'cfop',
  'baseCalculoIcms',
  'aliquotaIcms',
  'valorIcms',
  'qBCMonoRet',
  'adRemICMSRet',
  'vICMSMonoRet',
  'aliqVigente',
  'valorCorreto',
  'evento'
];
const XML_READER30_NFE_SIMPLE_NATIONAL_HIDDEN_COLUMNS = [
  'nfCancelada',
  'icmsStRet',
  'baseCalculoIcms',
  'aliquotaIcms',
  'valorIcms',
  'qBCMonoRet',
  'adRemICMSRet',
  'vICMSMonoRet',
  'aliqVigente',
  'valorCorreto',
  'evento'
];
const NFSE_FISCAL_READER_DEFAULT_COLUMN_ORDER = [
  'numeroNfse',
  'localPrestacao',
  'localIncidenciaIss',
  'prestador',
  'cnpjPrestador',
  'tomador',
  'cnpjTomador',
  'valorLiquidoNfse',
  'valorTotalRetencoes',
  'valorServico',
  'valorIss',
  'valorPis',
  'valorCofins',
  'valorInss',
  'valorIrrf',
  'valorCsll',
  'dataEmissao',
  'retencaoIss',
  'retencaoFederal',
  'aliquotaIss',
  'valorIssRetidoReal',
  'aliquotaRealIss',
  'statusProcessamento',
  'erroProcessamento'
];
const NIGHTLY_SWEEP_AVAILABLE_SLOTS = ['18:00', '20:00', '22:00', '00:00', '02:00', '04:00', '06:00'];
const NFE_DOMINIO_ALL_CLIENTS_OPTION = '__all_clients__';
let dashboardAutoRefreshTimer = null;
let dashboardAutoRefreshRunning = false;
let xmlReader30ScrollSyncing = false;
let lastRenderedRouteKey = null;
let authRefreshPromise = null;
let authInactivityTimer = null;
let lastAuthInteractionAt = 0;
let lastAuthActivityPingAt = 0;
let authActivityPingPromise = null;
const initialXmlReader30NfeRegime = loadXmlReader30NfeRegimeStore();
const initialXmlReader30NfeColumnWidths = loadXmlReader30NfeColumnWidthsStore();

function buildDefaultAccessReportRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return {
    periodoInicio: extractCalendarDateKey(start) || '',
    periodoFim: extractCalendarDateKey(end) || ''
  };
}

function createEmptyAuthAdminData() {
  const range = buildDefaultAccessReportRange();
  return {
    loading: false,
    users: [],
    sessions: [],
    events: [],
    report: {
      periodoInicio: range.periodoInicio,
      periodoFim: range.periodoFim,
      rows: []
    },
    lastLoadedAt: null
  };
}

function clearAuthInactivityTimer() {
  if (authInactivityTimer) {
    window.clearTimeout(authInactivityTimer);
    authInactivityTimer = null;
  }
}

function finalizeLoggedOutState() {
  clearAuthState();
  state.dataReady = false;
  stopPageLoading();
  syncDashboardAutoRefresh();
  render();
}

function handleAuthIdleTimeout() {
  if (!state.auth.accessToken && !state.auth.refreshToken) {
    clearAuthInactivityTimer();
    return;
  }

  finalizeLoggedOutState();
  pushToast('Sessao encerrada por 10 minutos de inatividade. Entre novamente para continuar.', 'info');
}

async function syncAuthSessionActivity() {
  if (authActivityPingPromise || (!state.auth.accessToken && !state.auth.refreshToken)) {
    return authActivityPingPromise;
  }

  const now = Date.now();
  if (now - lastAuthActivityPingAt < AUTH_ACTIVITY_PING_INTERVAL_MS) {
    return null;
  }

  lastAuthActivityPingAt = now;
  authActivityPingPromise = (async () => {
    try {
      const payload = await apiRequest('/auth/me', {
        suppressAuthFailureToast: true,
        sessionActivity: 'active'
      });
      if (payload?.user) {
        state.auth.user = payload.user;
        persistAuthState();
      }
      return payload;
    } catch {
      return null;
    } finally {
      authActivityPingPromise = null;
    }
  })();

  return authActivityPingPromise;
}

function scheduleAuthInactivityTimeout() {
  clearAuthInactivityTimer();

  if ((!state.auth.accessToken && !state.auth.refreshToken) || !lastAuthInteractionAt) {
    return;
  }

  const remainingMs = Math.max(0, AUTH_IDLE_TIMEOUT_MS - (Date.now() - lastAuthInteractionAt));
  authInactivityTimer = window.setTimeout(handleAuthIdleTimeout, remainingMs);
}

function registerAuthInteraction(options = {}) {
  lastAuthInteractionAt = Date.now();
  scheduleAuthInactivityTimeout();
  if (!options.skipPing && (state.auth.accessToken || state.auth.refreshToken)) {
    void syncAuthSessionActivity();
  }
}

function resolveAuthSessionActivityHeader(options = {}) {
  if (options.sessionActivity === 'active' || options.sessionActivity === 'passive') {
    return options.sessionActivity;
  }

  if (document.visibilityState === 'hidden') {
    return 'passive';
  }

  return Date.now() - lastAuthInteractionAt <= AUTH_ACTIVE_REQUEST_WINDOW_MS ? 'active' : 'passive';
}

const navItems = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', route: '/dashboard' },
  { key: 'clientes', label: 'Clientes', icon: 'users', route: '/clientes' },
  { key: 'certificados', label: 'Certificados', icon: 'shield', route: '/certificados' },
  { key: 'buscas', label: 'Buscas', icon: 'search', route: '/buscas' },
  { key: 'armazenados', label: 'Armazenados', icon: 'file', route: '/xmls' },
  { key: 'auditoria-lacunas', label: 'Auditoria NFS-e', icon: 'alert', route: '/auditoria-lacunas' },
  { key: 'compara-sped', label: 'Compara SPED', icon: 'compare', route: '/compara-sped' },
  { key: 'leitor-xml', label: 'Leitor XML 3.0', icon: 'file', route: '/leitor-xml' },
  { key: 'configuracoes', label: 'Configuracoes', icon: 'settings', route: '/configuracoes' },
  { key: 'alertas', label: 'Alertas', icon: 'alert', route: '/alertas' }
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
  'auditoria-lacunas': {
    title: 'Auditoria de Lacunas',
    description: 'Liste por empresa as numeracoes visiveis em aberto e acione a auditoria das lacunas.'
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
  },
  'compara-sped': {
    title: 'Compara SPED',
    description: 'Compare arquivos SPED Fiscal com os documentos integrados da Dominio.'
  },
  'leitor-xml': {
    title: 'Leitor XML 3.0',
    description: 'Consulte e abra XMLs ja armazenados no Nota Sync.'
  }
};

const state = {
  route: parseRoute(window.location.hash),
  mobileSidebarOpen: false,
  dataReady: false,
  dataSource: 'api',
  auth: {
    initialized: false,
    authenticating: false,
    accessToken: '',
    refreshToken: '',
    sessionExpiresAt: '',
    user: null,
    adminData: createEmptyAuthAdminData()
  },
  pageLoading: {
    active: false,
    title: '',
    description: '',
    currentTask: '',
    completedTasks: []
  },
  modal: null,
  drawer: null,
  toasts: [],
  selectedClientIds: new Set(),
  selectedAlertIds: new Set(),
  selectedXmlIds: new Set(),
  selectedNfeIds: new Set(),
  selectedXmlReaderIds: new Set(),
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
    manualImport: true,
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
    numberingValidation: null,
    informativeRows: 0,
    lastSearchedAt: null,
    page: 1,
    pageSize: SEARCH_PAGE_SIZE,
    total: 0,
    totalPages: 0
  },
  nfseFiscalReader: {
    rows: [],
    summary: null,
    resumoPorMunicipio: null,
    lastQuery: null,
    lastLoadedAt: null,
    exportConfig: {
      codigoEmpresa: '',
      tipoRegistro: 'Entrada',
      contas: 'Padrao',
      produtoPadrao: '557',
      exporting: false
    },
    columnOrder: [...NFSE_FISCAL_READER_DEFAULT_COLUMN_ORDER],
    hiddenColumns: new Set(),
    columnMenuOpenKey: null,
    columnMenuAnchor: null,
    columnDrag: null
  },
  nfseGapAuditOverview: {
    rows: [],
    lastLoadedAt: null
  },
  nfseGapAuditRecoverAll: {
    active: false
  },
  rowActionsMenu: {
    openId: null,
    anchor: null
  },
  xmlReader30: {
    activeTab: 'nfe',
    hasSearched: false,
    results: [],
    lastQuery: null,
    lastSearchedAt: null,
    total: 0,
    sourceTotals: {
      nfse: 0,
      nfe: 0,
      cte: 0
    },
    nfeColumnOrder: loadXmlReader30NfeColumnOrderStore(),
    nfeColumnWidths: initialXmlReader30NfeColumnWidths,
    nfeRegime: initialXmlReader30NfeRegime,
    hiddenNfeColumns: new Set(getXmlReader30NfeRegimeHiddenColumns(initialXmlReader30NfeRegime)),
    cstFilter: '',

    selectionDrag: null,
    scrollDrag: null,
    columnMenuOpenKey: null,
    columnMenuAnchor: null,
    columnDrag: null,
    columnResize: null
  },
  difalReader: {
    hasSearched: false,
    lastQuery: null,
    lastLoadedAt: null,
    summary: null,
    itemRows: [],
    chartGrouping: 'dia',
    chartPoints: [],
    chartRenderPoints: [],
    chartViewBox: null
  },
  alerts: [],
  serverResolvedAlerts: {},
  resolvedAlerts: loadResolvedAlertsStore(),
  compareSped: {
    status: 'idle',
    sourceFileName: '',
    sourceCompetence: '',
    sourceCompanyId: '',
    outputFormat: 'Excel',
    generatedAt: null,
    report: null,
    artifact: null,
    history: loadCompareSpedHistoryStore(),
    lastError: ''
  },
  establishmentsByClient: {},
  syncByClient: {},
  dashboardStats: null,
  schedulerStatus: null,
  settings: {
    tab: 'geral',
    geral: {
      nomeAmbiente: 'GCONT - Ambiente Interno',
      modoOperacao: 'Producao',
      statusSistema: 'Operacional',
      tema: readStoredTheme()
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
    aliquotas: {
      periodos: [],
      draftPeriodos: null,
      saving: false,
      errorMessage: ''
    },
    acessos: {
      creatingUser: false
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
      eventos: 'Todos',
      schemaDoc: 'Todos',
      valorMin: '',
      valorMax: '',
      xmlCompleto: 'Todos',
      ambiente: 'producao'
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
      eventos: 'Todos',
      tipoEvento: '',
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
    nfseFiscalReader: 'loading',
    nfseGapAudit: 'loading',
    nfeDocs: 'loading',
    cteDocs: 'loading',
    xmlReader30: 'loading',
    difalReader: 'data',
    alerts: 'loading'
  },
  sort: {
    xmls: {
      key: 'dataDownload',
      direction: 'desc'
    },
    xmlReader30: {
      key: 'dataEmissao',
      direction: 'desc'
    },
    nfeDocs: {
      key: 'dataEmissao',
      direction: 'desc'
    },
    cteDocs: {
      key: 'dataEmissao',
      direction: 'desc'
    },
    nfseFiscalReader: {
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

  applyTheme(state.settings.geral.tema);
  restoreAuthState();
  wireGlobalEvents();
  render();
  void initializeApp();
}

async function initializeApp() {
  const authenticated = await ensureAuthenticatedSession();
  state.auth.initialized = true;
  render();

  if (!authenticated) {
    return;
  }

  await initializeData();
}

async function initializeData() {
  startPageLoading(buildPageLoadingPlan(state.route));
  setGlobalLoading(true);
  render();

  await wait(250);

  try {
    await hydrateFromApi({ onProgress: updatePageLoadingTask });
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
  await ensureRouteDataLoaded({ silent: true, onProgress: updatePageLoadingTask });
  stopPageLoading();
  render();
  syncDashboardAutoRefresh();
}

async function hydrateFromApi(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  onProgress?.('Validando usuario autenticado');
  const me = await apiRequest('/auth/me');
  if (!me?.user) {
    throw new Error('Resposta inesperada em /auth/me');
  }
  state.auth.user = me.user;
  persistAuthState();

  onProgress?.('Carregando clientes');
  const apiClientsRaw = await apiRequest('/clientes');
  if (!Array.isArray(apiClientsRaw)) {
    throw new Error('Resposta inesperada em /clientes');
  }

  const apiClients = apiClientsRaw.map((client) => ({
    ...client,
    cnpj: normalizeDigits(client.cnpj || '')
  }));
  const clientIds = apiClients.map((client) => client.id);

  onProgress?.('Carregando certificados, controles e documentos');
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
    persistedAlerts,
    persistedAlertResolutions,
    auditRows,
    schedulerStatus,
    compareSpedHistoryRaw,
    monofasicoAliquotasConfig
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
    apiRequest('/alertas').catch(() => []),
    apiRequest('/alertas/resolucoes').catch(() => []),
    apiRequest('/auditoria').catch(() => []),
    apiRequest('/sync/scheduler-status').catch(() => null),
    apiRequest(`/comparacoes-sped?limit=${COMPARE_SPED_HISTORY_LIMIT}`).catch(() => []),
    apiRequest('/nfe/xml-reader30/aliquotas-monofasico').catch(() => null)
  ]);

  const nfseDocsPage = normalizePaginatedResponse(nfseDocs);
  const nfeDocsPage = normalizePaginatedResponse(nfeDocs);
  const cteDocsPage = normalizePaginatedResponse(cteDocs);

  onProgress?.('Montando dashboard, listas e alertas');
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
  const alerts = [
    ...buildPersistentAlertsFromApi(persistedAlerts),
    ...buildAlertsFromApi(certificates, syncByClient, clients, xmlFiles, auditRows)
  ];

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
  state.serverResolvedAlerts = buildResolvedAlertsStoreFromApi(persistedAlertResolutions);
  state.alerts = applyResolvedAlertState(alerts);
  state.establishmentsByClient = establishmentsByClient;
  state.syncByClient = syncByClient;
  state.dashboardStats = dashboardStats;
  state.schedulerStatus = schedulerStatus;
  state.compareSped.history = mergeCompareSpedHistorySources(
    loadCompareSpedHistoryStore(),
    Array.isArray(compareSpedHistoryRaw) ? compareSpedHistoryRaw : []
  );
  applySchedulerStatusToSettings(schedulerStatus);
  applyMonofasicoAliquotasToSettings(monofasicoAliquotasConfig);
  syncExecutionMonitorWithData();
}

function wireGlobalEvents() {
  window.addEventListener('hashchange', () => {
    state.route = parseRoute(window.location.hash);
    state.mobileSidebarOpen = false;
    render();
    void handleRouteAccess();
  });

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('contextmenu', onDocumentContextMenu);
  document.addEventListener('submit', onDocumentSubmit);
  document.addEventListener('change', onDocumentChange);
  document.addEventListener('keydown', registerAuthInteraction, true);
  document.addEventListener('pointerdown', registerAuthInteraction, true);
  document.addEventListener('touchstart', registerAuthInteraction, true);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'visible') {
        registerAuthInteraction();
      }
    },
    true
  );
  document.addEventListener('scroll', onDocumentScroll, true);
  document.addEventListener('mousedown', onDocumentMouseDown);
  document.addEventListener('mousemove', onDocumentMouseMove);
  document.addEventListener('mouseover', onDocumentMouseOver);
  document.addEventListener('mouseup', onDocumentMouseUp);
  document.addEventListener('dragstart', onDocumentDragStart);
  document.addEventListener('dragover', onDocumentDragOver);
  document.addEventListener('drop', onDocumentDrop);
  document.addEventListener('dragend', onDocumentDragEnd);
}

function onDocumentContextMenu(event) {
  const rowNode = event.target.closest('[data-row-actions-menu-id]');
  if (!rowNode) {
    return;
  }

  const menuId = rowNode.getAttribute('data-row-actions-menu-id') || '';
  if (!menuId) {
    return;
  }

  event.preventDefault();
  const estimatedWidth = 200;
  const estimatedMenuHeight = 220;
  const left = Math.min(window.innerWidth - estimatedWidth - 8, Math.max(8, event.clientX));
  const spaceBelow = window.innerHeight - event.clientY;
  const anchor =
    spaceBelow < estimatedMenuHeight && event.clientY > spaceBelow
      ? { left, bottom: Math.max(8, window.innerHeight - event.clientY) }
      : { left, top: Math.min(window.innerHeight - 12, event.clientY) };
  openRowActionsMenuAt(menuId, anchor);
}

function computeMenuAnchorFromRect(rect, estimatedWidth = 200) {
  const estimatedMenuHeight = 220;
  const left = Math.min(window.innerWidth - estimatedWidth - 8, Math.max(8, rect.right - estimatedWidth));
  const spaceBelow = window.innerHeight - rect.bottom;

  if (spaceBelow < estimatedMenuHeight && rect.top > spaceBelow) {
    return { left, bottom: Math.max(8, window.innerHeight - rect.top + 6) };
  }

  return { left, top: Math.min(window.innerHeight - 12, rect.bottom + 6) };
}

function openRowActionsMenuAt(menuId, anchor) {
  state.rowActionsMenu.openId = menuId;
  state.rowActionsMenu.anchor = anchor;
  renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
}

function closeRowActionsMenu() {
  if (!state.rowActionsMenu.openId) {
    return;
  }
  state.rowActionsMenu.openId = null;
  state.rowActionsMenu.anchor = null;
}

function toggleRowActionsMenu(menuId, anchorNode) {
  const normalizedId = String(menuId || '').trim();
  if (!normalizedId) {
    return;
  }

  if (state.rowActionsMenu.openId === normalizedId) {
    closeRowActionsMenu();
    renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
    return;
  }

  const rect = anchorNode instanceof HTMLElement ? anchorNode.getBoundingClientRect() : null;
  openRowActionsMenuAt(normalizedId, rect ? computeMenuAnchorFromRect(rect) : { left: 8, top: 8 });
}

function onDocumentClick(event) {
  const actionNode = event.target.closest('[data-action]');
  if (!actionNode) {
    let shouldRender = false;
    if (state.xmlReader30.columnMenuOpenKey) {
      closeXmlReader30NfeColumnMenu();
      shouldRender = true;
    }
    if (state.nfseFiscalReader.columnMenuOpenKey) {
      closeNfseFiscalReaderColumnMenu();
      shouldRender = true;
    }
    if (state.rowActionsMenu.openId) {
      closeRowActionsMenu();
      shouldRender = true;
    }
    if (shouldRender) {
      renderPreservingScroll([...XML_READER30_SCROLL_SELECTORS, '.nfse-fiscal-reader-scroll']);
    }
    return;
  }

  const action = actionNode.getAttribute('data-action');
  if (!action) {
    return;
  }

  if (action === 'overlay-close' && event.target !== actionNode) {
    return;
  }

  if (action === 'alert-toggle-resolved') {
    return;
  }

  if (action === 'xml-reader30-select') {
    return;
  }

  if (action === 'xml-reader30-column-resize') {
    return;
  }

  const isXmlReader30ColumnMenuAction = action === 'xml-reader30-column-menu-toggle' || action === 'xml-reader30-column-menu-hide';
  if (state.xmlReader30.columnMenuOpenKey && !isXmlReader30ColumnMenuAction && !event.target.closest('[data-xml-reader30-column-menu-wrap]')) {
    closeXmlReader30NfeColumnMenu();
  }
  const isNfseFiscalColumnMenuAction = action === 'nfse-fiscal-column-menu-toggle' || action === 'nfse-fiscal-column-menu-hide';
  if (state.nfseFiscalReader.columnMenuOpenKey && !isNfseFiscalColumnMenuAction && !event.target.closest('[data-nfse-fiscal-column-menu-wrap]')) {
    closeNfseFiscalReaderColumnMenu();
  }
  if (state.rowActionsMenu.openId && action !== 'row-actions-menu-toggle') {
    closeRowActionsMenu();
  }

  event.preventDefault();

  switch (action) {
    case 'row-actions-menu-toggle': {
      const menuId = actionNode.getAttribute('data-menu-id') || '';
      toggleRowActionsMenu(menuId, actionNode);
      return;
    }
    case 'navigate': {
      const route = actionNode.getAttribute('data-route');
      if (route) {
        navigate(route);
      }
      return;
    }
    case 'compare-sped-download': {
      void downloadCompareSpedArtifact();
      return;
    }
    case 'compare-sped-redownload': {
      const compareId = actionNode.getAttribute('data-compare-id');
      if (!compareId) {
        return;
      }
      void downloadCompareSpedHistoryItem(compareId);
      return;
    }
    case 'compare-sped-reset': {
      resetCompareSpedState();
      render();
      return;
    }
    case 'compare-sped-open-last': {
      openCompareSpedReportModal();
      return;
    }
    case 'xmlReader30-clear': {
      resetXmlReader30Search();
      render();
      return;
    }
    case 'xml-reader30-sort': {
      const key = actionNode.getAttribute('data-sort-key');
      if (!key) {
        return;
      }
      updateXmlReader30Sort(key);
      return;
    }
    case 'xml-reader30-switch-tab': {
      const tab = actionNode.getAttribute('data-tab');
      if (!tab) {
        return;
      }
      state.xmlReader30.activeTab = tab === 'nfse-fiscal' || tab === 'difal' ? tab : 'nfe';
      render();
      return;
    }
    case 'difalReader-clear': {
      resetDifalReader();
      render();
      return;
    }
    case 'xml-reader30-column-menu-toggle': {
      const columnKey = actionNode.getAttribute('data-column-key');
      if (!columnKey) {
        return;
      }
      toggleXmlReader30NfeColumnMenu(columnKey, actionNode);
      return;
    }
    case 'xml-reader30-column-menu-hide': {
      const columnKey = actionNode.getAttribute('data-column-key');
      if (!columnKey) {
        return;
      }
      hideXmlReader30NfeColumn(columnKey);
      return;
    }
    case 'xml-reader30-open-fullscreen': {
      void openXmlReader30Fullscreen();
      return;
    }
    case 'nfse-fiscal-sort': {
      const key = actionNode.getAttribute('data-sort-key');
      if (!key) {
        return;
      }
      updateNfseFiscalReaderSort(key);
      return;
    }
    case 'nfse-fiscal-column-menu-toggle': {
      const columnKey = actionNode.getAttribute('data-column-key');
      if (!columnKey) {
        return;
      }
      toggleNfseFiscalReaderColumnMenu(columnKey, actionNode);
      return;
    }
    case 'nfse-fiscal-column-menu-hide': {
      const columnKey = actionNode.getAttribute('data-column-key');
      if (!columnKey) {
        return;
      }
      hideNfseFiscalReaderColumn(columnKey);
      return;
    }
    case 'nfse-fiscal-show-all-columns': {
      restoreAllNfseFiscalReaderColumns();
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
      if (
        (
          state.modal?.kind === 'events-sync-report' ||
          state.modal?.kind === 'dominio-import-report'
        ) &&
        state.modal.running
      ) {
        return;
      }
      closeModal();
      return;
    }
    case 'overlay-toggle-failures': {
      if (
        state.modal?.kind === 'events-sync-report' ||
        state.modal?.kind === 'past-nsu-recovery-report' ||
        state.modal?.kind === 'download-by-key-report' ||
        state.modal?.kind === 'dominio-import-report'
      ) {
        state.modal = {
          ...state.modal,
          showOnlyFailures: !Boolean(state.modal.showOnlyFailures)
        };
        render();
      }
      return;
    }
    case 'close-drawer': {
      closeDrawer();
      return;
    }
    case 'dashboard-open-cte-disagreement-alerts': {
      openModal({ kind: 'cte-disagreement-alerts' });
      return;
    }
    case 'dashboard-open-nfse-retention-alerts': {
      openModal({ kind: 'nfse-retention-alerts', empresaId: '' });
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
    case 'client-buscar-codigo-empresa-dominio': {
      void buscarCodigoEmpresaDominioAutomatico();
      return;
    }
    case 'clients-toggle-all': {
      const checked = actionNode.checked;
      const filtered = getFilteredClients();
      state.selectedClientIds = checked ? new Set(filtered.map((item) => item.id)) : new Set();
      renderPreservingScroll();
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
      renderPreservingScroll();
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
    case 'nfe-download-by-key-global': {
      void runNfeDownloadByKey();
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
    case 'nfe-download-by-key-control': {
      const clientId = actionNode.getAttribute('data-client-id');
      const estabelecimentoId = actionNode.getAttribute('data-estabelecimento-id') || '';
      const ambiente = actionNode.getAttribute('data-ambiente') || 'producao';
      if (!clientId) {
        return;
      }
      void runNfeDownloadByKey({
        clienteId: clientId,
        estabelecimentoId: estabelecimentoId || undefined,
        ambiente,
        limitControles: 1
      });
      return;
    }
    case 'nfse-recover-by-dps': {
      openNfseRecoverByDpsModal();
      return;
    }
    case 'nfse-recover-by-key': {
      openNfseRecoverByKeyModal();
      return;
    }
    case 'nfse-open-numbering-exception': {
      openNfseNumberingExceptionModalForContext(getCurrentNfseGapContext());
      return;
    }
    case 'nfse-audit-gap-nsus': {
      void runNfseGapAuditFromCurrentSearch();
      return;
    }
    case 'gap-audit-refresh': {
      void loadNfseGapAuditOverview();
      return;
    }
    case 'gap-audit-recover-dps-all': {
      void runNfseGapAuditRecoverAllByDps();
      return;
    }
    case 'gap-audit-open-xmls': {
      const clientId = actionNode.getAttribute('data-client-id') || '';
      const row = findNfseGapAuditRowByClientId(clientId);
      if (!row) {
        pushToast('Nao foi possivel localizar a empresa selecionada na auditoria.', 'error');
        return;
      }
      void openXmlSearchForGapContext(getNfseGapContextFromAuditRow(row));
      return;
    }
    case 'gap-audit-run-nsu': {
      const clientId = actionNode.getAttribute('data-client-id') || '';
      const row = findNfseGapAuditRowByClientId(clientId);
      if (!row) {
        pushToast('Nao foi possivel localizar a empresa selecionada na auditoria.', 'error');
        return;
      }
      void runNfseGapAuditForContext(getNfseGapContextFromAuditRow(row));
      return;
    }
    case 'gap-audit-recover-dps': {
      const clientId = actionNode.getAttribute('data-client-id') || '';
      const row = findNfseGapAuditRowByClientId(clientId);
      if (!row) {
        pushToast('Nao foi possivel localizar a empresa selecionada na auditoria.', 'error');
        return;
      }
      openNfseRecoverByDpsModalForContext(getNfseGapContextFromAuditRow(row));
      return;
    }
    case 'gap-audit-recover-key': {
      const clientId = actionNode.getAttribute('data-client-id') || '';
      const row = findNfseGapAuditRowByClientId(clientId);
      if (!row) {
        pushToast('Nao foi possivel localizar a empresa selecionada na auditoria.', 'error');
        return;
      }
      openNfseRecoverByKeyModalForContext(getNfseGapContextFromAuditRow(row));
      return;
    }
    case 'gap-audit-open-numbering-exception': {
      const clientId = actionNode.getAttribute('data-client-id') || '';
      const row = findNfseGapAuditRowByClientId(clientId);
      if (!row) {
        pushToast('Nao foi possivel localizar a empresa selecionada na auditoria.', 'error');
        return;
      }
      openNfseNumberingExceptionModalForContext(getNfseGapContextFromAuditRow(row));
      return;
    }
    case 'nfse-delete-numbering-exception': {
      const exceptionId = actionNode.getAttribute('data-exception-id') || '';
      if (!exceptionId) {
        return;
      }
      void deleteNfseNumberingException(exceptionId);
      return;
    }
    case 'nfse-open-conta-contabil-config': {
      const clientId = actionNode.getAttribute('data-client-id') || '';
      if (!clientId) {
        pushToast('Selecione uma empresa para gerenciar as contas por codigo de servico.', 'error');
        return;
      }
      openNfseContaContabilConfigModal(clientId);
      return;
    }
    case 'nfse-delete-conta-contabil-config': {
      const configId = actionNode.getAttribute('data-config-id') || '';
      if (!configId) {
        return;
      }
      void deleteNfseContaContabilConfig(configId);
      return;
    }
    case 'nfse-toggle-conta-contabil-config': {
      const configId = actionNode.getAttribute('data-config-id') || '';
      const nextAtivo = actionNode.getAttribute('data-next-ativo') === 'true';
      if (!configId) {
        return;
      }
      void toggleNfseContaContabilConfigAtivo(configId, nextAtivo);
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
    case 'nfe-docs-download-by-key-client': {
      void runNfeDownloadByKeyForCurrentDocumentsClient();
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
      void openNfeDetails(nfeId);
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
    case 'nfe-download-danfe': {
      const nfeId = actionNode.getAttribute('data-nfe-id');
      if (!nfeId) {
        return;
      }
      void downloadNfeDanfeById(nfeId);
      return;
    }
    case 'nfe-select': {
      const nfeId = actionNode.getAttribute('data-nfe-id');
      if (!nfeId) {
        return;
      }
      if (actionNode.checked) {
        state.selectedNfeIds.add(nfeId);
      } else {
        state.selectedNfeIds.delete(nfeId);
      }
      renderPreservingScroll();
      return;
    }
    case 'nfe-toggle-all': {
      const checked = actionNode.checked;
      getFilteredNfeDocuments().forEach((doc) => {
        if (!doc.apiNfeId) {
          return;
        }
        if (checked) {
          state.selectedNfeIds.add(doc.id);
        } else {
          state.selectedNfeIds.delete(doc.id);
        }
      });
      renderPreservingScroll();
      return;
    }
    case 'nfe-batch-download': {
      const tipoArquivo = actionNode.getAttribute('data-tipo-arquivo') || 'ambos';
      void downloadSelectedNfeBatch(tipoArquivo);
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
      void openCteDetails(cteId);
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
    case 'events-report-open-document': {
      const documentType = actionNode.getAttribute('data-document-type');
      const documentId = actionNode.getAttribute('data-document-id');
      if (!documentType || !documentId) {
        return;
      }
      if (documentType === 'nfe') {
        void openNfeDetails(documentId);
        return;
      }
      if (documentType === 'cte') {
        void openCteDetails(documentId);
        return;
      }
      if (documentType === 'nfse') {
        void openXmlDetails(documentId);
      }
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
      void openXmlDetails(xmlId);
      return;
    }
    case 'xml-toggle-numbering-validation': {
      const xmlId = actionNode.getAttribute('data-xml-id');
      if (!xmlId) {
        return;
      }
      const xml = findXmlById(xmlId);
      if (!xml || !xml.apiNfseId || !xml.clientId) {
        pushToast('Nao foi possivel localizar a NFS-e para alterar a validacao de numeracao.', 'error');
        return;
      }
      const ignore = !Boolean(xml.ignorarNumeracaoValidacao);
      openModal({
        kind: 'confirm',
        title: ignore ? 'Desconsiderar documento na numeracao' : 'Voltar documento para a numeracao',
        subtitle: ignore
          ? `A NFS-e ${xml.numeroNfse || xml.chaveAcesso || xml.id} deixara de participar da validacao de numeracao e da auditoria de lacunas.`
          : `A NFS-e ${xml.numeroNfse || xml.chaveAcesso || xml.id} voltara a participar da validacao de numeracao e da auditoria de lacunas.`,
        confirmLabel: ignore ? 'Desconsiderar documento' : 'Voltar para numeracao',
        intent: ignore ? 'warning' : 'info',
        payload: { type: 'xml-toggle-numbering-validation', xmlId, ignore },
        returnTo: state.modal ? cloneModalState(state.modal) : null
      });
      return;
    }
    case 'xml-reader30-batch-download': {
      void downloadSelectedXmlReader30Batch();
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
      renderPreservingScroll();
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
      renderPreservingScroll();
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
      void markSelectedAlertsResolved();
      return;
    }
    case 'nfse-retention-resolve-company': {
      const companyId = actionNode.getAttribute('data-company-id');
      if (!companyId) {
        return;
      }
      void markNfseRetentionAlertsResolvedByCompany(companyId);
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
      renderPreservingScroll();
      return;
    }
    case 'alert-details': {
      const alertId = actionNode.getAttribute('data-alert-id');
      if (!alertId) {
        return;
      }
      const alert = state.alerts.find((item) => item.id === alertId);
      if (isNfseRetentionAlert(alert)) {
        const returnToModal = state.modal ? cloneModalState(state.modal) : null;
        void openAlertDocument(alertId, { returnToModal, preferDetails: true });
        return;
      }
      state.modal = null;
      openDrawer({ kind: 'alert-details', alertId });
      return;
    }
    case 'alert-open-document': {
      const alertId = actionNode.getAttribute('data-alert-id');
      if (!alertId) {
        return;
      }
      const returnToModal = state.modal ? cloneModalState(state.modal) : null;
      void openAlertDocument(alertId, { returnToModal, preferDetails: true });
      return;
    }
    case 'alert-resolve': {
      const alertId = actionNode.getAttribute('data-alert-id');
      void resolveAlert(alertId);
      return;
    }
    case 'alert-unresolve': {
      const alertId = actionNode.getAttribute('data-alert-id');
      void unresolveAlert(alertId);
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
      if (tab === 'acessos' && state.auth.user?.role === 'admin') {
        void loadAuthAdminData();
      }
      return;
    }
    case 'settings-auth-reload': {
      void loadAuthAdminData();
      return;
    }
    case 'auth-user-toggle-active': {
      const userId = actionNode.getAttribute('data-user-id');
      const nextActive = actionNode.getAttribute('data-next-active') === 'true';
      if (!userId) {
        return;
      }
      void toggleAuthUserActive(userId, nextActive);
      return;
    }
    case 'auth-user-reset-password': {
      const userId = actionNode.getAttribute('data-user-id');
      if (!userId) {
        return;
      }
      void promptAndResetAuthUserPassword(userId);
      return;
    }
    case 'auth-logout': {
      void performLogout();
      return;
    }
    case 'settings-aliquota-add-periodo': {
      syncAliquotaDraftPeriodosFromForm(actionNode.closest('form'));
      state.settings.aliquotas.draftPeriodos.push({ aliquota: '', dataInicio: '', dataFim: '' });
      render();
      return;
    }
    case 'settings-aliquota-remove-periodo': {
      const index = Number(actionNode.getAttribute('data-index'));
      syncAliquotaDraftPeriodosFromForm(actionNode.closest('form'));
      if (state.settings.aliquotas.draftPeriodos.length > 1) {
        state.settings.aliquotas.draftPeriodos.splice(index, 1);
      }
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
      if (
        (
          state.modal?.kind === 'events-sync-report' ||
          state.modal?.kind === 'past-nsu-recovery-report' ||
          state.modal?.kind === 'download-by-key-report' ||
          state.modal?.kind === 'dominio-import-report'
        ) &&
        state.modal.running
      ) {
        return;
      }
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
    case 'authLoginForm': {
      event.preventDefault();
      void submitAuthLoginForm(target);
      return;
    }
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
    case 'nfeDominioImportForm': {
      event.preventDefault();
      void submitNfeDominioImportForm(target);
      return;
    }
    case 'xmlsFilterForm': {
      event.preventDefault();
      void applyXmlFilters(target);
      return;
    }
    case 'difalReaderForm': {
      event.preventDefault();
      void submitDifalReaderForm(target);
      return;
    }
    case 'nfseFiscalDominioExportForm': {
      event.preventDefault();
      void submitNfseFiscalDominioExportForm(target);
      return;
    }
    case 'nfseRecoverByDpsForm': {
      event.preventDefault();
      void submitNfseRecoverByDpsForm(target);
      return;
    }
    case 'nfseRecoverByKeyForm': {
      event.preventDefault();
      void submitNfseRecoverByKeyForm(target);
      return;
    }
    case 'nfseNumberingExceptionForm': {
      event.preventDefault();
      void submitNfseNumberingExceptionForm(target);
      return;
    }
    case 'nfseContaContabilConfigForm': {
      event.preventDefault();
      void submitNfseContaContabilConfigForm(target);
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
    case 'compareSpedForm': {
      event.preventDefault();
      void submitCompareSpedForm(target, event.submitter);
      return;
    }
    case 'xmlReader30Form': {
      event.preventDefault();
      void submitXmlReader30Form(target);
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
    case 'settingsAliquotasForm': {
      event.preventDefault();
      void submitSettingsAliquotasForm(target);
      return;
    }
    case 'settingsAuthUserForm': {
      event.preventDefault();
      void submitSettingsAuthUserForm(target);
      return;
    }
    case 'settingsAuthReportForm': {
      event.preventDefault();
      void submitSettingsAuthReportForm(target);
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

  if (target instanceof HTMLInputElement && target.getAttribute('data-action') === 'alert-toggle-resolved') {
    const alertId = target.getAttribute('data-alert-id');
    if (!alertId) {
      return;
    }
    void toggleAlertResolved(alertId, target.checked);
    return;
  }

  const action = target.getAttribute('data-action');
  if (action === 'xml-reader30-select') {
    const selectionKey = target.getAttribute('data-selection-key');
    if (!selectionKey) {
      return;
    }
    void toggleXmlReader30DocumentCheck(selectionKey, target.checked);
    return;
  }

  if (action === 'xml-reader30-cst-filter') {
    state.xmlReader30.cstFilter = String(target.value || '').trim();
    renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
    return;
  }

  if (action === 'xml-reader30-nfe-regime') {
    void applyXmlReader30NfeRegimeWithLoading(target.value);
    return;
  }

  if (action === 'settings-tema-change') {
    setTheme(target.value);
    pushToast(`Tema ${target.value.toLowerCase()} aplicado.`, 'success');
    render();
    return;
  }

  if (action === 'difal-chart-grouping') {
    const grouping = target.value === 'mes' ? 'mes' : 'dia';
    state.difalReader.chartGrouping = grouping;
    state.difalReader.chartPoints = buildDifalReaderChartPoints(state.difalReader.itemRows, grouping);
    renderPreservingScroll();
    return;
  }

  if (action === 'nfse-retention-company-filter' && state.modal?.kind === 'nfse-retention-alerts') {
    state.modal = {
      ...state.modal,
      empresaId: String(target.value || '')
    };
    render();
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

function onDocumentMouseDown(event) {
  if (event.button !== 0) {
    return;
  }

  const resizeHandle = event.target.closest?.('[data-action="xml-reader30-column-resize"]');
  if (resizeHandle instanceof HTMLElement) {
    const columnKey = String(resizeHandle.getAttribute('data-column-key') || '').trim();
    if (!columnKey) {
      return;
    }

    startXmlReader30NfeColumnResize(columnKey, event.clientX);
    event.preventDefault();
    return;
  }

  const panWrap = event.target.closest?.('[data-action="xml-reader30-pan-scroll"]');
  if (panWrap instanceof HTMLElement && !event.target.closest?.('input, button, a, select, textarea, [data-action="xml-reader30-column-drag"]')) {
    state.xmlReader30.scrollDrag = {
      active: true,
      startX: event.clientX,
      startScrollLeft: panWrap.scrollLeft,
      wrap: panWrap
    };
    panWrap.classList.add('is-panning');
    event.preventDefault();
    return;
  }

  const target = event.target.closest?.('[data-action="xml-reader30-select"]');
  if (!(target instanceof HTMLInputElement) || target.disabled) {
    return;
  }

  const selectionKey = target.getAttribute('data-selection-key');
  if (!selectionKey) {
    return;
  }

  return;
}

function onDocumentMouseMove(event) {
  if (state.xmlReader30.columnResize?.active) {
    updateXmlReader30NfeColumnResize(event.clientX);
    event.preventDefault();
    return;
  }

  handleDifalChartHover(event);

  const scrollDrag = state.xmlReader30.scrollDrag;
  if (!scrollDrag?.active) {
    return;
  }

  if (event.buttons !== 1) {
    stopXmlReader30ScrollDrag();
    return;
  }

  const wrap = scrollDrag.wrap;
  if (!(wrap instanceof HTMLElement)) {
    stopXmlReader30ScrollDrag();
    return;
  }

  const deltaX = event.clientX - scrollDrag.startX;
  wrap.scrollLeft = scrollDrag.startScrollLeft - deltaX;
  event.preventDefault();
}

function onDocumentMouseOver(event) {
  const dragState = state.xmlReader30.selectionDrag;
  if (!dragState?.active || event.buttons !== 1) {
    return;
  }

  return;

  const target = event.target.closest?.('[data-action="xml-reader30-select"]');
  if (!(target instanceof HTMLInputElement) || target.disabled) {
    return;
  }

  const selectionKey = target.getAttribute('data-selection-key');
  if (!selectionKey || target.checked === dragState.checked) {
    return;
  }

  const previousSelectionKey = state.selectedXmlReaderIds.size ? [...state.selectedXmlReaderIds][0] : '';
  target.checked = dragState.checked;
  setXmlReader30Selection(selectionKey, dragState.checked);
  syncXmlReader30SelectionCheckboxes(selectionKey, previousSelectionKey);
}

function onDocumentMouseUp() {
  if (state.xmlReader30.columnResize?.active) {
    finishXmlReader30NfeColumnResize();
  }

  stopXmlReader30ScrollDrag();

  if (!state.xmlReader30.selectionDrag?.active) {
    return;
  }

  state.xmlReader30.selectionDrag = null;
}

function stopXmlReader30ScrollDrag() {
  const scrollDrag = state.xmlReader30.scrollDrag;
  if (!scrollDrag?.active) {
    return;
  }

  if (scrollDrag.wrap instanceof HTMLElement) {
    scrollDrag.wrap.classList.remove('is-panning');
  }

  state.xmlReader30.scrollDrag = null;
}

function onDocumentDragStart(event) {
  if (state.xmlReader30.columnResize?.active || event.target.closest?.('[data-action="xml-reader30-column-resize"]')) {
    event.preventDefault();
    return;
  }

  const xmlReader30Header = event.target.closest?.('[data-action="xml-reader30-column-drag"]');
  if (xmlReader30Header) {
    const columnKey = xmlReader30Header.getAttribute('data-column-key');
    if (!columnKey) {
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', columnKey);
    state.xmlReader30.columnDrag = {
      columnKey,
      targetKey: '',
      insertAfter: false
    };
    xmlReader30Header.classList.add('is-dragging');
    return;
  }

  const nfseFiscalHeader = event.target.closest?.('[data-action="nfse-fiscal-column-drag"]');
  if (!nfseFiscalHeader) {
    return;
  }

  const columnKey = nfseFiscalHeader.getAttribute('data-column-key');
  if (!columnKey) {
    return;
  }

  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', columnKey);
  state.nfseFiscalReader.columnDrag = {
    columnKey,
    targetKey: '',
    insertAfter: false
  };
  nfseFiscalHeader.classList.add('is-dragging');
}

function onDocumentDragOver(event) {
  const xmlReader30Header = event.target.closest?.('[data-action="xml-reader30-column-drag"]');
  const xmlReader30DragState = state.xmlReader30.columnDrag;
  if (xmlReader30Header && xmlReader30DragState?.columnKey) {
    const targetKey = xmlReader30Header.getAttribute('data-column-key');
    if (!targetKey || targetKey === xmlReader30DragState.columnKey) {
      return;
    }

    event.preventDefault();
    const rect = xmlReader30Header.getBoundingClientRect();
    const insertAfter = event.clientX > rect.left + rect.width / 2;
    xmlReader30DragState.targetKey = targetKey;
    xmlReader30DragState.insertAfter = insertAfter;

    document.querySelectorAll('[data-action="xml-reader30-column-drag"]').forEach((node) => {
      node.classList.remove('drop-before', 'drop-after');
    });

    xmlReader30Header.classList.add(insertAfter ? 'drop-after' : 'drop-before');
    return;
  }

  const nfseFiscalHeader = event.target.closest?.('[data-action="nfse-fiscal-column-drag"]');
  const nfseFiscalDragState = state.nfseFiscalReader.columnDrag;
  if (!nfseFiscalHeader || !nfseFiscalDragState?.columnKey) {
    return;
  }

  const targetKey = nfseFiscalHeader.getAttribute('data-column-key');
  if (!targetKey || targetKey === nfseFiscalDragState.columnKey) {
    return;
  }

  event.preventDefault();
  const rect = nfseFiscalHeader.getBoundingClientRect();
  const insertAfter = event.clientX > rect.left + rect.width / 2;
  nfseFiscalDragState.targetKey = targetKey;
  nfseFiscalDragState.insertAfter = insertAfter;

  document.querySelectorAll('[data-action="nfse-fiscal-column-drag"]').forEach((node) => {
    node.classList.remove('drop-before', 'drop-after');
  });

  nfseFiscalHeader.classList.add(insertAfter ? 'drop-after' : 'drop-before');
}

function onDocumentDrop(event) {
  const xmlReader30Header = event.target.closest?.('[data-action="xml-reader30-column-drag"]');
  const xmlReader30DragState = state.xmlReader30.columnDrag;
  if (xmlReader30Header && xmlReader30DragState?.columnKey) {
    event.preventDefault();
    const targetKey = xmlReader30Header.getAttribute('data-column-key');
    if (!targetKey || targetKey === xmlReader30DragState.columnKey) {
      clearXmlReader30ColumnDragState();
      return;
    }

    const nextOrder = moveXmlReader30NfeColumn(
      state.xmlReader30.nfeColumnOrder,
      xmlReader30DragState.columnKey,
      targetKey,
      Boolean(xmlReader30DragState.insertAfter)
    );
    state.xmlReader30.nfeColumnOrder = nextOrder;
    saveXmlReader30NfeColumnOrderStore(nextOrder);
    clearXmlReader30ColumnDragState();
    renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
    return;
  }

  const nfseFiscalHeader = event.target.closest?.('[data-action="nfse-fiscal-column-drag"]');
  const nfseFiscalDragState = state.nfseFiscalReader.columnDrag;
  if (!nfseFiscalHeader || !nfseFiscalDragState?.columnKey) {
    return;
  }

  event.preventDefault();
  const targetKey = nfseFiscalHeader.getAttribute('data-column-key');
  if (!targetKey || targetKey === nfseFiscalDragState.columnKey) {
    clearNfseFiscalReaderColumnDragState();
    return;
  }

  state.nfseFiscalReader.columnOrder = moveNfseFiscalReaderColumn(
    state.nfseFiscalReader.columnOrder,
    nfseFiscalDragState.columnKey,
    targetKey,
    Boolean(nfseFiscalDragState.insertAfter)
  );
  clearNfseFiscalReaderColumnDragState();
  renderPreservingScroll(['.nfse-fiscal-reader-scroll']);
}

function onDocumentDragEnd() {
  clearXmlReader30ColumnDragState();
  clearNfseFiscalReaderColumnDragState();
}

function clearXmlReader30ColumnDragState() {
  state.xmlReader30.columnDrag = null;
  document.querySelectorAll('[data-action="xml-reader30-column-drag"]').forEach((node) => {
    node.classList.remove('is-dragging', 'drop-before', 'drop-after');
  });
}

function clearNfseFiscalReaderColumnDragState() {
  state.nfseFiscalReader.columnDrag = null;
  document.querySelectorAll('[data-action="nfse-fiscal-column-drag"]').forEach((node) => {
    node.classList.remove('is-dragging', 'drop-before', 'drop-after');
  });
}

function captureScrollState(selectors = []) {
  const contentNode = appRoot.querySelector('.content');
  const extras = (Array.isArray(selectors) ? selectors : [])
    .map((selector) => String(selector || '').trim())
    .filter(Boolean)
    .map((selector) => {
      const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) {
        return null;
      }

      return {
        selector,
        top: node.scrollTop,
        left: node.scrollLeft
      };
    })
    .filter(Boolean);

  return {
    contentTop: contentNode instanceof HTMLElement ? contentNode.scrollTop : 0,
    contentLeft: contentNode instanceof HTMLElement ? contentNode.scrollLeft : 0,
    extras
  };
}

function restoreScrollState(scrollState) {
  if (!scrollState || typeof scrollState !== 'object') {
    return;
  }

  const contentNode = appRoot.querySelector('.content');
  if (contentNode instanceof HTMLElement) {
    contentNode.scrollTop = Number(scrollState.contentTop || 0);
    contentNode.scrollLeft = Number(scrollState.contentLeft || 0);
  }

  (Array.isArray(scrollState.extras) ? scrollState.extras : []).forEach((entry) => {
    const selector = String(entry?.selector || '').trim();
    if (!selector) {
      return;
    }

    const node = document.querySelector(selector);
    if (!(node instanceof HTMLElement)) {
      return;
    }

    node.scrollTop = Number(entry.top || 0);
    node.scrollLeft = Number(entry.left || 0);
  });
}

function renderPreservingScroll(selectors = []) {
  const scrollState = captureScrollState(selectors);
  render();
  restoreScrollState(scrollState);
}

function render() {
  if (!state.auth.initialized || !state.auth.user) {
    appRoot.innerHTML = renderUnauthenticatedShell();
    modalRoot.innerHTML = '';
    drawerRoot.innerHTML = '';
    toastRoot.innerHTML = renderToasts();
    return;
  }

  const routeKey = JSON.stringify(state.route);
  const isSameRouteAsLastRender = routeKey === lastRenderedRouteKey;
  const scrollState = isSameRouteAsLastRender ? captureScrollState() : null;
  lastRenderedRouteKey = routeKey;

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
    ${renderPageLoadingOverlay()}
  `;

  const modalHtml = renderModal();
  if (state.modal?.kind === 'xml-reader30-nfe-fullscreen') {
    const fullscreenBody = modalRoot.querySelector?.('[data-xml-reader30-fullscreen-body]');
    if (fullscreenBody instanceof HTMLElement) {
      fullscreenBody.innerHTML = renderXmlReader30NfeFullscreenBody();
    } else {
      modalRoot.innerHTML = modalHtml;
    }
  } else {
    modalRoot.innerHTML = modalHtml;
  }
  drawerRoot.innerHTML = renderDrawer();
  toastRoot.innerHTML = renderToasts();

  if (scrollState) {
    restoreScrollState(scrollState);
  }
}

async function handleRouteAccess() {
  if (!state.auth.user) {
    return;
  }

  const needsRouteLoad = shouldLoadRouteData(state.route);
  if (!needsRouteLoad) {
    stopPageLoading();
    render();
    syncDashboardAutoRefresh();
    return;
  }

  const plan = buildPageLoadingPlan(state.route);
  startPageLoading(plan);
  render();

  try {
    await ensureRouteDataLoaded({
      silent: true,
      onProgress: updatePageLoadingTask
    });
  } finally {
    stopPageLoading();
    render();
    syncDashboardAutoRefresh();
  }
}

function renderPageLoadingOverlay() {
  if (!state.pageLoading.active) {
    return '';
  }

  const completedTasks = Array.isArray(state.pageLoading.completedTasks) ? state.pageLoading.completedTasks : [];
  const currentTask = String(state.pageLoading.currentTask || '').trim();

  return `
    <div class="page-loading-overlay" aria-live="polite" aria-busy="true">
      <div class="page-loading-card">
        <div class="page-loading-spinner" aria-hidden="true"></div>
        <p class="page-loading-eyebrow">Atualizando pagina</p>
        <h2 class="page-loading-title">${escapeHtml(state.pageLoading.title || 'Carregando pagina')}</h2>
        <p class="page-loading-description">${escapeHtml(state.pageLoading.description || 'Aguarde enquanto os dados sao carregados.')}</p>
        <div class="page-loading-status">
          <strong>Agora:</strong> ${escapeHtml(currentTask || 'Preparando pagina')}
        </div>
        ${
          completedTasks.length
            ? `<ul class="page-loading-task-list">
                ${completedTasks
                  .map((task) => `<li class="page-loading-task page-loading-task-done">${escapeHtml(task)}</li>`)
                  .join('')}
                ${currentTask ? `<li class="page-loading-task page-loading-task-active">${escapeHtml(currentTask)}</li>` : ''}
              </ul>`
            : ''
        }
      </div>
    </div>
  `;
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
          <div class="brand-card" aria-label="NotaSync">
            <div class="brand-logo-frame">
              <img class="brand-logo" src="/app/assets/notasync-logo-horizontal.png" alt="NotaSync" />
            </div>
          </div>
          <p class="brand-subtitle">GCONT Gestao Contabil</p>
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
  const nightlyTimesText = nightlyInfo.shortLabel.replace(/,\s*/g, ' • ');

  const authUser = state.auth.user;
  const avatarLabel = buildUserInitials(authUser?.nome || authUser?.username || 'NS');
  const roleLabel = authUser?.role === 'comum' ? '' : formatAuthRoleLabel(authUser?.role);

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
        <div class="header-meta-groups">
          <div class="header-status-group" title="Fonte: Banco local">
            <span class="header-status-icon">${icon('clock')}</span>
            <div class="header-status-copy">
              <strong>Rotinas do sistema</strong>
              <small>Ultima rotina: ${escapeHtml(lastRoutineText)}</small>
            </div>
          </div>
          <span class="header-status-divider" aria-hidden="true"></span>
          <div class="header-status-group" title="${escapeHtml(nightlyInfo.badgeLabel)}">
            <span class="header-status-dot header-status-dot-${escapeHtml(nightlyInfo.tone)}"></span>
            <div class="header-status-copy">
              <strong>Rotina noturna</strong>
              <small>${escapeHtml(nightlyTimesText)}</small>
            </div>
          </div>
        </div>
        <span title="${escapeHtml(healthStatus.description)}">${statusBadge(healthStatus.label, healthStatus.tone)}</span>
        <div class="header-user-block">
          <div class="header-user-copy">
            <strong>${escapeHtml(authUser?.nome || authUser?.username || 'Usuario')}</strong>
            ${roleLabel ? `<small>${escapeHtml(roleLabel)}</small>` : ''}
          </div>
          <div class="avatar" aria-label="${escapeHtml(authUser?.username || 'Usuario')}">${escapeHtml(avatarLabel)}</div>
          <button class="btn ghost" type="button" data-action="auth-logout">Sair</button>
        </div>
      </div>
    </header>
  `;
}

function renderUnauthenticatedShell() {
  const loading = state.auth.authenticating;

  return `
    <section class="page-section" style="min-height:100vh; display:flex; align-items:center; justify-content:center; padding:32px;">
      <article class="card" style="width:min(460px, 100%);">
        <div class="brand" style="margin-bottom:24px;">
          <div class="brand-card" aria-label="NotaSync">
            <div class="brand-logo-frame">
              <img class="brand-logo" src="/app/assets/notasync-logo-horizontal.png" alt="NotaSync" />
            </div>
          </div>
          <p class="brand-subtitle">GCONT Gestao Contabil</p>
        </div>
        <h2 class="card-title">Acesso ao painel</h2>
        <p class="card-subtitle">Entre com o usuario interno para acessar clientes, buscas, XMLs e auditoria.</p>
        ${
          loading
            ? '<div class="table-state loading" style="margin-top:16px;">Validando sessao...</div>'
            : `
              <form id="authLoginForm" class="auth-login-form" style="margin-top:16px;">
                <div class="auth-login-fields">
                  <label class="field">
                    Usuario
                    <input name="username" autocomplete="username" />
                  </label>
                  <label class="field">
                    Senha
                    <input name="password" type="password" autocomplete="current-password" />
                  </label>
                </div>
                <div class="auth-login-actions">
                  <button class="btn primary" type="submit">Entrar</button>
                </div>
              </form>
            `
        }
      </article>
    </section>
  `;
}

function buildUserInitials(value) {
  const parts = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return 'NS';
  }

  return parts.map((part) => part.charAt(0).toUpperCase()).join('');
}

function formatAuthRoleLabel(role) {
  if (role === 'admin') {
    return 'Administrador';
  }
  if (role === 'comum') {
    return 'Usuario comum';
  }
  if (role === 'cliente') {
    return 'Usuario cliente';
  }
  return 'Usuario';
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
    case 'auditoria-lacunas':
      return renderNfseGapAuditPage();
    case 'buscas-nfe':
      return renderNfeSyncPage();
    case 'xmls-nfe':
      return renderNfeDocumentsPage();
    case 'xmls-cte':
      return renderCteDocumentsPage();
    case 'compara-sped':
      return renderComparaSpedPage();
    case 'leitor-xml':
      return renderXmlReader30Page();
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
  const openCteDisagreementAlerts = getOpenCteDisagreementAlerts();
  const openNfseRetentionAlerts = getOpenNfseRetentionAlerts();
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
        <div class="summary-actions">
          ${
            openCteDisagreementAlerts.length
              ? `
                <button class="dashboard-alert-button" type="button" data-action="dashboard-open-cte-disagreement-alerts" aria-label="Abrir alertas de desacordo de CT-e">
                  <span class="dashboard-alert-button-icon">${icon('alert')}</span>
                  <span class="dashboard-alert-button-copy">
                    <strong>${escapeHtml(String(openCteDisagreementAlerts.length))}</strong>
                    <span>CT-e em desacordo</span>
                  </span>
                </button>
              `
              : ''
          }
          ${
            openNfseRetentionAlerts.length
              ? `
                <button class="dashboard-alert-button" type="button" data-action="dashboard-open-nfse-retention-alerts" aria-label="Abrir alertas de NFS-e com retencao">
                  <span class="dashboard-alert-button-icon">${icon('alert')}</span>
                  <span class="dashboard-alert-button-copy">
                    <strong>${escapeHtml(String(openNfseRetentionAlerts.length))}</strong>
                    <span>NFS-e com retencao</span>
                  </span>
                </button>
              `
              : ''
          }
          ${statusBadge(lastRun?.status || 'Sem status', summaryTone, 'summary-status')}
        </div>
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
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                          ${statusBadge(alert.severity, toneFromSeverity(alert.severity))}
                        </div>
                      </div>
                      <p class="alert-row-sub">${escapeHtml(buildAlertPriorityMeta(alert))}</p>
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
                    const clientMenuId = `client:${client.id}`;
                    const clientMenuItems = [
                      { label: 'Ver detalhes', action: 'client-details', attrs: { 'client-id': client.id } },
                      { label: 'Editar', action: 'client-edit', attrs: { 'client-id': client.id } },
                      { label: 'Reprocessar busca', action: 'client-reprocess', attrs: { 'client-id': client.id } },
                      {
                        label: client.buscaAtiva ? 'Pausar busca' : 'Habilitar busca',
                        action: 'client-toggle-search',
                        attrs: { 'client-id': client.id }
                      },
                      {
                        label: client.buscaNfeAtiva !== false ? 'Pausar NF-e' : 'Habilitar NF-e',
                        action: 'client-toggle-nfe-search',
                        attrs: { 'client-id': client.id }
                      }
                    ];
                    return `
                      <tr data-row-actions-menu-id="${escapeHtml(clientMenuId)}">
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
                        <td>${renderRowActionsMenu(clientMenuId, clientMenuItems)}</td>
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
                          const clientXmlMenuId = `client-xml:${xml.id}`;
                          const clientXmlMenuItems = [
                            { label: 'Visualizar', action: 'xml-details', attrs: { 'xml-id': xml.id } },
                            { label: 'Baixar XML', action: 'xml-download', attrs: { 'xml-id': xml.id } },
                            { label: 'Baixar DANFSE', action: 'xml-download-danfse', attrs: { 'xml-id': xml.id } }
                          ];
                          return `<tr class="${xml.cancelada && !xml.substitui ? 'xml-row-cancelled' : ''}" data-row-actions-menu-id="${escapeHtml(clientXmlMenuId)}">
                            <td>${renderNfseNumber(xml)}</td>
                            <td>${escapeHtml(formatDate(xml.dataEmissao))}</td>
                            <td>${escapeHtml(`${xml.prestador} / ${xml.tomador}`)}</td>
                            <td>${escapeHtml(formatCurrency(xml.valor))}</td>
                            <td>${renderRowActionsMenu(clientXmlMenuId, clientXmlMenuItems)}</td>
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
                    const rowClass = cert.status === 'Vencido' ? ' class="cert-row-vencido"' : cert.status === 'A vencer' ? ' class="cert-row-a-vencer"' : '';
                    const canDelete = state.dataSource !== 'api' || !cert.ativo;
                    const certMenuId = `cert:${cert.id}`;
                    const certMenuItems = [
                      { label: 'Ver cliente', action: 'certificate-view-client', attrs: { 'client-id': cert.clientId || '' }, disabled: !cert.clientId },
                      { label: 'Testar certificado', action: 'certificate-test', attrs: { 'cert-id': cert.id } },
                      { label: 'Baixar', action: 'certificate-download', attrs: { 'cert-id': cert.id } },
                      { label: 'Ver senha', action: 'certificate-password', attrs: { 'cert-id': cert.id } },
                      { label: 'Editar', action: 'certificate-edit', attrs: { 'cert-id': cert.id } },
                      { label: 'Anotacoes', action: 'certificate-notes', attrs: { 'cert-id': cert.id } },
                      { label: 'Substituir', action: 'certificate-replace', attrs: { 'cert-id': cert.id } },
                      { label: 'Remover vinculo', action: 'certificate-unlink', attrs: { 'cert-id': cert.id }, disabled: !(cert.clientId || cert.ativo) },
                      { label: 'Excluir certificado', action: 'certificate-delete', attrs: { 'cert-id': cert.id }, disabled: !canDelete, variant: 'danger' }
                    ];
                    return `<tr${rowClass} data-row-actions-menu-id="${escapeHtml(certMenuId)}">
                      <td>${escapeHtml(cert.cliente)}</td>
                      <td>${escapeHtml(formatCnpj(cert.cnpj))}</td>
                      <td>${escapeHtml(cert.tipo)}</td>
                      <td>${escapeHtml(cert.apelido)}</td>
                      <td>${escapeHtml(formatDate(cert.validade))}</td>
                      <td>${escapeHtml(String(cert.diasRestantes))}</td>
                      <td>${statusBadge(cert.status, toneFromCertificateStatus(cert.status))}</td>
                      <td>${escapeHtml(cert.ultimaValidacao ? formatDateTime(cert.ultimaValidacao) : '-')}</td>
                      <td>${escapeHtml(truncateText(cert.anotacoes || '-', 72))}</td>
                      <td>${renderRowActionsMenu(certMenuId, certMenuItems)}</td>
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
                    const runMenuId = `run:${run.id}`;
                    const runMenuItems = [
                      { label: 'Ver detalhes', action: 'open-run-details', attrs: { 'run-id': run.id } },
                      { label: 'Exportar relatorio', action: 'run-export', attrs: { 'run-id': run.id } },
                      { label: 'Reprocessar falhas', action: 'run-reprocess-failures', attrs: { 'run-id': run.id } }
                    ];
                    return `<tr data-row-actions-menu-id="${escapeHtml(runMenuId)}">
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
                      <td>${renderRowActionsMenu(runMenuId, runMenuItems)}</td>
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
      <div class="card" style="margin-top:12px; border:1px dashed var(--line-strong); box-shadow:none;">
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
  const queueLabel =
    sourceMode === 'dominio'
      ? 'prontos para importar XMLs'
      : sourceMode === 'dominio_chave'
        ? 'prontos para download por chave'
        : 'buscando NF-e futuras';
  const errorLabel =
    sourceMode === 'dominio'
      ? 'revisar conexao, cursor ou XMLs'
      : sourceMode === 'dominio_chave'
        ? 'revisar certificado, Dominio ou consulta por chave'
        : 'revisar certificado ou API';
  const overviewDescription =
    sourceMode === 'dominio'
      ? 'Ligue a importacao por cliente ou em lote. O backend consulta o banco da Dominio, salva os XMLs no storage local e segue apenas com os registros novos.'
      : sourceMode === 'dominio_chave'
        ? 'Ligue os controles por cliente e use o download manual por chave para consultar apenas documentos novos localizados no catalogo da Dominio.'
        : 'Ligue a busca por cliente ou em lote. O sistema captura o NSU atual como base e segue apenas com as proximas NF-e de entrada e saida.';
  const simplifiedSubtitle =
    sourceMode === 'dominio'
      ? 'Ao ligar a importacao, o backend resolve os estabelecimentos ativos do cliente e passa a acompanhar novos XMLs no banco da Dominio.'
      : sourceMode === 'dominio_chave'
        ? 'Ao ligar a rotina, o backend prepara os controles por estabelecimento e usa o catalogo da Dominio como fila de chaves para download manual.'
        : 'Ao ligar a busca, o backend resolve os estabelecimentos ativos do cliente, captura o NSU atual e passa a sincronizar apenas as proximas NF-e.';
  const detailSubtitle =
    sourceMode === 'dominio'
      ? 'Visao detalhada dos controles usados pelo backend para importar XMLs e manter o cursor incremental por estabelecimento, com download manual por chave disponivel sob demanda.'
      : sourceMode === 'dominio_chave'
        ? 'Visao detalhada dos controles usados pelo backend para varrer o catalogo da Dominio e baixar documentos oficiais por chave.'
        : 'Visao detalhada dos controles realmente mantidos pelo backend para distribuicao DF-e.';
  const clientCursorLabel = sourceMode === 'distribuicao' ? 'Ult. NSU base' : 'Ult. cursor';
  const controlCursorLabel = sourceMode === 'distribuicao' ? 'Ult. NSU consultado' : 'Cursor atual';
  const controlProgressLabel = sourceMode === 'distribuicao' ? 'Ult. NSU distribuido' : 'Cursor salvo';
  const controlMaxLabel = sourceMode === 'distribuicao' ? 'Max NSU' : 'Maior catalogo';
  const globalRunLabel =
    sourceMode === 'dominio' ? 'Rodar importacao agora' : sourceMode === 'dominio_chave' ? 'Download por chave' : 'Rodar busca agora';
  const clientEnableLabel = sourceMode === 'dominio' ? 'Ligar importacao' : 'Ligar busca';
  const rowRunLabel =
    sourceMode === 'dominio' ? 'Importar agora' : sourceMode === 'dominio_chave' ? 'Download por chave' : 'Rodar agora';
  const globalRunAction = sourceMode === 'dominio_chave' ? 'nfe-download-by-key-global' : 'nfe-run-now';
  const rowRunAction = sourceMode === 'dominio_chave' ? 'nfe-download-by-key-control' : 'nfe-sync-run-control';
  const canUseManualDownloadByKey = canUseNfeManualDownloadByKey();
  const dominioManualImportContent =
    sourceMode === 'dominio'
      ? `
        <form id="nfeDominioImportForm" class="form-grid">
          <label class="field">
            Cliente
            <select name="clienteId">${renderOptions([NFE_DOMINIO_ALL_CLIENTS_OPTION, ...nfeEligibleClients.map((client) => client.id)], NFE_DOMINIO_ALL_CLIENTS_OPTION, {
              [NFE_DOMINIO_ALL_CLIENTS_OPTION]: 'Todas as empresas',
              ...mapClientOptions()
            })}</select>
          </label>
          <label class="field">
            Ambiente
            <select name="ambiente">${renderOptions(['producao', 'homologacao'], 'producao', {
              producao: 'Producao',
              homologacao: 'Homologacao'
            })}</select>
          </label>
          <label class="field">
            Limite
            <input name="limit" type="number" min="1" max="5000" value="200" />
          </label>
          <label class="field">
            Emissao inicial
            <input name="dataEmissaoInicio" type="date" />
          </label>
          <label class="field">
            Emissao final
            <input name="dataEmissaoFim" type="date" />
          </label>
          <div class="stack-actions" style="grid-column: span 3; justify-content:flex-start; align-items:flex-end;">
            <button class="btn primary" type="submit">Importar XMLs da Dominio</button>
          </div>
        </form>
        <p class="card-subtitle" style="margin:12px 0 0;">Use este formulario para buscar um periodo especifico diretamente no catalogo da Dominio. O resultado aparece no painel da ultima execucao logo acima.</p>
      `
      : '';
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
                const nfeSyncClientMenuId = `nfe-sync-client:${row.clientId}`;
                const nfeSyncClientMenuItems = [
                  { label: clientEnableLabel, action: 'nfe-client-enable', attrs: { 'client-id': row.clientId } },
                  { label: 'Pausar', action: 'nfe-client-pause', attrs: { 'client-id': row.clientId } },
                  { label: 'Ver XMLs', action: 'nfe-open-client-xmls', attrs: { 'client-id': row.clientId } }
                ];
                return `<tr data-row-actions-menu-id="${escapeHtml(nfeSyncClientMenuId)}">
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
                  <td>${renderRowActionsMenu(nfeSyncClientMenuId, nfeSyncClientMenuItems)}</td>
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
                const nfeControlMenuId = `nfe-sync-control:${control.clientId}:${control.estabelecimentoId}:${control.ambiente}`;
                const nfeControlMenuItems = [
                  {
                    label: rowRunLabel,
                    action: rowRunAction,
                    attrs: { 'client-id': control.clientId, 'estabelecimento-id': control.estabelecimentoId, ambiente: control.ambiente }
                  },
                  canUseManualDownloadByKey && sourceMode !== 'dominio_chave'
                    ? {
                        label: 'Download por chave',
                        action: 'nfe-download-by-key-control',
                        attrs: { 'client-id': control.clientId, 'estabelecimento-id': control.estabelecimentoId, ambiente: control.ambiente }
                      }
                    : null,
                  { label: 'Pausar', action: 'nfe-sync-pause-control', attrs: { 'client-id': control.clientId, ambiente: control.ambiente } }
                ];
                return `<tr data-row-actions-menu-id="${escapeHtml(nfeControlMenuId)}">
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
                  <td>${renderRowActionsMenu(nfeControlMenuId, nfeControlMenuItems)}</td>
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
          actionButton(globalRunLabel, globalRunAction, 'secondary'),
          ...(canUseManualDownloadByKey && sourceMode !== 'dominio_chave'
            ? [actionButton('Download por chave', 'nfe-download-by-key-global', 'secondary')]
            : []),
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
        sourceMode !== 'distribuicao'
          ? renderCollapsibleCard({
              sectionKey: 'failures',
              title: sourceMode === 'dominio' ? 'Painel de falhas da importacao' : 'Painel da ultima execucao manual',
              subtitle: 'Mostra a ultima execucao manual feita nesta tela.',
              contentHtml: renderNfeLastRunPanel(),
              defaultOpen: false
            })
          : ''
      }
      ${
        sourceMode === 'dominio'
          ? renderCollapsibleCard({
              sectionKey: 'manualImport',
              title: 'Importacao manual da Dominio',
              subtitle: 'Busca XMLs por cliente e periodo usando o endpoint direto da Dominio.',
              contentHtml: dominioManualImportContent,
              defaultOpen: true
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
  const importSummary = normalizeDominioImportSummary(report?.importSummary);

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
    ${renderDominioImportSummaryPanel(importSummary, {
      subtitle: 'O total bruto inclui documentos e eventos importados pela Dominio.'
    })}
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
                      const lastRunMenuId = `nfe-last-run:${row.clientId}:${row.catalogoId}`;
                      const lastRunMenuItems = canHandleXml
                        ? [
                            { label: 'Ver XML', action: 'nfe-last-run-view-xml', attrs: { 'client-id': row.clientId, 'catalogo-id': row.catalogoId } },
                            { label: 'Importar', action: 'nfe-last-run-import-item', attrs: { 'client-id': row.clientId, 'catalogo-id': row.catalogoId } }
                          ]
                        : [];
                      return `<tr ${canHandleXml ? `data-row-actions-menu-id="${escapeHtml(lastRunMenuId)}"` : ''}>
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
                          ${canHandleXml ? renderRowActionsMenu(lastRunMenuId, lastRunMenuItems) : '<span class="row-sub">-</span>'}
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
        ${statusBadge(sourceMode === 'dominio' ? 'Banco Dominio' : sourceMode === 'dominio_chave' ? 'Dominio + chave' : 'Distribuicao DF-e', 'info')}
        <p>${
          sourceMode === 'dominio'
            ? 'Os controles ativos importam XMLs diretamente do banco da Dominio e salvam os arquivos no storage local. O download manual por chave fica disponivel como acao complementar.'
            : sourceMode === 'dominio_chave'
              ? 'Os controles ativos usam o catalogo da Dominio para localizar chaves novas e o download oficial ocorre apenas quando voce dispara a rotina manual.'
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
            : sourceMode === 'dominio_chave'
              ? 'No modo por chave, o ciclo automatico nao executa downloads. A rotina fica reservada para acionamento manual.'
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
  const sourceMode = getNfeSourceMode();
  const canUseManualDownloadByKey = canUseNfeManualDownloadByKey();
  const showDefaultRunButton = sourceMode !== 'dominio_chave';
  const showManualDownloadButton = canUseManualDownloadByKey;

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
            Eventos / cancelamento
            <select name="eventos">${renderOptions(['Todos', 'Com eventos', 'Sem eventos', 'Canceladas'], state.filters.nfeDocs.eventos)}</select>
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
            ${
              showDefaultRunButton
                ? `<button class="btn secondary" type="button" data-action="nfe-docs-run-now-client" ${selectedClientId ? '' : 'disabled'}>Rodar busca do cliente</button>`
                : ''
            }
            ${
              showManualDownloadButton
                ? `<button class="btn secondary" type="button" data-action="nfe-docs-download-by-key-client" ${selectedClientId ? '' : 'disabled'}>Download por chave</button>`
                : ''
            }
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
  const selectableDocs = docs.filter((doc) => Boolean(doc.apiNfeId));
  const selectedVisibleCount = selectableDocs.filter((doc) => state.selectedNfeIds.has(doc.id)).length;
  const allVisibleSelected = selectableDocs.length > 0 && selectedVisibleCount === selectableDocs.length;
  const batchDisabled = selectedVisibleCount > 0 ? '' : 'disabled';
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
          <p class="card-subtitle">Mostrando ${escapeHtml(String(docs.length))} de ${escapeHtml(String(totalResults))} documento(s). ${selectedVisibleCount} selecionado(s). Valor total: ${escapeHtml(formatCurrency(totalValue))}.</p>
        </div>
        <div class="table-actions">
          <button class="btn secondary" type="button" data-action="nfe-sync-events-listed" ${syncDisabled}>${escapeHtml(syncLabel)}</button>
          <button class="btn secondary" type="button" data-action="nfe-batch-download" data-tipo-arquivo="xml" ${batchDisabled}>Baixar XMLs</button>
          <button class="btn secondary" type="button" data-action="nfe-batch-download" data-tipo-arquivo="danfe" ${batchDisabled}>Baixar DANFEs</button>
          <button class="btn primary" type="button" data-action="nfe-batch-download" data-tipo-arquivo="ambos" ${batchDisabled}>Baixar XML + DANFE</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input type="checkbox" data-action="nfe-toggle-all" ${allVisibleSelected ? 'checked' : ''} ${selectableDocs.length ? '' : 'disabled'} aria-label="Selecionar todas as NF-e da listagem" />
              </th>
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
              colSpan: 11,
              rowsHtml: docs
                .map((doc) => {
                  const syncDisabledRow = state.nfeEventsSyncRunning || !canSyncNfeEvents(doc) ? 'disabled' : '';
                  const nfeMenuId = `nfe:${doc.id}`;
                  const nfeMenuItems = [
                    { label: 'Visualizar detalhes', action: 'nfe-details', attrs: { 'nfe-id': doc.id } },
                    { label: 'Buscar eventos', action: 'nfe-sync-events', attrs: { 'nfe-id': doc.id }, disabled: Boolean(syncDisabledRow) },
                    { label: 'Ver XML', action: 'nfe-view', attrs: { 'nfe-id': doc.id } },
                    doc.xmlCompletoDisponivel ? { label: 'Baixar DANFE', action: 'nfe-download-danfe', attrs: { 'nfe-id': doc.id } } : null,
                    { label: 'Baixar XML', action: 'nfe-download', attrs: { 'nfe-id': doc.id } }
                  ];
                  return `<tr data-row-actions-menu-id="${escapeHtml(nfeMenuId)}">
                    <td><input type="checkbox" data-action="nfe-select" data-nfe-id="${escapeHtml(doc.id)}" ${state.selectedNfeIds.has(doc.id) ? 'checked' : ''} ${doc.apiNfeId ? '' : 'disabled'} aria-label="Selecionar NF-e ${escapeHtml(doc.numeroNfe || '-')}" /></td>
                    <td>${escapeHtml(doc.numeroNfe || '-')}</td>
                    <td>${escapeHtml(doc.cliente)}</td>
                    <td>${statusBadge(doc.tipo, doc.tipo === 'Emitida' ? 'success' : doc.tipo === 'Recebida' ? 'info' : 'neutral')}</td>
                    <td>
                      <span class="row-title">${escapeHtml(doc.contraparteNome || '-')}</span>
                      <span class="row-sub">${escapeHtml(formatCnpj(doc.contraparteCnpj || ''))}</span>
                    </td>
                    <td>${escapeHtml(formatDateTime(doc.dataEmissao))}</td>
                    <td>${escapeHtml(formatOptionalCurrency(doc.valor))}</td>
                    <td>${statusBadge(mapNfeAmbienteLabel(doc.ambiente), doc.ambiente === 'producao' ? 'success' : 'warning')}</td>
                    <td>${renderNfeStorageBadges(doc)}</td>
                    <td>${renderNfeStatusBadges(doc)}</td>
                    <td>${renderRowActionsMenu(nfeMenuId, nfeMenuItems)}</td>
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
  const eventTypeOptions = getCteEventTypeFilterOptions();

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
            Eventos / cancelamento
            <select name="eventos">${renderOptions(['Todos', 'Com eventos', 'Sem eventos', 'Canceladas'], state.filters.cteDocs.eventos)}</select>
          </label>
          <label class="field">
            Tipo de evento
            <select name="tipoEvento">${renderOptions(['Todos', ...eventTypeOptions], state.filters.cteDocs.tipoEvento || 'Todos')}</select>
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
                  const cteMenuId = `cte:${doc.id}`;
                  const cteMenuItems = [
                    { label: 'Visualizar detalhes', action: 'cte-details', attrs: { 'cte-id': doc.id } },
                    { label: 'Buscar eventos', action: 'cte-sync-events', attrs: { 'cte-id': doc.id }, disabled: Boolean(syncDisabledRow) },
                    { label: 'Ver XML', action: 'cte-view', attrs: { 'cte-id': doc.id } },
                    { label: 'Baixar XML', action: 'cte-download', attrs: { 'cte-id': doc.id } }
                  ];
                  return `<tr data-row-actions-menu-id="${escapeHtml(cteMenuId)}">
                    <td>${escapeHtml(doc.numeroCte || '-')}</td>
                    <td>${escapeHtml(doc.cliente)}</td>
                    <td>${statusBadge(doc.tipo, doc.tipo === 'Emitido' ? 'success' : doc.tipo === 'Recebido' ? 'info' : 'neutral')}</td>
                    <td>
                      <span class="row-title">${escapeHtml(doc.contraparteNome || '-')}</span>
                      <span class="row-sub">${escapeHtml(formatCnpj(doc.contraparteCnpj || ''))}</span>
                    </td>
                    <td>${escapeHtml(formatDateTime(doc.dataEmissao))}</td>
                    <td>${escapeHtml(formatOptionalCurrency(doc.valor))}</td>
                    <td>${statusBadge(mapNfeAmbienteLabel(doc.ambiente), doc.ambiente === 'producao' ? 'success' : 'warning')}</td>
                    <td>${renderNfeStorageBadges(doc)}</td>
                    <td>${renderCteStatusBadges(doc)}</td>
                    <td>${renderRowActionsMenu(cteMenuId, cteMenuItems)}</td>
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

function renderNfseGapAuditPage() {
  const rows = Array.isArray(state.nfseGapAuditOverview.rows) ? state.nfseGapAuditOverview.rows : [];
  const totalEmpresas = rows.length;
  const totalFaixas = rows.reduce((total, row) => total + Number(row?.totalFaixasLacuna || 0), 0);
  const totalNumeros = rows.reduce((total, row) => total + Number(row?.totalNumerosPulados || 0), 0);
  const totalDocumentos = rows.reduce((total, row) => total + Number(row?.totalDocumentosAnalisados || 0), 0);
  const updatedAt = state.nfseGapAuditOverview.lastLoadedAt
    ? formatDateTime(state.nfseGapAuditOverview.lastLoadedAt)
    : '-';
  const rowsHtml = rows
    .map((row) => {
      const preview = renderNfseGapAuditPreview(row.lacunas);
      const menuId = `gap-audit:${row.clientId}`;
      const menuItems = [
        { label: 'Abrir XMLs', action: 'gap-audit-open-xmls', attrs: { 'client-id': row.clientId } },
        { label: 'Auditar NSU', action: 'gap-audit-run-nsu', attrs: { 'client-id': row.clientId } },
        { label: 'Recuperar DPS', action: 'gap-audit-recover-dps', attrs: { 'client-id': row.clientId } },
        { label: 'Recuperar chave', action: 'gap-audit-recover-key', attrs: { 'client-id': row.clientId } },
        { label: 'Informar excecao', action: 'gap-audit-open-numbering-exception', attrs: { 'client-id': row.clientId } }
      ];
      return `
        <tr data-row-actions-menu-id="${escapeHtml(menuId)}">
          <td><strong>${escapeHtml(row.razaoSocial || 'Sem razao social')}</strong></td>
          <td>${escapeHtml(formatCnpj(row.cnpjConsulta || ''))}</td>
          <td>${escapeHtml(String(row.totalDocumentosAnalisados || 0))}</td>
          <td>${statusBadge(`${Number(row.totalFaixasLacuna || 0)} faixa(s)`, Number(row.totalFaixasLacuna || 0) > 0 ? 'warning' : 'neutral')}</td>
          <td>${escapeHtml(String(row.totalNumerosPulados || 0))}</td>
          <td style="min-width:220px;">${escapeHtml(preview)}</td>
          <td>${renderRowActionsMenu(menuId, menuItems)}</td>
        </tr>
      `;
    })
    .join('');

  const recoveringAll = Boolean(state.nfseGapAuditRecoverAll.active);
  const hasRecoverableRows = rows.some((row) => Array.isArray(row?.lacunas) && row.lacunas.length > 0);

  return `
    <section class="page-section">
      ${renderPageHeader({
        title: 'Auditoria de Lacunas',
        description: 'Liste por empresa as numeracoes visiveis em aberto e acione a auditoria das lacunas.',
        actions: [
          actionButton('Atualizar auditoria', 'gap-audit-refresh', 'primary', recoveringAll),
          actionButton(
            recoveringAll ? 'Recuperando DPS...' : 'Recuperar todas as DPS',
            'gap-audit-recover-dps-all',
            'secondary',
            recoveringAll || !hasRecoverableRows
          )
        ]
      })}

      <section class="stats-grid">
        ${statCard('users', 'Empresas com lacunas', String(totalEmpresas), 'empresas com numeracao visivel em aberto', 'warning')}
        ${statCard('alert', 'Faixas abertas', String(totalFaixas), 'faixas consolidadas por numeracao visivel', 'warning')}
        ${statCard('file', 'Numeros pulados', String(totalNumeros), 'numeros faltantes somados na auditoria', 'danger')}
        ${statCard('folder', 'Documentos analisados', String(totalDocumentos), 'XMLs armazenados considerados na auditoria', 'neutral')}
      </section>

      <article class="card" style="box-shadow:none; border-style:dashed;">
        <div class="progress-meta">
          <span>Empresas listadas: <strong>${escapeHtml(String(totalEmpresas))}</strong></span>
          <span>Faixas abertas: <strong>${escapeHtml(String(totalFaixas))}</strong></span>
          <span>Numeros pulados: <strong>${escapeHtml(String(totalNumeros))}</strong></span>
          <span>Atualizado: <strong>${escapeHtml(updatedAt)}</strong></span>
        </div>
      </article>

      <article class="card">
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Docs</th>
                <th>Lacunas</th>
                <th>Numeros</th>
                <th>Preview</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              ${renderTableRowsOrState({
                key: 'nfseGapAudit',
                colSpan: 7,
                rowsHtml,
                emptyMessage: 'Nenhuma empresa com lacunas visiveis foi encontrada.'
              })}
            </tbody>
          </table>
        </div>
      </article>
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
  const informativeRows = Number(state.xmlSearch.informativeRows || 0);
  const totalValue = sumListedDocumentValues(filteredXmls);
  const periodText =
    query.emissaoInicio || query.emissaoFim
      ? `${formatDate(query.emissaoInicio || '')} ate ${formatDate(query.emissaoFim || '')}`
      : 'Todos os XMLs armazenados';
  const numberingValidationSummary = renderXmlNumberingValidationSummary(query, state.xmlSearch.numberingValidation);
  return `
    <article class="card" style="box-shadow:none; border-style:dashed;">
      <div class="progress-meta">
        <span>Empresa: <strong>${escapeHtml(client?.razaoSocial || 'Cliente selecionado')}</strong></span>
        <span>Periodo: <strong>${escapeHtml(periodText)}</strong></span>
        <span>Resultado: <strong>${escapeHtml(String(totalResults))} XML(s)${informativeRows ? ` + ${escapeHtml(String(informativeRows))} excecao(oes)` : ''}</strong></span>
        <span>Pagina: <strong>${escapeHtml(`${state.xmlSearch.page}/${Math.max(1, state.xmlSearch.totalPages || 1)}`)}</strong></span>
        <span>Valor somado: <strong>${escapeHtml(formatCurrency(totalValue))}</strong></span>
        <span>Atualizado: <strong>${escapeHtml(formatDateTime(state.xmlSearch.lastSearchedAt || new Date().toISOString()))}</strong></span>
      </div>
      ${numberingValidationSummary}
    </article>
  `;
}

function renderXmlNumberingValidationSummary(query, validation) {
  if (query?.tipo !== 'Emitida') {
    return '';
  }

  if (!validation || validation.aplicada === false) {
    const reason =
      validation?.motivo === 'filtros_incompativeis'
        ? 'Validacao de numeracao indisponivel com os filtros adicionais atuais.'
        : 'Validacao de numeracao disponivel apenas para a consulta de NFS-e emitidas da empresa selecionada.';

    return `<p class="card-subtitle" style="margin-top:12px;">${escapeHtml(reason)}</p>`;
  }

  if (!validation.possuiNumeracaoPulada) {
    return `<p class="card-subtitle" style="margin-top:12px;">Numeracao geral da empresa validada sem lacunas para ${escapeHtml(String(validation.totalNumerosValidos || 0))} documento(s) emitido(s) armazenado(s), independentemente dos filtros da tabela.</p>`;
  }

  const summaryGaps = summarizeXmlNumberingGaps(validation.lacunas);
  const preview = summaryGaps.slice(0, 5).map((gap) => formatXmlNumberingGap(gap)).filter(Boolean).join('; ');
  const hiddenCount = Math.max(0, summaryGaps.length - 5);
  const suffix = hiddenCount > 0 ? ` (+${hiddenCount} faixa(s))` : '';
  const totalFaixasResumo = Number(validation.totalFaixasLacuna || summaryGaps.length || 0);
  const totalNumerosResumo = Number(
    validation.totalNumerosPulados || summaryGaps.reduce((total, gap) => total + Number(gap.quantidade || 0), 0)
  );

  return `
    <div style="display:flex; gap:12px; align-items:flex-start; justify-content:space-between; flex-wrap:wrap; margin-top:12px;">
      <p class="card-subtitle" style="margin:0; color:var(--warning);">
        Atencao: a validacao geral da empresa encontrou ${escapeHtml(String(totalNumerosResumo))} numeracao(oes) pulada(s) em ${escapeHtml(String(totalFaixasResumo))} faixa(s), independentemente dos filtros da tabela. ${escapeHtml(preview)}${escapeHtml(suffix)}
      </p>
      ${
        state.dataSource === 'api'
          ? `
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn primary" type="button" data-action="nfse-audit-gap-nsus">Auditar lacunas por NSU</button>
              <button class="btn secondary" type="button" data-action="nfse-recover-by-dps">Recuperar por DPS</button>
              <button class="btn secondary" type="button" data-action="nfse-recover-by-key">Recuperar por chave</button>
              <button class="btn secondary" type="button" data-action="nfse-open-numbering-exception">Informar excecao</button>
            </div>
          `
          : ''
      }
    </div>
  `;
}

function formatXmlNumberingGap(gap) {
  if (!gap) {
    return '';
  }

  const ambiente = mapNfseAmbienteLabel(gap.ambiente || '');
  const serie = String(gap.serie || '').trim();
  const prefix = serie ? `Serie ${serie}` : 'Serie padrao';
  const start = Number(gap.numeroInicial || 0);
  const end = Number(gap.numeroFinal || 0);
  const range = start === end ? String(start) : `${start} a ${end}`;
  return `${prefix} (${ambiente}): ${range}`;
}

function formatXmlNumberingRange(gap) {
  if (!gap) {
    return '';
  }

  const start = Number(gap.numeroInicial || 0);
  const end = Number(gap.numeroFinal || 0);
  if (start <= 0 || end < start) {
    return '';
  }

  return start === end ? String(start) : `${start} a ${end}`;
}

function summarizeXmlNumberingGaps(gaps) {
  const normalized = Array.isArray(gaps)
    ? gaps
        .map((gap) => ({
          ambiente: String(gap?.ambiente || '') === 'producao_restrita' ? 'producao_restrita' : 'producao',
          serie: gap?.serie == null ? null : String(gap.serie).trim() || null,
          numeroInicial: Number(gap?.numeroInicial || 0),
          numeroFinal: Number(gap?.numeroFinal || 0)
        }))
        .filter((gap) => gap.numeroInicial > 0 && gap.numeroFinal >= gap.numeroInicial)
        .sort((left, right) => {
          const ambienteDiff = String(left.ambiente).localeCompare(String(right.ambiente));
          if (ambienteDiff !== 0) {
            return ambienteDiff;
          }

          const serieDiff = String(left.serie || '').localeCompare(String(right.serie || ''));
          if (serieDiff !== 0) {
            return serieDiff;
          }

          if (left.numeroInicial !== right.numeroInicial) {
            return left.numeroInicial - right.numeroInicial;
          }

          return left.numeroFinal - right.numeroFinal;
        })
    : [];

  const merged = [];
  for (const gap of normalized) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({
        ambiente: gap.ambiente,
        serie: gap.serie,
        numeroInicial: gap.numeroInicial,
        numeroFinal: gap.numeroFinal,
        quantidade: gap.numeroFinal - gap.numeroInicial + 1
      });
      continue;
    }

    if (gap.ambiente === last.ambiente && gap.serie === last.serie && gap.numeroInicial <= last.numeroFinal + 1) {
      last.numeroFinal = Math.max(last.numeroFinal, gap.numeroFinal);
      last.quantidade = last.numeroFinal - last.numeroInicial + 1;
      continue;
    }

    merged.push({
      ambiente: gap.ambiente,
      serie: gap.serie,
      numeroInicial: gap.numeroInicial,
      numeroFinal: gap.numeroFinal,
      quantidade: gap.numeroFinal - gap.numeroInicial + 1
    });
  }

  return merged;
}

function renderNfseGapAuditPreview(gaps) {
  const summary = summarizeXmlNumberingGaps(gaps);
  if (!summary.length) {
    return '-';
  }

  const preview = summary
    .slice(0, 5)
    .map((gap) => formatXmlNumberingGap(gap))
    .filter(Boolean)
    .join('; ');
  const hiddenCount = Math.max(0, summary.length - 5);
  return hiddenCount > 0 ? `${preview} (+${hiddenCount} faixa(s))` : preview;
}

function renderXmlsTableCard(xmls) {
  const selectableXmls = xmls.filter((xml) => Boolean(xml.apiNfseId));
  const informativeRowsCount = xmls.filter((xml) => Boolean(xml?.isNumberingException)).length;
  const syncableRowsCount = xmls.filter((xml) => canSyncXmlEvents(xml)).length;
  const selectedVisibleCount = selectableXmls.filter((xml) => state.selectedXmlIds.has(xml.id)).length;
  const allVisibleSelected = selectableXmls.length > 0 && selectedVisibleCount === selectableXmls.length;
  const batchDisabled = selectedVisibleCount > 0 ? '' : 'disabled';
  const totalValue = sumListedDocumentValues(xmls);
  const totalResults = Number(state.xmlSearch.total || xmls.length || 0);
  const syncEventsDisabled =
    state.xmlEventsSyncRunning || state.dataSource !== 'api' || state.tableState.xmls === 'loading' || !syncableRowsCount
      ? 'disabled'
      : '';
  const syncEventsLabel = state.xmlEventsSyncRunning ? 'Buscando eventos...' : 'Buscar eventos da listagem';
  const subtitleParts = [
    `Mostrando ${escapeHtml(String(xmls.length))} registro(s).`,
    `${selectedVisibleCount} selecionado(s).`,
    `Valor total: ${escapeHtml(formatCurrency(totalValue))}.`
  ];
  if (totalResults > 0 || informativeRowsCount > 0) {
    subtitleParts.splice(
      1,
      0,
      `${escapeHtml(String(totalResults))} XML(s)${informativeRowsCount ? ` e ${escapeHtml(String(informativeRowsCount))} excecao(oes) informada(s)` : ''}.`
    );
  }

  return `
    <article class="card">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">Arquivos encontrados</h3>
          <p class="card-subtitle">${subtitleParts.join(' ')}</p>
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
              ${renderXmlSortHeader('contraparte', 'Fornecedor / cliente')}
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
                    !canSyncXmlEvents(xml)
                      ? 'disabled'
                      : '';
                  const xmlMenuId = `xml:${xml.id}`;
                  const xmlActionsItems = xml.isNumberingException
                    ? []
                    : [
                        { label: 'Visualizar detalhes', action: 'xml-details', attrs: { 'xml-id': xml.id } },
                        {
                          label: xml.ignorarNumeracaoValidacao ? 'Voltar numeracao' : 'Desconsiderar numeracao',
                          action: 'xml-toggle-numbering-validation',
                          attrs: { 'xml-id': xml.id }
                        },
                        { label: 'Buscar eventos', action: 'xml-sync-events', attrs: { 'xml-id': xml.id }, disabled: Boolean(xmlSyncDisabled) },
                        { label: 'Ver XML', action: 'xml-view', attrs: { 'xml-id': xml.id } },
                        { label: 'Baixar XML', action: 'xml-download', attrs: { 'xml-id': xml.id } },
                        { label: 'Baixar DANFSE', action: 'xml-download-danfse', attrs: { 'xml-id': xml.id } }
                      ];
                  return `<tr class="${xml.cancelada && !xml.substitui ? 'xml-row-cancelled' : ''}" ${xml.isNumberingException ? '' : `data-row-actions-menu-id="${escapeHtml(xmlMenuId)}"`}>
                    <td><input type="checkbox" data-action="xml-select" data-xml-id="${escapeHtml(xml.id)}" ${state.selectedXmlIds.has(xml.id) ? 'checked' : ''} ${xml.apiNfseId ? '' : 'disabled'} aria-label="Selecionar NFS-e ${escapeHtml(xml.numeroNfse || '-')}" /></td>
                    <td>${renderNfseNumber(xml)}</td>
                    <td>${escapeHtml(xml.cliente)}</td>
                    <td>${escapeHtml(xml.contraparteNome || '-')}</td>
                    <td>${escapeHtml(xml.municipio)}</td>
                    <td>${escapeHtml(formatDate(xml.dataEmissao))}</td>
                    <td>${escapeHtml(formatDateTime(xml.dataDownload))}</td>
                    <td>${escapeHtml(formatCurrency(xml.valor))}</td>
                    <td>${escapeHtml(xml.tipo)}</td>
                    <td>${renderXmlStatusBadges(xml)}</td>
                    <td>
                      ${
                        xml.isNumberingException
                          ? '<span class="row-sub">Somente informativo</span>'
                          : renderRowActionsMenu(xmlMenuId, xmlActionsItems)
                      }
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
              <select name="tipo">${renderOptions(['Todos', 'Certificado', 'Prefeitura', 'XML', 'Cliente', 'Servidor', 'Busca', 'CT-e', 'NFS-e'], state.filters.alerts.tipo)}</select>
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
          ${hasAlertDocumentAction(alert) ? `<p class="alert-row-sub">${escapeHtml(renderAlertDocumentLine(alert))}</p>` : ''}
          ${alert.emissor ? `<p class="alert-row-sub">Emissor: ${escapeHtml(alert.emissor)}</p>` : ''}
          ${alert.retencoes?.length ? `<p class="alert-row-sub">Retencoes: ${escapeHtml(alert.retencoes.join(' • '))}</p>` : ''}
          <div class="table-actions">
            <button class="icon-btn" type="button" data-action="alert-details" data-alert-id="${alert.id}">Ver detalhes</button>
            ${hasAlertDocumentAction(alert) ? `<button class="icon-btn" type="button" data-action="alert-open-document" data-alert-id="${alert.id}">${renderAlertOpenDocumentLabel(alert)}</button>` : ''}
            ${
              alert.status === 'Resolvido'
                ? '<button class="icon-btn" type="button" data-action="alert-unresolve" data-alert-id="' + alert.id + '">Reabrir alerta</button>'
                : '<button class="icon-btn" type="button" data-action="alert-resolve" data-alert-id="' + alert.id + '">Marcar como resolvido</button>'
            }
            ${alert.allowsReprocess ? `<button class="icon-btn" type="button" data-action="alert-reprocess" data-alert-id="${alert.id}">Reprocessar</button>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

function renderSettingsPage() {
  const authTab = state.auth.user?.role === 'admin' ? renderTabButton('acessos', 'Acessos') : '';

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
          ${renderTabButton('aliquotas', 'Aliquotas')}
          ${authTab}
          ${renderTabButton('manutencao', 'Manutencao')}
        </div>
        ${renderSettingsTabPanel()}
      </article>
    </section>
  `;
}

function renderComparaSpedPage() {
  const clientOptions = state.clients.map((client) => client.id);
  const hasClients = clientOptions.length > 0;
  const compareState = state.compareSped;
  const report = compareState.report;
  const recentComparisons = Array.isArray(compareState.history) ? compareState.history : [];
  const artifactReady = Boolean(compareState.artifact?.blobUrl && report);
  const downloadLabel = compareState.outputFormat === 'PDF' ? 'Baixar PDF' : 'Baixar Excel';
  const generationStatus =
    compareState.status === 'processing'
      ? 'Processando arquivo...'
      : artifactReady
        ? 'Arquivo pronto para download'
        : compareState.status === 'error'
          ? 'Falha na comparacao'
          : 'Aguardando arquivo';
  const topStats = report
    ? [
        statCard('file', 'TXT', String(report.summary.spedDocs), 'documentos lidos no arquivo', 'neutral'),
        statCard('search', 'Dominio x SPED', String(report.summary.dominioDocs), 'documentos no banco', 'info'),
        statCard('alert', 'Pendentes', String(report.summary.issuesCount), 'divergencias a serem analisadas', 'warning')
      ]
    : [
        statCard('file', 'TXT', 'TXT', 'arquivo SPED upload e leitura linha a linha', 'neutral'),
        statCard('search', 'Dominio x SPED', 'Dominio x SPED', 'conferencia comparacao por documento', 'info'),
        statCard('alert', 'Pendentes', 'Pendentes', 'divergencias a serem analisadas', 'warning')
      ];

  return `
    <section class="page-section compare-page">
      ${renderPageHeader({
        title: 'Compara SPED',
        description: 'Importe o SPED Fiscal, selecione a empresa e gere a comparacao com a base da Dominio.',
        actions: []
      })}

      <article class="card compare-hero">
        <div class="compare-hero-main">
          <div class="compare-hero-icon" aria-hidden="true">${icon('compare')}</div>
          <div>
            <h3 class="card-title">Comparação em SPED</h3>
            <p class="card-subtitle">
              Escolha uma empresa cadastrada na Dominio, envie o arquivo SPED Fiscal e gere o arquivo de conferência para baixar no painel ao lado.
            </p>
          </div>
        </div>
        <p class="compare-hero-note">
          O primeiro passo já pode ler o TXT do SPED, cruzar com os documentos da Domínio que estão carregados no sistema e entregar um Excel ou PDF para download.
        </p>
      </article>

      <section class="stats-grid compare-stats">
        ${topStats.join('')}
      </section>

      <section class="split-grid compare-layout">
        <div class="compare-left-stack">
        <article class="card compare-main-card">
          <div class="compare-card-header">
            <div>
              <h3 class="card-title">Gerar arquivo</h3>
              <p class="card-subtitle">
                O upload fica aqui. A saída escolhida define se o resultado será Excel ou PDF, e o download acontece no bloco ao lado.
              </p>
            </div>
            ${statusBadge(generationStatus, compareState.status === 'processing' ? 'info' : artifactReady ? 'success' : compareState.status === 'error' ? 'danger' : 'neutral')}
          </div>

          <form id="compareSpedForm" class="form-grid compare-form">
            <label class="field compare-span-2">
              Empresa
              <select name="empresa" ${hasClients ? '' : 'disabled'} required>
                ${renderOptions(clientOptions, compareState.sourceCompanyId || '', mapClientOptions(), 'Selecione a empresa')}
              </select>
            </label>
            <label class="field">
              Competência
              <input name="competencia" type="month" value="${escapeHtml(compareState.sourceCompetence || '')}" />
            </label>
            <label class="field compare-span-2">
              Arquivo SPED Fiscal
              <input name="arquivoSped" type="file" accept=".txt,text/plain" required />
            </label>
            <label class="field">
              Saída
              <select name="saida">
                ${renderOptions(['Excel', 'PDF'], compareState.outputFormat || 'Excel', {
                  Excel: 'Excel',
                  PDF: 'PDF'
                })}
              </select>
            </label>
            <label class="field">
              Status
              <input value="${escapeHtml(compareState.status === 'processing' ? 'Lendo arquivo...' : compareState.status === 'done' ? 'Comparacao concluida' : 'Pronto para gerar')}" disabled />
            </label>
            <div class="compare-upload-hint compare-span-3">
              <span class="compare-upload-dot"></span>
              <span>Use o TXT do SPED Fiscal. Nesta primeira etapa a comparação cruza o arquivo enviado com os documentos de NF-e já carregados do cliente selecionado.</span>
            </div>
            <div class="stack-actions compare-actions compare-span-3">
              <button class="btn primary" type="submit" ${hasClients && compareState.status !== 'processing' ? '' : 'disabled'}>${compareState.status === 'processing' ? `Processando ${escapeHtml(compareState.outputFormat || 'arquivo')}...` : 'Gerar arquivo'}</button>
              <button class="btn secondary" type="button" data-action="compare-sped-reset" ${compareState.status === 'processing' ? 'disabled' : ''}>Limpar</button>
            </div>
          </form>
        </article>

          <article class="card compare-history-card">
            <div class="compare-card-header">
              <div>
                <h3 class="card-title">Ultimas comparações</h3>
                <p class="card-subtitle">Reabra ou baixe novamente os arquivos gerados recentemente nesta sessao.</p>
              </div>
              ${statusBadge(`${recentComparisons.length} itens`, recentComparisons.length ? 'info' : 'neutral')}
            </div>

            ${
              recentComparisons.length
                ? `
                  <div class="compare-history-list">
                    ${recentComparisons
                      .map((item) => {
                        const outputLabel = item.outputFormat === 'PDF' ? 'PDF' : 'Excel';
                        return `
                          <div class="compare-history-item">
                            <div class="compare-history-item-main">
                              <div class="compare-history-item-title">${escapeHtml(item.clientName || 'Comparacao sem cliente')}</div>
                              <div class="compare-history-meta">
                                <span>${escapeHtml(item.competence ? `Competencia: ${item.competence}` : 'Competencia nao informada')}</span>
                                <span>${escapeHtml(item.generatedAt ? `Gerada em: ${formatDateTime(item.generatedAt)}` : 'Data nao informada')}</span>
                                <span>${escapeHtml(`Arquivo: ${item.sourceFileName || 'comparacao'}`)}</span>
                                <span>${escapeHtml(`Saida: ${outputLabel}`)}</span>
                              </div>
                            </div>
                            <div class="compare-history-actions">
                              <button class="btn secondary small" type="button" data-action="compare-sped-redownload" data-compare-id="${escapeHtml(item.id)}">Baixar de novo</button>
                            </div>
                          </div>
                        `;
                      })
                      .join('')}
                  </div>
                `
                : `
                  <div class="compare-history-empty">
                    <div class="compare-history-empty-icon">${icon('clock')}</div>
                    <div>
                      <h4>Nenhuma comparacao recente</h4>
                      <p>Quando voce gerar um arquivo, as ultimas comparacoes aparecem aqui com a opcao de baixar novamente.</p>
                    </div>
                  </div>
                `
            }
          </article>
        </div>

        <div class="compare-side-stack">
          <article class="card compare-result-card">
            <div class="compare-card-header">
              <div>
                <h3 class="card-title">Relatório de saída</h3>
                <p class="card-subtitle">O arquivo gerado aparece aqui para download imediato.</p>
              </div>
              ${statusBadge(generationStatus, compareState.status === 'processing' ? 'info' : artifactReady ? 'success' : compareState.status === 'error' ? 'danger' : 'neutral')}
            </div>

            <div class="compare-result-placeholder">
              <div class="compare-result-icon">${icon('file')}</div>
              <h4>${artifactReady ? compareState.artifact.fileName : 'Nenhum arquivo gerado ainda'}</h4>
              <p>
                ${
                  artifactReady
                    ? `Gerado em ${escapeHtml(formatDateTime(compareState.generatedAt || ''))}. Clique no botão abaixo para baixar novamente.`
                    : 'Depois de gerar, este painel mostrará o nome do arquivo e o atalho para download.'
                }
              </p>
            </div>

            <div class="compare-result-actions">
              <button class="btn secondary" type="button" data-action="compare-sped-download" ${artifactReady ? '' : 'disabled'}>${downloadLabel}</button>
              <button class="btn primary" type="button" data-action="compare-sped-open-last" ${artifactReady ? '' : 'disabled'}>Abrir resumo</button>
            </div>
          </article>

          <article class="card compare-steps-card">
            <div class="compare-card-header">
              <div>
                <h3 class="card-title">Fluxo simples</h3>
                <p class="card-subtitle">A ideia é manter a operação rápida e clara para o usuário.</p>
              </div>
              ${statusBadge('3 etapas', 'info')}
            </div>

            <div class="compare-step-list">
              ${renderCompareStep(1, 'Selecione a empresa', 'Use o cadastro já sincronizado com a Domínio para definir a base da comparação.')}
              ${renderCompareStep(2, 'Envie o SPED', 'Carregue o TXT da competência desejada e deixe o sistema processar as linhas do arquivo.')}
              ${renderCompareStep(3, 'Baixe o resultado', 'Receba a planilha ou o PDF com faltantes e divergências prontas para auditoria.')}
            </div>
          </article>
        </div>
      </section>
    </section>
  `;
}

function renderXmlReader30Page() {
  return `
    <section class="page-section compare-page">
      ${renderPageHeader({
        title: 'Leitor XML 3.0',
        badgeText: 'Funcional',
        description: 'Consulte e abra XMLs ja armazenados no Nota Sync.',
        actions: []
      })}

      ${renderXmlReader30Tabs()}
      ${renderXmlReader30Section()}
    </section>
  `;
}

function renderXmlReader30Tabs() {
  const activeTab = ['nfse-fiscal', 'difal'].includes(state.xmlReader30.activeTab) ? state.xmlReader30.activeTab : 'nfe';
  return `
    <article class="card" style="padding-bottom:14px;">
      <div class="tabs" style="margin-bottom:0;">
        <button class="tab-btn ${activeTab === 'nfe' ? 'active' : ''}" type="button" data-action="xml-reader30-switch-tab" data-tab="nfe">NF-e</button>
        <button class="tab-btn ${activeTab === 'nfse-fiscal' ? 'active' : ''}" type="button" data-action="xml-reader30-switch-tab" data-tab="nfse-fiscal">NFS-e fiscal</button>
        <button class="tab-btn ${activeTab === 'difal' ? 'active' : ''}" type="button" data-action="xml-reader30-switch-tab" data-tab="difal">DIFAL</button>
      </div>
    </article>
  `;
}

function renderXmlReader30Section() {
  if (state.xmlReader30.activeTab === 'nfse-fiscal') {
    return renderXmlReader30NfseFiscalSection();
  }

  if (state.xmlReader30.activeTab === 'difal') {
    return renderXmlReader30DifalSection();
  }

  const reader = state.xmlReader30;
  const hasClients = state.clients.length > 0;
  const currentCount = Number(reader.total || reader.results.length || 0);
  const results = Array.isArray(reader.results) ? reader.results : [];
  const summary = reader.hasSearched && reader.lastQuery ? renderXmlReader30Summary() : '';

  return `
    <article class="card compare-reader-card">
      <div class="compare-card-header">
        <div>
          <h3 class="card-title">Leitor XML 3.0</h3>
          <p class="card-subtitle">Leia os XMLs ja armazenados no Nota Sync em uma tela dedicada.</p>
        </div>
        ${statusBadge(`${currentCount} item(s)`, currentCount ? 'success' : 'neutral')}
      </div>

      <form id="xmlReader30Form" class="form-grid compare-form">
        <label class="field compare-span-2">
          Empresa
          <select name="cliente" required ${hasClients ? '' : 'disabled'}>
            ${renderOptions(state.clients.map((client) => client.id), reader.lastQuery?.cliente || '', mapClientOptions(), 'Selecione a empresa')}
          </select>
        </label>
        <label class="field">
          Tipo NF-e
          <select name="tipo">
            ${renderOptions(['Todos', 'Recebida', 'Emitida'], reader.lastQuery?.tipo || 'Todos', {
              Todos: 'Entradas e saídas',
              Recebida: 'Entradas',
              Emitida: 'Saídas'
            })}
          </select>
        </label>
        <label class="field">
          Emissao inicio
          <input name="emissaoInicio" type="date" value="${escapeHtml(reader.lastQuery?.emissaoInicio || '')}" />
        </label>
        <label class="field">
          Emissao fim
          <input name="emissaoFim" type="date" value="${escapeHtml(reader.lastQuery?.emissaoFim || '')}" />
        </label>
        <label class="field compare-span-2">
          Busca livre
          <input name="texto" placeholder="Chave, número, CNPJ, cliente, status..." value="${escapeHtml(reader.lastQuery?.texto || '')}" />
        </label>
        <label class="field compare-span-2">
          Status
          <input value="${escapeHtml(reader.hasSearched ? 'Pronto para consultar NF-e' : 'Aguardando busca')}" disabled />
        </label>
        <div class="compare-upload-hint compare-span-4">
          <span class="compare-upload-dot"></span>
          <span>O leitor consulta o acervo interno ja carregado pelo Nota Sync e abre o XML bruto no visualizador padrao.</span>
        </div>
        <div class="stack-actions compare-actions compare-span-4">
          <button class="btn primary" type="submit" ${hasClients ? '' : 'disabled'}>Buscar XML</button>
          <button class="btn secondary" type="button" data-action="xmlReader30-clear" ${reader.hasSearched || reader.lastQuery ? '' : 'disabled'}>Limpar</button>
        </div>
      </form>

      ${
        summary
          ? summary
          : renderXmlReader30EmptyState()
      }

      ${reader.hasSearched ? renderXmlReader30ResultsTable(results) : ''}
    </article>
  `;
}

function renderXmlReader30NfseFiscalSection() {
  const selectedClientId = state.filters.xmls.cliente && state.filters.xmls.cliente !== 'Todos' ? state.filters.xmls.cliente : '';
  const canShowTable =
    state.xmlSearch.hasSearched || state.tableState.xmls === 'loading' || state.tableState.xmls === 'error';
  const summary =
    state.xmlSearch.hasSearched && state.tableState.xmls !== 'loading' ? renderXmlSearchSummary() : '';

  return `
    <article class="card compare-reader-card">
      <div class="compare-card-header">
        <div>
          <h3 class="card-title">Leitura fiscal de NFS-e</h3>
          <p class="card-subtitle">Consulte as NFS-e armazenadas e monte a tabela fiscal consolidada em uma tela dedicada do leitor.</p>
        </div>
        ${statusBadge(
          `${escapeHtml(String((state.nfseFiscalReader.rows || []).length))} linha(s)`,
          state.nfseFiscalReader.rows?.length ? 'success' : 'neutral'
        )}
      </div>

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
          <button class="btn primary" type="submit">Buscar NFS-e fiscal</button>
          <button class="btn secondary" type="button" data-action="xmls-clear-filters">Limpar</button>
          <button class="btn secondary" type="button" data-action="xmls-recover-past-nsus" ${selectedClientId ? '' : 'disabled'}>Reprocessar NSUs do cliente</button>
        </div>
      </form>

      ${canShowTable ? `${summary}${renderNfseFiscalReaderCard()}` : renderXmlSearchEmptyState()}
    </article>
  `;
}

function renderXmlReader30DifalSection() {
  const reader = state.difalReader;
  const query = reader.lastQuery;
  const isLoading = state.tableState.difalReader === 'loading';
  const hasClients = state.clients.length > 0;

  return `
    <article class="card compare-reader-card">
      <div class="compare-card-header">
        <div>
          <h3 class="card-title">DIFAL das NF-e</h3>
          <p class="card-subtitle">Leia as NF-e recebidas (compras) ja armazenadas no Nota Sync no periodo e calcule o DIFAL, o ICMS monofasico, o ICMS proprio e o ICMS 4% por item.</p>
        </div>
        ${statusBadge(
          reader.summary ? `${escapeHtml(String(reader.summary.totalItens))} item(ns)` : '0 item(ns)',
          reader.summary?.totalItens ? 'success' : 'neutral'
        )}
      </div>

      <form id="difalReaderForm" class="form-grid compare-form">
        <label class="field compare-span-2">
          Empresa
          <select name="cliente" required ${hasClients ? '' : 'disabled'}>
            ${renderOptions(state.clients.map((client) => client.id), query?.cliente || '', mapClientOptions(), 'Selecione a empresa')}
          </select>
        </label>
        <label class="field">
          Emissao inicio
          <input name="emissaoInicio" type="date" value="${escapeHtml(query?.emissaoInicio || '')}" />
        </label>
        <label class="field">
          Emissao fim
          <input name="emissaoFim" type="date" value="${escapeHtml(query?.emissaoFim || '')}" />
        </label>
        <label class="field">
          Aliquota interna (%)
          <input name="aliquotaInterna" type="number" min="0" max="100" step="0.01" placeholder="Ex.: 18" value="${escapeHtml(query?.aliquotaInterna != null ? String(query.aliquotaInterna) : '')}" />
        </label>
        <div class="compare-upload-hint compare-span-4">
          <span class="compare-upload-dot"></span>
          <span>Considera apenas as NF-e recebidas (compras) da empresa no periodo. Calculado apenas para os itens com ICMS a 4% (Resolucao Senado 13/2012): DIFAL = (Base de calculo ICMS - ICMS interestadual) regrossada pela aliquota interna informada, menos o ICMS interestadual. Demais itens (incluindo o monofasico) nao entram nessa soma.</span>
        </div>
        <div class="stack-actions compare-actions compare-span-4">
          <button class="btn primary" type="submit" ${hasClients ? '' : 'disabled'}>Calcular DIFAL</button>
          <button class="btn secondary" type="button" data-action="difalReader-clear" ${reader.hasSearched || query ? '' : 'disabled'}>Limpar</button>
        </div>
      </form>

      ${isLoading ? '<p class="row-sub">Lendo as NF-e do periodo...</p>' : renderXmlReader30DifalResults()}
    </article>
  `;
}

function renderXmlReader30DifalResults() {
  const reader = state.difalReader;
  if (!reader.hasSearched) {
    return renderXmlReader30EmptyState();
  }

  if (state.tableState.difalReader === 'error') {
    return `
      <div class="compare-history-empty">
        <div class="compare-history-empty-icon">${icon('alert')}</div>
        <div>
          <h4>Nao foi possivel calcular o DIFAL</h4>
          <p>Revise os filtros e tente novamente.</p>
        </div>
      </div>
    `;
  }

  const summary = reader.summary;
  if (!summary) {
    return renderXmlReader30EmptyState();
  }

  return `
    <div class="difal-summary-grid">
      ${renderXmlReader30DifalResumoCard(summary)}
      ${renderXmlReader30DifalChartCard()}
    </div>
    <article class="card" style="box-shadow:none; border-style:dashed; margin-top: 2px;">
      <div class="xml-reader30-summary-meta">
        <span>Itens analisados: <strong>${escapeHtml(String(summary.totalItens))} item(ns)</strong></span>
        <span>Soma ICMS Monofasico: <strong>${escapeHtml(formatCurrency(summary.totalMonofasico))}</strong></span>
        <span>Soma ICMS Proprio: <strong>${escapeHtml(formatCurrency(summary.totalIcmsProprio))}</strong></span>
        <span>Soma ICMS 4%: <strong>${escapeHtml(formatCurrency(summary.totalIcms4))}</strong></span>
      </div>
    </article>
    ${renderXmlReader30DifalNotesCard()}
  `;
}

function renderXmlReader30DifalResumoCard(summary) {
  return `
    <article class="card difal-resumo-card">
      <h3 class="card-title">Resumo do periodo</h3>
      <div class="difal-resumo-rows">
        <div class="difal-resumo-row">
          <span class="difal-resumo-icon">${icon('file')}</span>
          <div class="difal-resumo-copy">
            <small>Notas fiscais analisadas</small>
            <strong>${escapeHtml(String(summary.totalNotas))} nota(s)</strong>
          </div>
        </div>
        <div class="difal-resumo-row">
          <span class="difal-resumo-icon">${icon('pie')}</span>
          <div class="difal-resumo-copy">
            <small>Aliquota interna usada</small>
            <strong>${escapeHtml(formatXmlReader30DecimalValue(summary.aliquotaInterna))}%</strong>
          </div>
        </div>
        <div class="difal-resumo-row">
          <span class="difal-resumo-icon">${icon('coin')}</span>
          <div class="difal-resumo-copy">
            <small>Valor total do DIFAL</small>
            <strong>${escapeHtml(formatCurrency(summary.totalDifal))}</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderXmlReader30DifalChartCard() {
  const points = Array.isArray(state.difalReader.chartPoints) ? state.difalReader.chartPoints : [];
  const grouping = state.difalReader.chartGrouping === 'mes' ? 'mes' : 'dia';

  return `
    <article class="card difal-chart-card">
      <div class="difal-chart-card-header">
        <h3 class="card-title">Evolucao do DIFAL no periodo</h3>
        <label class="field difal-chart-grouping-field">
          <select data-action="difal-chart-grouping" aria-label="Agrupar grafico">
            ${renderOptions(['dia', 'mes'], grouping, { dia: 'Por dia', mes: 'Por mes' })}
          </select>
        </label>
      </div>
      ${points.length ? renderXmlReader30DifalChartSvg(points, grouping) : '<div class="difal-chart-empty">Sem dados suficientes para o grafico.</div>'}
    </article>
  `;
}

function renderXmlReader30DifalChartSvg(points, grouping) {
  const layout = computeDifalChartLayout(points);
  state.difalReader.chartRenderPoints = layout.points;
  state.difalReader.chartViewBox = { width: layout.width, height: layout.height };

  const linePath = layout.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const firstPoint = layout.points[0];
  const lastPoint = layout.points[layout.points.length - 1];
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${layout.baselineY.toFixed(2)} L ${firstPoint.x.toFixed(2)} ${layout.baselineY.toFixed(2)} Z`;
  const labelStep = Math.max(1, Math.ceil(layout.points.length / 12));

  const gridLines = layout.gridTicks
    .map(
      (tick) => `
        <line x1="${layout.padding.left}" x2="${layout.width - layout.padding.right}" y1="${tick.y.toFixed(2)}" y2="${tick.y.toFixed(2)}" class="difal-chart-grid"></line>
        <text x="${layout.padding.left - 8}" y="${tick.y.toFixed(2)}" class="difal-chart-axis-label difal-chart-axis-label-y">${escapeHtml(formatCurrency(tick.value))}</text>
      `
    )
    .join('');

  const xLabels = layout.points
    .map((point, index) =>
      index % labelStep === 0 || index === layout.points.length - 1
        ? `<text x="${point.x.toFixed(2)}" y="${layout.height - 8}" class="difal-chart-axis-label difal-chart-axis-label-x">${escapeHtml(point.label)}</text>`
        : ''
    )
    .join('');

  const dots = layout.points
    .map((point) => `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3" class="difal-chart-dot"></circle>`)
    .join('');

  return `
    <div class="difal-chart-wrap" data-difal-chart>
      <svg viewBox="0 0 ${layout.width} ${layout.height}" preserveAspectRatio="none" role="img" aria-label="Evolucao do DIFAL no periodo">
        <defs>
          <linearGradient id="difalAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28"></stop>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        ${gridLines}
        <path d="${areaPath}" fill="url(#difalAreaFill)" stroke="none"></path>
        <path d="${linePath}" fill="none" class="difal-chart-line"></path>
        ${dots}
        <circle cx="${lastPoint.x.toFixed(2)}" cy="${lastPoint.y.toFixed(2)}" r="4" class="difal-chart-end-dot"></circle>
        <line data-difal-chart-crosshair x1="0" x2="0" y1="${layout.padding.top}" y2="${layout.height - layout.padding.bottom}" class="difal-chart-crosshair" style="display:none;"></line>
        <circle data-difal-chart-active-dot cx="0" cy="0" r="4.5" class="difal-chart-active-dot" style="display:none;"></circle>
        ${xLabels}
      </svg>
      <div class="difal-chart-tooltip" data-difal-chart-tooltip>
        <span data-tooltip-date></span>
        <strong data-tooltip-value></strong>
      </div>
    </div>
    <details class="difal-chart-table-toggle">
      <summary>Ver dados em tabela</summary>
      <table>
        <thead>
          <tr>
            <th>${grouping === 'mes' ? 'Mes' : 'Dia'}</th>
            <th>Valor do DIFAL</th>
          </tr>
        </thead>
        <tbody>
          ${points
            .map(
              (point) => `
                <tr>
                  <td>${escapeHtml(point.label)}</td>
                  <td>${escapeHtml(formatCurrency(point.value))}</td>
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </details>
  `;
}

const DIFAL_NOTES_COLUMNS = [
  { label: 'Numero NF', className: 'xml-reader30-number', value: (row) => row.numeroNf || row.numeroLabel || '-' },
  {
    label: 'Status',
    className: 'xml-reader30-status',
    html: true,
    value: (row) => statusBadge(row.statusLabel || 'Ativa', row.isCancelada ? 'danger' : 'success')
  },
  { label: 'Produto', className: 'xml-reader30-product', value: (row) => row.produto || '-' },
  { label: 'Quantidade', className: 'xml-reader30-quantity', value: (row) => row.quantidade || '-' },
  { label: 'CST', className: 'xml-reader30-icms-code', value: (row) => row.cstCsosn || '-' },
  { label: 'BC ICMS', className: 'xml-reader30-icms-number', value: (row) => row.baseCalculoIcms || '-' },
  { label: 'ICMS (%)', className: 'xml-reader30-icms-number', value: (row) => row.aliquotaIcms || '-' },
  { label: 'Valor ICMS', className: 'xml-reader30-icms-number', value: (row) => row.valorIcms || '-' },
  { label: 'BC Mono', className: 'xml-reader30-icms-number', value: (row) => row.qBCMonoRet || '-' },
  { label: 'Aliq NF', className: 'xml-reader30-icms-number', value: (row) => row.adRemICMSRet || '-' },
  { label: 'Valor Mono', className: 'xml-reader30-icms-number', value: (row) => row.vICMSMonoRet || '-' },
  { label: 'Aliq Vigente', className: 'xml-reader30-icms-number', value: (row) => row.aliqVigente || '-' },
  { label: 'Valor Correto', className: 'xml-reader30-money xml-reader30-icms-currency', value: (row) => row.valorCorreto || '-' }
];

function renderXmlReader30DifalNotesCard() {
  const itemRows = Array.isArray(state.difalReader.itemRows) ? state.difalReader.itemRows : [];

  return `
    <article class="card difal-notes-card">
      <div class="compare-card-header">
        <div>
          <h3 class="card-title">Notas do periodo</h3>
          <p class="card-subtitle">Informacoes de ICMS e monofasico por item das NF-e do periodo.</p>
        </div>
        ${statusBadge(`${escapeHtml(String(itemRows.length))} item(ns)`, itemRows.length ? 'success' : 'neutral')}
      </div>
      <div class="table-wrap difal-notes-scroll">
        <table class="xml-reader30-table">
          <thead>
            <tr>
              ${DIFAL_NOTES_COLUMNS.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${
              itemRows.length
                ? itemRows
                    .map(
                      (row) => `
                        <tr class="${row.isIcms4 ? 'row-icms4' : ''}">
                          ${DIFAL_NOTES_COLUMNS.map((column) => {
                            const rawValue = column.value(row);
                            const cellContent = column.html ? rawValue : escapeHtml(String(rawValue));
                            const highlightClass = row.isIcms4 && (column.className === 'xml-reader30-number' || column.className === 'xml-reader30-product') ? ' row-icms4-cell' : '';
                            return `<td class="${escapeHtml(column.className)}${highlightClass}">${cellContent}</td>`;
                          }).join('')}
                        </tr>
                      `
                    )
                    .join('')
                : `<tr><td colspan="${DIFAL_NOTES_COLUMNS.length}" class="row-sub">Nenhum item encontrado para os filtros informados.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderXmlReader30Summary() {
  const query = state.xmlReader30.lastQuery;
  if (!query) {
    return '';
  }

  const totals = getXmlReader30NfeSummaryTotals(Array.isArray(state.xmlReader30.results) ? state.xmlReader30.results : []);
  const totalNotasPeriodo = countXmlReader30NfeNotes(Array.isArray(state.xmlReader30.results) ? state.xmlReader30.results : []);
  const tipoLabel = query.tipo === 'Recebida' ? 'Entradas' : query.tipo === 'Emitida' ? 'Saidas' : 'Entradas e saídas';

  return `
    <article class="card" style="box-shadow:none; border-style:dashed; margin-top: 2px;">
      <div class="xml-reader30-summary-meta">
        <span>Movimentacao: <strong>${escapeHtml(tipoLabel)}</strong></span>
        <span>Total de notas no período: <strong>${escapeHtml(String(totalNotasPeriodo))} nota(s)</strong></span>
        <span>Valor Total das notas: <strong>${escapeHtml(formatCurrency(totals.totalNotasValue))}</strong></span>
        <span>Valor Total ICMS: <strong>${escapeHtml(formatCurrency(totals.totalIcmsValue))}</strong></span>
        <span>Valor ICMS Monofasico: <strong>${escapeHtml(formatCurrency(totals.totalIcmsMonofasicoValue))}</strong></span>
        <span>Valor ICMS ST RET: <strong>${escapeHtml(formatCurrency(totals.totalIcmsStRetValue))}</strong></span>
      </div>
    </article>
  `;
}
function renderXmlReader30EmptyState() {
  return `
    <div class="compare-history-empty">
      <div class="compare-history-empty-icon">${icon('search')}</div>
      <div>
        <h4>Pronto para pesquisar</h4>
        <p>Selecione a empresa, defina o tipo e abra os XMLs que ja estao armazenados no sistema.</p>
      </div>
    </div>
  `;
}

function renderXmlReader30ResultsTable(results) {
  const sourceRows = Array.isArray(results) ? results : [];
  const currentDocumentType = state.xmlReader30.lastQuery?.documento || 'todos';
  if (currentDocumentType === 'nfe') {
    return renderXmlReader30NfeResultsTableReorderable(sourceRows);
  }

  const sortedRows = sortXmlReader30Results(sourceRows, { documentType: currentDocumentType });
  const selectedVisibleCount = getXmlReader30UniqueDocumentCheckKeys(sortedRows).filter((key) => state.selectedXmlReaderIds.has(key)).length;

  return `
    <article class="card" style="margin-top: 2px;">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">XMLs encontrados</h3>
          <p class="card-subtitle">Mostrando ${escapeHtml(String(results.length))} XML(s) do acervo interno.</p>
        </div>
        <div class="stack-mini" style="align-items:flex-end;">
          ${statusBadge(`${selectedVisibleCount} conferido(s)`, selectedVisibleCount ? 'info' : 'neutral')}
          <span class="row-sub">Use as caixas para acompanhar o que ja conferiu.</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="xml-reader30-table">
          <thead>
            <tr>
              <th class="xml-reader30-check">Selecao</th>
              <th>Tipo</th>
              ${renderXmlReader30SortHeader('numeroNf', 'Documento')}
              <th>Empresa</th>
              ${renderXmlReader30SortHeader('dataEmissao', 'Emissao')}
              <th>Valor</th>
              <th>Produtos</th>
              <th>Situacao</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'xmlReader30',
              colSpan: 9,
              rowsHtml: sortedRows.length
                ? sortedRows
                    .map((row) => {
                      const actions = renderXmlReader30Actions(row);
                      const selectionKey = getXmlReader30DocumentCheckKey(row);
                      const rowMenuId = getXmlReader30ActionsMenuId(row);
                      return `
                        <tr data-row-actions-menu-id="${escapeHtml(rowMenuId)}">
                          <td class="xml-reader30-check">
                            ${renderXmlReader30SelectionControl({
                              selectionKey,
                              checked: selectionKey && state.selectedXmlReaderIds.has(selectionKey),
                              label: `Marcar ${row.documentLabel} ${row.numeroLabel} como conferido`
                            })}
                          </td>
                          <td>${statusBadge(row.documentLabel, row.documentTone)}</td>
                          <td class="xml-reader30-doc">
                            <span class="row-title">${escapeHtml(row.numeroLabel)}</span>
                          </td>
                          <td class="xml-reader30-company">
                            <span class="row-title">${escapeHtml(row.cliente)}</span>
                            <span class="row-sub">${escapeHtml(row.cnpjLabel)}</span>
                          </td>
                          <td>${escapeHtml(formatDateTime(row.dataEmissao))}</td>
                          <td class="xml-reader30-money">${escapeHtml(row.valorLabel || '-')}</td>
                          <td class="xml-reader30-product">
                            <span class="row-title">${escapeHtml(row.productLabel || '-')}</span>
                            <span class="row-sub">${escapeHtml(row.productSecondaryLabel || row.productHint || '-')}</span>
                          </td>
                          <td>
                            <div class="status-stack">
                              ${statusBadge(row.statusLabel, row.statusTone)}
                              ${statusBadge(row.storageLabel, row.storageTone)}
                            </div>
                          </td>
                          <td>${actions}</td>
                        </tr>
                      `;
                    })
                    .join('')
                : '',
              emptyMessage: 'Nenhum XML encontrado para os filtros informados.'
            })}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderXmlReader30NfeResultsTable(results) {
  const expandedRows = expandXmlReader30NfeRows(Array.isArray(results) ? results : []);
  const displayedRows = sortXmlReader30Results(expandedRows);
  const selectedVisibleCount = getXmlReader30UniqueDocumentCheckKeys(displayedRows).filter((key) => state.selectedXmlReaderIds.has(key)).length;

  return `
    <article class="card" style="margin-top: 2px;">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">XMLs encontrados</h3>
          <p class="card-subtitle">Mostrando ${escapeHtml(String(displayedRows.length))} linha(s) itemizada(s) da NF-e do acervo interno.</p>
        </div>
        <div class="stack-mini" style="align-items:flex-end;">
          ${statusBadge(`${selectedVisibleCount} conferido(s)`, selectedVisibleCount ? 'info' : 'neutral')}
          <span class="row-sub">Cada produto aparece em uma linha para facilitar a conferencia.</span>
        </div>
      </div>
      <div class="table-wrap">
        <table class="xml-reader30-table" style="min-width: 1380px;">
          <thead>
            <tr>
              <th class="xml-reader30-check">Conferido</th>
              ${renderXmlReader30SortHeader('numeroNf', 'Numero NF')}
              <th>Status NF-e</th>
              <th>NF Cancelada?</th>
              ${renderXmlReader30SortHeader('dataEmissao', 'Data Emissao')}
              <th>Produto</th>
              <th>Quantidade</th>
              <th>Valor Unitario</th>
              <th>Valor Total</th>
              <th>Valor Total NF XML R$</th>
              <th>ICMS ST RET R$</th>
              <th>CST/CSOSN</th>
              <th>CFOP</th>
              <th>Base de Calculo ICMS</th>
              <th>Aliquota ICMS (%)</th>
              <th>Valor ICMS</th>
              <th>qBCMonoRet</th>
              <th>adRemICMSRet</th>
              <th>vICMSMonoRet</th>
              <th>Aliq Vigente</th>
              <th>Valor Correto R$</th>
              <th>Evento</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'xmlReader30',
              colSpan: 22,
              rowsHtml: displayedRows.length
                ? displayedRows
                    .map((row) => {
                      const selectionKey = getXmlReader30DocumentCheckKey(row);
                      const statusTone = row.raw?.cancelada ? 'danger' : row.raw?.statusFiscal === 'Autorizada' ? 'success' : row.statusTone || 'info';
                      const numberLabel = row.numeroNf || row.numeroLabel || '-';
                      return `
                        <tr>
                          <td class="xml-reader30-check">
                            ${renderXmlReader30SelectionControl({
                              selectionKey,
                              checked: selectionKey && state.selectedXmlReaderIds.has(selectionKey),
                              label: `Marcar NF-e como conferida ${String(numberLabel)}`
                            })}
                          </td>
                          <td>
                            <span class="row-title">${escapeHtml(String(numberLabel))}</span>
                          </td>
                          <td>${statusBadge(row.statusNf || row.statusLabel || '-', statusTone)}</td>
                          <td>${escapeHtml(row.nfCancelada || (row.raw?.cancelada ? 'Sim' : 'Nao'))}</td>
                          <td>${escapeHtml(row.dataEmissaoLabel || formatDate(row.dataEmissao || row.raw?.dataEmissao || ''))}</td>
                          <td class="xml-reader30-doc">
                            ${renderXmlReader30ProductLabel(row.produto || '-')}
                          </td>
                          <td>${escapeHtml(row.quantidade || '-')}</td>
                          <td class="xml-reader30-money">${escapeHtml(row.valorUnitario || '-')}</td>
                          <td class="xml-reader30-money">${escapeHtml(row.valorTotal || '-')}</td>
                          <td class="xml-reader30-money">${escapeHtml(row.valorTotalNfXml || '-')}</td>
                          <td class="xml-reader30-money">${escapeHtml(row.icmsStRet || '-')}</td>
                          <td>${escapeHtml(row.cstCsosn || '-')}</td>
                          <td>${escapeHtml(row.cfop || '-')}</td>
                          <td>${escapeHtml(row.baseCalculoIcms || '-')}</td>
                          <td>${escapeHtml(row.aliquotaIcms || '-')}</td>
                          <td>${escapeHtml(row.valorIcms || '-')}</td>
                          <td>${escapeHtml(row.qBCMonoRet || '-')}</td>
                          <td>${escapeHtml(row.adRemICMSRet || '-')}</td>
                          <td>${escapeHtml(row.vICMSMonoRet || '-')}</td>
                          <td>${escapeHtml(row.aliqVigente || '-')}</td>
                      <td class="xml-reader30-money">${escapeHtml(row.valorCorreto || '-')}</td>
                      <td>${escapeHtml(row.evento || '-')}</td>
                      <td>
                        <div class="table-actions">${renderXmlReader30Actions(row)}</div>
                      </td>
                    </tr>
                  `;
                })
                .join('')
                : '',
              emptyMessage: 'Nenhum XML encontrado para os filtros informados.'
            })}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderXmlReader30NfeFullscreenIcon() {
  return `
    <span aria-hidden="true" style="display:inline-flex; width:14px; height:14px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H3v5"></path>
        <path d="M16 3h5v5"></path>
        <path d="M21 16v5h-5"></path>
        <path d="M8 21H3v-5"></path>
      </svg>
    </span>
  `;
}

function renderXmlReader30NfeResultsTableReorderable(results, options = {}) {
  const fullscreen = Boolean(options.fullscreen);
  const expandedRows = expandXmlReader30NfeRows(Array.isArray(results) ? results : []);
  const allDisplayedRows = sortXmlReader30Results(expandedRows);
  const cstFilter = String(state.xmlReader30.cstFilter || '').trim();
  const cstOptions = uniqueValues(allDisplayedRows.map((row) => String(row.cstCsosn || '').trim()));
  const displayedRows = cstFilter ? allDisplayedRows.filter((row) => String(row.cstCsosn || '').trim() === cstFilter) : allDisplayedRows;
  const selectedVisibleCount = getXmlReader30UniqueDocumentCheckKeys(displayedRows).filter((key) => state.selectedXmlReaderIds.has(key)).length;
  const visibleColumns = getXmlReader30VisibleNfeColumns();
  const tableWidth = getXmlReader30VisibleNfeColumnsTotalWidth();
  const compactMaxHeight = fullscreen ? 'none' : 'min(62vh, 620px)';
  const shellClassName = fullscreen ? 'xml-reader30-results-shell fullscreen' : 'xml-reader30-results-shell compact';
  const viewportClassName = fullscreen ? 'xml-reader30-results-viewport fullscreen' : 'xml-reader30-results-viewport compact';
  const tableWrapClassName = fullscreen ? 'table-wrap xml-reader30-pan-scroll xml-reader30-pan-scroll-fullscreen' : 'table-wrap xml-reader30-pan-scroll xml-reader30-pan-scroll-compact';

  return `
    <article class="card ${shellClassName}" style="margin-top: 2px;">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">XMLs encontrados</h3>
          <p class="card-subtitle">
            Mostrando ${escapeHtml(String(displayedRows.length))}${cstFilter ? ` de ${escapeHtml(String(allDisplayedRows.length))}` : ''} linha(s) itemizada(s) da NF-e do acervo interno.
          </p>

        </div>
        <div class="stack-mini xml-reader30-toolbar-stack">
          <div class="xml-reader30-toolbar-controls">
            <label class="field xml-reader30-filter-field">
              <span style="font-size:11px;">CST/CSOSN</span>
              <select data-action="xml-reader30-cst-filter">
                ${renderOptions(['', ...cstOptions], cstFilter, { '': 'Todos' })}
              </select>
            </label>
            <label class="field xml-reader30-filter-field xml-reader30-filter-field-regime">
              <span style="font-size:11px;">Regime da empresa</span>
              <select data-action="xml-reader30-nfe-regime">
                ${renderOptions(
                  ['lucro_real', 'lucro_presumido', 'simples_nacional'],
                  state.xmlReader30.nfeRegime || 'lucro_real',
                  {
                    lucro_real: 'Lucro Real',
                    lucro_presumido: 'Lucro Presumido',
                    simples_nacional: 'Simples Nacional'
                  }
                )}
              </select>
            </label>
            <div class="xml-reader30-selection-badge">${statusBadge(`${selectedVisibleCount} conferido(s)`, selectedVisibleCount ? 'info' : 'neutral')}</div>
            ${
              fullscreen
                ? ''
                : `
                  <button
                    class="btn secondary"
                    type="button"
                    data-action="xml-reader30-open-fullscreen"
                    aria-label="Abrir tabela da NF-e em tela cheia"
                    title="Tela cheia"
                    style="height:32px; padding:0 10px; display:inline-flex; align-items:center; gap:6px;"
                  >
                    ${renderXmlReader30NfeFullscreenIcon()}
                  </button>
                `
            }
          </div>
          <span class="row-sub xml-reader30-toolbar-hint">${fullscreen ? 'Use a barra de rolagem da janela para consultar a tabela inteira.' : 'A tabela esta compactada para consulta rapida. Use o botao de tela cheia para ampliar.'}</span>
        </div>
      </div>
      <div class="${viewportClassName}" style="max-height:${compactMaxHeight};">
        <div class="xml-reader30-top-scroll" aria-hidden="true">
          <div class="xml-reader30-top-scroll-spacer" style="min-width:${tableWidth}px;"></div>
        </div>
        <div class="${tableWrapClassName}">
          <table class="xml-reader30-table xml-reader30-reorderable-table xml-reader30-nfe-reorderable-table" style="min-width: ${tableWidth}px;">
          <colgroup>
            ${visibleColumns
              .map((column) => {
                const columnWidth = getXmlReader30NfeColumnWidth(column.key);
                return `<col data-column-key="${escapeHtml(column.key)}" style="width:${columnWidth}px; min-width:${columnWidth}px; max-width:${columnWidth}px;" />`;
              })
              .join('')}
          </colgroup>
          <thead>
            <tr>
              ${visibleColumns
                .map((column, index) => {
                  const columnWidth = getXmlReader30NfeColumnWidth(column.key);
                  return `
                    <th
                      class="xml-reader30-column-header ${column.key === 'select' ? 'xml-reader30-column-header-select' : ''}"
                      data-action="xml-reader30-column-drag"
                      data-column-key="${escapeHtml(column.key)}"
                      data-column-index="${index}"
                      draggable="true"
                      style="width:${columnWidth}px; min-width:${columnWidth}px; max-width:${columnWidth}px;"
                      title="Arraste para mover esta coluna"
                    >
                      <div class="xml-reader30-column-header-inner">
                        <span class="xml-reader30-column-title">
                          ${column.key === 'select' ? `<span class="xml-reader30-column-title-select">Conferido</span>` : renderXmlReader30SortHeader(column.key, column.label)}
                        </span>
                        <div class="xml-reader30-column-header-tools">
                          <div class="xml-reader30-column-menu-wrap" data-xml-reader30-column-menu-wrap>
                            <button
                              class="xml-reader30-column-menu"
                              type="button"
                              data-action="xml-reader30-column-menu-toggle"
                              data-column-key="${escapeHtml(column.key)}"
                              aria-expanded="${state.xmlReader30.columnMenuOpenKey === column.key ? 'true' : 'false'}"
                              aria-label="Abrir menu da coluna ${escapeHtml(column.label)}"
                              title="Abrir menu"
                            >&#8942;</button>
                            ${
                              state.xmlReader30.columnMenuOpenKey === column.key
                                ? `
                                  <div
                                    class="xml-reader30-column-menu-panel"
                                    role="menu"
                                    aria-label="Menu da coluna ${escapeHtml(column.label)}"
                                    style="top:${escapeHtml(String(state.xmlReader30.columnMenuAnchor?.top ?? 8))}px; left:${escapeHtml(String(state.xmlReader30.columnMenuAnchor?.left ?? 8))}px;"
                                  >
                                    <button
                                      type="button"
                                      class="xml-reader30-column-menu-item"
                                      data-action="xml-reader30-column-menu-hide"
                                      data-column-key="${escapeHtml(column.key)}"
                                      role="menuitem"
                                    >Excluir coluna</button>
                                  </div>
                                `
                                : ''
                            }
                          </div>
                          <span class="xml-reader30-column-resizer" data-action="xml-reader30-column-resize" data-column-key="${escapeHtml(column.key)}" title="Arraste para redimensionar a coluna"></span>
                        </div>
                      </div>
                    </th>
                  `;
                })
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'xmlReader30',
              colSpan: visibleColumns.length,
              rowsHtml: displayedRows.length
                ? displayedRows
                    .map((row) => {
                      const statusTone = row.raw?.cancelada ? 'danger' : row.raw?.statusFiscal === 'Autorizada' ? 'success' : row.statusTone || 'info';
                      return `
                        <tr>
                          ${visibleColumns.map((column) => renderXmlReader30NfeColumnCell(column, row, statusTone)).join('')}
                        </tr>
                      `;
                    })
                    .join('')
                : '',
              emptyMessage: 'Nenhum XML encontrado para os filtros informados.'
            })}
          </tbody>
          </table>
        </div>
      </div>
    </article>
  `;
}

function renderXmlReader30NfeFullscreenBody() {
  const results = Array.isArray(state.xmlReader30.results) ? state.xmlReader30.results : [];
  return renderXmlReader30NfeResultsTableReorderable(results, { fullscreen: true });
}

function renderXmlReader30NfeFullscreenModal() {
  return `
    <div class="overlay xml-reader30-fullscreen-overlay" data-action="overlay-close">
      <div class="modal xml-reader30-fullscreen-modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h3 class="modal-title">Leitor NF-e em tela cheia</h3>
            <p class="modal-subtitle">A visualizacao abre a mesma tabela completa do leitor, com mais espaco para consulta.</p>
          </div>
          <div class="modal-header-actions">
            <button class="btn secondary" type="button" data-action="close-modal">Fechar</button>
          </div>
        </div>
        <div class="modal-body xml-reader30-fullscreen-body" data-xml-reader30-fullscreen-body>
          ${renderXmlReader30NfeFullscreenBody()}
        </div>
      </div>
    </div>
  `;
}

function getXmlReader30NfeOrderedColumns() {
  const order = normalizeXmlReader30NfeColumnOrder(state.xmlReader30.nfeColumnOrder);
  const currentOrder = Array.isArray(state.xmlReader30.nfeColumnOrder) ? state.xmlReader30.nfeColumnOrder : [];
  if (order.join('|') !== currentOrder.join('|')) {
    state.xmlReader30.nfeColumnOrder = order;
  }

  const definitions = getXmlReader30NfeColumnDefinitions();
  const byKey = new Map(definitions.map((column) => [column.key, column]));
  return order.map((key) => byKey.get(key)).filter(Boolean);
}

function getXmlReader30VisibleNfeColumns() {
  const hiddenColumns = state.xmlReader30.hiddenNfeColumns instanceof Set ? state.xmlReader30.hiddenNfeColumns : new Set();
  return getXmlReader30NfeOrderedColumns().filter((column) => !hiddenColumns.has(column.key));
}

function getXmlReader30NfeColumnDefinitions() {
  return [
    {
      key: 'select',
      label: 'Checkbox',
      headerHtml: 'Conferido',
      className: 'xml-reader30-check',
      html: true,
      render: (row) => {
        const selectionKey = getXmlReader30DocumentCheckKey(row);
        return renderXmlReader30SelectionControl({
          selectionKey,
          checked: selectionKey && state.selectedXmlReaderIds.has(selectionKey),
          label: `Marcar NF-e como conferida ${String(row.numeroNf || row.numeroLabel || '-')}`
        });
      }
    },
    {
      key: 'numeroNf',
      label: 'Numero NF',
      className: 'xml-reader30-number',
      html: false,
      render: (row) => row.numeroNf || row.numeroLabel || '-'
    },
    {
      key: 'statusNf',
      label: 'Status NF-e',
      className: 'xml-reader30-status',
      html: true,
      render: (row, statusTone) => statusBadge(row.statusNf || row.statusLabel || '-', statusTone)
    },
    {
      key: 'nfCancelada',
      label: 'NF Cancelada?',
      className: 'xml-reader30-flag',
      html: false,
      render: (row) => (row.raw?.cancelada ? 'Sim' : 'Nao')
    },
    {
      key: 'dataEmissao',
      label: 'Data Emissao',
      className: 'xml-reader30-date',
      html: false,
      render: (row) => row.dataEmissaoLabel || formatDate(row.dataEmissao || row.raw?.dataEmissao || '')
    },
    {
      key: 'produto',
      label: 'Produto',
      className: 'xml-reader30-product',
      html: true,
      render: (row) => renderXmlReader30ProductLabel(row.produto)
    },
    {
      key: 'quantidade',
      label: 'Quantidade',
      className: 'xml-reader30-quantity',
      html: false,
      render: (row) => row.quantidade || '-'
    },
    {
      key: 'valorUnitario',
      label: 'Valor Unitario',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatXmlReader30UnitValue(row.valorUnitario)
    },
    {
      key: 'valorTotal',
      label: 'Valor Total',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => row.valorTotal || '-'
    },
    {
      key: 'valorTotalNfXml',
      label: 'Valor Total NF XML R$',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => row.valorTotalNfXml || '-'
    },
    {
      key: 'icmsStRet',
      label: 'ICMS ST RET R$',
      className: 'xml-reader30-money xml-reader30-icms-currency',
      html: false,
      render: (row) => row.icmsStRet || '-'
    },
    {
      key: 'cstCsosn',
      label: 'CST/CSOSN',
      className: 'xml-reader30-icms-code',
      html: false,
      render: (row) => row.cstCsosn || '-'
    },
    {
      key: 'cfop',
      label: 'CFOP',
      className: 'xml-reader30-icms-cfop',
      html: false,
      render: (row) => row.cfop || '-'
    },
    {
      key: 'baseCalculoIcms',
      label: 'Base de Cálculo ICMS',
      className: 'xml-reader30-icms-number',
      html: false,
      render: (row) => row.baseCalculoIcms || '-'
    },
    {
      key: 'aliquotaIcms',
      label: 'Alíquota ICMS (%)',
      className: 'xml-reader30-icms-number',
      html: false,
      render: (row) => row.aliquotaIcms || '-'
    },
    {
      key: 'valorIcms',
      label: 'Valor ICMS',
      className: 'xml-reader30-icms-number',
      html: false,
      render: (row) => row.valorIcms || '-'
    },
    {
      key: 'qBCMonoRet',
      label: 'qBCMonoRet',
      className: 'xml-reader30-icms-number',
      html: false,
      render: (row) => row.qBCMonoRet || '-'
    },
    {
      key: 'adRemICMSRet',
      label: 'adRemICMSRet',
      className: 'xml-reader30-icms-number',
      html: false,
      render: (row) => row.adRemICMSRet || '-'
    },
    {
      key: 'vICMSMonoRet',
      label: 'vICMSMonoRet',
      className: 'xml-reader30-icms-number',
      html: false,
      render: (row) => row.vICMSMonoRet || '-'
    },
    {
      key: 'aliqVigente',
      label: 'Aliq Vigente',
      className: 'xml-reader30-icms-number',
      html: false,
      render: (row) => row.aliqVigente || '-'
    },
    {
      key: 'valorCorreto',
      label: 'Valor Correto R$',
      className: 'xml-reader30-money xml-reader30-icms-currency',
      html: false,
      render: (row) => row.valorCorreto || '-'
    },
    {
      key: 'evento',
      label: 'Evento',
      className: 'xml-reader30-event',
      html: false,
      render: (row) => row.evento || '-'
    }
  ];
}

function renderXmlReader30NfeColumnCell(column, row, statusTone) {
  const value = column.render(row, statusTone);
  const columnWidth = getXmlReader30NfeColumnWidth(column.key);
  const cellStyle = `width:${columnWidth}px; min-width:${columnWidth}px; max-width:${columnWidth}px;`;
  if (column.html) {
    return `<td class="${escapeHtml(column.className || '')}" data-column-key="${escapeHtml(column.key)}" style="${cellStyle}">${value}</td>`;
  }

  return `<td class="${escapeHtml(column.className || '')}" data-column-key="${escapeHtml(column.key)}" style="${cellStyle}">${escapeHtml(String(value ?? '-'))}</td>`;
}

function getXmlReader30NfeColumnMinWidth(columnKey) {
  switch (columnKey) {
    case 'select':
      return 92;
    case 'numeroNf':
      return 110;
    case 'statusNf':
      return 118;
    case 'nfCancelada':
      return 108;
    case 'dataEmissao':
      return 125;
    case 'produto':
      return 320;
    case 'quantidade':
      return 84;
    case 'valorUnitario':
      return 118;
    case 'valorTotal':
      return 118;
    case 'valorTotalNfXml':
      return 148;
    case 'icmsStRet':
      return 118;
    case 'cstCsosn':
      return 92;
    case 'cfop':
      return 84;
    case 'baseCalculoIcms':
      return 116;
    case 'aliquotaIcms':
      return 108;
    case 'valorIcms':
      return 108;
    case 'qBCMonoRet':
      return 110;
    case 'adRemICMSRet':
      return 118;
    case 'vICMSMonoRet':
      return 118;
    case 'aliqVigente':
      return 100;
    case 'valorCorreto':
      return 132;
    case 'evento':
      return 220;
    default:
      return 110;
  }
}

function normalizeXmlReader30NfeColumnWidth(columnKey, width) {
  const minWidth = getXmlReader30NfeColumnMinWidth(columnKey);
  const normalizedWidth = Math.round(Number(width) || 0);
  if (!Number.isFinite(normalizedWidth)) {
    return minWidth;
  }

  return Math.max(minWidth, Math.min(normalizedWidth, 960));
}

function getXmlReader30NfeColumnWidth(columnKey) {
  const configuredWidths = state.xmlReader30.nfeColumnWidths && typeof state.xmlReader30.nfeColumnWidths === 'object'
    ? state.xmlReader30.nfeColumnWidths
    : {};
  const configuredWidth = configuredWidths[columnKey];
  if (Number.isFinite(configuredWidth)) {
    return normalizeXmlReader30NfeColumnWidth(columnKey, configuredWidth);
  }

  return getXmlReader30NfeColumnMinWidth(columnKey);
}

function getXmlReader30VisibleNfeColumnsTotalWidth() {
  return getXmlReader30VisibleNfeColumns().reduce((total, column) => total + getXmlReader30NfeColumnWidth(column.key), 0);
}

function applyXmlReader30NfeColumnWidthsToDom() {
  const visibleColumns = getXmlReader30VisibleNfeColumns();
  const totalWidth = visibleColumns.reduce((total, column) => total + getXmlReader30NfeColumnWidth(column.key), 0);

  document.querySelectorAll('.xml-reader30-nfe-reorderable-table').forEach((table) => {
    if (!(table instanceof HTMLElement)) {
      return;
    }

    table.style.minWidth = `${totalWidth}px`;

    visibleColumns.forEach((column) => {
      const columnWidth = getXmlReader30NfeColumnWidth(column.key);
      table.querySelectorAll(`[data-column-key="${column.key}"]`).forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }

        node.style.width = `${columnWidth}px`;
        node.style.minWidth = `${columnWidth}px`;
        node.style.maxWidth = `${columnWidth}px`;
      });
    });
  });

  document.querySelectorAll('.xml-reader30-top-scroll-spacer').forEach((node) => {
    if (!(node instanceof HTMLElement)) {
      return;
    }

    node.style.minWidth = `${totalWidth}px`;
  });
}

function startXmlReader30NfeColumnResize(columnKey, startX) {
  const normalizedKey = String(columnKey || '').trim();
  if (!normalizedKey) {
    return;
  }

  state.xmlReader30.columnResize = {
    active: true,
    columnKey: normalizedKey,
    startX,
    startWidth: getXmlReader30NfeColumnWidth(normalizedKey)
  };

  document.body.classList.add('xml-reader30-resizing');
}

function updateXmlReader30NfeColumnResize(clientX) {
  const resizeState = state.xmlReader30.columnResize;
  if (!resizeState?.active) {
    return;
  }

  const nextWidth = normalizeXmlReader30NfeColumnWidth(
    resizeState.columnKey,
    resizeState.startWidth + (clientX - resizeState.startX)
  );

  state.xmlReader30.nfeColumnWidths = {
    ...(state.xmlReader30.nfeColumnWidths && typeof state.xmlReader30.nfeColumnWidths === 'object' ? state.xmlReader30.nfeColumnWidths : {}),
    [resizeState.columnKey]: nextWidth
  };
  applyXmlReader30NfeColumnWidthsToDom();
}

function finishXmlReader30NfeColumnResize() {
  if (!state.xmlReader30.columnResize?.active) {
    return;
  }

  saveXmlReader30NfeColumnWidthsStore(state.xmlReader30.nfeColumnWidths);
  state.xmlReader30.columnResize = null;
  document.body.classList.remove('xml-reader30-resizing');
}

function onDocumentScroll(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (!target.classList.contains('xml-reader30-top-scroll') && !target.classList.contains('xml-reader30-pan-scroll')) {
    return;
  }

  if (xmlReader30ScrollSyncing) {
    return;
  }

  const card = target.closest('.card');
  if (!(card instanceof HTMLElement)) {
    return;
  }

  const topScroll = card.querySelector('.xml-reader30-top-scroll');
  const panScroll = card.querySelector('.xml-reader30-pan-scroll');
  const left = target.scrollLeft;

  xmlReader30ScrollSyncing = true;
  try {
    if (topScroll instanceof HTMLElement && topScroll !== target) {
      topScroll.scrollLeft = left;
    }
    if (panScroll instanceof HTMLElement && panScroll !== target) {
      panScroll.scrollLeft = left;
    }
  } finally {
    xmlReader30ScrollSyncing = false;
  }
}

function formatXmlReader30UnitValue(value) {
  const normalizedValue = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const numericValue = Number(normalizedValue);
  if (Number.isFinite(numericValue)) {
    return numericValue.toFixed(2);
  }

  return value ? String(value) : '-';
}

function normalizeXmlReader30InlineText(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || '-';
}

function renderXmlReader30ProductLabel(value) {
  const normalized = normalizeXmlReader30InlineText(value);
  const displayValue = truncateText(normalized, 30);
  return `<span class="row-title xml-reader30-product-label" title="${escapeHtml(normalized)}">${escapeHtml(displayValue)}</span>`;
}

function resolveXmlReader30AliqVigente(dataEmissao, cstCsosn) {
  if (String(cstCsosn || '').trim() !== '61') {
    return 0;
  }

  const emissionTimestamp = Date.parse(dataEmissao || '');
  if (!Number.isFinite(emissionTimestamp)) {
    return 0;
  }

  const periodos = Array.isArray(state.settings.aliquotas.periodos) ? state.settings.aliquotas.periodos : [];
  const periodoVigente = periodos.find((periodo) => {
    const inicioTimestamp = Date.parse(`${periodo.dataInicio}T00:00:00`);
    if (!Number.isFinite(inicioTimestamp) || emissionTimestamp < inicioTimestamp) {
      return false;
    }

    if (!periodo.dataFim) {
      return true;
    }

    const fimTimestamp = Date.parse(`${periodo.dataFim}T23:59:59`);
    return Number.isFinite(fimTimestamp) && emissionTimestamp <= fimTimestamp;
  });

  return periodoVigente ? Number(periodoVigente.aliquota) || 0 : 0;
}

function computeXmlReader30MonofasicValues(dataEmissao, cstCsosn, qBCMonoRet) {
  const aliqVigente = resolveXmlReader30AliqVigente(dataEmissao, cstCsosn);
  const baseValue = Number(String(qBCMonoRet || 0).replace(',', '.'));
  const valorCorreto = Number.isFinite(baseValue) ? baseValue * aliqVigente : 0;

  return {
    aliqVigente: formatXmlReader30DecimalValue(aliqVigente),
    aliqVigenteRaw: aliqVigente.toFixed(2),
    valorCorreto: formatXmlReader30CurrencyValue(valorCorreto),
    valorCorretoRaw: valorCorreto.toFixed(2)
  };
}

function renderXmlReader30SortHeader(key, label) {
  const isActive = state.sort.xmlReader30.key === key;
  const direction = isActive ? state.sort.xmlReader30.direction : 'none';
  const sortLabel =
    direction === 'asc'
      ? `${label}, ordenado crescente`
      : direction === 'desc'
        ? `${label}, ordenado decrescente`
        : `${label}, ordenar`;

  return `
    <button class="sort-header xml-reader30-sort-header ${isActive ? 'active' : ''}" type="button" data-action="xml-reader30-sort" data-sort-key="${escapeHtml(key)}" aria-label="${escapeHtml(sortLabel)}">
      <span>${escapeHtml(label)}</span>
      <span class="sort-indicator" aria-hidden="true">${direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}</span>
    </button>
  `;
}

function updateXmlReader30Sort(key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return;
  }

  const current = state.sort.xmlReader30;
  state.sort.xmlReader30 = {
    key: normalizedKey,
    direction: current.key === normalizedKey && current.direction === 'asc' ? 'desc' : 'asc'
  };
  renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
}

function sortXmlReader30Results(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const sort = state.sort.xmlReader30;
  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;
  return [...sourceRows].sort((left, right) => {
    const comparison = compareXmlSortValues(getXmlReader30SortValue(left, sort.key), getXmlReader30SortValue(right, sort.key));
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    if (sort.key !== 'numeroNf') {
      const numeroComparison = compareXmlSortValues(getXmlReader30SortValue(left, 'numeroNf'), getXmlReader30SortValue(right, 'numeroNf'));
      if (numeroComparison !== 0) {
        return numeroComparison;
      }
    }

    if (sort.key !== 'dataEmissao') {
      const dataComparison = compareXmlSortValues(getXmlReader30SortValue(left, 'dataEmissao'), getXmlReader30SortValue(right, 'dataEmissao'));
      if (dataComparison !== 0) {
        return dataComparison;
      }
    }

    return compareXmlSortValues(String(left?.rowId || ''), String(right?.rowId || ''));
  });
}

function renderNfseFiscalReaderSortHeader(key, label) {
  const isActive = state.sort.nfseFiscalReader.key === key;
  const direction = isActive ? state.sort.nfseFiscalReader.direction : 'none';
  const sortLabel =
    direction === 'asc'
      ? `${label}, ordenado crescente`
      : direction === 'desc'
        ? `${label}, ordenado decrescente`
        : `${label}, ordenar`;

  return `
    <button class="sort-header nfse-fiscal-reader-sort-header ${isActive ? 'active' : ''}" type="button" data-action="nfse-fiscal-sort" data-sort-key="${escapeHtml(key)}" aria-label="${escapeHtml(sortLabel)}">
      <span>${escapeHtml(label)}</span>
      <span class="sort-indicator" aria-hidden="true">${direction === 'asc' ? '▲' : direction === 'desc' ? '▼' : '↕'}</span>
    </button>
  `;
}

function updateNfseFiscalReaderSort(key) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return;
  }

  const current = state.sort.nfseFiscalReader;
  state.sort.nfseFiscalReader = {
    key: normalizedKey,
    direction: current.key === normalizedKey && current.direction === 'asc' ? 'desc' : 'asc'
  };
  renderPreservingScroll(['.nfse-fiscal-reader-scroll']);
}

function sortNfseFiscalReaderRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const sort = state.sort.nfseFiscalReader;
  const directionMultiplier = sort.direction === 'asc' ? 1 : -1;
  return [...sourceRows].sort((left, right) => {
    const comparison = compareXmlSortValues(getNfseFiscalReaderSortValue(left, sort.key), getNfseFiscalReaderSortValue(right, sort.key));
    if (comparison !== 0) {
      return comparison * directionMultiplier;
    }

    if (sort.key !== 'dataEmissao') {
      const dataComparison = compareXmlSortValues(
        getNfseFiscalReaderSortValue(left, 'dataEmissao'),
        getNfseFiscalReaderSortValue(right, 'dataEmissao')
      );
      if (dataComparison !== 0) {
        return dataComparison;
      }
    }

    return compareXmlSortValues(String(left?.id || ''), String(right?.id || ''));
  });
}

function getNfseFiscalReaderSortValue(row, key) {
  if (!row) {
    return '';
  }

  switch (key) {
    case 'numeroNfse':
      return toSortableNumber(row.numeroNfse);
    case 'dataEmissao':
      return toSortableDate(row.dataEmissao);
    case 'cnpjPrestador':
      return row.cnpjPrestador || '';
    case 'cnpjTomador':
      return row.cnpjTomador || '';
    case 'valorLiquidoNfse':
    case 'valorTotalRetencoes':
    case 'valorServico':
    case 'valorIss':
    case 'valorPis':
    case 'valorCofins':
    case 'valorInss':
    case 'valorIrrf':
    case 'valorCsll':
    case 'valorIssRetidoReal':
    case 'aliquotaIss':
    case 'aliquotaRealIss':
    case 'totalRetencoesFederais':
      return toSortableBrNumber(row[key]);
    default:
      return row[key] || '';
  }
}

function getXmlReader30SortValue(row, key) {
  if (!row) {
    return '';
  }

  switch (key) {
    case 'numero':
    case 'numeroNf':
      return toSortableNumber(row.numeroNf || row.numeroLabel || row.raw?.numeroNfe || row.raw?.numeroNfse || row.raw?.numeroCte);
    case 'dataEmissao':
      return toSortableDate(row.dataEmissao || row.dataEmissaoLabel || row.raw?.dataEmissao || row.raw?.dataAutorizacao || row.raw?.dataDownload);
    case 'tipo':
      return row.documentLabel || '';
    case 'empresa':
      return row.cliente || '';
    case 'valor':
      return Number(String(row.valorLabel || row.valorTotal || row.valorTotalNfXml || row.raw?.valor || 0).replace(/[^\d.-]/g, '')) || 0;
    case 'statusNf':
      return row.statusNf || row.statusLabel || '';
    case 'nfCancelada':
      return row.raw?.cancelada ? 1 : 0;
    case 'produto':
      return row.produto || '';
    case 'quantidade':
      return toSortableBrNumber(row.quantidade);
    case 'valorUnitario':
      return toSortableBrNumber(row.valorUnitario);
    case 'valorTotal':
      return toSortableBrNumber(row.valorTotal);
    case 'valorTotalNfXml':
      return toSortableBrNumber(row.valorTotalNfXml);
    case 'icmsStRet':
      return toSortableBrNumber(row.icmsStRetRaw ?? row.icmsStRet);
    case 'cstCsosn':
      return row.cstCsosn || '';
    case 'cfop':
      return row.cfop || '';
    case 'baseCalculoIcms':
      return toSortableBrNumber(row.baseCalculoIcmsRaw ?? row.baseCalculoIcms);
    case 'aliquotaIcms':
      return toSortableBrNumber(row.aliquotaIcmsRaw ?? row.aliquotaIcms);
    case 'valorIcms':
      return toSortableBrNumber(row.valorIcmsRaw ?? row.valorIcms);
    case 'qBCMonoRet':
      return toSortableBrNumber(row.qBCMonoRet);
    case 'adRemICMSRet':
      return toSortableBrNumber(row.adRemICMSRet);
    case 'vICMSMonoRet':
      return toSortableBrNumber(row.vICMSMonoRet);
    case 'aliqVigente':
      return toSortableBrNumber(row.aliqVigente);
    case 'valorCorreto':
      return toSortableBrNumber(row.valorCorreto);
    case 'evento':
      return row.evento || '';
    default:
      return row[key] || row.raw?.[key] || '';
  }
}

function formatXmlReader30DecimalValue(value) {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  const normalizedValue = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  return numericValue
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function formatXmlReader30QuantityValue(value) {
  if (value === null || value === undefined || value === '') {
    return '0.00';
  }

  const normalizedValue = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue)) {
    return '0.00';
  }

  return numericValue.toFixed(2);
}

function formatXmlReader30CurrencyValue(value) {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  const normalizedValue = typeof value === 'string' ? value.replace(',', '.').trim() : value;
  const numericValue = Number(normalizedValue);
  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  return formatCurrency(numericValue);
}

async function applyXmlReader30NfeRegimeWithLoading(regime) {
  startPageLoading({
    title: 'Atualizando regime da empresa',
    description: 'Recalculando as colunas visiveis do Leitor NFE.',
    initialTask: 'Aplicando configuracao selecionada'
  });
  render();
  await new Promise((resolve) => setTimeout(resolve, 120));
  applyXmlReader30NfeRegime(regime);
  renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
  stopPageLoading();
  render();
}

function applyXmlReader30NfeRegime(regime) {
  const normalizedRegime = normalizeXmlReader30NfeRegime(regime);
  state.xmlReader30.nfeRegime = normalizedRegime;
  state.xmlReader30.hiddenNfeColumns = new Set(getXmlReader30NfeRegimeHiddenColumns(normalizedRegime));
  saveXmlReader30NfeRegimeStore(normalizedRegime);
  closeXmlReader30NfeColumnMenu();
}

function hideXmlReader30NfeColumn(columnKey) {
  const normalizedKey = String(columnKey || '').trim();
  if (!normalizedKey) {
    return;
  }

  const nextHidden = state.xmlReader30.hiddenNfeColumns instanceof Set
    ? new Set(state.xmlReader30.hiddenNfeColumns)
    : new Set();
  nextHidden.add(normalizedKey);
  state.xmlReader30.hiddenNfeColumns = nextHidden;
  closeXmlReader30NfeColumnMenu();
  renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
}

function toggleXmlReader30NfeColumnMenu(columnKey, anchorNode) {
  const normalizedKey = String(columnKey || '').trim();
  if (!normalizedKey) {
    return;
  }

  if (state.xmlReader30.columnMenuOpenKey === normalizedKey) {
    closeXmlReader30NfeColumnMenu();
    renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
    return;
  }

  const rect = anchorNode instanceof HTMLElement ? anchorNode.getBoundingClientRect() : null;
  if (rect) {
    const estimatedWidth = 164;
    const left = Math.min(window.innerWidth - estimatedWidth - 8, Math.max(8, rect.right - estimatedWidth));
    const top = Math.min(window.innerHeight - 12, rect.bottom + 6);
    state.xmlReader30.columnMenuAnchor = {
      left,
      top
    };
  } else {
    state.xmlReader30.columnMenuAnchor = {
      left: 8,
      top: 8
    };
  }

  state.xmlReader30.columnMenuOpenKey = normalizedKey;
  renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
}

function closeXmlReader30NfeColumnMenu() {
  if (!state.xmlReader30.columnMenuOpenKey) {
    return;
  }

  state.xmlReader30.columnMenuOpenKey = null;
  state.xmlReader30.columnMenuAnchor = null;
}

function expandXmlReader30NfeRows(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!row || row.documentType !== 'nfe') {
      return row ? [row] : [];
    }

    return buildXmlReader30NfeItemRows(row, { includeFallback: true });
  });
}

function buildXmlReader30NfeItemRows(row, options = {}) {
  const includeFallback = Boolean(options.includeFallback);
  const items = extractNfeLineItems(row?.raw?.conteudoXml || '');
  const baseStatusLabel = resolveNfeLineItemStatusLabel(row?.raw || row);
  const baseStatusTone = row?.raw?.cancelada ? 'danger' : row?.raw?.statusFiscal === 'Autorizada' ? 'success' : row?.statusTone || 'info';
  const baseDataEmissao = formatDate(row?.raw?.dataEmissao || row?.dataEmissao || '');
  const baseNumero = row?.numeroLabel || '-';
  const baseValorTotal = row?.valorLabel || formatOptionalCurrency(row?.raw?.valor) || '-';
  const baseEvento = normalizeXmlReader30InlineText(row?.raw?.eventosResumo || '-');
  const baseSelectionKey = `${row?.documentType || 'nfe'}:${row?.rowId || row?.raw?.id || row?.raw?.apiNfeId || row?.raw?.chaveAcesso || baseNumero}`;

  if (!items.length) {
    if (!includeFallback) {
      return [];
    }

    const monofasicValues = computeXmlReader30MonofasicValues(row?.raw?.dataEmissao || row?.dataEmissao || '', '0', '0');
    return [
      {
        ...row,
        selectionKey: `${baseSelectionKey}:fallback`,
        numeroNf: baseNumero,
        statusNf: baseStatusLabel,
        statusTone: baseStatusTone,
        nfCancelada: row?.raw?.cancelada ? 'Sim' : 'Nao',
        dataEmissaoLabel: baseDataEmissao,
        produto: normalizeXmlReader30InlineText(row?.productLabel),
        quantidade: '0.00',
        valorUnitario: '-',
        valorTotal: '-',
        valorTotalNfXml: baseValorTotal,
        icmsStRet: '0',
        icmsStRetRaw: '0',
        cstCsosn: '0',
        cfop: '0',
        baseCalculoIcms: '0',
        baseCalculoIcmsRaw: '0',
        aliquotaIcms: '0',
        aliquotaIcmsRaw: '0',
        valorIcms: '0',
        valorIcmsRaw: '0',
        qBCMonoRet: '0',
        qBCMonoRetRaw: '0',
        adRemICMSRet: '0',
        adRemICMSRetRaw: '0',
        vICMSMonoRet: '0',
        vICMSMonoRetRaw: '0',
        aliqVigente: monofasicValues.aliqVigente,
        aliqVigenteRaw: monofasicValues.aliqVigenteRaw,
        valorCorreto: monofasicValues.valorCorreto,
        valorCorretoRaw: monofasicValues.valorCorretoRaw,
        evento: baseEvento
      }
    ];
  }

  return items.map((item, itemIndex) => ({
    ...row,
    selectionKey: `${baseSelectionKey}:item:${itemIndex}`,
    numeroNf: baseNumero,
    statusNf: baseStatusLabel,
    statusTone: baseStatusTone,
    nfCancelada: row?.raw?.cancelada ? 'Sim' : 'Nao',
    dataEmissaoLabel: baseDataEmissao,
    produto: normalizeXmlReader30InlineText(item.description),
    quantidade: formatXmlReader30QuantityValue(item.quantity),
    valorUnitario: item.unitValueRaw || item.unitValue || '-',
    valorTotal: item.totalValueRaw || item.totalValue || '-',
    valorTotalNfXml: baseValorTotal,
    icmsStRet: item.icmsStRet || '0',
    icmsStRetRaw: item.icmsStRetRaw || '0',
    cstCsosn: item.cstCsosn || '0',
    cfop: item.cfop || '0',
    baseCalculoIcms: item.baseCalculoIcms || '0',
    baseCalculoIcmsRaw: item.baseCalculoIcmsRaw || '0',
    aliquotaIcms: item.aliquotaIcms || '0',
    aliquotaIcmsRaw: item.aliquotaIcmsRaw || '0',
    valorIcms: item.valorIcms || '0',
    valorIcmsRaw: item.valorIcmsRaw || '0',
    qBCMonoRet: item.qBCMonoRet || '0',
    qBCMonoRetRaw: item.qBCMonoRetRaw || '0',
    adRemICMSRet: item.adRemICMSRet || '0',
    adRemICMSRetRaw: item.adRemICMSRetRaw || '0',
    vICMSMonoRet: item.vICMSMonoRet || '0',
    vICMSMonoRetRaw: item.vICMSMonoRetRaw || '0',
    ...computeXmlReader30MonofasicValues(row?.raw?.dataEmissao || row?.dataEmissao || '', item.cstCsosn || '0', item.qBCMonoRetRaw || item.qBCMonoRet || '0'),
    evento: baseEvento
  }));
}

function getXmlReader30NfeGroupKey(row) {
  const raw = row?.raw || {};
  const chaveAcesso = normalizeDigits(String(raw?.chaveAcesso || row?.chaveAcesso || ''));
  const clientId = String(raw?.clientId || row?.clientId || '').trim();
  const numeroNfe = String(raw?.numeroNfe || row?.numeroLabel || row?.numeroNf || '').trim();
  const serie = String(raw?.serie || row?.serie || '').trim();
  const dataEmissao = String(raw?.dataEmissao || row?.dataEmissao || '').trim();
  const emitenteCnpj = normalizeDigits(String(raw?.emitenteCnpj || row?.emitenteCnpj || ''));
  const destinatarioCnpj = normalizeDigits(String(raw?.destinatarioCnpj || row?.destinatarioCnpj || ''));

  if (chaveAcesso) {
    return ['nfe', clientId || '-', chaveAcesso].join('|');
  }

  return [
    'nfe',
    clientId || '-',
    numeroNfe || '-',
    serie || '-',
    dataEmissao || '-',
    emitenteCnpj || '-',
    destinatarioCnpj || '-'
  ]
    .join('|');
}

function resolveXmlReader30NfeFornecedorLabel(row) {
  const raw = row?.raw || row || {};
  const contraparte = normalizeXmlReader30InlineText(raw?.contraparteNome || row?.contraparteNome || '');
  const emitente = normalizeXmlReader30InlineText(raw?.emitenteNome || row?.emitenteNome || '');
  const destinatario = normalizeXmlReader30InlineText(raw?.destinatarioNome || row?.destinatarioNome || '');
  const cliente = normalizeXmlReader30InlineText(raw?.cliente || row?.cliente || '');

  return contraparte || emitente || destinatario || cliente || '-';
}

function countXmlReader30NfeNotes(rows) {
  const seenKeys = new Set();

  for (const row of expandXmlReader30NfeRows(rows)) {
    if (!row || row.documentType !== 'nfe') {
      continue;
    }

    const raw = row.raw || row;
    const key =
      String(raw?.chaveAcesso || raw?.apiNfeId || raw?.id || '')
        .trim() ||
      `${String(raw?.numeroNfe || row.numeroNf || '').trim()}|${String(raw?.serie || '').trim()}|${String(raw?.dataEmissao || row.dataEmissao || '').trim()}`;

    if (!key || seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
  }

  return seenKeys.size;
}

function getXmlReader30NfeSummaryTotals(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const invoiceRows = sourceRows.filter((row) => row?.documentType === 'nfe');
  const itemRows = expandXmlReader30NfeRows(sourceRows).filter((row) => row?.documentType === 'nfe');

  const totalNotasValue = invoiceRows.reduce((sum, row) => {
    if (!shouldIncludeDocumentValueInSum(row?.raw || row)) {
      return sum;
    }

    return sum + toNumber(row?.raw?.valor ?? row?.valor ?? 0);
  }, 0);

  const totalIcmsValue = itemRows.reduce((sum, row) => {
    if (!shouldIncludeDocumentValueInSum(row?.raw || row)) {
      return sum;
    }

    return sum + toNumber(row?.valorIcmsRaw ?? row?.valorIcms ?? 0);
  }, 0);

  const totalIcmsMonofasicoValue = itemRows.reduce((sum, row) => {
    if (!shouldIncludeDocumentValueInSum(row?.raw || row)) {
      return sum;
    }

    return sum + toNumber(row?.vICMSMonoRetRaw ?? row?.vICMSMonoRet ?? 0);
  }, 0);

  const totalIcmsStRetValue = itemRows.reduce((sum, row) => {
    if (!shouldIncludeDocumentValueInSum(row?.raw || row)) {
      return sum;
    }

    return sum + toNumber(row?.icmsStRetRaw ?? row?.icmsStRet ?? 0);
  }, 0);

  return {
    totalNotasValue,
    totalIcmsValue,
    totalIcmsMonofasicoValue,
    totalIcmsStRetValue
  };
}
function renderXmlReader30ResultsTableLegacyUnusedOld2(results) {
  return `
    <article class="card" style="margin-top: 2px;">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">XMLs encontrados</h3>
          <p class="card-subtitle">Mostrando ${escapeHtml(String(results.length))} XML(s) do acervo interno.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Documento</th>
              <th>Empresa</th>
              <th>Emissao</th>
              <th>Situação</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'xmlReader30',
              colSpan: 6,
              rowsHtml: results.length
                ? results
                    .map((row) => {
                      const actions = renderXmlReader30Actions(row);
                      return `
                        <tr>
                          <td>${statusBadge(row.documentLabel, row.documentTone)}</td>
                          <td>
                            <span class="row-title">${escapeHtml(row.numeroLabel)}</span>
                          </td>
                          <td>
                            <span class="row-title">${escapeHtml(row.cliente)}</span>
                            <span class="row-sub">${escapeHtml(row.cnpjLabel)}</span>
                          </td>
                          <td>${escapeHtml(formatDateTime(row.dataEmissao))}</td>
                          <td>
                            <div class="status-stack">
                              ${statusBadge(row.statusLabel, row.statusTone)}
                              ${statusBadge(row.storageLabel, row.storageTone)}
                            </div>
                          </td>
                          <td>
                            <div class="table-actions">${actions}</div>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')
                : '',
              emptyMessage: 'Nenhum XML encontrado para os filtros informados.'
            })}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function getXmlReader30ActionsMenuId(row) {
  return `xml-reader30:${row.documentType}:${row.rowId}`;
}

function renderXmlReader30Actions(row) {
  const menuId = getXmlReader30ActionsMenuId(row);
  if (row.documentType === 'nfse') {
    return renderRowActionsMenu(menuId, [
      { label: 'Detalhes', action: 'xml-details', attrs: { 'xml-id': row.rowId } },
      { label: 'Ver XML', action: 'xml-view', attrs: { 'xml-id': row.rowId } }
    ]);
  }

  if (row.documentType === 'nfe') {
    return renderRowActionsMenu(menuId, [
      { label: 'Detalhes', action: 'nfe-details', attrs: { 'nfe-id': row.rowId } },
      { label: 'Ver XML', action: 'nfe-view', attrs: { 'nfe-id': row.rowId } }
    ]);
  }

  return renderRowActionsMenu(menuId, [
    { label: 'Detalhes', action: 'cte-details', attrs: { 'cte-id': row.rowId } },
    { label: 'Ver XML', action: 'cte-view', attrs: { 'cte-id': row.rowId } }
  ]);
}

function renderXmlReader30ActionsLegacyUnused(row) {
  if (row.documentType === 'nfse') {
    return `
      <button class="icon-btn" data-action="xml-details" data-xml-id="${escapeHtml(row.rowId)}">Detalhes</button>
      <button class="icon-btn" data-action="xml-view" data-xml-id="${escapeHtml(row.rowId)}">Ver XML</button>
      <button class="icon-btn" data-action="xml-download" data-xml-id="${escapeHtml(row.rowId)}">Baixar XML</button>
    `;
  }

  if (row.documentType === 'nfe') {
    return `
      <button class="icon-btn" data-action="nfe-details" data-nfe-id="${escapeHtml(row.rowId)}">Detalhes</button>
      <button class="icon-btn" data-action="nfe-view" data-nfe-id="${escapeHtml(row.rowId)}">Ver XML</button>
      <button class="icon-btn" data-action="nfe-download" data-nfe-id="${escapeHtml(row.rowId)}">Baixar XML</button>
    `;
  }

  return `
    <button class="icon-btn" data-action="cte-details" data-cte-id="${escapeHtml(row.rowId)}">Detalhes</button>
    <button class="icon-btn" data-action="cte-view" data-cte-id="${escapeHtml(row.rowId)}">Ver XML</button>
    <button class="icon-btn" data-action="cte-download" data-cte-id="${escapeHtml(row.rowId)}">Baixar XML</button>
  `;
}

function mapXmlReader30TypeLabel(documentType) {
  if (documentType === 'nfse') {
    return 'NFS-e';
  }
  if (documentType === 'nfe') {
    return 'NF-e';
  }
  if (documentType === 'cte') {
    return 'CT-e';
  }
  return 'Todos';
}

function resetXmlReader30Search() {
  const activeTab = state.xmlReader30.activeTab === 'nfse-fiscal' ? 'nfse-fiscal' : 'nfe';
  const nfeRegime = normalizeXmlReader30NfeRegime(state.xmlReader30.nfeRegime);
  const nfeColumnOrder = normalizeXmlReader30NfeColumnOrder(state.xmlReader30.nfeColumnOrder);
  const nfeColumnWidths = normalizeXmlReader30NfeColumnWidthsStore(state.xmlReader30.nfeColumnWidths);
  const hiddenNfeColumns = state.xmlReader30.hiddenNfeColumns instanceof Set
    ? new Set(state.xmlReader30.hiddenNfeColumns)
    : new Set(getXmlReader30NfeRegimeHiddenColumns(nfeRegime));
  state.xmlReader30 = {
    activeTab,
    hasSearched: false,
    results: [],
    lastQuery: null,
    lastSearchedAt: null,
    total: 0,
    sourceTotals: {
      nfse: 0,
      nfe: 0,
      cte: 0
    },
    nfeRegime,
    nfeColumnOrder,
    nfeColumnWidths,
    hiddenNfeColumns,
    selectionDrag: null,
    scrollDrag: null,
    columnMenuOpenKey: null,
    columnMenuAnchor: null,
    columnDrag: null,
    columnResize: null
  };
  state.selectedXmlReaderIds = new Set();
  state.tableState.xmlReader30 = 'data';
}

function resetDifalReader() {
  state.difalReader = {
    hasSearched: false,
    lastQuery: null,
    lastLoadedAt: null,
    summary: null,
    itemRows: [],
    chartGrouping: state.difalReader?.chartGrouping || 'dia',
    chartPoints: [],
    chartRenderPoints: [],
    chartViewBox: null
  };
  state.tableState.difalReader = 'data';
}

async function submitDifalReaderForm(form) {
  const data = new FormData(form);
  const cliente = String(data.get('cliente') || '').trim();
  const emissaoInicio = String(data.get('emissaoInicio') || '').trim();
  const emissaoFim = String(data.get('emissaoFim') || '').trim();
  const aliquotaInternaInput = String(data.get('aliquotaInterna') || '').trim();

  if (!cliente) {
    pushToast('Selecione uma empresa para calcular o DIFAL.', 'error');
    return;
  }

  if (emissaoInicio && emissaoFim && Date.parse(emissaoInicio) > Date.parse(emissaoFim)) {
    pushToast('A data inicial nao pode ser maior que a data final.', 'error');
    return;
  }

  const aliquotaInterna = toNumber(aliquotaInternaInput);
  if (!(aliquotaInterna > 0)) {
    pushToast('Informe a aliquota interna (%) para calcular o DIFAL.', 'error');
    return;
  }

  state.difalReader.hasSearched = true;
  state.difalReader.lastQuery = { cliente, emissaoInicio, emissaoFim, aliquotaInterna };
  state.difalReader.summary = null;
  state.difalReader.itemRows = [];
  state.tableState.difalReader = 'loading';
  render();

  try {
    const sourceResult = await fetchDifalReaderDocuments({ cliente, emissaoInicio, emissaoFim });
    const fetchedNoteRows = Array.isArray(sourceResult.items) ? sourceResult.items : [];
    const noteRows = fetchedNoteRows.filter((noteRow) => matchesDateRange(noteRow?.dataEmissao, emissaoInicio, emissaoFim));
    const lineItems = noteRows.flatMap((noteRow) => buildXmlReader30NfeItemRows(noteRow, { includeFallback: true }));
    const { rows: decoratedItemRows, summary } = computeDifalReaderTotals(lineItems, aliquotaInterna, noteRows.length);

    state.difalReader.itemRows = decoratedItemRows;
    state.difalReader.summary = summary;
    state.difalReader.chartPoints = buildDifalReaderChartPoints(decoratedItemRows, state.difalReader.chartGrouping);
    state.difalReader.lastLoadedAt = new Date().toISOString();
    state.tableState.difalReader = 'data';

    if (sourceResult.capped) {
      pushToast(
        `O leitor trouxe o limite seguro do acervo completo (${sourceResult.loaded} de ${sourceResult.total}). Refine o periodo para ver o restante.`,
        'info'
      );
    }

    const notasSemXml = noteRows.filter((noteRow) => !noteRow?.raw?.conteudoXml).length;
    if (notasSemXml > 0) {
      pushToast(
        `${notasSemXml} de ${noteRows.length} nota(s) do periodo nao tem XML (completo ou resumo) armazenado no Nota Sync e entraram com valores zerados no calculo.`,
        'info'
      );
    }

    const notasForaDoPeriodo = fetchedNoteRows.length - noteRows.length;
    if (notasForaDoPeriodo > 0) {
      pushToast(`${notasForaDoPeriodo} nota(s) fora do periodo exato foram excluidas da consulta.`, 'info');
    }

    const notasCanceladasNaLista = noteRows.filter((noteRow) => noteRow?.raw?.cancelada).length;
    if (notasCanceladasNaLista > 0) {
      pushToast(
        `${notasCanceladasNaLista} nota(s) cancelada(s) aparecem na lista (status "Cancelada"), mas nao entram nas somas do DIFAL.`,
        'info'
      );
    }
  } catch (error) {
    state.difalReader.summary = null;
    state.difalReader.itemRows = [];
    state.difalReader.chartPoints = [];
    state.tableState.difalReader = 'error';
    pushToast(`Falha ao calcular o DIFAL: ${toErrorMessage(error)}`, 'error');
  }

  render();
}

async function fetchDifalReaderDocuments(filters) {
  if (state.dataSource !== 'api') {
    return createXmlReader30FetchResult('NF-e', buildDifalReaderNfeSourceFromState(filters.cliente, filters.emissaoInicio, filters.emissaoFim));
  }

  return fetchDifalReaderNfeSource(filters);
}

function shiftDateOnlyString(value, days) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return normalized;
  }

  const timestamp = Date.parse(`${normalized}T00:00:00`);
  if (!Number.isFinite(timestamp)) {
    return normalized;
  }

  const shifted = new Date(timestamp + days * 86400000);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function fetchDifalReaderNfeSource(filters) {
  const query = buildNfeSearchQuery(
    {
      cliente: filters.cliente,
      tipo: 'Recebida',
      cnpj: '',
      numero: '',
      chave: '',
      emissaoInicio: shiftDateOnlyString(filters.emissaoInicio, -1),
      emissaoFim: shiftDateOnlyString(filters.emissaoFim, 1),
      status: 'Todos',
      eventos: 'Todos',
      schemaDoc: 'Todos',
      valorMin: '',
      valorMax: '',
      xmlCompleto: 'Todos',
      ambiente: 'producao'
    },
    1,
    SEARCH_PAGE_SIZE,
    true
  );
  const payload = normalizePaginatedResponse(await apiRequest(`/nfe?${query.toString()}`));
  const docs = buildNfeDocumentsFromApi(payload.items, state.clients);
  await enrichXmlReader30DocumentsWithContent('nfe', docs);
  state.nfeDocuments = mergeNfeDocumentsById(state.nfeDocuments, docs);
  return createXmlReader30FetchResult('NF-e', docs.map((doc) => mapXmlReader30Item('nfe', doc)), payload);
}

function buildDifalReaderNfeSourceFromState(clienteId, emissaoInicio, emissaoFim) {
  return (Array.isArray(state.nfeDocuments) ? state.nfeDocuments : [])
    .filter((doc) => doc.clientId === clienteId)
    .filter((doc) => doc.tipo === 'Recebida')
    .filter((doc) => doc.ambiente === 'producao')
    .filter((doc) => matchesDateRange(doc.dataEmissao, emissaoInicio, emissaoFim))
    .map((doc) => mapXmlReader30Item('nfe', doc));
}

function computeDifalPorDentro(baseCalculoIcms, aliquotaInterestadual, aliquotaInterna) {
  const aliquotaInternaFraction = aliquotaInterna / 100;
  if (!(aliquotaInternaFraction < 1)) {
    return 0;
  }

  const icmsInterestadual = baseCalculoIcms * (aliquotaInterestadual / 100);
  const baseSemInterestadual = baseCalculoIcms - icmsInterestadual;
  const baseRegrossada = baseSemInterestadual / (1 - aliquotaInternaFraction);
  const icmsInterno = baseRegrossada * aliquotaInternaFraction;
  const difal = icmsInterno - icmsInterestadual;
  return Number.isFinite(difal) ? difal : 0;
}

function computeDifalReaderTotals(itemRows, aliquotaInterna, totalNotas) {
  const rows = Array.isArray(itemRows) ? itemRows : [];
  let totalMonofasico = 0;
  let totalIcmsProprio = 0;
  let totalIcms4 = 0;
  let totalDifal = 0;

  const decoratedRows = rows.map((row) => {
    const isCancelada = Boolean(row?.raw?.cancelada);
    const valorIcms = toNumber(row?.valorIcmsRaw);
    const aliquotaIcms = toNumber(row?.aliquotaIcmsRaw);
    const baseCalculo = toNumber(row?.baseCalculoIcmsRaw);
    const isIcms4 = Math.abs(aliquotaIcms - 4) < 0.005;
    const difalRaw = isIcms4 ? computeDifalPorDentro(baseCalculo, aliquotaIcms, aliquotaInterna) : 0;

    if (!isCancelada) {
      totalMonofasico += toNumber(row?.vICMSMonoRetRaw);
      totalIcmsProprio += valorIcms;

      if (isIcms4) {
        totalIcms4 += valorIcms;
      }

      totalDifal += difalRaw;
    }

    return {
      ...row,
      isCancelada,
      isIcms4,
      statusLabel: isCancelada ? 'Cancelada' : 'Ativa',
      difalRaw,
      difalLabel: isIcms4 ? formatCurrency(difalRaw) : '-'
    };
  });

  return {
    rows: decoratedRows,
    summary: {
      totalNotas,
      totalItens: decoratedRows.length,
      aliquotaInterna,
      totalMonofasico,
      totalIcmsProprio,
      totalIcms4,
      totalDifal
    }
  };
}

function buildDifalReaderChartPoints(itemRows, grouping) {
  const normalizedGrouping = grouping === 'mes' ? 'mes' : 'dia';
  const buckets = new Map();

  (Array.isArray(itemRows) ? itemRows : []).forEach((row) => {
    const timestamp = Date.parse(row?.dataEmissao || row?.raw?.dataEmissao || '');
    if (!Number.isFinite(timestamp)) {
      return;
    }

    const date = new Date(timestamp);
    const key =
      normalizedGrouping === 'mes'
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    buckets.set(key, (buckets.get(key) || 0) + (Number(row?.difalRaw) || 0));
  });

  return [...buckets.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([key, value]) => ({
      key,
      label: formatDifalChartBucketLabel(key, normalizedGrouping),
      value
    }));
}

function formatDifalChartBucketLabel(key, grouping) {
  const parts = String(key || '').split('-').map(Number);
  if (grouping === 'mes') {
    const [year, month] = parts;
    const monthLabels = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${monthLabels[(month || 1) - 1] || '-'}/${String(year || '').slice(-2)}`;
  }

  const [, month, day] = parts;
  return `${String(day || 0).padStart(2, '0')}/${String(month || 0).padStart(2, '0')}`;
}

function computeNiceAxisMax(value) {
  if (!(value > 0)) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  let niceFraction;
  if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 2.5) {
    niceFraction = 2.5;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * magnitude;
}

function computeDifalChartLayout(points) {
  const width = 640;
  const height = 220;
  const padding = { left: 56, right: 12, top: 16, bottom: 30 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const sourcePoints = Array.isArray(points) ? points : [];

  if (!sourcePoints.length) {
    return { width, height, padding, plotWidth, plotHeight, points: [], gridTicks: [], baselineY: height - padding.bottom };
  }

  const rawValues = sourcePoints.map((point) => Number(point.value) || 0);
  const maxValue = Math.max(0, ...rawValues);
  const minValue = Math.min(0, ...rawValues);
  const niceMax = computeNiceAxisMax(maxValue);
  const niceMin = minValue < 0 ? -computeNiceAxisMax(Math.abs(minValue)) : 0;
  const domain = niceMax - niceMin || 1;

  const positionedPoints = sourcePoints.map((point, index) => {
    const x =
      sourcePoints.length > 1 ? padding.left + (index / (sourcePoints.length - 1)) * plotWidth : padding.left + plotWidth / 2;
    const normalized = ((Number(point.value) || 0) - niceMin) / domain;
    const y = padding.top + (1 - normalized) * plotHeight;
    return { ...point, x, y };
  });

  const tickCount = 4;
  const gridTicks = Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = niceMin + (domain * index) / tickCount;
    const y = padding.top + (1 - index / tickCount) * plotHeight;
    return { value, y };
  }).reverse();

  const baselineY = padding.top + (1 - (0 - niceMin) / domain) * plotHeight;

  return { width, height, padding, plotWidth, plotHeight, points: positionedPoints, gridTicks, baselineY };
}

function handleDifalChartHover(event) {
  const tooltip = document.querySelector('[data-difal-chart-tooltip]');
  const crosshair = document.querySelector('[data-difal-chart-crosshair]');
  const activeDot = document.querySelector('[data-difal-chart-active-dot]');
  if (!tooltip && !crosshair && !activeDot) {
    return;
  }

  const chart = event.target.closest?.('[data-difal-chart]');
  if (!chart) {
    if (tooltip) tooltip.style.display = 'none';
    if (crosshair) crosshair.style.display = 'none';
    if (activeDot) activeDot.style.display = 'none';
    return;
  }

  const points = Array.isArray(state.difalReader.chartRenderPoints) ? state.difalReader.chartRenderPoints : [];
  const viewBox = state.difalReader.chartViewBox;
  const rect = chart.getBoundingClientRect();
  if (!points.length || !viewBox || !rect.width) {
    return;
  }

  const relativeX = event.clientX - rect.left;
  const viewBoxX = (relativeX / rect.width) * viewBox.width;

  let nearest = points[0];
  let nearestDistance = Math.abs(points[0].x - viewBoxX);
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.abs(points[index].x - viewBoxX);
    if (distance < nearestDistance) {
      nearest = points[index];
      nearestDistance = distance;
    }
  }

  if (crosshair) {
    crosshair.setAttribute('x1', String(nearest.x));
    crosshair.setAttribute('x2', String(nearest.x));
    crosshair.style.display = 'block';
  }

  if (activeDot) {
    activeDot.setAttribute('cx', String(nearest.x));
    activeDot.setAttribute('cy', String(nearest.y));
    activeDot.style.display = 'block';
  }

  if (tooltip) {
    const percentX = (nearest.x / viewBox.width) * 100;
    const percentY = (nearest.y / viewBox.height) * 100;
    const flip = percentX > 65;
    tooltip.style.display = 'block';
    tooltip.style.left = `${percentX}%`;
    tooltip.style.top = `${percentY}%`;
    tooltip.style.transform = flip ? 'translate(calc(-100% - 10px), -100%)' : 'translate(10px, -100%)';
    const dateNode = tooltip.querySelector('[data-tooltip-date]');
    const valueNode = tooltip.querySelector('[data-tooltip-value]');
    if (dateNode) {
      dateNode.textContent = nearest.label || '-';
    }
    if (valueNode) {
      valueNode.textContent = formatCurrency(nearest.value);
    }
  }
}

async function submitXmlReader30Form(form) {
  await executeXmlReader30Search(form);
}

async function executeXmlReader30Search(form) {
  const data = new FormData(form);
  const cliente = String(data.get('cliente') || '').trim();
  const documento = 'nfe';
  const tipo = String(data.get('tipo') || 'Todos').trim();
  const emissaoInicio = String(data.get('emissaoInicio') || '').trim();
  const emissaoFim = String(data.get('emissaoFim') || '').trim();
  const texto = String(data.get('texto') || '').trim();

  if (!cliente) {
    resetXmlReader30Search();
    pushToast('Selecione uma empresa para ler os XMLs.', 'error');
    render();
    return;
  }

  if (emissaoInicio && emissaoFim && Date.parse(emissaoInicio) > Date.parse(emissaoFim)) {
    resetXmlReader30Search();
    pushToast('A data inicial nao pode ser maior que a data final.', 'error');
    render();
    return;
  }

  state.xmlReader30.hasSearched = true;
  state.xmlReader30.results = [];
  state.selectedXmlReaderIds = new Set();
  state.xmlReader30.lastQuery = {
    cliente,
    documento,
    tipo,
    emissaoInicio,
    emissaoFim,
    texto
  };
  state.tableState.xmlReader30 = 'loading';
  render();

  try {
    const sourceResponse = await fetchXmlReader30SourceDocuments({
      cliente,
      documento,
      tipo,
      emissaoInicio,
      emissaoFim
    });
    const filtered = dedupeXmlReader30Results(filterXmlReader30Results(sourceResponse.items, texto));
    state.xmlReader30.results = filtered;
    try {
      await loadXmlReader30DocumentChecks(filtered);
    } catch (error) {
      state.selectedXmlReaderIds = new Set();
      pushToast(`Nao foi possivel carregar as conferencias salvas: ${toErrorMessage(error)}`, 'error');
    }
    state.xmlReader30.total = countXmlReader30NfeNotes(filtered);
    state.xmlReader30.sourceTotals = sourceResponse.sourceTotals;
    state.xmlReader30.lastSearchedAt = new Date().toISOString();
    state.tableState.xmlReader30 = 'data';

    if (sourceResponse.cappedSources.length) {
      const cappedLabels = sourceResponse.cappedSources
        .map((entry) => `${entry.label}: ${entry.loaded} de ${entry.total}`)
        .join(' / ');
      pushToast(`O leitor trouxe o limite seguro do acervo completo. Refine os filtros para ver o restante (${cappedLabels}).`, 'info');
    }
  } catch (error) {
    state.xmlReader30.results = [];
    state.xmlReader30.total = 0;
    state.xmlReader30.sourceTotals = {
      nfse: 0,
      nfe: 0,
      cte: 0
    };
    state.tableState.xmlReader30 = 'error';
    pushToast(`Falha ao ler XMLs: ${toErrorMessage(error)}`, 'error');
  }

  render();
}

async function fetchXmlReader30SourceDocuments(filters) {
  if (state.dataSource !== 'api') {
    const items = buildXmlReader30SourceDocumentsFromState(filters);
    return {
      items,
      sourceTotals: countXmlReader30SourceTotals(items),
      cappedSources: []
    };
  }

  const selectedType = filters.documento && filters.documento !== 'todos' ? filters.documento : 'todos';
  const tasks = [
    selectedType !== 'todos' && selectedType !== 'nfse' ? Promise.resolve(createXmlReader30FetchResult('NFS-e', [])) : fetchXmlReader30NfseSource(filters),
    selectedType !== 'todos' && selectedType !== 'nfe' ? Promise.resolve(createXmlReader30FetchResult('NF-e', [])) : fetchXmlReader30NfeSource(filters),
    selectedType !== 'todos' && selectedType !== 'cte' ? Promise.resolve(createXmlReader30FetchResult('CT-e', [])) : fetchXmlReader30CteSource(filters)
  ];
  const [nfseResponse, nfeResponse, cteResponse] = await Promise.all(tasks);
  const items = [...nfseResponse.items, ...nfeResponse.items, ...cteResponse.items].sort(
    (left, right) => Date.parse(right.dataEmissao || 0) - Date.parse(left.dataEmissao || 0)
  );

  return {
    items,
    sourceTotals: {
      nfse: nfseResponse.items.length,
      nfe: nfeResponse.items.length,
      cte: cteResponse.items.length
    },
    cappedSources: [nfseResponse, nfeResponse, cteResponse]
      .filter((entry) => entry.capped)
      .map((entry) => ({ label: entry.label, total: entry.total, loaded: entry.loaded }))
  };
}

function buildXmlReader30SourceDocumentsFromState(filters) {
  const clientId = filters.cliente;
  const selectedType = filters.documento && filters.documento !== 'todos' ? filters.documento : 'todos';

  const nfseDocs =
    selectedType !== 'todos' && selectedType !== 'nfse'
      ? []
      : buildXmlReader30NfseSourceFromState(clientId, filters.emissaoInicio, filters.emissaoFim);
  const nfeDocs =
    selectedType !== 'todos' && selectedType !== 'nfe'
      ? []
      : buildXmlReader30NfeSourceFromState(clientId, filters.emissaoInicio, filters.emissaoFim, filters.tipo);
  const cteDocs =
    selectedType !== 'todos' && selectedType !== 'cte'
      ? []
      : buildXmlReader30CteSourceFromState(clientId, filters.emissaoInicio, filters.emissaoFim);

  return [...nfseDocs, ...nfeDocs, ...cteDocs].sort((left, right) => Date.parse(right.dataEmissao || 0) - Date.parse(left.dataEmissao || 0));
}

async function fetchXmlReader30NfseSource(filters) {
  const query = buildXmlSearchQuery(
    {
      cliente: filters.cliente,
      cnpj: '',
      numero: '',
      emissaoInicio: filters.emissaoInicio,
      emissaoFim: filters.emissaoFim,
      downloadInicio: '',
      downloadFim: '',
      municipio: 'Todos',
      tipo: 'Todos',
      status: 'Armazenado'
    },
    1,
    SEARCH_PAGE_SIZE,
    true
  );
  const payload = normalizePaginatedResponse(await apiRequest(`/nfse?${query.toString()}`));
  const xmls = buildXmlFilesFromApi(payload.items, state.clients, filters.cliente).filter(
    (xml) => xml.statusArmazenamento === 'Armazenado'
  );
  state.xmlFiles = mergeXmlFilesById(state.xmlFiles, xmls);
  return createXmlReader30FetchResult('NFS-e', xmls.map((xml) => mapXmlReader30Item('nfse', xml)), payload);
}

function buildXmlReader30NfseSourceFromState(clienteId, emissaoInicio, emissaoFim) {
  return (Array.isArray(state.xmlFiles) ? state.xmlFiles : [])
    .filter((xml) => xml.clientId === clienteId)
    .filter((xml) => xml.statusArmazenamento === 'Armazenado')
    .filter((xml) => matchesDateRange(xml.dataEmissao, emissaoInicio, emissaoFim))
    .map((xml) => mapXmlReader30Item('nfse', xml));
}

async function fetchXmlReader30NfeSource(filters) {
  const query = buildNfeSearchQuery(
    {
      cliente: filters.cliente,
      tipo: filters.tipo || 'Todos',
      cnpj: '',
      numero: '',
      chave: '',
      emissaoInicio: filters.emissaoInicio,
      emissaoFim: filters.emissaoFim,
      status: 'Todos',
      eventos: 'Todos',
      schemaDoc: 'Todos',
      valorMin: '',
      valorMax: '',
      xmlCompleto: 'Somente completos',
      ambiente: 'Todos'
    },
    1,
    SEARCH_PAGE_SIZE,
    true
  );
  const payload = normalizePaginatedResponse(await apiRequest(`/nfe?${query.toString()}`));
  const docs = buildNfeDocumentsFromApi(payload.items, state.clients).filter((doc) => doc.xmlCompletoDisponivel);
  await enrichXmlReader30DocumentsWithContent('nfe', docs);
  state.nfeDocuments = mergeNfeDocumentsById(state.nfeDocuments, docs);
  return createXmlReader30FetchResult('NF-e', docs.map((doc) => mapXmlReader30Item('nfe', doc)), payload);
}

function buildXmlReader30NfeSourceFromState(clienteId, emissaoInicio, emissaoFim, tipo = 'Todos') {
  return (Array.isArray(state.nfeDocuments) ? state.nfeDocuments : [])
    .filter((doc) => doc.clientId === clienteId)
    .filter((doc) => tipo === 'Todos' || doc.tipo === tipo)
    .filter((doc) => doc.xmlCompletoDisponivel)
    .filter((doc) => matchesDateRange(doc.dataEmissao, emissaoInicio, emissaoFim))
    .map((doc) => mapXmlReader30Item('nfe', doc));
}

async function fetchXmlReader30CteSource(filters) {
  const query = buildCteSearchQuery(
    {
      cliente: filters.cliente,
      tipo: 'Todos',
      cnpj: '',
      numero: '',
      chave: '',
      emissaoInicio: filters.emissaoInicio,
      emissaoFim: filters.emissaoFim,
      status: 'Todos',
      eventos: 'Todos',
      tipoEvento: '',
      schemaDoc: 'Todos',
      valorMin: '',
      valorMax: '',
      xmlCompleto: 'Somente completos',
      ambiente: 'Todos'
    },
    1,
    SEARCH_PAGE_SIZE,
    true
  );
  const payload = normalizePaginatedResponse(await apiRequest(`/cte?${query.toString()}`));
  const docs = buildCteDocumentsFromApi(payload.items, state.clients).filter((doc) => doc.xmlCompletoDisponivel);
  await enrichXmlReader30DocumentsWithContent('cte', docs);
  state.cteDocuments = mergeCteDocumentsById(state.cteDocuments, docs);
  return createXmlReader30FetchResult('CT-e', docs.map((doc) => mapXmlReader30Item('cte', doc)), payload);
}

function buildXmlReader30CteSourceFromState(clienteId, emissaoInicio, emissaoFim) {
  return (Array.isArray(state.cteDocuments) ? state.cteDocuments : [])
    .filter((doc) => doc.clientId === clienteId)
    .filter((doc) => doc.xmlCompletoDisponivel)
    .filter((doc) => matchesDateRange(doc.dataEmissao, emissaoInicio, emissaoFim))
    .map((doc) => mapXmlReader30Item('cte', doc));
}

function createXmlReader30FetchResult(label, items, payload = null) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const total = Number(payload?.total ?? normalizedItems.length);
  return {
    label,
    items: normalizedItems,
    total,
    loaded: normalizedItems.length,
    capped: total > normalizedItems.length
  };
}

function countXmlReader30SourceTotals(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (totals, item) => {
      if (item?.documentType === 'nfse') {
        totals.nfse += 1;
      } else if (item?.documentType === 'nfe') {
        totals.nfe += 1;
      } else if (item?.documentType === 'cte') {
        totals.cte += 1;
      }
      return totals;
    },
    {
      nfse: 0,
      nfe: 0,
      cte: 0
    }
  );
}

function formatXmlReader30SourceTotals(sourceTotals) {
  const totals = sourceTotals || { nfse: 0, nfe: 0, cte: 0 };
  return `NFS-e ${totals.nfse || 0} / NF-e ${totals.nfe || 0} / CT-e ${totals.cte || 0}`;
}

async function enrichXmlReader30DocumentsWithContent(documentType, documents) {
  const docs = Array.isArray(documents) ? documents.filter(Boolean) : [];
  if (!docs.length) {
    return;
  }

  const loader =
    documentType === 'cte'
      ? ensureCteContentLoaded
      : documentType === 'nfe'
        ? ensureNfeContentLoaded
        : null;

  if (!loader) {
    return;
  }

  const batchSize = 4;
  for (let index = 0; index < docs.length; index += batchSize) {
    const batch = docs.slice(index, index + batchSize);
    const results = await Promise.allSettled(batch.map((doc) => loader(doc)));
    results.forEach((result, resultIndex) => {
      if (result.status === 'rejected') {
        const failedDoc = batch[resultIndex];
        console.warn(`Falha ao enriquecer ${documentType.toUpperCase()} ${failedDoc?.id || failedDoc?.chaveAcesso || '-'} no leitor XML 3.0.`, result.reason);
      }
    });
  }
}

function summarizeXmlReader30Products(documentType, doc) {
  if (documentType === 'nfse') {
    const description = truncateText(String(doc?.descricaoServico || doc?.codigoServicoPrestado || '').trim(), 88);
    return {
      label: description || 'Servico sem descricao',
      secondary: String(doc?.codigoServicoPrestado || doc?.tipo || '').trim() || 'Servico',
      hint: 'Servico destacado no XML'
    };
  }

  if (documentType === 'nfe') {
    const items = extractNfeLineItems(doc?.conteudoXml || '');
    if (items.length) {
      const label = truncateText(items.slice(0, 2).map((item) => item.description).filter(Boolean).join(' / '), 88);
      return {
        label: label || 'Itens lidos do XML',
        secondary: `${items.length} item(ns) encontrado(s)`,
        hint: 'Produtos da NF-e'
      };
    }

    return {
      label: 'Produtos nao lidos',
      secondary: 'Abra o XML para detalhar os itens',
      hint: 'Itens da NF-e'
    };
  }

  const summary = extractCteServiceSummary(doc?.conteudoXml || '');
  if (summary.productLabel || summary.components.length) {
    const label = truncateText(summary.productLabel || summary.components.slice(0, 2).map((item) => item.name).join(' / '), 88);
    return {
      label: label || 'Prestacao identificada',
      secondary: summary.components.length ? `${summary.components.length} componente(s)` : 'Prestacao do CT-e',
      hint: 'Resumo da carga ou prestacao'
    };
  }

  return {
    label: 'Prestacao nao detalhada',
    secondary: 'Abra o XML para ver os componentes',
    hint: 'Resumo do CT-e'
  };
}

function mapXmlReader30Item(documentType, doc) {
  if (documentType === 'nfse') {
    const xml = doc;
    const productSummary = summarizeXmlReader30Products(documentType, xml);
    return {
      documentType,
      documentLabel: 'NFS-e',
      documentTone: 'success',
      rowId: xml.id,
      apiId: xml.apiNfseId || null,
      clientId: xml.clientId || '',
      cliente: xml.cliente || 'Cliente nao identificado',
      cnpjLabel: formatCnpj(xml.cnpj || ''),
      numeroLabel: xml.numeroNfse || '-',
      chaveLabel: xml.chaveAcesso ? `Chave ${xml.chaveAcesso}` : 'Chave nao informada',
      dataEmissao: xml.dataEmissao || xml.dataDownload || null,
      statusLabel: xml.statusFiscal || '-',
      statusTone: xml.cancelada ? 'danger' : xml.statusFiscal === 'Autorizada' ? 'success' : 'info',
      storageLabel: xml.statusArmazenamento || 'Desconhecido',
      storageTone: xml.statusArmazenamento === 'Armazenado' ? 'success' : 'danger',
      valorLabel: formatOptionalCurrency(xml.valor),
      productLabel: productSummary.label,
      productSecondaryLabel: productSummary.secondary,
      productHint: productSummary.hint,
      searchText: buildXmlReader30SearchText([
        xml.cliente,
        xml.cnpj,
        xml.numeroNfse,
        xml.chaveAcesso,
        xml.statusFiscal,
        xml.statusArmazenamento,
        xml.tipo,
        xml.municipio,
        xml.prestador,
        xml.tomador,
        xml.eventosResumo,
        productSummary.label,
        productSummary.secondary
      ]),
      raw: xml
    };
  }

  if (documentType === 'nfe') {
    const nfe = doc;
    const nfeItems = extractNfeLineItems(nfe.conteudoXml || '');
    const productSummary = summarizeXmlReader30Products(documentType, nfe);
    return {
      documentType,
      documentLabel: 'NF-e',
      documentTone: 'info',
      rowId: nfe.id,
      apiId: nfe.apiNfeId || null,
      clientId: nfe.clientId || '',
      cliente: nfe.cliente || 'Cliente nao identificado',
      cnpjLabel: formatCnpj(nfe.emitenteCnpj || nfe.destinatarioCnpj || ''),
      numeroLabel: nfe.numeroNfe || '-',
      chaveLabel: nfe.chaveAcesso ? `Chave ${nfe.chaveAcesso}` : 'Chave nao informada',
      dataEmissao: nfe.dataEmissao || nfe.dataAutorizacao || null,
      statusLabel: nfe.statusFiscal || '-',
      statusTone: nfe.cancelada ? 'danger' : nfe.statusFiscal === 'Autorizada' ? 'success' : 'info',
      storageLabel: nfe.xmlCompletoDisponivel ? 'XML completo' : 'Resumo XML',
      storageTone: nfe.xmlCompletoDisponivel ? 'success' : 'warning',
      valorLabel: formatOptionalCurrency(nfe.valor),
      productLabel: productSummary.label,
      productSecondaryLabel: productSummary.secondary,
      productHint: productSummary.hint,
      searchText: buildXmlReader30SearchText([
        nfe.cliente,
        nfe.emitenteNome,
        nfe.destinatarioNome,
        nfe.contraparteNome,
        nfe.emitenteCnpj,
        nfe.destinatarioCnpj,
        nfe.numeroNfe,
        nfe.chaveAcesso,
        nfe.statusFiscal,
        nfe.schemaDoc,
        nfe.eventosResumo,
        nfe.cancelada ? 'cancelada' : 'ativa',
        nfe.tipo,
        productSummary.label,
        productSummary.secondary,
        ...nfeItems.map((item) => item.description),
        ...nfeItems.map((item) => item.code),
        ...nfeItems.map((item) => item.quantity),
        ...nfeItems.map((item) => item.unitValueRaw || item.unitValue || ''),
        ...nfeItems.map((item) => item.totalValueRaw || item.totalValue || ''),
        ...nfeItems.map((item) => item.cstCsosn || ''),
        ...nfeItems.map((item) => item.cfop || ''),
        ...nfeItems.map((item) => item.baseCalculoIcmsRaw || item.baseCalculoIcms || ''),
        ...nfeItems.map((item) => item.aliquotaIcmsRaw || item.aliquotaIcms || ''),
        ...nfeItems.map((item) => item.valorIcmsRaw || item.valorIcms || ''),
        ...nfeItems.map((item) => item.icmsStRetRaw || item.icmsStRet || ''),
        ...nfeItems.map((item) => item.qBCMonoRetRaw || item.qBCMonoRet || ''),
        ...nfeItems.map((item) => item.adRemICMSRetRaw || item.adRemICMSRet || ''),
        ...nfeItems.map((item) => item.vICMSMonoRetRaw || item.vICMSMonoRet || ''),
        ...nfeItems.map((item) => computeXmlReader30MonofasicValues(nfe.dataEmissao || nfe.dataAutorizacao || '', item.cstCsosn || '0', item.qBCMonoRetRaw || item.qBCMonoRet || '0').aliqVigenteRaw),
        ...nfeItems.map((item) => computeXmlReader30MonofasicValues(nfe.dataEmissao || nfe.dataAutorizacao || '', item.cstCsosn || '0', item.qBCMonoRetRaw || item.qBCMonoRet || '0').valorCorretoRaw)
      ]),
      raw: nfe
    };
  }

  const cte = doc;
  const productSummary = summarizeXmlReader30Products(documentType, cte);
  return {
    documentType,
    documentLabel: 'CT-e',
    documentTone: 'warning',
    rowId: cte.id,
    apiId: cte.apiCteId || null,
    clientId: cte.clientId || '',
    cliente: cte.cliente || 'Cliente nao identificado',
    cnpjLabel: formatCnpj(cte.emitenteCnpj || cte.destinatarioCnpj || ''),
    numeroLabel: cte.numeroCte || '-',
    chaveLabel: cte.chaveAcesso ? `Chave ${cte.chaveAcesso}` : 'Chave nao informada',
    dataEmissao: cte.dataEmissao || cte.dataAutorizacao || null,
    statusLabel: cte.statusFiscal || '-',
    statusTone: cte.cancelada ? 'danger' : cte.statusFiscal === 'Autorizada' ? 'success' : 'info',
    storageLabel: cte.xmlCompletoDisponivel ? 'XML completo' : 'Resumo XML',
    storageTone: cte.xmlCompletoDisponivel ? 'success' : 'warning',
    valorLabel: formatOptionalCurrency(cte.valor),
    productLabel: productSummary.label,
    productSecondaryLabel: productSummary.secondary,
    productHint: productSummary.hint,
    searchText: buildXmlReader30SearchText([
      cte.cliente,
      cte.emitenteNome,
      cte.destinatarioNome,
      cte.contraparteNome,
      cte.emitenteCnpj,
      cte.destinatarioCnpj,
      cte.numeroCte,
      cte.chaveAcesso,
      cte.statusFiscal,
      cte.schemaDoc,
      cte.eventosResumo,
      cte.tipo,
      productSummary.label,
      productSummary.secondary
    ]),
    raw: cte
  };
}

function filterXmlReader30Results(results, texto) {
  const normalizedText = normalizeSearchText(texto);
  return (Array.isArray(results) ? results : [])
    .filter((row) => {
      if (!normalizedText) {
        return true;
      }

      return normalizeSearchText(row.searchText || '').includes(normalizedText);
    })
    .sort((left, right) => Date.parse(right.dataEmissao || 0) - Date.parse(left.dataEmissao || 0));
}

function getXmlReader30DuplicateIdentityKey(row) {
  const raw = row?.raw || {};
  const documentType = row?.documentType || '';
  const chaveAcesso = normalizeDigits(String(raw.chaveAcesso || row?.chaveLabel || ''));
  if (chaveAcesso.length === 44) {
    return `${documentType}:chave:${chaveAcesso}`;
  }

  const numero = String(raw.numeroNfe || raw.numeroCte || raw.numeroNfse || row?.numeroLabel || '').trim();
  const serie = String(raw.serie || '').trim();
  const dataEmissao = String(row?.dataEmissao || raw.dataEmissao || '').trim();
  const clientId = String(row?.clientId || raw.clientId || '').trim();
  const emitenteCnpj = normalizeDigits(String(raw.emitenteCnpj || ''));
  const destinatarioCnpj = normalizeDigits(String(raw.destinatarioCnpj || ''));

  return [documentType, 'snapshot', clientId, numero, serie, dataEmissao, emitenteCnpj, destinatarioCnpj].join(':');
}

function isXmlReader30PreferredDuplicate(candidate, current) {
  const candidateScore = candidate?.raw?.xmlCompletoDisponivel ? 1 : 0;
  const currentScore = current?.raw?.xmlCompletoDisponivel ? 1 : 0;
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore;
  }

  return Date.parse(candidate?.raw?.updatedAt || 0) > Date.parse(current?.raw?.updatedAt || 0);
}

function dedupeXmlReader30Results(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const byKey = new Map();

  sourceRows.forEach((row) => {
    const key = getXmlReader30DuplicateIdentityKey(row);
    if (!key) {
      return;
    }

    const current = byKey.get(key);
    if (!current || isXmlReader30PreferredDuplicate(row, current)) {
      byKey.set(key, row);
    }
  });

  return Array.from(byKey.values());
}

function buildXmlReader30SearchText(values) {
  return (Array.isArray(values) ? values : [])
    .filter(Boolean)
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function matchesDateRange(value, start, end) {
  const timestamp = Date.parse(value || '');
  if (Number.isNaN(timestamp)) {
    return true;
  }

  if (start && timestamp < Date.parse(`${start}T00:00:00`)) {
    return false;
  }

  if (end && timestamp > Date.parse(`${end}T23:59:59`)) {
    return false;
  }

  return true;
}

function getXmlReader30PersistedDocumentId(row) {
  if (!row) {
    return '';
  }

  const directApiId = String(row.apiId || '').trim();
  if (directApiId) {
    return directApiId;
  }

  const raw = row.raw || {};
  const fallbackApiId =
    row.documentType === 'nfse'
      ? raw.apiNfseId || raw.id
      : row.documentType === 'nfe'
        ? raw.apiNfeId || raw.id
        : row.documentType === 'cte'
          ? raw.apiCteId || raw.id
          : raw.id;

  return String(fallbackApiId || row.rowId || '').trim();
}

function getXmlReader30DocumentCheckKey(row) {
  if (!row?.documentType) {
    return '';
  }

  const explicitSelectionKey = String(row.selectionKey || '').trim();
  if (explicitSelectionKey) {
    return explicitSelectionKey;
  }

  const persistedDocumentId = getXmlReader30PersistedDocumentId(row);
  if (!persistedDocumentId) {
    return '';
  }

  return `${row.documentType}:${persistedDocumentId}`;
}

function getXmlReader30DocumentCheckTypeFromKey(selectionKey) {
  const normalizedKey = String(selectionKey || '').trim();
  const separatorIndex = normalizedKey.indexOf(':');
  if (separatorIndex <= 0) {
    return '';
  }

  return normalizedKey.slice(0, separatorIndex);
}

function getXmlReader30DocumentIdFromKey(selectionKey) {
  const normalizedKey = String(selectionKey || '').trim();
  const separatorIndex = normalizedKey.indexOf(':');
  if (separatorIndex <= 0) {
    return '';
  }

  return normalizedKey.slice(separatorIndex + 1);
}

function getXmlReader30UniqueDocumentCheckKeys(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((row) => getXmlReader30DocumentCheckKey(row)).filter(Boolean))];
}

function getXmlReader30SelectionGroupKey(selectionKey) {
  const normalizedKey = String(selectionKey || '').trim();
  if (!normalizedKey) {
    return '';
  }

  const itemSuffixIndex = normalizedKey.indexOf(':item:');
  if (itemSuffixIndex > 0) {
    return normalizedKey.slice(0, itemSuffixIndex);
  }

  const fallbackSuffix = ':fallback';
  if (normalizedKey.endsWith(fallbackSuffix)) {
    return normalizedKey.slice(0, -fallbackSuffix.length);
  }

  return normalizedKey;
}

function isXmlReader30LocalSelectionKey(selectionKey) {
  const normalizedKey = String(selectionKey || '').trim();
  if (!normalizedKey) {
    return false;
  }

  return normalizedKey.includes(':item:') || normalizedKey.endsWith(':fallback');
}

function findXmlReader30RowByDocumentCheckKey(checkKey) {
  const normalizedKey = String(checkKey || '').trim();
  if (!normalizedKey) {
    return null;
  }

  const sourceRows = Array.isArray(state.xmlReader30.results) ? state.xmlReader30.results : [];
  for (const row of sourceRows) {
    if (getXmlReader30DocumentCheckKey(row) === normalizedKey) {
      return row;
    }
  }

  for (const row of expandXmlReader30NfeRows(sourceRows)) {
    if (getXmlReader30DocumentCheckKey(row) === normalizedKey) {
      return row;
    }
  }

  return null;
}

function setXmlReader30Selection(selectionKey, checked) {
  const normalizedKey = String(selectionKey || '').trim();
  if (!normalizedKey) {
    return;
  }

  if (checked) {
    state.selectedXmlReaderIds.add(normalizedKey);
    return;
  }

  state.selectedXmlReaderIds.delete(normalizedKey);
}

function renderXmlReader30SelectionControl(options = {}) {
  const selectionKey = String(options.selectionKey || '').trim();
  const label = String(options.label || 'Selecionar item');
  const checked = Boolean(options.checked);
  const disabled = Boolean(options.disabled) || !selectionKey;

  return `
    <label class="xml-reader30-selection-control${disabled ? ' is-disabled' : ''}">
      <input
        type="checkbox"
        data-action="xml-reader30-select"
        data-selection-key="${escapeHtml(selectionKey)}"
        ${checked ? 'checked' : ''}
        ${disabled ? 'disabled' : ''}
        aria-label="${escapeHtml(label)}"
      />
      <span class="xml-reader30-selection-control-box" aria-hidden="true"></span>
    </label>
  `;
}

function syncXmlReader30SelectionCheckboxes() {
  document.querySelectorAll('[data-action="xml-reader30-select"]').forEach((node) => {
    if (!(node instanceof HTMLInputElement)) {
      return;
    }

    const nodeSelectionKey = String(node.getAttribute('data-selection-key') || '').trim();
    if (!nodeSelectionKey) {
      return;
    }
    node.checked = state.selectedXmlReaderIds.has(nodeSelectionKey);
  });
}

async function loadXmlReader30DocumentChecks(rows) {
  const sourceRows = expandXmlReader30NfeRows(Array.isArray(rows) ? rows : []);
  const previousSelection = new Set(state.selectedXmlReaderIds);
  const groupedIds = {
    nfse: [],
    nfe: [],
    cte: []
  };

  sourceRows.forEach((row) => {
    const checkKey = getXmlReader30DocumentCheckKey(row);
    const documentType = getXmlReader30DocumentCheckTypeFromKey(checkKey);
    const documentId = getXmlReader30DocumentIdFromKey(checkKey);
    if (!documentId || !documentType || !Array.isArray(groupedIds[documentType])) {
      return;
    }

    groupedIds[documentType].push(documentId);
  });

  const types = Object.entries(groupedIds).filter(([, ids]) => ids.length);
  if (!types.length) {
    state.selectedXmlReaderIds = new Set();
    return;
  }

  const requests = [];
  types.forEach(([tipo, ids]) => {
    const uniqueIds = [...new Set(ids)];
    for (let index = 0; index < uniqueIds.length; index += 500) {
      requests.push(
        apiRequest('/conferencias-documentos/consulta', {
          method: 'POST',
          body: {
            tipo,
            documentoIds: uniqueIds.slice(index, index + 500)
          }
        })
      );
    }
  });

  const responses = await Promise.all(requests);

  const nextSelection = new Set();
  responses.forEach((items) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      if (!item?.conferido || !item?.tipo || !item?.documentoId) {
        return;
      }
      const selectionKey = `${item.tipo}:${item.documentoId}`;
      nextSelection.add(selectionKey);
    });
  });

  state.selectedXmlReaderIds = new Set([...previousSelection, ...nextSelection]);
}

async function toggleXmlReader30DocumentCheck(selectionKey, checked) {
  const normalizedKey = String(selectionKey || '').trim();
  const row = findXmlReader30RowByDocumentCheckKey(normalizedKey);
  const tipo = getXmlReader30DocumentCheckTypeFromKey(normalizedKey);
  const documentoId = getXmlReader30DocumentIdFromKey(normalizedKey);
  if (!row || !tipo || !documentoId) {
    pushToast('Nao foi possivel identificar o documento conferido.', 'error');
    syncXmlReader30SelectionCheckboxes();
    return;
  }

  const previousState = new Set(state.selectedXmlReaderIds);
  setXmlReader30Selection(normalizedKey, checked);
  syncXmlReader30SelectionCheckboxes();
  renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);

  if (isXmlReader30LocalSelectionKey(normalizedKey)) {
    return;
  }

  try {
    await apiRequest('/conferencias-documentos', {
      method: 'PUT',
      body: {
        tipo,
        documentoId,
        clienteId: row.clientId || row.raw?.clientId || undefined,
        conferido: checked
      }
    });
  } catch (error) {
    state.selectedXmlReaderIds = previousState;
    syncXmlReader30SelectionCheckboxes();
    renderPreservingScroll(XML_READER30_SCROLL_SELECTORS);
    pushToast(`Falha ao salvar conferencia do documento: ${toErrorMessage(error)}`, 'error');
  }
}

function getXmlReader30SelectionRows() {
  return expandXmlReader30NfeRows(Array.isArray(state.xmlReader30.results) ? state.xmlReader30.results : []);
}

function canDownloadXmlReader30Row(row) {
  if (!row?.raw) {
    return false;
  }

  if (row.documentType === 'nfse') {
    return Boolean(row.raw.apiNfseId && row.raw.clientId);
  }

  if (row.documentType === 'nfe') {
    return Boolean(row.raw.apiNfeId && row.raw.clientId && row.raw.xmlCompletoDisponivel);
  }

  if (row.documentType === 'cte') {
    return Boolean(row.raw.apiCteId && row.raw.clientId && row.raw.xmlCompletoDisponivel);
  }

  return false;
}

function getSelectedXmlReader30Rows() {
  return getXmlReader30SelectionRows().filter((row) => {
    const selectionKey = getXmlReader30DocumentCheckKey(row);
    return selectionKey && state.selectedXmlReaderIds.has(selectionKey) && canDownloadXmlReader30Row(row);
  });
}

async function downloadSelectedXmlReader30Batch() {
  const selectedRows = getSelectedXmlReader30Rows();
  if (!selectedRows.length) {
    pushToast('Selecione ao menos um XML no leitor.', 'error');
    return;
  }

  const nfseRows = selectedRows.filter((row) => row.documentType === 'nfse');
  const nfeRows = selectedRows.filter((row) => row.documentType === 'nfe');
  const cteRows = selectedRows.filter((row) => row.documentType === 'cte');
  const summary = [];

  try {
    if (nfseRows.length) {
      const ids = [...new Set(nfseRows.map((row) => row.raw.apiNfseId).filter(Boolean))];
      const clientIds = [...new Set(nfseRows.map((row) => row.raw.clientId).filter(Boolean))];
      const body = { ids, tipoArquivo: 'xml' };
      if (clientIds.length === 1) {
        body.clienteId = clientIds[0];
      }

      const payload = await apiRequest('/nfse/download-lote', {
        method: 'POST',
        body,
        timeoutMs: 2 * 60 * 1000
      });
      downloadFromPayload(payload, 'leitor-xml-nfse.zip');
      summary.push(`NFS-e ${Number(payload?.totalArquivosIncluidos || ids.length)}`);
    }

    if (nfeRows.length) {
      const ids = [...new Set(nfeRows.map((row) => row.raw.apiNfeId).filter(Boolean))];
      const clientIds = [...new Set(nfeRows.map((row) => row.raw.clientId).filter(Boolean))];
      const body = { ids, tipoArquivo: 'xml' };
      if (clientIds.length === 1) {
        body.clienteId = clientIds[0];
      }

      const payload = await apiRequest('/nfe/download-lote', {
        method: 'POST',
        body,
        timeoutMs: 2 * 60 * 1000
      });
      downloadFromPayload(payload, 'leitor-xml-nfe.zip');
      summary.push(`NF-e ${Number(payload?.totalArquivosIncluidos || ids.length)}`);
    }

    if (cteRows.length) {
      for (const row of cteRows) {
        const doc = row.raw;
        await ensureCteContentLoaded(doc);
        const blob = new Blob([doc.conteudoXml], { type: 'application/xml' });
        triggerBrowserDownload(`cte-${doc.chaveAcesso || doc.numeroCte || 'xml'}.xml`, blob);
        await wait(120);
      }
      summary.push(`CT-e ${cteRows.length}`);
    }

    pushToast(`Downloads iniciados no leitor: ${summary.join(' / ')}.`, 'success');
  } catch (error) {
    pushToast(`Falha ao baixar selecao do leitor: ${toErrorMessage(error)}`, 'error');
  }
}

function renderXmlReader30ResultsTableLegacyUnused(results) {
  const selectableRows = results.filter((row) => canDownloadXmlReader30Row(row));
  const selectableDocumentCount = getXmlReader30UniqueDocumentCheckKeys(selectableRows).length;
  const selectedVisibleCount = getXmlReader30UniqueDocumentCheckKeys(selectableRows).filter((key) => state.selectedXmlReaderIds.has(key)).length;
  const batchDisabled = selectableDocumentCount === 0 || selectedVisibleCount === 0 ? 'disabled' : '';

  return `
    <article class="card" style="margin-top: 2px;">
      <div class="xml-batch-bar">
        <div>
          <h3 class="card-title">XMLs encontrados</h3>
          <p class="card-subtitle">Mostrando ${escapeHtml(String(results.length))} XML(s) do acervo interno.</p>
        </div>
        <div class="table-actions">
          <span class="row-sub">${escapeHtml(String(selectedVisibleCount))} conferido(s)</span>
          <button class="btn primary" type="button" data-action="xml-reader30-batch-download" ${batchDisabled}>Baixar XMLs selecionados</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Selecao</th>
              <th>Tipo</th>
              <th>Documento</th>
              <th>Status</th>
              <th>Cancelada?</th>
              <th>Empresa</th>
              <th>Participante</th>
              <th>Emissao</th>
              <th>Resumo</th>
              <th>Valor</th>
              <th>Arquivo</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'xmlReader30',
              colSpan: 12,
              rowsHtml: results.length
                ? results
                    .map((row) => {
                      const actions = renderXmlReader30Actions(row);
                      const selectionKey = getXmlReader30DocumentCheckKey(row);
                      const canDownload = canDownloadXmlReader30Row(row);
                      return `
                        <tr>
                          <td class="xml-reader30-check">
                            ${renderXmlReader30SelectionControl({
                              selectionKey,
                              checked: state.selectedXmlReaderIds.has(selectionKey),
                              disabled: !canDownload,
                              label: `Selecionar ${row.documentLabel} ${row.numeroLabel}`
                            })}
                          </td>
                          <td>${statusBadge(row.documentLabel, row.documentTone)}</td>
                          <td>
                            <span class="row-title">${escapeHtml(row.numeroLabel)}</span>
                          </td>
                          <td>${statusBadge(row.statusLabel, row.statusTone)}</td>
                          <td>${statusBadge(row.cancelLabel, row.cancelTone)}</td>
                          <td>
                            <span class="row-title">${escapeHtml(row.cliente)}</span>
                            <span class="row-sub">${escapeHtml(row.cnpjLabel)}</span>
                          </td>
                          <td>
                            <span class="row-title">${escapeHtml(row.partyLabel)}</span>
                            <span class="row-sub">${escapeHtml(row.partySecondaryLabel)}</span>
                          </td>
                          <td>${escapeHtml(formatDateTime(row.dataEmissao))}</td>
                          <td><span class="row-sub">${escapeHtml(row.previewLabel)}</span></td>
                          <td>${escapeHtml(row.valorLabel)}</td>
                          <td>${statusBadge(row.storageLabel, row.storageTone)}</td>
                          <td>
                            <div class="table-actions">${actions}</div>
                          </td>
                        </tr>
                      `;
                    })
                    .join('')
                : '',
              emptyMessage: 'Nenhum XML encontrado para os filtros informados.'
            })}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function resetXmlReader30SearchLegacyUnused() {
  state.selectedXmlReaderIds = new Set();
  const hiddenNfeColumns = state.xmlReader30.hiddenNfeColumns instanceof Set
    ? new Set(state.xmlReader30.hiddenNfeColumns)
    : new Set();
  const nfeColumnOrder = Array.isArray(state.xmlReader30.nfeColumnOrder)
    ? [...state.xmlReader30.nfeColumnOrder]
    : [...XML_READER30_NFE_DEFAULT_COLUMN_ORDER];
  const nfeColumnWidths = normalizeXmlReader30NfeColumnWidthsStore(state.xmlReader30.nfeColumnWidths);
  state.xmlReader30 = {
    hasSearched: false,
    results: [],
    lastQuery: null,
    lastSearchedAt: null,
    total: 0,
    sourceTotals: {
      nfse: 0,
      nfe: 0,
      cte: 0
    },
    nfeColumnOrder,
    nfeColumnWidths,
    hiddenNfeColumns,
    selectionDrag: null,
    scrollDrag: null,
    columnMenuOpenKey: null,
    columnMenuAnchor: null,
    columnDrag: null,
    columnResize: null
  };
  state.tableState.xmlReader30 = 'data';
}

async function executeXmlReader30SearchLegacyUnused(form) {
  const data = new FormData(form);
  const cliente = String(data.get('cliente') || '').trim();
  const documento = String(data.get('documento') || 'todos').trim();
  const tipo = String(data.get('tipo') || 'Todos').trim();
  const emissaoInicio = String(data.get('emissaoInicio') || '').trim();
  const emissaoFim = String(data.get('emissaoFim') || '').trim();
  const texto = String(data.get('texto') || '').trim();

  if (!cliente) {
    resetXmlReader30Search();
    pushToast('Selecione uma empresa para ler os XMLs.', 'error');
    render();
    return;
  }

  if (emissaoInicio && emissaoFim && Date.parse(emissaoInicio) > Date.parse(emissaoFim)) {
    resetXmlReader30Search();
    pushToast('A data inicial nao pode ser maior que a data final.', 'error');
    render();
    return;
  }

  state.xmlReader30.hasSearched = true;
  state.selectedXmlReaderIds = new Set();
  state.xmlReader30.results = [];
  state.xmlReader30.lastQuery = {
    cliente,
    documento,
    tipo,
    emissaoInicio,
    emissaoFim,
    texto
  };
  state.tableState.xmlReader30 = 'loading';
  render();

  try {
    const sourceResponse = await fetchXmlReader30SourceDocuments({
      cliente,
      documento,
      tipo,
      emissaoInicio,
      emissaoFim
    });
    const filtered = filterXmlReader30Results(sourceResponse.items, texto);
    state.xmlReader30.results = filtered;
    try {
      await loadXmlReader30DocumentChecks(filtered);
    } catch (error) {
      state.selectedXmlReaderIds = new Set();
      pushToast(`Nao foi possivel carregar as conferencias salvas: ${toErrorMessage(error)}`, 'error');
    }
    state.xmlReader30.total = filtered.length;
    state.xmlReader30.sourceTotals = sourceResponse.sourceTotals;
    state.xmlReader30.lastSearchedAt = new Date().toISOString();
    state.tableState.xmlReader30 = 'data';

    if (sourceResponse.cappedSources.length) {
      const cappedLabels = sourceResponse.cappedSources.map((entry) => `${entry.label}: ${entry.loaded} de ${entry.total}`).join(' / ');
      pushToast(`O leitor trouxe o limite seguro do acervo completo. Refine os filtros para ver o restante (${cappedLabels}).`, 'info');
    }
  } catch (error) {
    state.xmlReader30.results = [];
    state.xmlReader30.total = 0;
    state.xmlReader30.sourceTotals = {
      nfse: 0,
      nfe: 0,
      cte: 0
    };
    state.tableState.xmlReader30 = 'error';
    pushToast(`Falha ao ler XMLs: ${toErrorMessage(error)}`, 'error');
  }

  render();
}

function mapXmlReader30ItemLegacyUnused(documentType, doc) {
  if (documentType === 'nfse') {
    const xml = doc;
    return {
      documentType,
      documentLabel: 'NFS-e',
      documentTone: 'success',
      rowId: xml.id,
      apiId: xml.apiNfseId || null,
      clientId: xml.clientId || '',
      cliente: xml.cliente || 'Cliente nao identificado',
      cnpjLabel: formatCnpj(xml.cnpj || ''),
      numeroLabel: xml.numeroNfse || '-',
      chaveLabel: xml.chaveAcesso ? `Chave ${xml.chaveAcesso}` : 'Chave nao informada',
      dataEmissao: xml.dataEmissao || xml.dataDownload || null,
      statusLabel: xml.statusFiscal || '-',
      statusTone: xml.cancelada ? 'danger' : xml.statusFiscal === 'Autorizada' ? 'success' : 'info',
      cancelLabel: xml.cancelada ? 'Sim' : 'Nao',
      cancelTone: xml.cancelada ? 'danger' : 'success',
      storageLabel: xml.statusArmazenamento || 'Desconhecido',
      storageTone: xml.statusArmazenamento === 'Armazenado' ? 'success' : 'danger',
      valorLabel: formatOptionalCurrency(xml.valor),
      partyLabel: xml.contraparteNome || xml.tomador || xml.prestador || '-',
      partySecondaryLabel: xml.tipo || '-',
      previewLabel: truncateText(xml.descricaoServico || xml.codigoServicoPrestado || xml.eventosResumo || '-', 90),
      searchText: buildXmlReader30SearchText([
        xml.cliente,
        xml.cnpj,
        xml.numeroNfse,
        xml.chaveAcesso,
        xml.statusFiscal,
        xml.statusArmazenamento,
        xml.tipo,
        xml.municipio,
        xml.prestador,
        xml.tomador,
        xml.eventosResumo,
        xml.descricaoServico
      ]),
      raw: xml
    };
  }

  if (documentType === 'nfe') {
    const nfe = doc;
    return {
      documentType,
      documentLabel: 'NF-e',
      documentTone: 'info',
      rowId: nfe.id,
      apiId: nfe.apiNfeId || null,
      clientId: nfe.clientId || '',
      cliente: nfe.cliente || 'Cliente nao identificado',
      cnpjLabel: formatCnpj(nfe.emitenteCnpj || nfe.destinatarioCnpj || ''),
      numeroLabel: nfe.numeroNfe || '-',
      chaveLabel: nfe.chaveAcesso ? `Chave ${nfe.chaveAcesso}` : 'Chave nao informada',
      dataEmissao: nfe.dataEmissao || nfe.dataAutorizacao || null,
      statusLabel: nfe.statusFiscal || '-',
      statusTone: nfe.cancelada ? 'danger' : nfe.statusFiscal === 'Autorizada' ? 'success' : 'info',
      cancelLabel: nfe.cancelada ? 'Sim' : 'Nao',
      cancelTone: nfe.cancelada ? 'danger' : 'success',
      storageLabel: nfe.xmlCompletoDisponivel ? 'XML completo' : 'Resumo XML',
      storageTone: nfe.xmlCompletoDisponivel ? 'success' : 'warning',
      valorLabel: formatOptionalCurrency(nfe.valor),
      partyLabel: nfe.contraparteNome || '-',
      partySecondaryLabel: formatCnpj(nfe.contraparteCnpj || nfe.emitenteCnpj || nfe.destinatarioCnpj || ''),
      previewLabel: truncateText(`${nfe.tipo || '-'} / ${nfe.schemaDoc || '-'}${nfe.eventosResumo ? ` / ${nfe.eventosResumo}` : ''}`, 90),
      searchText: buildXmlReader30SearchText([
        nfe.cliente,
        nfe.emitenteNome,
        nfe.destinatarioNome,
        nfe.contraparteNome,
        nfe.emitenteCnpj,
        nfe.destinatarioCnpj,
        nfe.numeroNfe,
        nfe.chaveAcesso,
        nfe.statusFiscal,
        nfe.schemaDoc,
        nfe.eventosResumo,
        nfe.tipo
      ]),
      raw: nfe
    };
  }

  const cte = doc;
  return {
    documentType,
    documentLabel: 'CT-e',
    documentTone: 'warning',
    rowId: cte.id,
    apiId: cte.apiCteId || null,
    clientId: cte.clientId || '',
    cliente: cte.cliente || 'Cliente nao identificado',
    cnpjLabel: formatCnpj(cte.emitenteCnpj || cte.destinatarioCnpj || ''),
    numeroLabel: cte.numeroCte || '-',
    chaveLabel: cte.chaveAcesso ? `Chave ${cte.chaveAcesso}` : 'Chave nao informada',
    dataEmissao: cte.dataEmissao || cte.dataAutorizacao || null,
    statusLabel: cte.statusFiscal || '-',
    statusTone: cte.cancelada ? 'danger' : cte.statusFiscal === 'Autorizada' ? 'success' : 'info',
    cancelLabel: cte.cancelada ? 'Sim' : 'Nao',
    cancelTone: cte.cancelada ? 'danger' : 'success',
    storageLabel: cte.xmlCompletoDisponivel ? 'XML completo' : 'Resumo XML',
    storageTone: cte.xmlCompletoDisponivel ? 'success' : 'warning',
    valorLabel: formatOptionalCurrency(cte.valor),
    partyLabel: cte.contraparteNome || '-',
    partySecondaryLabel: formatCnpj(cte.contraparteCnpj || cte.emitenteCnpj || cte.destinatarioCnpj || ''),
    previewLabel: truncateText(`${cte.tipo || '-'} / ${cte.schemaDoc || '-'}${cte.eventosResumo ? ` / ${cte.eventosResumo}` : ''}`, 90),
    searchText: buildXmlReader30SearchText([
      cte.cliente,
      cte.emitenteNome,
      cte.destinatarioNome,
      cte.contraparteNome,
      cte.emitenteCnpj,
      cte.destinatarioCnpj,
      cte.numeroCte,
      cte.chaveAcesso,
      cte.statusFiscal,
      cte.schemaDoc,
      cte.eventosResumo,
      cte.tipo
    ]),
    raw: cte
  };
}

function renderAliquotaPeriodoRow(periodo, index, total) {
  return `
    <div class="aliquota-periodo-row">
      <label class="field">
        Aliquota (fator)
        <input name="aliquota" type="number" step="0.0001" min="0" value="${escapeHtml(periodo?.aliquota === '' || periodo?.aliquota == null ? '' : String(periodo.aliquota))}" required />
      </label>
      <label class="field">
        Data inicio
        <input name="dataInicio" type="date" value="${escapeHtml(periodo?.dataInicio || '')}" required />
      </label>
      <label class="field">
        Data fim (vazio = vigente)
        <input name="dataFim" type="date" value="${escapeHtml(periodo?.dataFim || '')}" />
      </label>
      <button
        class="btn secondary"
        type="button"
        data-action="settings-aliquota-remove-periodo"
        data-index="${index}"
        ${total <= 1 ? 'disabled' : ''}
      >Remover</button>
    </div>
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
          <label class="field">
            Tema do NotaSync
            <select name="tema" data-action="settings-tema-change">${renderOptions(['Claro', 'Escuro'], state.settings.geral.tema)}</select>
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
    case 'aliquotas': {
      const periodos = Array.isArray(state.settings.aliquotas.draftPeriodos)
        ? state.settings.aliquotas.draftPeriodos
        : cloneMonofasicoAliquotaPeriodos(state.settings.aliquotas.periodos);
      const errorMessage = state.settings.aliquotas.errorMessage;
      const saving = state.settings.aliquotas.saving;

      return `
        <form id="settingsAliquotasForm">
          <p class="card-subtitle" style="margin-top:0;">
            Aliquota vigente usada na conferencia do monofasico (CST/CSOSN 61) no Leitor XML 3.0 -&gt; NF-e. Cadastre os periodos de vigencia; o periodo mais recente pode ficar sem data final (vigente).
          </p>
          ${errorMessage ? `<div class="table-state error" style="margin-bottom:14px;">${escapeHtml(errorMessage)}</div>` : ''}
          <div class="aliquota-periodo-list">
            ${
              periodos.length
                ? periodos.map((periodo, index) => renderAliquotaPeriodoRow(periodo, index, periodos.length)).join('')
                : '<p class="row-sub">Nenhum periodo cadastrado.</p>'
            }
          </div>
          <div class="stack-actions" style="justify-content:flex-start; margin-top:12px;">
            <button class="btn secondary" type="button" data-action="settings-aliquota-add-periodo">+ Adicionar periodo</button>
            <button class="btn primary" type="submit" ${saving ? 'disabled' : ''}>${saving ? 'Salvando...' : 'Salvar aliquotas'}</button>
          </div>
        </form>
      `;
    }
    case 'acessos':
      return renderAuthAccessSettingsPanel();
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
    case 'events-sync-report':
      return renderEventsSyncReportModal();
    case 'past-nsu-recovery-report':
      return renderPastNsuRecoveryReportModal();
    case 'nfse-recover-by-dps':
      return renderNfseRecoverByDpsModal();
    case 'nfse-recover-by-key':
      return renderNfseRecoverByKeyModal();
    case 'nfse-numbering-exception':
      return renderNfseNumberingExceptionModal();
    case 'nfse-conta-contabil-config':
      return renderNfseContaContabilConfigModal();
    case 'download-by-key-report':
      return renderDownloadByKeyReportModal();
    case 'dominio-import-report':
      return renderDominioImportReportModal();
    case 'cte-disagreement-alerts':
      return renderCteDisagreementAlertsModal();
    case 'nfse-retention-alerts':
      return renderNfseRetentionAlertsModal();
    case 'dominio-nfe-view':
      return renderDominioNfeViewerModal();
    case 'compare-sped-report':
      return renderCompareSpedReportModal();
    case 'xml-details':
      return renderXmlDetailsModal(state.modal.xmlId);
    case 'xml-view':
      return renderXmlViewerModal(state.modal.xmlId);
    case 'xml-reader30-nfe-fullscreen':
      return renderXmlReader30NfeFullscreenModal();
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

function renderNfseRecoverByDpsModal() {
  if (state.modal?.kind !== 'nfse-recover-by-dps') {
    return '';
  }

  const submitting = Boolean(state.modal.submitting);
  const result = state.modal.result || null;
  const details = Array.isArray(result?.detalhes) ? result.detalhes : [];
  const gapSummary = Array.isArray(state.modal.gapPreview) ? state.modal.gapPreview.filter(Boolean).join('; ') : '';
  const errorMessage = String(state.modal.errorMessage || '').trim();

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1120px); max-width:1120px;">
        <div class="modal-header">
          <h3 class="modal-title">Recuperar NFS-e faltantes por DPS</h3>
          <p class="modal-subtitle">${escapeHtml(state.modal.clientName || 'Cliente selecionado')} • o sistema vai inferir o Id da DPS pelas notas vizinhas e, quando houver XML salvo, usar a DPS real da nota anterior ou posterior.</p>
        </div>
        <div class="modal-body">
          <form id="nfseRecoverByDpsForm">
            <div class="form-grid two">
              <label>
                <span>Cliente</span>
                <input type="text" value="${escapeHtml(state.modal.clientName || '')}" readonly />
              </label>
              <label>
                <span>CNPJ consulta</span>
                <input type="text" name="cnpjConsulta" value="${escapeHtml(state.modal.cnpjConsulta || '')}" readonly />
              </label>
              <label>
                <span>Ambiente</span>
                <input type="text" value="${escapeHtml(mapNfseAmbienteLabel(state.modal.ambiente || 'producao'))}" readonly />
              </label>
              <label>
                <span>Cliente ID</span>
                <input type="text" name="clienteId" value="${escapeHtml(state.modal.clientId || '')}" readonly />
              </label>
            </div>
            ${
              gapSummary
                ? `<p class="card-subtitle" style="margin:14px 0 10px; color:var(--warning);">Lacunas detectadas na busca atual: ${escapeHtml(gapSummary)}</p>`
                : ''
            }
            <p class="card-subtitle" style="margin-top:10px;">
              A recuperacao tenta primeiro derivar a DPS real a partir do XML da NFS-e vizinha. Se isso nao for possivel, cai no modo de inferencia pelo CNPJ emissor, serie e numeracao faltante.
            </p>
            ${errorMessage ? `<div class="table-state error" style="margin-top:14px;">${escapeHtml(errorMessage)}</div>` : ''}
            <div class="modal-footer" style="padding:18px 0 0;">
              <button class="btn secondary" type="button" data-action="close-modal" ${submitting ? 'disabled' : ''}>Fechar</button>
              <button class="btn primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Recuperando...' : 'Recuperar XMLs'}</button>
            </div>
          </form>
          ${
            result
              ? `
                <div style="margin-top:18px;">
                  <div class="form-grid four" style="margin-bottom:18px;">
                    ${detailItem('NFS-e faltantes', String(result.requestedDps || 0))}
                    ${detailItem('Processadas', String(result.processedDps || 0))}
                    ${detailItem('XMLs recuperados', String(result.documentsRecovered || 0))}
                    ${detailItem('Falhas', String(result.failures || 0))}
                  </div>
                  ${
                    details.length
                      ? `
                        <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(52vh, 520px);">
                          <div style="display:grid; grid-template-columns:minmax(160px, .8fr) minmax(260px, 1.4fr) minmax(160px, .8fr) minmax(360px, 1.8fr); gap:0; min-width:940px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line);">
                            <div style="padding:12px 14px;">NFS-e faltante</div>
                            <div style="padding:12px 14px;">Id inferido</div>
                            <div style="padding:12px 14px;">Status</div>
                            <div style="padding:12px 14px;">Mensagem</div>
                          </div>
                          ${details
                            .map(
                              (detail) => `
                                <div style="display:grid; grid-template-columns:minmax(160px, .8fr) minmax(260px, 1.4fr) minmax(160px, .8fr) minmax(360px, 1.8fr); gap:0; min-width:940px; border-bottom:1px solid var(--line); align-items:start;">
                                  <div style="padding:14px;">${escapeHtml(`${detail?.numeroDps || '-'}${detail?.serie ? ` / serie ${detail.serie}` : ''}`)}</div>
                                  <div style="padding:14px; font-family:monospace; font-size:12px; word-break:break-all;">${escapeHtml(detail?.dpsId || '-')}</div>
                                  <div style="padding:14px;">${statusBadge(detail?.status === 'recuperada' ? 'Recuperada' : 'Falha', detail?.status === 'recuperada' ? 'success' : 'danger')}</div>
                                  <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(detail?.mensagem || '-')}</div>
                                </div>
                              `
                            )
                            .join('')}
                        </div>
                      `
                      : '<div class="table-state">Nenhum detalhe retornado para esta recuperacao.</div>'
                  }
                </div>
              `
              : ''
          }
        </div>
      </div>
    </div>
  `;
}

function renderNfseRecoverByKeyModal() {
  if (state.modal?.kind !== 'nfse-recover-by-key') {
    return '';
  }

  const submitting = Boolean(state.modal.submitting);
  const result = state.modal.result || null;
  const details = Array.isArray(result?.detalhes) ? result.detalhes : [];
  const gapSummary = Array.isArray(state.modal.gapPreview) ? state.modal.gapPreview.filter(Boolean).join('; ') : '';
  const errorMessage = String(state.modal.errorMessage || '').trim();

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1100px); max-width:1100px;">
        <div class="modal-header">
          <h3 class="modal-title">Recuperar NFS-e faltantes por chave</h3>
          <p class="modal-subtitle">${escapeHtml(state.modal.clientName || 'Cliente selecionado')} • cole as chaves localizadas no Portal Nacional.</p>
        </div>
        <div class="modal-body">
          <form id="nfseRecoverByKeyForm">
            <div class="form-grid two">
              <label>
                <span>Cliente</span>
                <input type="text" value="${escapeHtml(state.modal.clientName || '')}" readonly />
              </label>
              <label>
                <span>CNPJ consulta</span>
                <input type="text" name="cnpjConsulta" value="${escapeHtml(state.modal.cnpjConsulta || '')}" readonly />
              </label>
              <label>
                <span>Ambiente</span>
                <select name="ambiente" ${submitting ? 'disabled' : ''}>
                  ${renderOptions(['producao', 'producao_restrita'], state.modal.ambiente || 'producao', {
                    producao: 'Producao',
                    producao_restrita: 'Producao restrita'
                  })}
                </select>
              </label>
              <label>
                <span>Cliente ID</span>
                <input type="text" name="clienteId" value="${escapeHtml(state.modal.clientId || '')}" readonly />
              </label>
            </div>
            ${
              gapSummary
                ? `<p class="card-subtitle" style="margin:14px 0 10px; color:var(--warning);">Lacunas detectadas na busca atual: ${escapeHtml(gapSummary)}</p>`
                : ''
            }
            <label style="display:block; margin-top:12px;">
              <span>Chaves de acesso</span>
              <textarea name="chaves" rows="8" placeholder="Cole uma chave ou URL do portal por linha." ${submitting ? 'disabled' : ''}>${escapeHtml(state.modal.keyText || '')}</textarea>
            </label>
            <p class="card-subtitle" style="margin-top:10px;">A API oficial nao lista a chave a partir da numeracao pulada. Aqui o sistema consulta o Emissor Publico usando as chaves informadas.</p>
            ${errorMessage ? `<div class="table-state error" style="margin-top:14px;">${escapeHtml(errorMessage)}</div>` : ''}
            <div class="modal-footer" style="padding:18px 0 0;">
              <button class="btn secondary" type="button" data-action="close-modal" ${submitting ? 'disabled' : ''}>Fechar</button>
              <button class="btn primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Recuperando...' : 'Recuperar XMLs'}</button>
            </div>
          </form>
          ${
            result
              ? `
                <div style="margin-top:18px;">
                  <div class="form-grid four" style="margin-bottom:18px;">
                    ${detailItem('Chaves solicitadas', String(result.requestedKeys || 0))}
                    ${detailItem('Processadas', String(result.processedKeys || 0))}
                    ${detailItem('XMLs recuperados', String(result.documentsRecovered || 0))}
                    ${detailItem('Falhas', String(result.failures || 0))}
                  </div>
                  ${
                    details.length
                      ? `
                        <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(52vh, 520px);">
                          <div style="display:grid; grid-template-columns:minmax(260px, 1.4fr) minmax(140px, .7fr) minmax(360px, 1.8fr); gap:0; min-width:760px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line);">
                            <div style="padding:12px 14px;">Chave de acesso</div>
                            <div style="padding:12px 14px;">Status</div>
                            <div style="padding:12px 14px;">Mensagem</div>
                          </div>
                          ${details
                            .map(
                              (detail) => `
                                <div style="display:grid; grid-template-columns:minmax(260px, 1.4fr) minmax(140px, .7fr) minmax(360px, 1.8fr); gap:0; min-width:760px; border-bottom:1px solid var(--line); align-items:start;">
                                  <div style="padding:14px; font-family:monospace; font-size:12px; word-break:break-all;">${escapeHtml(detail?.chaveAcesso || '-')}</div>
                                  <div style="padding:14px;">${statusBadge(detail?.status === 'recuperada' ? 'Recuperada' : 'Falha', detail?.status === 'recuperada' ? 'success' : 'danger')}</div>
                                  <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(detail?.mensagem || '-')}</div>
                                </div>
                              `
                            )
                            .join('')}
                        </div>
                      `
                      : '<div class="table-state">Nenhum detalhe retornado para esta recuperacao.</div>'
                  }
                </div>
              `
              : ''
          }
        </div>
      </div>
    </div>
  `;
}

function renderNfseNumberingExceptionModal() {
  if (state.modal?.kind !== 'nfse-numbering-exception') {
    return '';
  }

  const submitting = Boolean(state.modal.submitting);
  const loading = Boolean(state.modal.loading);
  const errorMessage = String(state.modal.errorMessage || '').trim();
  const exceptions = Array.isArray(state.modal.exceptions) ? state.modal.exceptions : [];

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 980px); max-width:980px;">
        <div class="modal-header">
          <h3 class="modal-title">Informar excecao de numeracao</h3>
          <p class="modal-subtitle">${escapeHtml(state.modal.clientName || 'Cliente selecionado')} • marque notas inutilizadas ou que realmente nao existem para retirar da auditoria e da validacao de armazenamento.</p>
        </div>
        <div class="modal-body">
          <form id="nfseNumberingExceptionForm">
            <div class="form-grid two">
              <label>
                <span>Cliente</span>
                <input type="text" value="${escapeHtml(state.modal.clientName || '')}" readonly />
              </label>
              <label>
                <span>CNPJ consulta</span>
                <input type="text" name="cnpjConsulta" value="${escapeHtml(state.modal.cnpjConsulta || '')}" readonly />
              </label>
              <label>
                <span>Ambiente</span>
                <select name="ambiente" ${submitting ? 'disabled' : ''}>
                  ${renderOptions(['producao', 'producao_restrita'], state.modal.ambiente || 'producao', {
                    producao: 'Producao',
                    producao_restrita: 'Producao restrita'
                  })}
                </select>
              </label>
              <label>
                <span>Numero(s) da NFS-e</span>
                <textarea name="numeroNfse" rows="3" placeholder="Ex.: 555, 556, 560, 564 ou 555-562" ${submitting ? 'disabled' : ''}>${escapeHtml(String(state.modal.numeroNfse || ''))}</textarea>
              </label>
              <label>
                <span>Tipo</span>
                <select name="tipo" ${submitting ? 'disabled' : ''}>
                  ${renderOptions(['inutilizada', 'nao_existe'], state.modal.tipo || 'inutilizada', {
                    inutilizada: 'Inutilizada',
                    nao_existe: 'Nao existe'
                  })}
                </select>
              </label>
              <label>
                <span>Cliente ID</span>
                <input type="text" name="clienteId" value="${escapeHtml(state.modal.clientId || '')}" readonly />
              </label>
              <label style="grid-column: span 2;">
                <span>Observacao</span>
                <textarea name="observacao" rows="3" ${submitting ? 'disabled' : ''}>${escapeHtml(state.modal.observacao || '')}</textarea>
              </label>
            </div>
            ${errorMessage ? `<div class="table-state error" style="margin-top:14px;">${escapeHtml(errorMessage)}</div>` : ''}
            <p class="card-subtitle" style="margin-top:10px;">Voce pode informar numeros separados por virgula, espaco, ponto e virgula, quebra de linha ou uma faixa como <strong>555-562</strong>.</p>
            <div class="modal-footer" style="padding:18px 0 0;">
              <button class="btn secondary" type="button" data-action="close-modal" ${submitting ? 'disabled' : ''}>Fechar</button>
              <button class="btn primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Salvando...' : 'Salvar excecoes'}</button>
            </div>
          </form>
          <div style="margin-top:18px;">
            <h4 class="card-title" style="margin-bottom:8px;">Excecoes ja informadas</h4>
            ${
              loading
                ? '<div class="table-state loading">Carregando excecoes...</div>'
                : exceptions.length
                  ? `
                    <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(46vh, 420px);">
                      <div style="display:grid; grid-template-columns:minmax(120px, .8fr) minmax(140px, .9fr) minmax(120px, .8fr) minmax(280px, 1.6fr) minmax(120px, .8fr); gap:0; min-width:760px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line);">
                        <div style="padding:12px 14px;">Ambiente</div>
                        <div style="padding:12px 14px;">Numero</div>
                        <div style="padding:12px 14px;">Tipo</div>
                        <div style="padding:12px 14px;">Observacao</div>
                        <div style="padding:12px 14px;">Acao</div>
                      </div>
                      ${exceptions
                        .map(
                          (row) => `
                            <div style="display:grid; grid-template-columns:minmax(120px, .8fr) minmax(140px, .9fr) minmax(120px, .8fr) minmax(280px, 1.6fr) minmax(120px, .8fr); gap:0; min-width:760px; border-bottom:1px solid var(--line); align-items:start;">
                              <div style="padding:14px;">${escapeHtml(mapNfseAmbienteLabel(row.ambiente || 'producao'))}</div>
                              <div style="padding:14px;"><strong>${escapeHtml(String(row.numeroNfse || '-'))}</strong></div>
                              <div style="padding:14px;">${statusBadge(mapNfseNumberingExceptionTypeLabel(row.tipo), row.tipo === 'inutilizada' ? 'warning' : 'neutral')}</div>
                              <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(row.observacao || '-')}</div>
                              <div style="padding:14px;">
                                <button class="btn secondary" type="button" data-action="nfse-delete-numbering-exception" data-exception-id="${escapeHtml(row.id)}" ${submitting ? 'disabled' : ''}>Remover</button>
                              </div>
                            </div>
                          `
                        )
                        .join('')}
                    </div>
                  `
                  : '<div class="table-state">Nenhuma excecao de numeracao cadastrada para este cliente/CNPJ.</div>'
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderNfseContaContabilConfigModal() {
  if (state.modal?.kind !== 'nfse-conta-contabil-config') {
    return '';
  }

  const submitting = Boolean(state.modal.submitting);
  const loading = Boolean(state.modal.loading);
  const errorMessage = String(state.modal.errorMessage || '').trim();
  const configs = Array.isArray(state.modal.configs) ? state.modal.configs : [];

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 900px); max-width:900px;">
        <div class="modal-header">
          <h3 class="modal-title">Contas contabeis por codigo de servico</h3>
          <p class="modal-subtitle">${escapeHtml(state.modal.clientName || 'Cliente selecionado')} • defina a conta de debito (registro 1300) usada automaticamente em toda exportacao Dominio de Entrada, independente do modo Contas selecionado. Sem configuracao para o codigo, a exportacao usa a conta padrao 467; a conta do fornecedor (credito) continua controlada pelo campo Contas.</p>
        </div>
        <div class="modal-body">
          <form id="nfseContaContabilConfigForm">
            <input type="hidden" name="clienteId" value="${escapeHtml(state.modal.clientId || '')}" />
            <div class="form-grid two">
              <label>
                <span>Codigo do servico</span>
                <input type="text" name="codigoServico" placeholder="Ex.: 170101" value="${escapeHtml(String(state.modal.codigoServico || ''))}" ${submitting ? 'disabled' : ''} required />
              </label>
              <label>
                <span>Conta contabil</span>
                <input type="text" name="contaContabil" placeholder="Ex.: 505" value="${escapeHtml(String(state.modal.contaContabil || ''))}" ${submitting ? 'disabled' : ''} required />
              </label>
            </div>
            ${errorMessage ? `<div class="table-state error" style="margin-top:14px;">${escapeHtml(errorMessage)}</div>` : ''}
            <p class="card-subtitle" style="margin-top:10px;">Use o Codigo Servico Nacional da NFS-e (cai para o Item Lista Servico quando o nacional nao tiver configuracao).</p>
            <div class="modal-footer" style="padding:18px 0 0;">
              <button class="btn secondary" type="button" data-action="close-modal" ${submitting ? 'disabled' : ''}>Fechar</button>
              <button class="btn primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Salvando...' : 'Salvar configuracao'}</button>
            </div>
          </form>
          <div style="margin-top:18px;">
            <h4 class="card-title" style="margin-bottom:8px;">Configuracoes cadastradas</h4>
            ${
              loading
                ? '<div class="table-state loading">Carregando configuracoes...</div>'
                : configs.length
                  ? `
                    <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(46vh, 420px);">
                      <div style="display:grid; grid-template-columns:minmax(160px, 1fr) minmax(140px, .8fr) minmax(100px, .6fr) minmax(160px, 1fr); gap:0; min-width:600px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line);">
                        <div style="padding:12px 14px;">Codigo do servico</div>
                        <div style="padding:12px 14px;">Conta contabil</div>
                        <div style="padding:12px 14px;">Status</div>
                        <div style="padding:12px 14px;">Acao</div>
                      </div>
                      ${configs
                        .map(
                          (row) => `
                            <div style="display:grid; grid-template-columns:minmax(160px, 1fr) minmax(140px, .8fr) minmax(100px, .6fr) minmax(160px, 1fr); gap:0; min-width:600px; border-bottom:1px solid var(--line); align-items:center;">
                              <div style="padding:14px;"><strong>${escapeHtml(row.codigoServico || '-')}</strong></div>
                              <div style="padding:14px;">${escapeHtml(row.contaContabil || '-')}</div>
                              <div style="padding:14px;">${statusBadge(row.ativo ? 'Ativa' : 'Inativa', row.ativo ? 'success' : 'neutral')}</div>
                              <div style="padding:14px; display:flex; gap:8px;">
                                <button class="btn secondary" type="button" data-action="nfse-toggle-conta-contabil-config" data-config-id="${escapeHtml(row.id)}" data-next-ativo="${row.ativo ? 'false' : 'true'}" ${submitting ? 'disabled' : ''}>${row.ativo ? 'Desativar' : 'Ativar'}</button>
                                <button class="btn secondary" type="button" data-action="nfse-delete-conta-contabil-config" data-config-id="${escapeHtml(row.id)}" ${submitting ? 'disabled' : ''}>Remover</button>
                              </div>
                            </div>
                          `
                        )
                        .join('')}
                    </div>
                  `
                  : '<div class="table-state">Nenhuma conta configurada para este cliente ainda.</div>'
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderClientFormModal() {
  const client = state.modal.mode === 'edit' ? findClientById(state.modal.clientId) : null;
  const municipioValue = getEditableValue(client?.municipio);
  const ufValue = getEditableValue(client?.uf);
  const responsavelInternoValue = getEditableValue(client?.responsavelInterno);
  const codigoEmpresaDominioValue =
    state.modal.codigoEmpresaDominioOverride ?? (client?.codigoEmpresaDominio != null ? String(client.codigoEmpresaDominio) : '');
  const buscandoCodigoEmpresa = Boolean(state.modal.buscandoCodigoEmpresa);

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
              <label class="field">
                Codigo empresa Dominio
                <div style="display:flex; gap:8px; align-items:center;">
                  <input name="codigoEmpresaDominio" type="number" min="0" step="1" placeholder="Ex.: 10105" value="${escapeHtml(codigoEmpresaDominioValue)}" style="flex:1;" />
                  <button
                    class="btn secondary"
                    type="button"
                    data-action="client-buscar-codigo-empresa-dominio"
                    ${client?.id ? '' : 'disabled title="Salve o cliente primeiro para buscar pelo CNPJ."'}
                    ${buscandoCodigoEmpresa ? 'disabled' : ''}
                  >
                    ${buscandoCodigoEmpresa ? 'Buscando...' : 'Buscar por CNPJ'}
                  </button>
                </div>
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
  const danfeButton = doc.xmlCompletoDisponivel
    ? `<button class="btn secondary" data-action="nfe-download-danfe" data-nfe-id="${doc.id}">Baixar DANFE</button>`
    : '';

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
            ${detailItem('Valor total', formatOptionalCurrency(doc.valor))}
            ${detailItem('Schema', doc.schemaDoc || '-')}
            ${detailItem('Arquivo completo', doc.xmlCompletoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Resumo disponivel', doc.resumoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Status fiscal', doc.statusFiscal || '-')}
            ${detailItem('Resumo de eventos', doc.eventosResumo || '-')}
            ${detailItem('Caminho XML', doc.caminhoServidor || '-')}
          </div>
          <div style="margin-top:18px;">
            <small style="color:var(--text-secondary); display:block; margin-bottom:8px;">Eventos vinculados</small>
            ${renderXmlEventsList(doc.eventos)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="nfe-sync-events" data-nfe-id="${doc.id}" ${syncEventsDisabled}>Buscar eventos</button>
          <button class="btn secondary" data-action="nfe-view" data-nfe-id="${doc.id}">Ver conteudo XML</button>
          ${danfeButton}
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
  const danfeButton = doc.xmlCompletoDisponivel
    ? `<button class="btn secondary" data-action="nfe-download-danfe" data-nfe-id="${doc.id}">Baixar DANFE</button>`
    : '';

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
          ${danfeButton}
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
            ${detailItem('Valor total', formatOptionalCurrency(doc.valor))}
            ${detailItem('Schema', doc.schemaDoc || '-')}
            ${detailItem('Arquivo completo', doc.xmlCompletoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Resumo disponivel', doc.resumoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Status fiscal', doc.statusFiscal || '-')}
            ${detailItem('Resumo de eventos', doc.eventosResumo || '-')}
            ${detailItem('Caminho XML', doc.caminhoServidor || '-')}
          </div>
          <div style="margin-top:18px;">
            <small style="color:var(--text-secondary); display:block; margin-bottom:8px;">Eventos vinculados</small>
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

function renderEventsSyncReportModal() {
  if (state.modal?.kind !== 'events-sync-report') {
    return '';
  }

  const documentType = state.modal.documentType || 'nfe';
  const summary = state.modal.summary || {};
  const rows = Array.isArray(state.modal.rows) && state.modal.rows.length ? state.modal.rows : buildEventsSyncAuditRows(documentType, summary);
  const showOnlyFailures = Boolean(state.modal.showOnlyFailures);
  const visibleRows = getOverlayVisibleRows('events-sync-report', rows, showOnlyFailures);
  const failureRows = countOverlayFailureRows('events-sync-report', rows);
  const titleByType = {
    nfse: 'Auditoria da busca de eventos de NFS-e',
    nfe: 'Auditoria da busca de eventos de NF-e',
    cte: 'Auditoria da busca de eventos de CT-e'
  };
  const subtitlePrefix = state.modal.scope === 'individual' ? 'Consulta individual concluida.' : 'Consulta da listagem concluida.';
  const processedCount = Number(state.modal.processedCount || summary?.documentosProcessados || summary?.documentosAnalisados || rows.length || 0);
  const totalCount = Number(state.modal.totalCount || processedCount || 0);
  const documentosComEventos = Number(state.modal.documentosComEventos || summary?.documentosComEventos || 0);
  const eventosImportados = Number(state.modal.eventosImportados || summary?.eventosImportados || 0);
  const falhas = Number(state.modal.falhas || summary?.falhas || 0);
  const running = Boolean(state.modal.running);
  const currentMessage = String(state.modal.currentMessage || '').trim();
  const gridTemplate =
    'minmax(160px, 1.05fr) minmax(260px, 1.55fr) minmax(280px, 1.45fr) minmax(160px, .85fr) minmax(320px, 1.65fr) 120px';
  const subtitle = running
    ? `Consulta em andamento. ${processedCount}/${totalCount} documento(s) processado(s).`
    : `${subtitlePrefix} Revise o resultado documento por documento.`;

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1460px); max-width:1460px;">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(titleByType[documentType] || 'Auditoria da busca de eventos')}</h3>
          <p class="modal-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="modal-body">
          ${
            currentMessage
              ? `<div style="margin-bottom:14px; padding:12px 14px; border:1px solid var(--info); border-radius:12px; background:var(--surface-alt); color:var(--info);">${escapeHtml(currentMessage)}</div>`
              : ''
          }
          <div class="form-grid four" style="margin-bottom:18px;">
            ${detailItem('Documentos processados', `${processedCount}${totalCount ? ` / ${totalCount}` : ''}`)}
            ${detailItem('Com eventos', String(documentosComEventos))}
            ${detailItem('Eventos importados', String(eventosImportados))}
            ${detailItem('Falhas', String(falhas))}
          </div>
          ${renderOverlayFailureToolbar({
            showOnlyFailures,
            failureRows,
            visibleRows: visibleRows.length,
            totalRows: rows.length
          })}
          ${
            visibleRows.length
              ? `
                <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(68vh, 760px);">
                  <div style="display:grid; grid-template-columns:${gridTemplate}; gap:0; min-width:1300px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:1;">
                    <div style="padding:12px 14px;">Documento</div>
                    <div style="padding:12px 14px;">Chave de acesso</div>
                    <div style="padding:12px 14px;">Evento</div>
                    <div style="padding:12px 14px;">Resultado</div>
                    <div style="padding:12px 14px;">Mensagem</div>
                    <div style="padding:12px 14px;">Acao</div>
                  </div>
                  ${visibleRows
                    .map(
                      (row) => `
                        <div style="display:grid; grid-template-columns:${gridTemplate}; gap:0; min-width:1300px; border-bottom:1px solid var(--line); align-items:start;">
                          <div style="padding:14px;">
                            <strong>${escapeHtml(row.documentLabel)}</strong>
                            ${row.secondaryLabel ? `<div style="margin-top:4px; color:var(--text-secondary);">${escapeHtml(row.secondaryLabel)}</div>` : ''}
                          </div>
                          <div style="padding:14px; font-family:monospace; font-size:12px; word-break:break-all;">${escapeHtml(row.chaveAcesso)}</div>
                          <div style="padding:14px;">
                            <strong>${escapeHtml(row.eventLabel)}</strong>
                            <div style="margin-top:4px; color:var(--text-secondary);">${escapeHtml(row.eventCountLabel)}</div>
                          </div>
                          <div style="padding:14px;">${statusBadge(row.statusLabel, row.statusTone)}</div>
                          <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(row.message || '-')}</div>
                          <div style="padding:14px;">
                            ${
                              row.openActionId && !running
                                ? `<button class="btn secondary small" data-action="events-report-open-document" data-document-type="${escapeHtml(
                                    documentType
                                  )}" data-document-id="${escapeHtml(row.openActionId)}">Ver nota</button>`
                                : '<span style="color:var(--muted);">-</span>'
                            }
                          </div>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
              : `<div style="padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt); color:var(--text-secondary);">${
                  showOnlyFailures ? 'Nenhuma falha encontrada para os filtros atuais.' : 'Nenhum retorno disponivel para auditoria.'
                }</div>`
          }
        </div>
        <div class="modal-footer">
          ${running ? '<span style="color:var(--text-secondary); font-size:13px;">Aguarde a conclusao da busca manual...</span>' : '<button class="btn secondary" data-action="close-modal">Fechar</button>'}
        </div>
      </div>
    </div>
  `;
}

function renderPastNsuRecoveryReportModal() {
  if (state.modal?.kind !== 'past-nsu-recovery-report') {
    return '';
  }

  const summary = state.modal.summary || {};
  const rows = Array.isArray(state.modal.rows) ? state.modal.rows : [];
  const showOnlyFailures = Boolean(state.modal.showOnlyFailures);
  const visibleRows = getOverlayVisibleRows('past-nsu-recovery-report', rows, showOnlyFailures);
  const failureRows = countOverlayFailureRows('past-nsu-recovery-report', rows);
  const running = Boolean(state.modal.running);
  const rowMode = state.modal.rowMode || 'controle';
  const currentMessage = String(state.modal.currentMessage || '').trim();
  const clientName = String(state.modal.clientName || 'Cliente selecionado');
  const executionMode = String(state.modal.executionMode || 'full');
  const title = String(state.modal.title || 'Auditoria do reprocessamento de NSUs');
  const runningLabel = String(state.modal.runningLabel || 'reprocessamento em andamento.');
  const completedLabel = String(state.modal.completedLabel || 'reprocessamento concluido.');
  const processedCount = Number(summary?.controlesProcessados || 0);
  const totalCount = Number(summary?.controlesEncontrados || state.modal.totalCount || 0);
  const documentosSalvos = Number(summary?.documentosSalvos || 0);
  const documentosGapResolvidos = Number(summary?.documentosGapResolvidos || 0);
  const documentosAdicionaisSalvos = Number(summary?.documentosAdicionaisSalvos || 0);
  const nsusAvaliados = Number(summary?.nsusAvaliados || 0);
  const nsusConsultados = Number(summary?.nsusConsultados || 0);
  const jaExistentes = Number(summary?.nsusIgnoradosComDocumento || 0) + Number(summary?.documentosIgnoradosExistentes || 0);
  const semDocumento = Number(summary?.semDocumento || 0);
  const falhas = Number(summary?.falhas || 0);

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1440px); max-width:1440px;">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <p class="modal-subtitle">${escapeHtml(clientName)}${running ? ` • ${escapeHtml(runningLabel)}` : ` • ${escapeHtml(completedLabel)}`}</p>
        </div>
        <div class="modal-body">
          ${
            currentMessage
              ? `<div style="margin-bottom:14px; padding:12px 14px; border:1px solid var(--info); border-radius:12px; background:var(--surface-alt); color:var(--info);">${escapeHtml(currentMessage)}</div>`
              : ''
          }
          <div class="form-grid four" style="margin-bottom:18px;">
            ${detailItem('Controles processados', `${processedCount}${totalCount ? ` / ${totalCount}` : ''}`)}
            ${detailItem('NSUs avaliados', String(nsusAvaliados))}
            ${detailItem('NSUs consultados', String(nsusConsultados))}
            ${
              executionMode === 'gap-audit'
                ? `
                  ${detailItem('Lacunas resolvidas', String(documentosGapResolvidos))}
                  ${detailItem('XMLs adicionais', String(documentosAdicionaisSalvos))}
                  ${detailItem('Ja existentes', String(jaExistentes))}
                  ${detailItem('Sem doc. proprio', String(semDocumento))}
                `
                : `
                  ${detailItem('XMLs salvos', String(documentosSalvos))}
                  ${detailItem('Ja existentes', String(jaExistentes))}
                  ${detailItem('Sem documento', String(semDocumento))}
                `
            }
            ${detailItem('Falhas', String(falhas))}
          </div>
          ${renderOverlayFailureToolbar({
            showOnlyFailures,
            failureRows,
            visibleRows: visibleRows.length,
            totalRows: rows.length
          })}
          ${
            visibleRows.length
              ? rowMode === 'nsu'
                ? `
                <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(68vh, 760px);">
                  <div style="display:grid; grid-template-columns: minmax(120px, .7fr) minmax(170px, 1fr) minmax(140px, .8fr) minmax(220px, 1.2fr) minmax(160px, .9fr) minmax(320px, 1.6fr); gap:0; min-width:1160px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:1;">
                    <div style="padding:12px 14px;">NSU</div>
                    <div style="padding:12px 14px;">CNPJ consulta</div>
                    <div style="padding:12px 14px;">Ambiente</div>
                    <div style="padding:12px 14px;">Chave</div>
                    <div style="padding:12px 14px;">Status</div>
                    <div style="padding:12px 14px;">Mensagem</div>
                  </div>
                  ${visibleRows
                    .map(
                      (row) => `
                        <div style="display:grid; grid-template-columns: minmax(120px, .7fr) minmax(170px, 1fr) minmax(140px, .8fr) minmax(220px, 1.2fr) minmax(160px, .9fr) minmax(320px, 1.6fr); gap:0; min-width:1160px; border-bottom:1px solid var(--line); align-items:start;">
                          <div style="padding:14px; font-family:monospace; font-size:12px;">${escapeHtml(row.nsuLabel || '-')}</div>
                          <div style="padding:14px; font-family:monospace; font-size:12px;">${escapeHtml(row.cnpjConsulta || '-')}</div>
                          <div style="padding:14px;">${escapeHtml(row.ambienteLabel || '-')}</div>
                          <div style="padding:14px; font-family:monospace; font-size:12px; word-break:break-all;">
                            ${escapeHtml(row.chaveAcesso || '-')}
                          </div>
                          <div style="padding:14px;">${statusBadge(row.statusLabel || '-', row.statusTone || 'neutral')}</div>
                          <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(row.message || '-')}</div>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
                : `
                <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(68vh, 760px);">
                  <div style="display:grid; grid-template-columns: minmax(170px, 1.1fr) minmax(120px, .7fr) minmax(160px, 1fr) minmax(240px, 1.4fr) minmax(160px, .9fr) minmax(320px, 1.6fr); gap:0; min-width:1170px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:1;">
                    <div style="padding:12px 14px;">CNPJ consulta</div>
                    <div style="padding:12px 14px;">Ambiente</div>
                    <div style="padding:12px 14px;">Faixa NSU</div>
                    <div style="padding:12px 14px;">Resultado</div>
                    <div style="padding:12px 14px;">Status</div>
                    <div style="padding:12px 14px;">Mensagem</div>
                  </div>
                  ${visibleRows
                    .map(
                      (row) => `
                        <div style="display:grid; grid-template-columns: minmax(170px, 1.1fr) minmax(120px, .7fr) minmax(160px, 1fr) minmax(240px, 1.4fr) minmax(160px, .9fr) minmax(320px, 1.6fr); gap:0; min-width:1170px; border-bottom:1px solid var(--line); align-items:start;">
                          <div style="padding:14px; font-family:monospace; font-size:12px;">${escapeHtml(row.cnpjConsulta)}</div>
                          <div style="padding:14px;">${escapeHtml(row.ambienteLabel)}</div>
                          <div style="padding:14px; font-family:monospace; font-size:12px;">${escapeHtml(row.nsuRangeLabel)}</div>
                          <div style="padding:14px;">
                            <strong>${escapeHtml(row.resultLabel)}</strong>
                            <div style="margin-top:4px; color:var(--text-secondary);">${escapeHtml(row.detailLabel)}</div>
                          </div>
                          <div style="padding:14px;">${statusBadge(row.statusLabel, row.statusTone)}</div>
                          <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(row.message)}</div>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
              : `<div style="padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt); color:var(--text-secondary);">${
                  showOnlyFailures ? 'Nenhuma falha encontrada para os filtros atuais.' : 'Nenhum detalhe retornado para o reprocessamento.'
                }</div>`
          }
        </div>
        <div class="modal-footer">
          ${running ? '<span style="color:var(--text-secondary); font-size:13px;">Aguarde a conclusao da execucao manual...</span>' : '<button class="btn secondary" data-action="close-modal">Fechar</button>'}
        </div>
      </div>
    </div>
  `;
}

function renderDownloadByKeyReportModal() {
  if (state.modal?.kind !== 'download-by-key-report') {
    return '';
  }

  const rows = Array.isArray(state.modal.rows) ? state.modal.rows : [];
  const showOnlyFailures = Boolean(state.modal.showOnlyFailures);
  const visibleRows = getOverlayVisibleRows('download-by-key-report', rows, showOnlyFailures);
  const failureRows = countOverlayFailureRows('download-by-key-report', rows);
  const running = Boolean(state.modal.running);
  const showClientColumn = Boolean(state.modal.showClientColumn);
  const pendingCount = Number(state.modal.pendingCount || 0);
  const downloadedCount = Number(state.modal.downloadedCount || 0);
  const errorCount = Number(state.modal.errorCount || 0);
  const currentMessage = String(state.modal.currentMessage || '').trim();
  const clientName = String(state.modal.clientName || 'Todos os clientes');
  const subtitle = running
    ? `${clientName} • ${downloadedCount}/${pendingCount} item(ns) concluido(s).`
    : `${clientName} • revise o resultado chave por chave.`;

  const gridTemplate = showClientColumn
    ? 'minmax(150px, 1fr) minmax(250px, 1.45fr) minmax(140px, .8fr) minmax(140px, .75fr) minmax(420px, 2fr)'
    : 'minmax(250px, 1.5fr) minmax(140px, .8fr) minmax(140px, .75fr) minmax(460px, 2.2fr)';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1440px); max-width:1440px;">
        <div class="modal-header">
          <h3 class="modal-title">Download por chave</h3>
          <p class="modal-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="modal-body">
          ${
            currentMessage
              ? `<div style="margin-bottom:14px; padding:12px 14px; border:1px solid var(--info); border-radius:12px; background:var(--surface-alt); color:var(--info);">${escapeHtml(currentMessage)}</div>`
              : ''
          }
          <div class="form-grid four" style="margin-bottom:18px;">
            ${detailItem('Chaves pendentes', String(pendingCount))}
            ${detailItem('Baixadas', String(downloadedCount))}
            ${detailItem('Erros', String(errorCount))}
            ${detailItem('Linhas exibidas', String(visibleRows.length))}
          </div>
          ${renderOverlayFailureToolbar({
            showOnlyFailures,
            failureRows,
            visibleRows: visibleRows.length,
            totalRows: rows.length
          })}
          ${
            visibleRows.length
              ? `
                <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(68vh, 760px);">
                  <div style="display:grid; grid-template-columns:${gridTemplate}; gap:0; min-width:${showClientColumn ? '1220px' : '1080px'}; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:1;">
                    ${showClientColumn ? '<div style="padding:12px 14px;">Cliente</div>' : ''}
                    <div style="padding:12px 14px;">Chave de acesso</div>
                    <div style="padding:12px 14px;">Documento</div>
                    <div style="padding:12px 14px;">Status</div>
                    <div style="padding:12px 14px;">Mensagem</div>
                  </div>
                  ${visibleRows
                    .map(
                      (row) => `
                        <div style="display:grid; grid-template-columns:${gridTemplate}; gap:0; min-width:${showClientColumn ? '1220px' : '1080px'}; border-bottom:1px solid var(--line); align-items:start;">
                          ${
                            showClientColumn
                              ? `<div style="padding:14px;">
                                  <strong>${escapeHtml(row.clientLabel || '-')}</strong>
                                  ${row.clientDetail ? `<div style="margin-top:4px; color:var(--text-secondary);">${escapeHtml(row.clientDetail)}</div>` : ''}
                                </div>`
                              : ''
                          }
                          <div style="padding:14px; font-family:monospace; font-size:12px; word-break:break-all;">
                            ${escapeHtml(row.chaveAcesso || '-')}
                            ${row.keyDetail ? `<div style="margin-top:4px; color:var(--text-secondary); font-family:inherit;">${escapeHtml(row.keyDetail)}</div>` : ''}
                          </div>
                          <div style="padding:14px;">
                            <strong>${escapeHtml(row.documentLabel || '-')}</strong>
                            ${row.documentDetail ? `<div style="margin-top:4px; color:var(--text-secondary);">${escapeHtml(row.documentDetail)}</div>` : ''}
                          </div>
                          <div style="padding:14px;">${statusBadge(row.statusLabel || '-', row.statusTone || 'neutral')}</div>
                          <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(row.message || '-')}</div>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
              : `<div style="padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt); color:var(--text-secondary);">${
                  showOnlyFailures ? 'Nenhuma falha encontrada para os filtros atuais.' : 'Nenhuma chave pendente foi encontrada para esta execucao.'
                }</div>`
          }
        </div>
        <div class="modal-footer">
          ${running ? '<span style="color:var(--text-secondary); font-size:13px;">Aguarde a conclusao do download manual por chave...</span>' : '<button class="btn secondary" data-action="close-modal">Fechar</button>'}
        </div>
      </div>
    </div>
  `;
}

function renderDominioImportReportModal() {
  if (state.modal?.kind !== 'dominio-import-report') {
    return '';
  }

  const rows = Array.isArray(state.modal.rows) ? state.modal.rows : [];
  const showOnlyFailures = Boolean(state.modal.showOnlyFailures);
  const visibleRows = getOverlayVisibleRows('dominio-import-report', rows, showOnlyFailures);
  const failureRows = countOverlayFailureRows('dominio-import-report', rows);
  const running = Boolean(state.modal.running);
  const scopeLabel = String(state.modal.scopeLabel || 'Importacao manual da Dominio');
  const totalClients = Number(state.modal.totalClients || rows.length || 0);
  const processedClients = Number(state.modal.processedClients || 0);
  const successfulClients = Number(state.modal.successfulClients || 0);
  const failedClients = Number(state.modal.failedClients || 0);
  const importedDocuments = Number(state.modal.importedDocuments || 0);
  const importSummary = normalizeDominioImportSummary(state.modal.importSummary);
  const currentMessage = String(state.modal.currentMessage || '').trim();
  const subtitle = running
    ? `${scopeLabel} • ${processedClients}/${totalClients} empresa(s) processada(s).`
    : `${scopeLabel} • revise o resultado empresa por empresa.`;

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1380px); max-width:1380px;">
        <div class="modal-header">
          <h3 class="modal-title">Importacao manual da Dominio</h3>
          <p class="modal-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <div class="modal-body">
          ${
            currentMessage
              ? `<div style="margin-bottom:14px; padding:12px 14px; border:1px solid var(--info); border-radius:12px; background:var(--surface-alt); color:var(--info);">${escapeHtml(currentMessage)}</div>`
              : ''
          }
          <div class="form-grid four" style="margin-bottom:18px;">
            ${detailItem('Empresas processadas', `${processedClients}/${totalClients}`)}
            ${detailItem('Empresas sem falha', String(successfulClients))}
            ${detailItem('Empresas com falha', String(failedClients))}
            ${detailItem('XMLs importados', String(importedDocuments))}
          </div>
          ${renderDominioImportSummaryPanel(importSummary, {
            subtitle: 'Esse total inclui NF-e, CT-e, NFS-e e eventos importados pela Dominio.'
          })}
          ${renderOverlayFailureToolbar({
            showOnlyFailures,
            failureRows,
            visibleRows: visibleRows.length,
            totalRows: rows.length
          })}
          ${
            visibleRows.length
              ? `
                <div style="border:1px solid var(--line); border-radius:14px; overflow:auto; background:var(--surface); max-height:min(68vh, 760px);">
                  <div style="display:grid; grid-template-columns:minmax(220px, 1.2fr) minmax(170px, .9fr) minmax(180px, .9fr) minmax(170px, .8fr) minmax(170px, .8fr) minmax(340px, 1.7fr); gap:0; min-width:1250px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--text-secondary); background:var(--surface-alt); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:1;">
                    <div style="padding:12px 14px;">Empresa</div>
                    <div style="padding:12px 14px;">Periodo</div>
                    <div style="padding:12px 14px;">Etapa atual</div>
                    <div style="padding:12px 14px;">Status</div>
                    <div style="padding:12px 14px;">Resultado</div>
                    <div style="padding:12px 14px;">Mensagem</div>
                  </div>
                  ${visibleRows
                    .map(
                      (row) => `
                        <div style="display:grid; grid-template-columns:minmax(220px, 1.2fr) minmax(170px, .9fr) minmax(180px, .9fr) minmax(170px, .8fr) minmax(170px, .8fr) minmax(340px, 1.7fr); gap:0; min-width:1250px; border-bottom:1px solid var(--line); align-items:start;">
                          <div style="padding:14px;">
                            <strong>${escapeHtml(row.clientLabel || '-')}</strong>
                            ${row.clientDetail ? `<div style="margin-top:4px; color:var(--text-secondary);">${escapeHtml(row.clientDetail)}</div>` : ''}
                          </div>
                          <div style="padding:14px; color:var(--text-secondary);">${escapeHtml(row.periodLabel || '-')}</div>
                          <div style="padding:14px;">
                            <strong>${escapeHtml(row.stepLabel || '-')}</strong>
                          </div>
                          <div style="padding:14px;">${statusBadge(mapDominioImportOverlayStatusLabel(row.status), toneFromDominioImportOverlayStatus(row.status))}</div>
                          <div style="padding:14px; color:var(--text-secondary);">
                            XMLs: <strong>${escapeHtml(String(Number(row.importedCount || 0)))}</strong><br />
                            Falhas: <strong>${escapeHtml(String(Number(row.failureCount || 0)))}</strong>
                            ${
                              Number(row.importedCount || 0) > 0
                                ? `<div style="margin-top:6px; line-height:1.45;">${escapeHtml(buildDominioImportCompositionLabel(row.importSummary))}</div>`
                                : ''
                            }
                          </div>
                          <div style="padding:14px; color:var(--text-secondary); white-space:normal; overflow-wrap:anywhere; word-break:break-word; line-height:1.45;">${escapeHtml(row.message || '-')}</div>
                        </div>
                      `
                    )
                    .join('')}
                </div>
              `
              : `<div style="padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt); color:var(--text-secondary);">${
                  showOnlyFailures ? 'Nenhuma falha encontrada para os filtros atuais.' : 'Nenhuma empresa foi preparada para esta importacao.'
                }</div>`
          }
        </div>
        <div class="modal-footer">
          ${running ? '<span style="color:var(--text-secondary); font-size:13px;">Aguarde a conclusao da importacao manual da Dominio...</span>' : '<button class="btn secondary" data-action="close-modal">Fechar</button>'}
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
  const syncEventsDisabled = state.xmlEventsSyncRunning || !canSyncXmlEvents(xml) ? 'disabled' : '';
  const sourceAlert = state.modal?.kind === 'xml-details' && state.modal.alertId ? state.alerts.find((item) => item.id === state.modal.alertId) || null : null;
  const closeLabel = getModalCloseActionLabel(state.modal);

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
            ${detailItem('Validacao de numeracao', xml.ignorarNumeracaoValidacao ? 'Desconsiderado nesta validacao' : 'Participa normalmente')}
            ${detailItem('Obs. validacao numeracao', xml.ignorarNumeracaoObservacao || '-')}
            ${detailItem('Data de cancelamento', xml.dataCancelamento ? formatDateTime(xml.dataCancelamento) : '-')}
            ${detailItem('Resumo de eventos', xml.eventosResumo || '-')}
          </div>
          ${renderNfseRetentionSummarySection(xml, sourceAlert)}
          ${renderDocumentInsightsSection('nfse', xml)}
          <div style="margin-top:18px;">
            <small style="color:var(--text-secondary); display:block; margin-bottom:8px;">Eventos vinculados</small>
            ${renderXmlEventsList(xml.eventos)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">${escapeHtml(closeLabel)}</button>
          ${
            sourceAlert
              ? sourceAlert.status === 'Resolvido'
                ? `<button class="btn secondary" type="button" data-action="alert-unresolve" data-alert-id="${escapeHtml(sourceAlert.id)}">Reabrir alerta</button>`
                : `<button class="btn secondary" type="button" data-action="alert-resolve" data-alert-id="${escapeHtml(sourceAlert.id)}">Marcar como resolvido</button>`
              : ''
          }
          <button class="btn secondary" data-action="xml-toggle-numbering-validation" data-xml-id="${xml.id}">${escapeHtml(
            xml.ignorarNumeracaoValidacao ? 'Voltar numeracao' : 'Desconsiderar numeracao'
          )}</button>
          <button class="btn secondary" data-action="xml-sync-events" data-xml-id="${xml.id}" ${syncEventsDisabled}>Buscar eventos</button>
          <button class="btn secondary" data-action="xml-view" data-xml-id="${xml.id}">Ver conteudo XML</button>
          <button class="btn secondary" data-action="xml-download-danfse" data-xml-id="${xml.id}">Baixar DANFSE</button>
          <button class="btn primary" data-action="xml-download" data-xml-id="${xml.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderNfeDetailsModalLegacyUnused(nfeId) {
  const doc = findNfeById(nfeId);
  if (!doc) {
    return '';
  }
  const syncEventsDisabled = state.nfeEventsSyncRunning || !canSyncNfeEvents(doc) ? 'disabled' : '';
  const danfeButton = doc.xmlCompletoDisponivel
    ? `<button class="btn secondary" data-action="nfe-download-danfe" data-nfe-id="${doc.id}">Baixar DANFE</button>`
    : '';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1280px);">
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
            ${detailItem('Valor total', formatOptionalCurrency(doc.valor))}
            ${detailItem('Schema', doc.schemaDoc || '-')}
            ${detailItem('Arquivo completo', doc.xmlCompletoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Resumo disponivel', doc.resumoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Status fiscal', doc.statusFiscal || '-')}
            ${detailItem('Resumo de eventos', doc.eventosResumo || '-')}
            ${detailItem('Caminho XML', doc.caminhoServidor || '-')}
          </div>
          ${renderDocumentInsightsSection('nfe', doc)}
          <div style="margin-top:18px;">
            <small style="color:var(--text-secondary); display:block; margin-bottom:8px;">Eventos vinculados</small>
            ${renderXmlEventsList(doc.eventos)}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="nfe-sync-events" data-nfe-id="${doc.id}" ${syncEventsDisabled}>Buscar eventos</button>
          <button class="btn secondary" data-action="nfe-view" data-nfe-id="${doc.id}">Ver conteudo XML</button>
          ${danfeButton}
          <button class="btn primary" data-action="nfe-download" data-nfe-id="${doc.id}">Baixar XML</button>
        </div>
      </div>
    </div>
  `;
}

function renderCteDetailsModalLegacyUnused(cteId) {
  const doc = findCteById(cteId);
  if (!doc) {
    return '';
  }
  const syncEventsDisabled = state.cteEventsSyncRunning || !canSyncCteEvents(doc) ? 'disabled' : '';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1240px);">
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
            ${detailItem('Valor total', formatOptionalCurrency(doc.valor))}
            ${detailItem('Schema', doc.schemaDoc || '-')}
            ${detailItem('Arquivo completo', doc.xmlCompletoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Resumo disponivel', doc.resumoDisponivel ? 'Sim' : 'Nao')}
            ${detailItem('Status fiscal', doc.statusFiscal || '-')}
            ${detailItem('Resumo de eventos', doc.eventosResumo || '-')}
            ${detailItem('Caminho XML', doc.caminhoServidor || '-')}
          </div>
          ${renderDocumentInsightsSection('cte', doc)}
          <div style="margin-top:18px;">
            <small style="color:var(--text-secondary); display:block; margin-bottom:8px;">Eventos vinculados</small>
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

function renderXmlDetailsModalLegacyUnused(xmlId) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    return '';
  }
  const syncEventsDisabled = state.xmlEventsSyncRunning || !canSyncXmlEvents(xml) ? 'disabled' : '';

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(calc(100vw - 24px), 1200px);">
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
          ${renderDocumentInsightsSection('nfse', xml)}
          <div style="margin-top:18px;">
            <small style="color:var(--text-secondary); display:block; margin-bottom:8px;">Eventos vinculados</small>
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

function renderDocumentInsightsSection(documentType, doc) {
  if (documentType === 'nfe') {
    const items = extractNfeLineItems(doc.conteudoXml || '');
    const lineItems = items.map((item) => ({
      numeroNf: doc.numeroNfe || '-',
      statusNf: resolveNfeLineItemStatusLabel(doc),
      dataEmissao: formatDate(doc.dataEmissao),
      produto: item.description || '-',
      quantidadeLabel: formatXmlReader30QuantityValue(item.quantity),
      valorUnitarioLabel: formatXmlReader30UnitValue(item.unitValueRaw || item.unitValue),
      valorTotal: item.totalValue || '-',
      valorTotalNfXml: formatOptionalCurrency(doc.valor),
      icmsStRet: item.icmsStRet || '0',
      cstCsosn: item.cstCsosn || '0',
      cfop: item.cfop || '0',
      baseCalculoIcms: item.baseCalculoIcms || '0',
      aliquotaIcms: item.aliquotaIcms || '0',
      valorIcms: item.valorIcms || '0'
    }));

    return renderDocumentInsightsBlock('Itens da NF-e', renderDocumentInsightsProductsTable(lineItems));
  }

  if (documentType === 'cte') {
    const summary = extractCteServiceSummary(doc.conteudoXml || '');
    const metaCards = [
      detailItem('Produto predominante', summary.productLabel || '-'),
      detailItem('Valor total prestacao', summary.totalValue ? formatCurrency(summary.totalValue) : '-'),
      detailItem('Total de componentes', String(summary.components.length))
    ].join('');
    const table = summary.components.length
      ? renderDocumentInsightsTable(summary.components, [
          { key: 'name', label: 'Componente' },
          { key: 'valueLabel', label: 'Valor' }
        ])
      : renderDocumentInsightsEmpty('Nao encontrei componentes detalhados no XML carregado deste CT-e.');

    return renderDocumentInsightsBlock('Prestacao do CT-e', `<div class="form-grid three" style="margin-bottom:14px;">${metaCards}</div>${table}`);
  }

  const serviceSummary = extractNfseServiceSummary(doc);
  const leituraFiscal = normalizeNfseLeituraFiscal(doc?.leituraFiscal);
  if (leituraFiscal) {
    const cards = [
      detailItem('Layout', mapNfseLeituraLayoutLabel(leituraFiscal.layout)),
      detailItem('Local prestacao', leituraFiscal.localPrestacao || '-'),
      detailItem('Local ISS', leituraFiscal.localIncidenciaIss || '-'),
      detailItem('Retencao ISS', leituraFiscal.retencaoIss || '-'),
      detailItem('Retencao federal', leituraFiscal.retencaoFederal || '-'),
      detailItem('Valor retido total', formatOptionalCurrency(leituraFiscal.valorTotalRetencoes)),
      detailItem('ISS retido real', formatOptionalCurrency(leituraFiscal.valorIssRetidoReal)),
      detailItem('Aliquota ISS', formatOptionalPercentage(leituraFiscal.aliquotaIss)),
      detailItem('Aliquota real ISS', formatOptionalPercentage(leituraFiscal.aliquotaRealIss))
    ].join('');
    const retencoesRows = Array.isArray(leituraFiscal.retencoes)
      ? leituraFiscal.retencoes.map((entry) => ({
          imposto: entry.label || '-',
          valor: entry.amount || 'Detectado no XML'
        }))
      : [];
    const retencoesTable = retencoesRows.length
      ? renderDocumentInsightsTable(retencoesRows, [
          { key: 'imposto', label: 'Retencao' },
          { key: 'valor', label: 'Valor' }
        ])
      : renderDocumentInsightsEmpty('Nenhuma retencao destacada foi encontrada no XML desta NFS-e.');
    const alertBlock =
      leituraFiscal.statusProcessamento === 'Erro'
        ? `<div style="margin-top:14px; padding:12px 14px; border:1px solid var(--warning); border-radius:12px; background:var(--surface-alt); color:var(--warning);">
            <strong>Atencao na leitura:</strong> ${escapeHtml(leituraFiscal.erroProcessamento || 'Inconsistencia detectada no XML.')}
            <div style="margin-top:6px;"><strong>Campos com problema:</strong> ${escapeHtml(
              Array.isArray(leituraFiscal.camposComProblema) && leituraFiscal.camposComProblema.length
                ? leituraFiscal.camposComProblema.join(', ')
                : '-'
            )}</div>
          </div>`
        : '';

    return renderDocumentInsightsBlock(
      'Leitura fiscal da NFS-e',
      `<div class="form-grid three">${cards}</div><div style="margin-top:14px;">${retencoesTable}</div>${alertBlock}`
    );
  }

  const cards = [
    detailItem('Servico', serviceSummary.description || '-'),
    detailItem('Codigo do servico', serviceSummary.serviceCode || '-'),
    detailItem('Valor do servico', serviceSummary.serviceValue ? formatCurrency(serviceSummary.serviceValue) : '-'),
    detailItem('ISS', serviceSummary.issValue ? formatCurrency(serviceSummary.issValue) : '-')
  ].join('');

  return renderDocumentInsightsBlock('Servico destacado', `<div class="form-grid two">${cards}</div>`);
}

function renderNfseRetentionSummarySection(xml, alert = null) {
  const leituraFiscal = normalizeNfseLeituraFiscal(xml?.leituraFiscal);
  const alertRetencoes = Array.isArray(alert?.retencoes) ? alert.retencoes.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
  const leituraRetencoes = Array.isArray(leituraFiscal?.retencoes) ? leituraFiscal.retencoes : [];
  const combinedRetencoes = [...new Set([...alertRetencoes, ...leituraRetencoes.map((entry) => String(entry?.label || '').trim()).filter(Boolean)])];

  if (!combinedRetencoes.length && !leituraFiscal && !alert) {
    return '';
  }

  const cards = [
    detailItem('Retencoes detectadas', combinedRetencoes.length ? combinedRetencoes.join(' • ') : '-'),
    detailItem('Valor retido total', formatOptionalCurrency(leituraFiscal?.valorTotalRetencoes)),
    detailItem('ISS retido real', formatOptionalCurrency(leituraFiscal?.valorIssRetidoReal)),
    detailItem('Retencao federal', leituraFiscal?.retencaoFederal || '-'),
    detailItem('Status do alerta', alert?.status || '-'),
    detailItem('Severidade', alert?.severity || '-')
  ].join('');

  const retencoesRows = leituraRetencoes.length
    ? leituraRetencoes.map((entry) => ({
        imposto: entry.label || '-',
        valor: entry.amount || 'Detectado no XML'
      }))
    : combinedRetencoes.map((label) => ({
        imposto: label,
        valor: 'Detectado no XML'
      }));

  const retencoesTable = retencoesRows.length
    ? renderDocumentInsightsTable(retencoesRows, [
        { key: 'imposto', label: 'Retencao' },
        { key: 'valor', label: 'Valor' }
      ])
    : '';

  const alertSummary = alert
    ? `
        <div style="margin-top:14px; padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt);">
          <div><strong>Resumo do alerta:</strong> ${escapeHtml(alert.descricao || '-')}</div>
          <div style="margin-top:6px;"><strong>Sugestao:</strong> ${escapeHtml(alert.sugestaoAcao || '-')}</div>
        </div>
      `
    : '';

  return renderDocumentInsightsBlock(
    'Resumo das retencoes',
    `<div class="form-grid three">${cards}</div>${retencoesTable ? `<div style="margin-top:14px;">${retencoesTable}</div>` : ''}${alertSummary}`
  );
}

function renderDocumentInsightsBlock(title, content) {
  return `
    <div style="margin-top:18px;">
      <small style="color:var(--text-secondary); display:block; margin-bottom:8px;">${escapeHtml(title)}</small>
      ${content}
    </div>
  `;
}

function renderDocumentInsightsEmpty(message) {
  return `<div style="padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt); color:var(--text-secondary);">${escapeHtml(message)}</div>`;
}

function renderDocumentInsightsProductsTable(rows) {
  const normalizedRows = Array.isArray(rows) ? rows : [];

  if (!normalizedRows.length) {
    return renderDocumentInsightsEmpty('Nao encontrei itens detalhados no XML carregado desta NF-e.');
  }

  const rowsHtml = normalizedRows
    .map((row) => {
      const fullProductLabel = String(row.produto || '-');

      return `
        <tr>
          <td class="document-products-product" title="${escapeHtml(fullProductLabel)}">
            <span class="row-title" title="${escapeHtml(fullProductLabel)}">${escapeHtml(fullProductLabel)}</span>
          </td>
          <td class="document-products-quantity">${escapeHtml(row.quantidadeLabel || row.quantidade || '-')}</td>
          <td class="document-products-money">${escapeHtml(row.valorUnitarioLabel || row.valorUnitario || '-')}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="document-products-shell">
      <div class="document-products-toolbar" aria-hidden="true">
        <span class="document-products-toolbar-icon">${icon('filter')}</span>
      </div>
      <div class="table-wrap document-products-scroll">
        <table class="document-products-table">
          <thead>
            <tr>
              <th class="document-products-col-product">
                <div class="document-products-header-cell">
                  <span>Produto</span>
                  <span class="document-products-column-menu">${icon('more')}</span>
                </div>
              </th>
              <th class="document-products-col-quantity">
                <div class="document-products-header-cell">
                  <span>Quantidade</span>
                  <span class="document-products-column-menu">${icon('more')}</span>
                </div>
              </th>
              <th class="document-products-col-unit">
                <div class="document-products-header-cell">
                  <span>Valor Unitario</span>
                  <span class="document-products-column-menu">${icon('more')}</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDocumentInsightsTable(rows, columns) {
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  ${columns.map((column) => `<td>${escapeHtml(row[column.key] ?? '-')}</td>`).join('')}
                </tr>
              `
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function resolveNfeLineItemStatusLabel(doc) {
  if (doc?.cancelada) {
    return 'Cancelada';
  }

  if (doc?.statusFiscal === 'Autorizada') {
    return 'Ativa';
  }

  return doc?.statusFiscal || '-';
}

function parseXmlDocumentSafe(xmlString) {
  if (!xmlString) {
    return null;
  }

  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(xmlString, 'application/xml');
    if (document.getElementsByTagName('parsererror').length) {
      return null;
    }
    return document;
  } catch (error) {
    return null;
  }
}

function findXmlElementsByLocalName(parent, localName) {
  if (!parent || !localName) {
    return [];
  }

  const withNamespace = typeof parent.getElementsByTagNameNS === 'function' ? Array.from(parent.getElementsByTagNameNS('*', localName) || []) : [];
  if (withNamespace.length) {
    return withNamespace;
  }

  return Array.from(parent.getElementsByTagName(localName) || []);
}

function getXmlText(parent, localName) {
  const node = findXmlElementsByLocalName(parent, localName)[0] || null;
  return String(node?.textContent || '').trim();
}

function getFirstXmlText(parents, localNames) {
  const nodes = (Array.isArray(parents) ? parents : []).filter(Boolean);
  const tags = Array.isArray(localNames) ? localNames : [];

  for (const parent of nodes) {
    for (const localName of tags) {
      const value = getXmlText(parent, localName);
      if (value) {
        return value;
      }
    }
  }

  return '';
}

function extractNfeLineItems(xmlString) {
  const xml = parseXmlDocumentSafe(xmlString);
  if (!xml) {
    return [];
  }

  return findXmlElementsByLocalName(xml, 'det')
    .map((detNode, index) => {
      const prodNode = findXmlElementsByLocalName(detNode, 'prod')[0] || detNode;
      const taxValues = extractNfeLineItemTaxValues(detNode, prodNode);
      const quantity = getXmlText(prodNode, 'qCom');
      const unitValue = getXmlText(prodNode, 'vUnCom');
      const totalValue = getXmlText(prodNode, 'vProd');
      return {
        index: String(index + 1),
        code: getXmlText(prodNode, 'cProd') || '-',
        description: getXmlText(prodNode, 'xProd') || '-',
        quantity: quantity || '-',
        unit: getXmlText(prodNode, 'uCom') || '-',
        unitValue: unitValue ? formatCurrency(unitValue) : '-',
        unitValueRaw: unitValue || '-',
        totalValue: totalValue ? formatCurrency(totalValue) : '-',
        totalValueRaw: totalValue || '-',
        ...taxValues
      };
    })
    .filter((item) => item.description !== '-' || item.code !== '-');
}

function extractNfeLineItemTaxValues(detNode, prodNode) {
  const impostoNode = findXmlElementsByLocalName(detNode, 'imposto')[0] || detNode;
  const icmsNode = findXmlElementsByLocalName(impostoNode, 'ICMS')[0] || null;
  const icmsGroupNode = icmsNode
    ? Array.from(icmsNode.children || []).find((node) => node && node.nodeType === 1) || null
    : null;
  const icmsSourceNodes = [icmsGroupNode, icmsNode, impostoNode, detNode, prodNode].filter(Boolean);
  const cstCsosn = getFirstXmlText(icmsSourceNodes, ['CST', 'CSOSN']) || '0';
  const icmsStRet = getFirstXmlText(icmsSourceNodes, ['vICMSSTRet', 'vICMSST', 'vBCSTRet']) || '0';
  const qBCMonoRet = getFirstXmlText(icmsSourceNodes, ['qBCMonoRet']) || '0';
  const adRemICMSRet = getFirstXmlText(icmsSourceNodes, ['adRemICMSRet']) || '0';
  const vICMSMonoRet = getFirstXmlText(icmsSourceNodes, ['vICMSMonoRet']) || '0';
  const baseCalculoIcms = getFirstXmlText(icmsSourceNodes, ['vBC', 'vBCST', 'vBCSTRet', 'vBCUFDest']) || '0';
  const aliquotaIcms = getFirstXmlText(icmsSourceNodes, ['pICMS', 'pST', 'pICMSST', 'pICMSInter', 'pICMSInterPart']) || '0';
  const valorIcms = getFirstXmlText(icmsSourceNodes, ['vICMS', 'vICMSST', 'vICMSDif', 'vICMSDeson']) || '0';

  return {
    cstCsosn,
    cfop: getFirstXmlText([prodNode, icmsGroupNode, icmsNode, impostoNode, detNode], ['CFOP']) || '0',
    icmsStRet: formatXmlReader30CurrencyValue(icmsStRet),
    icmsStRetRaw: icmsStRet || '0',
    qBCMonoRet: formatXmlReader30DecimalValue(qBCMonoRet),
    qBCMonoRetRaw: qBCMonoRet || '0',
    adRemICMSRet: formatXmlReader30DecimalValue(adRemICMSRet),
    adRemICMSRetRaw: adRemICMSRet || '0',
    vICMSMonoRet: formatXmlReader30CurrencyValue(vICMSMonoRet),
    vICMSMonoRetRaw: vICMSMonoRet || '0',
    baseCalculoIcms: formatXmlReader30DecimalValue(baseCalculoIcms),
    baseCalculoIcmsRaw: baseCalculoIcms || '0',
    aliquotaIcms: formatXmlReader30DecimalValue(aliquotaIcms),
    aliquotaIcmsRaw: aliquotaIcms || '0',
    valorIcms: formatXmlReader30DecimalValue(valorIcms),
    valorIcmsRaw: valorIcms || '0'
  };
}

function extractCteServiceSummary(xmlString) {
  const xml = parseXmlDocumentSafe(xmlString);
  if (!xml) {
    return {
      productLabel: '',
      totalValue: null,
      components: []
    };
  }

  const components = findXmlElementsByLocalName(xml, 'Comp')
    .map((componentNode) => {
      const value = getXmlText(componentNode, 'vComp');
      return {
        name: getXmlText(componentNode, 'xNome') || '-',
        valueLabel: value ? formatCurrency(value) : '-'
      };
    })
    .filter((item) => item.name !== '-');

  return {
    productLabel: getXmlText(xml, 'xProd') || '',
    totalValue: toNumber(getXmlText(xml, 'vTPrest') || ''),
    components
  };
}

function extractNfseServiceSummary(doc) {
  return {
    description: String(doc?.descricaoServico || '').trim(),
    serviceCode: String(doc?.codigoServicoPrestado || '').trim(),
    serviceValue: toNumber(doc?.valor),
    issValue: toNumber(doc?.iss)
  };
}

function normalizeNfseLeituraFiscal(leituraFiscal) {
  if (!leituraFiscal || typeof leituraFiscal !== 'object') {
    return null;
  }

  return {
    layout: String(leituraFiscal.layout || '').trim(),
    localPrestacao: String(leituraFiscal.localPrestacao || '').trim(),
    localIncidenciaIss: String(leituraFiscal.localIncidenciaIss || '').trim(),
    valorTotalRetencoes: leituraFiscal.valorTotalRetencoes ?? '',
    valorIssRetidoReal: leituraFiscal.valorIssRetidoReal ?? '',
    aliquotaIss: leituraFiscal.aliquotaIss ?? '',
    aliquotaRealIss: leituraFiscal.aliquotaRealIss ?? '',
    retencaoIss: String(leituraFiscal.retencaoIss || '').trim(),
    retencaoFederal: String(leituraFiscal.retencaoFederal || '').trim(),
    erroProcessamento: String(leituraFiscal.erroProcessamento || '').trim(),
    statusProcessamento: String(leituraFiscal.statusProcessamento || '').trim(),
    camposComProblema: Array.isArray(leituraFiscal.camposComProblema)
      ? leituraFiscal.camposComProblema.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    retencoes: Array.isArray(leituraFiscal.retencoes)
      ? leituraFiscal.retencoes.map((entry) => ({
          label: String(entry?.label || '').trim(),
          amount: String(entry?.amount || '').trim()
        }))
      : []
  };
}

function mapNfseLeituraLayoutLabel(layout) {
  if (layout === 'padrao_nacional') {
    return 'Padrao nacional';
  }
  if (layout === 'abrasf') {
    return 'ABRASF';
  }
  return layout || '-';
}

function formatOptionalPercentage(value) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return String(value);
  }
  return `${parsed.toFixed(2)}%`;
}

function renderCteDisagreementAlertsModal() {
  const alerts = getCteDisagreementAlerts();
  const openAlerts = alerts.filter((alert) => alert.status !== 'Resolvido');
  const resolvedAlerts = alerts.filter((alert) => alert.status === 'Resolvido');

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(1100px, calc(100vw - 24px));">
        <div class="modal-header">
          <h3 class="modal-title">Alertas de desacordo de CT-e</h3>
          <p class="modal-subtitle">Acompanhe CT-es que receberam evento de desacordo e marque como resolvido quando o tratamento operacional for concluido.</p>
        </div>
        <div class="modal-body">
          <div class="form-grid four" style="margin-bottom:18px;">
            ${detailItem('Total', String(alerts.length))}
            ${detailItem('Em aberto', String(openAlerts.length))}
            ${detailItem('Resolvidos', String(resolvedAlerts.length))}
            ${detailItem('Empresas afetadas', String(new Set(openAlerts.map((alert) => alert.clientId).filter(Boolean)).size))}
          </div>
          ${
            alerts.length
              ? `<div style="display:grid; gap:14px;">
                  ${alerts
                    .map(
                      (alert) => `
                        <article class="dashboard-alert-overlay-card ${alert.status === 'Resolvido' ? 'resolved' : 'open'}">
                          <div class="dashboard-alert-overlay-main">
                            <div class="dashboard-alert-overlay-icon">${icon('alert')}</div>
                            <div style="min-width:0;">
                              <div class="dashboard-alert-overlay-header">
                                <div>
                                  <h4 class="dashboard-alert-overlay-title">${escapeHtml(alert.titulo)}</h4>
                                  <p class="dashboard-alert-overlay-subtitle">${escapeHtml(alert.descricao)}</p>
                                </div>
                                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
                                  ${statusBadge(alert.status, toneFromAlertStatus(alert.status))}
                                  ${statusBadge(alert.severity, toneFromSeverity(alert.severity))}
                                </div>
                              </div>
                              <div class="dashboard-alert-overlay-meta">
                                <span><strong>Cliente:</strong> ${escapeHtml(alert.cliente)}</span>
                                <span><strong>Data:</strong> ${escapeHtml(formatDateTime(alert.dataHora))}</span>
                              </div>
                              <div class="dashboard-alert-overlay-meta">
                                <span><strong>CT-e:</strong> ${escapeHtml(alert.numeroDocumento || alert.chaveAcesso || '-')}</span>
                                <span><strong>Chave:</strong> ${escapeHtml(alert.chaveAcesso || '-')}</span>
                              </div>
                              <div class="table-actions" style="margin-top:12px;">
                                <button class="btn secondary" type="button" data-action="alert-details" data-alert-id="${escapeHtml(alert.id)}">Ver detalhes</button>
                                <button class="btn secondary" type="button" data-action="alert-open-document" data-alert-id="${escapeHtml(alert.id)}">Ver CT-e</button>
                                ${
                                  alert.status === 'Resolvido'
                                    ? `<button class="btn primary" type="button" data-action="alert-unresolve" data-alert-id="${escapeHtml(alert.id)}">Reabrir alerta</button>`
                                    : `<button class="btn primary" type="button" data-action="alert-resolve" data-alert-id="${escapeHtml(alert.id)}">Marcar como resolvido</button>`
                                }
                              </div>
                            </div>
                          </div>
                        </article>
                      `
                    )
                    .join('')}
                </div>`
              : '<div class="table-state">Nenhum alerta de desacordo de CT-e encontrado.</div>'
          }
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">Fechar</button>
        </div>
      </div>
    </div>
  `;
}

function renderNfseFiscalReaderResumoMunicipioTable(titulo, linhas) {
  const items = Array.isArray(linhas) ? linhas : [];
  if (!items.length) {
    return `
      <div class="card" style="padding:14px; border:1px solid var(--line); border-radius:14px;">
        <h4 class="card-title" style="margin-bottom:8px;">${escapeHtml(titulo)}</h4>
        <div class="table-state">Sem dados para somar.</div>
      </div>
    `;
  }

  const totalNotas = items.reduce((acc, item) => acc + Number(item.quantidadeNotas || 0), 0);
  const totalValorServico = items.reduce((acc, item) => acc + Number(item.valorServicoTotal || 0), 0);

  return `
    <div class="card" style="padding:14px; border:1px solid var(--line); border-radius:14px;">
      <h4 class="card-title" style="margin-bottom:8px;">${escapeHtml(titulo)}</h4>
      <div style="overflow:auto; max-height:320px; border:1px solid var(--line); border-radius:10px;">
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="background:var(--surface-alt); text-align:left;">
              <th style="padding:8px 10px; border-bottom:1px solid var(--line);">Municipio</th>
              <th style="padding:8px 10px; border-bottom:1px solid var(--line); text-align:right;">Notas</th>
              <th style="padding:8px 10px; border-bottom:1px solid var(--line); text-align:right;">Valor servico</th>
              <th style="padding:8px 10px; border-bottom:1px solid var(--line); text-align:right;">Valor liquido</th>
              <th style="padding:8px 10px; border-bottom:1px solid var(--line); text-align:right;">ISS</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (item) => `
                  <tr style="border-bottom:1px solid var(--line);">
                    <td style="padding:8px 10px;">${escapeHtml(item.municipio)}</td>
                    <td style="padding:8px 10px; text-align:right;">${escapeHtml(String(item.quantidadeNotas || 0))}</td>
                    <td style="padding:8px 10px; text-align:right;">${escapeHtml(formatOptionalCurrency(item.valorServicoTotal))}</td>
                    <td style="padding:8px 10px; text-align:right;">${escapeHtml(formatOptionalCurrency(item.valorLiquidoTotal))}</td>
                    <td style="padding:8px 10px; text-align:right;">${escapeHtml(formatOptionalCurrency(item.valorIssTotal))}</td>
                  </tr>
                `
              )
              .join('')}
          </tbody>
          <tfoot>
            <tr style="background:var(--surface-alt); font-weight:600;">
              <td style="padding:8px 10px;">Total (${escapeHtml(String(items.length))} municipio${items.length > 1 ? 's' : ''})</td>
              <td style="padding:8px 10px; text-align:right;">${escapeHtml(String(totalNotas))}</td>
              <td style="padding:8px 10px; text-align:right;">${escapeHtml(formatOptionalCurrency(totalValorServico))}</td>
              <td style="padding:8px 10px;"></td>
              <td style="padding:8px 10px;"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

function renderNfseFiscalReaderCard() {
  if (!state.xmlSearch.hasSearched) {
    return '';
  }

  const summary = state.nfseFiscalReader.summary;
  const rows = sortNfseFiscalReaderRows(Array.isArray(state.nfseFiscalReader.rows) ? state.nfseFiscalReader.rows : []);
  const exportableRows = getNfseFiscalReaderExportableRows(rows);
  const exportConfig = state.nfseFiscalReader.exportConfig || {};
  const visibleColumns = getNfseFiscalReaderVisibleColumns();
  const hiddenColumns = state.nfseFiscalReader.hiddenColumns instanceof Set ? state.nfseFiscalReader.hiddenColumns : new Set();
  const hiddenCount = hiddenColumns.size;
  const minWidth = Math.max(1480, visibleColumns.length * 138);
  const tipoRegistro = String(exportConfig.tipoRegistro || 'Entrada') === 'Servico' ? 'Servico' : 'Entrada';
  const contas = String(exportConfig.contas || 'Padrao') === 'PorFornecedor' ? 'PorFornecedor' : 'Padrao';
  const clienteIdAtual = state.filters.xmls.cliente && state.filters.xmls.cliente !== 'Todos' ? state.filters.xmls.cliente : '';
  const clienteAtual = clienteIdAtual ? findClientById(clienteIdAtual) : null;
  const codigoEmpresaCadastrado =
    clienteAtual?.codigoEmpresaDominio != null && clienteAtual.codigoEmpresaDominio !== '' ? String(clienteAtual.codigoEmpresaDominio) : '';
  const codigoEmpresaValue = codigoEmpresaCadastrado || String(exportConfig.codigoEmpresa || '');
  const exportDisabled =
    !exportableRows.length ||
    state.tableState.nfseFiscalReader === 'loading' ||
    state.tableState.nfseFiscalReader === 'error' ||
    exportConfig.exporting;
  const summaryCards = summary
    ? `
      <div class="form-grid six" style="margin-bottom:18px;">
        ${detailItem('Filtradas', String(summary.totalDocumentosFiltrados || 0))}
        ${detailItem('Lidas', String(summary.totalDocumentosLidos || 0))}
        ${detailItem('Com erro', String(summary.totalDocumentosComErro || 0))}
        ${detailItem('Sem XML', String(summary.totalDocumentosSemXml || 0))}
        ${detailItem('Valor servico', formatOptionalCurrency(summary.valorServicoTotal))}
        ${detailItem('ISS retido real', formatOptionalCurrency(summary.valorIssRetidoRealTotal))}
      </div>
      <div class="form-grid four" style="margin-bottom:18px;">
        ${detailItem('Valor liquido', formatOptionalCurrency(summary.valorLiquidoTotal))}
        ${detailItem('Valor retido', formatOptionalCurrency(summary.valorRetidoTotal))}
        ${detailItem('ISS total', formatOptionalCurrency(summary.valorIssTotal))}
        ${detailItem('Retencoes federais', formatOptionalCurrency(summary.totalRetencoesFederais))}
      </div>
    `
    : '';
  const resumoPorMunicipio = state.nfseFiscalReader.resumoPorMunicipio || null;
  const resumoPorMunicipioHtml =
    resumoPorMunicipio && (resumoPorMunicipio.localPrestacao.length || resumoPorMunicipio.localIncidenciaIss.length)
      ? `
      <div class="form-grid two" style="margin-top:18px; align-items:start;">
        ${renderNfseFiscalReaderResumoMunicipioTable('Somatorio por municipio - Local prestacao', resumoPorMunicipio.localPrestacao)}
        ${renderNfseFiscalReaderResumoMunicipioTable('Somatorio por municipio - Local ISS', resumoPorMunicipio.localIncidenciaIss)}
      </div>
    `
      : '';
  const exportForm = `
    <form id="nfseFiscalDominioExportForm" class="form-grid four" style="margin:0 0 18px;">
      <label class="field">
        Codigo empresa Dominio
        <input
          name="codigoEmpresa"
          type="number"
          min="0"
          step="1"
          value="${escapeHtml(codigoEmpresaValue)}"
          placeholder="Ex.: 10105"
          required
        />
        ${
          codigoEmpresaCadastrado
            ? '<span style="color:var(--text-secondary); font-size:12px;">Preenchido automaticamente a partir do cadastro do cliente.</span>'
            : '<span style="color:var(--text-secondary); font-size:12px;">Cliente sem codigo cadastrado; informe manualmente ou cadastre em Clientes.</span>'
        }
      </label>
      <label class="field">
        Tipo de registro
        <select name="tipoRegistro">${renderOptions(['Entrada', 'Servico'], tipoRegistro, { Entrada: 'Entrada', Servico: 'Serviço' })}</select>
      </label>
      <label class="field">
        Contas
        <select name="contas" ${tipoRegistro !== 'Entrada' ? 'disabled' : ''}>${renderOptions(['Padrao', 'PorFornecedor'], contas, { Padrao: 'Padrao', PorFornecedor: 'Por Fornecedor' })}</select>
      </label>
      <label class="field">
        Produto padrao
        <input name="produtoPadrao" type="number" min="1" step="1" value="${escapeHtml(String(exportConfig.produtoPadrao || '557'))}" required />
      </label>
      <div class="stack-actions" style="grid-column:1 / -1; justify-content:flex-start; align-items:flex-end;">
        <button class="btn primary" type="submit" ${exportDisabled ? 'disabled' : ''}>
          ${exportConfig.exporting ? 'Exportando layout Dominio...' : 'Exportar layout Dominio'}
        </button>
        <button
          class="btn secondary"
          type="button"
          data-action="nfse-open-conta-contabil-config"
          data-client-id="${escapeHtml(clienteIdAtual)}"
          ${clienteIdAtual ? '' : 'disabled'}
        >
          Gerenciar contas por codigo de servico
        </button>
        <span style="color:var(--text-secondary); font-size:13px;">
          ${
            rows.length
              ? `O arquivo segue o padrao do LeitorXML para NFS-e e ignora automaticamente ${escapeHtml(String(rows.length - exportableRows.length))} nota(s) cancelada(s).`
              : 'Busque NFS-e com XML valido para habilitar a exportacao.'
          }
        </span>
      </div>
    </form>
  `;

  return `
    <article class="card">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div>
          <h3 class="card-title">Leitura fiscal das NFS-e filtradas</h3>
          <p class="card-subtitle">Tabela consolidada no estilo do LeitorXML, usando exatamente as NFS-e retornadas pelos filtros atuais. Arraste os cabecalhos para reorganizar e oculte colunas quando precisar focar na conferencia.</p>
        </div>
        <div class="stack-mini" style="align-items:flex-end;">
          <div class="progress-meta">
            <span>Atualizado: <strong>${escapeHtml(formatDateTime(state.nfseFiscalReader.lastLoadedAt || new Date().toISOString()))}</strong></span>
            <span>Linhas: <strong>${escapeHtml(String(rows.length))}</strong></span>
            <span>Colunas visiveis: <strong>${escapeHtml(String(visibleColumns.length))}</strong></span>
          </div>
          <div class="table-actions" style="justify-content:flex-end;">
            <button class="btn secondary" type="button" data-action="nfse-fiscal-show-all-columns" ${hiddenCount ? '' : 'disabled'}>
              Restaurar colunas${hiddenCount ? ` (${escapeHtml(String(hiddenCount))})` : ''}
            </button>
          </div>
        </div>
      </div>
      ${summaryCards}
      ${exportForm}
      <div class="table-wrap nfse-fiscal-reader-scroll">
        <table class="xml-reader30-table xml-reader30-reorderable-table nfse-fiscal-reader-table" style="min-width:${minWidth}px;">
          <thead>
            <tr>
              ${visibleColumns
                .map(
                  (column, index) => `
                    <th
                      class="xml-reader30-column-header"
                      data-action="nfse-fiscal-column-drag"
                      data-column-key="${escapeHtml(column.key)}"
                      data-column-index="${index}"
                      draggable="true"
                      title="Arraste para mover esta coluna"
                    >
                      <div class="xml-reader30-column-header-inner">
                        <span class="xml-reader30-column-title">${renderNfseFiscalReaderSortHeader(column.key, column.label)}</span>
                        <div class="xml-reader30-column-menu-wrap" data-nfse-fiscal-column-menu-wrap>
                          <button
                            class="xml-reader30-column-menu"
                            type="button"
                            data-action="nfse-fiscal-column-menu-toggle"
                            data-column-key="${escapeHtml(column.key)}"
                            aria-expanded="${state.nfseFiscalReader.columnMenuOpenKey === column.key ? 'true' : 'false'}"
                            aria-label="Abrir menu da coluna ${escapeHtml(column.label)}"
                            title="Abrir menu"
                          >&#8942;</button>
                          ${
                            state.nfseFiscalReader.columnMenuOpenKey === column.key
                              ? `
                                <div
                                  class="xml-reader30-column-menu-panel"
                                  role="menu"
                                  aria-label="Menu da coluna ${escapeHtml(column.label)}"
                                  style="top:${escapeHtml(String(state.nfseFiscalReader.columnMenuAnchor?.top ?? 8))}px; left:${escapeHtml(String(state.nfseFiscalReader.columnMenuAnchor?.left ?? 8))}px;"
                                >
                                  <button
                                    type="button"
                                    class="xml-reader30-column-menu-item"
                                    data-action="nfse-fiscal-column-menu-hide"
                                    data-column-key="${escapeHtml(column.key)}"
                                    role="menuitem"
                                    ${visibleColumns.length <= 1 ? 'disabled' : ''}
                                  >Ocultar coluna</button>
                                </div>
                              `
                              : ''
                          }
                        </div>
                      </div>
                    </th>
                  `
                )
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${renderTableRowsOrState({
              key: 'nfseFiscalReader',
              colSpan: visibleColumns.length,
              rowsHtml: rows
                .map(
                  (row) =>
                    `<tr class="${row.cancelada ? 'xml-row-cancelled' : ''}">${visibleColumns
                      .map((column) => renderNfseFiscalReaderColumnCell(column, row))
                      .join('')}</tr>`
                )
                .join(''),
              emptyMessage: 'Nenhuma NFS-e armazenada foi processada para a leitura fiscal com os filtros atuais.'
            })}
          </tbody>
        </table>
      </div>
      ${resumoPorMunicipioHtml}
    </article>
  `;
}

function getNfseFiscalReaderExportableRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => !row?.cancelada);
}

function getNfseFiscalReaderOrderedColumns() {
  const order = normalizeNfseFiscalReaderColumnOrder(state.nfseFiscalReader.columnOrder);
  const currentOrder = Array.isArray(state.nfseFiscalReader.columnOrder) ? state.nfseFiscalReader.columnOrder : [];
  if (order.join('|') !== currentOrder.join('|')) {
    state.nfseFiscalReader.columnOrder = order;
  }

  const definitions = getNfseFiscalReaderColumnDefinitions();
  const byKey = new Map(definitions.map((column) => [column.key, column]));
  return order.map((key) => byKey.get(key)).filter(Boolean);
}

function getNfseFiscalReaderVisibleColumns() {
  const hiddenColumns = state.nfseFiscalReader.hiddenColumns instanceof Set ? state.nfseFiscalReader.hiddenColumns : new Set();
  return getNfseFiscalReaderOrderedColumns().filter((column) => !hiddenColumns.has(column.key));
}

function getNfseFiscalReaderColumnDefinitions() {
  return [
    {
      key: 'numeroNfse',
      label: 'Numero',
      className: 'nfse-fiscal-reader-number',
      html: false,
      render: (row) => row.numeroNfse || '-'
    },
    {
      key: 'localPrestacao',
      label: 'Local prestacao',
      className: 'nfse-fiscal-reader-place',
      html: false,
      render: (row) => row.localPrestacao || row.municipio || '-'
    },
    {
      key: 'localIncidenciaIss',
      label: 'Local ISS',
      className: 'nfse-fiscal-reader-place',
      html: false,
      render: (row) => row.localIncidenciaIss || row.municipio || '-'
    },
    {
      key: 'prestador',
      label: 'Prestador',
      className: 'nfse-fiscal-reader-party',
      html: false,
      render: (row) => row.prestador || '-'
    },
    {
      key: 'cnpjPrestador',
      label: 'CNPJ prestador',
      className: 'nfse-fiscal-reader-cnpj',
      html: false,
      render: (row) => formatCnpj(row.cnpjPrestador || '') || '-'
    },
    {
      key: 'tomador',
      label: 'Tomador',
      className: 'nfse-fiscal-reader-party',
      html: false,
      render: (row) => row.tomador || '-'
    },
    {
      key: 'cnpjTomador',
      label: 'CNPJ tomador',
      className: 'nfse-fiscal-reader-cnpj',
      html: false,
      render: (row) => formatCnpj(row.cnpjTomador || '') || '-'
    },
    {
      key: 'valorLiquidoNfse',
      label: 'Valor liquido',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorLiquidoNfse)
    },
    {
      key: 'valorTotalRetencoes',
      label: 'Valor retido',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorTotalRetencoes)
    },
    {
      key: 'valorServico',
      label: 'Valor servico',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorServico)
    },
    {
      key: 'valorIss',
      label: 'ISS',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorIss)
    },
    {
      key: 'valorPis',
      label: 'PIS',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorPis)
    },
    {
      key: 'valorCofins',
      label: 'COFINS',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorCofins)
    },
    {
      key: 'valorInss',
      label: 'INSS',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorInss)
    },
    {
      key: 'valorIrrf',
      label: 'IRRF',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorIrrf)
    },
    {
      key: 'valorCsll',
      label: 'CSLL',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorCsll)
    },
    {
      key: 'dataEmissao',
      label: 'Data emissao',
      className: 'xml-reader30-date nfse-fiscal-reader-date',
      html: false,
      render: (row) => formatDate(row.dataEmissao)
    },
    {
      key: 'retencaoIss',
      label: 'ISS RET',
      className: 'nfse-fiscal-reader-flag',
      html: false,
      render: (row) => row.retencaoIss || '-'
    },
    {
      key: 'retencaoFederal',
      label: 'Federal RET',
      className: 'nfse-fiscal-reader-flag',
      html: false,
      render: (row) => row.retencaoFederal || '-'
    },
    {
      key: 'aliquotaIss',
      label: 'Aliq ISS',
      className: 'nfse-fiscal-reader-rate',
      html: false,
      render: (row) => formatOptionalPercentage(row.aliquotaIss)
    },
    {
      key: 'valorIssRetidoReal',
      label: 'ISS retido real',
      className: 'xml-reader30-money',
      html: false,
      render: (row) => formatOptionalCurrency(row.valorIssRetidoReal)
    },
    {
      key: 'aliquotaRealIss',
      label: 'Aliq real ISS',
      className: 'nfse-fiscal-reader-rate',
      html: false,
      render: (row) => formatOptionalPercentage(row.aliquotaRealIss)
    },
    {
      key: 'statusProcessamento',
      label: 'Status',
      className: 'nfse-fiscal-reader-status',
      html: true,
      render: (row) => statusBadge(
        row.statusProcessamento || '-',
        row.statusProcessamento === 'OK'
          ? 'success'
          : row.statusProcessamento === 'ERRO'
            ? 'danger'
            : 'warning'
      )
    },
    {
      key: 'erroProcessamento',
      label: 'Erro',
      className: 'nfse-fiscal-reader-error',
      html: false,
      render: (row) => row.erroProcessamento || (Array.isArray(row.camposComProblema) && row.camposComProblema.length ? row.camposComProblema.join(', ') : '-') || '-'
    }
  ];
}

function renderNfseFiscalReaderColumnCell(column, row) {
  const value = column.render(row);
  if (column.html) {
    return `<td class="${escapeHtml(column.className || '')}">${value}</td>`;
  }

  return `<td class="${escapeHtml(column.className || '')}">${escapeHtml(String(value ?? '-'))}</td>`;
}

function hideNfseFiscalReaderColumn(columnKey) {
  const normalizedKey = String(columnKey || '').trim();
  if (!normalizedKey || getNfseFiscalReaderVisibleColumns().length <= 1) {
    closeNfseFiscalReaderColumnMenu();
    renderPreservingScroll(['.nfse-fiscal-reader-scroll']);
    return;
  }

  const nextHidden = state.nfseFiscalReader.hiddenColumns instanceof Set
    ? new Set(state.nfseFiscalReader.hiddenColumns)
    : new Set();
  nextHidden.add(normalizedKey);
  state.nfseFiscalReader.hiddenColumns = nextHidden;
  closeNfseFiscalReaderColumnMenu();
  renderPreservingScroll(['.nfse-fiscal-reader-scroll']);
}

function restoreAllNfseFiscalReaderColumns() {
  state.nfseFiscalReader.hiddenColumns = new Set();
  closeNfseFiscalReaderColumnMenu();
  renderPreservingScroll(['.nfse-fiscal-reader-scroll']);
}

function toggleNfseFiscalReaderColumnMenu(columnKey, anchorNode) {
  const normalizedKey = String(columnKey || '').trim();
  if (!normalizedKey) {
    return;
  }

  if (state.nfseFiscalReader.columnMenuOpenKey === normalizedKey) {
    closeNfseFiscalReaderColumnMenu();
    renderPreservingScroll(['.nfse-fiscal-reader-scroll']);
    return;
  }

  const rect = anchorNode instanceof HTMLElement ? anchorNode.getBoundingClientRect() : null;
  if (rect) {
    const estimatedWidth = 164;
    const left = Math.min(window.innerWidth - estimatedWidth - 8, Math.max(8, rect.right - estimatedWidth));
    const top = Math.min(window.innerHeight - 12, rect.bottom + 6);
    state.nfseFiscalReader.columnMenuAnchor = {
      left,
      top
    };
  } else {
    state.nfseFiscalReader.columnMenuAnchor = {
      left: 8,
      top: 8
    };
  }

  state.nfseFiscalReader.columnMenuOpenKey = normalizedKey;
  renderPreservingScroll(['.nfse-fiscal-reader-scroll']);
}

function closeNfseFiscalReaderColumnMenu() {
  if (!state.nfseFiscalReader.columnMenuOpenKey) {
    return;
  }

  state.nfseFiscalReader.columnMenuOpenKey = null;
  state.nfseFiscalReader.columnMenuAnchor = null;
}

function normalizeNfseFiscalReaderColumnOrder(columnOrder) {
  const seen = new Set();
  const normalized = [];

  (Array.isArray(columnOrder) ? columnOrder : []).forEach((key) => {
    const columnKey = String(key || '').trim();
    if (!columnKey || seen.has(columnKey) || !NFSE_FISCAL_READER_DEFAULT_COLUMN_ORDER.includes(columnKey)) {
      return;
    }
    seen.add(columnKey);
    normalized.push(columnKey);
  });

  NFSE_FISCAL_READER_DEFAULT_COLUMN_ORDER.forEach((key) => {
    if (!seen.has(key)) {
      normalized.push(key);
    }
  });

  return normalized;
}

function moveNfseFiscalReaderColumn(columnOrder, sourceKey, targetKey, insertAfter) {
  const normalized = normalizeNfseFiscalReaderColumnOrder(columnOrder);
  const filtered = normalized.filter((key) => key !== sourceKey);
  const targetIndex = filtered.indexOf(targetKey);
  if (targetIndex < 0) {
    return normalized;
  }

  const nextIndex = insertAfter ? targetIndex + 1 : targetIndex;
  filtered.splice(nextIndex, 0, sourceKey);
  return normalizeNfseFiscalReaderColumnOrder(filtered);
}

function renderNfseRetentionAlertsModal() {
  const companyId = state.modal?.kind === 'nfse-retention-alerts' ? String(state.modal.empresaId || '') : '';
  const alerts = getFilteredNfseRetentionAlerts(companyId);
  const openAlerts = alerts.filter((alert) => alert.status !== 'Resolvido');
  const resolvedAlerts = alerts.filter((alert) => alert.status === 'Resolvido');
  const availableClientIds = [...new Set(getNfseRetentionAlerts().map((alert) => String(alert?.clientId || '').trim()).filter(Boolean))];

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal" role="dialog" aria-modal="true" style="width:min(1100px, calc(100vw - 24px));">
        <div class="modal-header">
          <h3 class="modal-title">Alertas de NFS-e com retencao</h3>
          <p class="modal-subtitle">Acompanhe NFS-es tomadas com retencoes detectadas no XML e marque como resolvido quando a conferencia fiscal for concluida.</p>
        </div>
        <div class="modal-body">
          <div class="form-grid" style="margin-bottom:18px;">
            <label class="field">
              Empresa
              <select data-action="nfse-retention-company-filter">
                ${renderOptions(availableClientIds, companyId, mapClientOptions(), 'Selecione uma empresa')}
              </select>
            </label>
          </div>
          ${
            companyId
              ? `
                <div class="table-actions" style="margin:0 0 18px;">
                  <button
                    class="btn secondary"
                    type="button"
                    data-action="nfse-retention-resolve-company"
                    data-company-id="${escapeHtml(companyId)}"
                    ${openAlerts.length ? '' : 'disabled'}
                  >
                    Marcar todas da empresa como resolvido
                  </button>
                </div>
              `
              : ''
          }
          <div class="form-grid four" style="margin-bottom:18px;">
            ${detailItem('Total', String(alerts.length))}
            ${detailItem('Em aberto', String(openAlerts.length))}
            ${detailItem('Resolvidos', String(resolvedAlerts.length))}
            ${detailItem('Empresas afetadas', String(new Set(openAlerts.map((alert) => alert.clientId).filter(Boolean)).size))}
          </div>
          ${
            alerts.length
              ? `<div style="display:grid; gap:14px;">
                  ${alerts
                    .map(
                      (alert) => `
                        <article class="dashboard-alert-overlay-card ${alert.status === 'Resolvido' ? 'resolved' : 'open'}">
                          <div class="dashboard-alert-overlay-main">
                            <div class="dashboard-alert-overlay-icon">${icon('alert')}</div>
                            <div style="min-width:0;">
                              <div class="dashboard-alert-overlay-header">
                                <div>
                                  <h4 class="dashboard-alert-overlay-title">${escapeHtml(alert.titulo)}</h4>
                                  <p class="dashboard-alert-overlay-subtitle">${escapeHtml(alert.descricao)}</p>
                                </div>
                                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end;">
                                  ${statusBadge(alert.status, toneFromAlertStatus(alert.status))}
                                  ${statusBadge(alert.severity, toneFromSeverity(alert.severity))}
                                </div>
                              </div>
                              <div class="dashboard-alert-overlay-meta">
                                <span><strong>Cliente:</strong> ${escapeHtml(alert.cliente)}</span>
                                <span><strong>Data:</strong> ${escapeHtml(formatDateTime(alert.dataHora))}</span>
                              </div>
                              <div class="dashboard-alert-overlay-meta">
                                <span><strong>NFS-e:</strong> ${escapeHtml(alert.numeroDocumento || alert.chaveAcesso || '-')}</span>
                                <span><strong>Emissor:</strong> ${escapeHtml(alert.emissor || '-')}</span>
                              </div>
                              <div class="dashboard-alert-overlay-meta">
                                <span><strong>Retencoes:</strong> ${escapeHtml(alert.retencoes?.length ? alert.retencoes.join(' • ') : '-')}</span>
                              </div>
                              <div class="table-actions" style="margin-top:12px;">
                                <button class="btn secondary" type="button" data-action="alert-details" data-alert-id="${escapeHtml(alert.id)}">Ver detalhes</button>
                                <button class="btn secondary" type="button" data-action="alert-open-document" data-alert-id="${escapeHtml(alert.id)}">Ver NFS-e</button>
                                ${
                                  alert.status === 'Resolvido'
                                    ? `<button class="btn primary" type="button" data-action="alert-unresolve" data-alert-id="${escapeHtml(alert.id)}">Reabrir alerta</button>`
                                    : `<button class="btn primary" type="button" data-action="alert-resolve" data-alert-id="${escapeHtml(alert.id)}">Marcar como resolvido</button>`
                                }
                              </div>
                            </div>
                          </div>
                        </article>
                      `
                    )
                    .join('')}
                </div>`
              : '<div class="table-state">Nenhuma NFS-e com retencao encontrada para a empresa selecionada.</div>'
          }
        </div>
        <div class="modal-footer">
          <button class="btn secondary" data-action="close-modal">Fechar</button>
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
  const closeLabel = getModalCloseActionLabel(state.modal);

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
          <button class="btn secondary" data-action="close-modal">${escapeHtml(closeLabel)}</button>
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
                ${detailItem('Documento', renderAlertDocumentLine(alert))}
                ${detailItem('Emissor', alert.emissor || '-')}
                ${detailItem('Retencoes', alert.retencoes?.length ? alert.retencoes.join(' • ') : '-')}
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
                ${hasAlertDocumentAction(alert) ? `<button class="btn secondary" type="button" data-action="alert-open-document" data-alert-id="${alert.id}">${renderAlertOpenDocumentLabel(alert)}</button>` : ''}
                ${
                  alert.status === 'Resolvido'
                    ? `<button class="btn secondary" type="button" data-action="alert-unresolve" data-alert-id="${alert.id}">Reabrir alerta</button>`
                    : `<button class="btn secondary" type="button" data-action="alert-resolve" data-alert-id="${alert.id}">Marcar como resolvido</button>`
                }
                ${alert.allowsReprocess ? `<button class="btn primary" type="button" data-action="alert-reprocess" data-alert-id="${alert.id}">Reprocessar</button>` : ''}
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

function renderPageHeader({ title, description, actions, badgeText = '' }) {
  return `
    <div class="page-header">
      <div>
        <div class="page-title-row">
          <h2 class="page-title">${escapeHtml(title)}</h2>
          ${badgeText ? `<span class="page-title-badge">${escapeHtml(badgeText)}</span>` : ''}
        </div>
        <p class="page-description">${escapeHtml(description)}</p>
      </div>
      <div class="page-actions">${actions.join('')}</div>
    </div>
  `;
}

function actionButton(label, action, variant, disabled = false) {
  return `<button class="btn ${variant}" type="button" data-action="${action}"${disabled ? ' disabled' : ''}>${escapeHtml(label)}</button>`;
}

function renderRowActionsMenuItem(item) {
  const attrs = Object.entries(item.attrs || {})
    .map(([key, value]) => ` data-${key}="${escapeHtml(String(value))}"`)
    .join('');
  return `
    <button
      type="button"
      class="row-actions-menu-item${item.variant === 'danger' ? ' danger' : ''}"
      data-action="${escapeHtml(item.action)}"
      role="menuitem"
      ${item.disabled ? 'disabled' : ''}${attrs}
    >${escapeHtml(item.label)}</button>
  `;
}

function renderRowActionsMenu(menuId, items) {
  const normalizedId = String(menuId || '');
  const visibleItems = (Array.isArray(items) ? items : []).filter(Boolean);
  const isOpen = Boolean(normalizedId) && state.rowActionsMenu.openId === normalizedId;
  const anchor = state.rowActionsMenu.anchor || { top: 8, left: 8 };
  const verticalStyle =
    anchor.bottom !== undefined ? `bottom:${escapeHtml(String(anchor.bottom))}px;` : `top:${escapeHtml(String(anchor.top))}px;`;

  if (!visibleItems.length) {
    return '';
  }

  return `
    <div class="row-actions-menu-wrap" data-row-actions-menu-wrap>
      <button
        class="row-actions-menu-trigger"
        type="button"
        data-action="row-actions-menu-toggle"
        data-menu-id="${escapeHtml(normalizedId)}"
        aria-haspopup="true"
        aria-expanded="${isOpen ? 'true' : 'false'}"
        aria-label="Abrir menu de acoes"
        title="Acoes"
      >&#8942;</button>
      ${
        isOpen
          ? `
            <div
              class="row-actions-menu-panel"
              role="menu"
              aria-label="Menu de acoes"
              style="${verticalStyle} left:${escapeHtml(String(anchor.left))}px;"
            >
              ${visibleItems.map((item) => renderRowActionsMenuItem(item)).join('')}
            </div>
          `
          : ''
      }
    </div>
  `;
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

function renderCompareStep(number, title, description) {
  return `
    <article class="compare-step">
      <div class="compare-step-number">${escapeHtml(String(number))}</div>
      <div>
        <h4>${escapeHtml(title)}</h4>
        <p>${escapeHtml(description)}</p>
      </div>
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
        : sourceMode === 'dominio_chave'
          ? 'participa do download manual por chave via Dominio'
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
  const cancelBadge = xml.cancelada && !xml.substitui ? statusBadge('Cancelada', 'danger', 'nfse-cancel-chip') : '';
  const exceptionBadge = xml.isNumberingException ? statusBadge('Excecao', 'warning', 'nfse-cancel-chip') : '';
  return `<div class="nfse-number-cell"><strong>${numero}</strong>${cancelBadge}${exceptionBadge}</div>`;
}

function renderXmlStatusBadges(xml) {
  if (xml.isNumberingException) {
    const badges = [statusBadge('Excecao aplicada', 'warning')];
    if (xml.numberingExceptionType) {
      badges.push(statusBadge(mapNfseNumberingExceptionTypeLabel(xml.numberingExceptionType), 'neutral'));
    }
    return `<div class="status-stack">${badges.join('')}</div>`;
  }

  const badges = [];
  if (xml.statusArmazenamento !== 'Armazenado') {
    badges.push(statusBadge(xml.statusArmazenamento, toneFromStorageStatus(xml.statusArmazenamento)));
  }
  if (xml.ignorarNumeracaoValidacao) {
    badges.push(statusBadge('Fora da numeracao', 'warning'));
  }
  if (xml.substitui) {
    badges.push(renderXmlLinkChip(`Substitui NF ${xml.substitui.numeroNfse || ''}`.trim(), 'info', xml.substitui.linkedXmlId));
  } else if (xml.cancelada) {
    badges.push(statusBadge('Cancelada', 'danger', 'nfse-cancel-chip'));
  } else if (xml.statusFiscal && xml.statusFiscal !== '-') {
    badges.push(statusBadge(xml.statusFiscal, toneFromFiscalStatus(xml.statusFiscal)));
  }

  if (xml.substituidaPor) {
    badges.push(renderXmlLinkChip(`Substituida (NF ${xml.substituidaPor.numeroNfse || ''})`.trim(), 'warning', xml.substituidaPor.linkedXmlId));
  }

  return `<div class="status-stack">${badges.join('')}</div>`;
}

function renderXmlLinkChip(label, tone, linkedXmlId) {
  const normalizedTone = ['success', 'warning', 'danger', 'info', 'neutral'].includes(tone) ? tone : 'neutral';
  if (!linkedXmlId) {
    return `<span class="chip ${normalizedTone}">${escapeHtml(label)}</span>`;
  }

  return `<button type="button" class="chip chip-link ${normalizedTone}" data-action="xml-details" data-xml-id="${escapeHtml(linkedXmlId)}" title="Abrir detalhes desta NFS-e">${escapeHtml(label)}</button>`;
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
  if (doc.temEventos) {
    badges.push(statusBadge('Com eventos', 'info'));
  }
  badges.push(statusBadge(doc.tipo, doc.tipo === 'Emitida' ? 'success' : doc.tipo === 'Recebida' ? 'info' : 'neutral'));
  return `<div class="status-stack">${badges.join('')}</div>`;
}

function renderCteStatusBadges(doc) {
  const badges = [];
  if (doc.statusFiscal && doc.statusFiscal !== '-') {
    badges.push(statusBadge(doc.statusFiscal, toneFromFiscalStatus(doc.statusFiscal)));
  }
  if (doc.temEventos) {
    badges.push(statusBadge('Com eventos', 'info'));
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
  return `<div><small style="color:var(--text-secondary); display:block; margin-bottom:4px;">${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
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
    '/auditoria-lacunas': 'auditoria-lacunas',
    '/buscas-nfe': 'buscas-nfe',
    '/xmls-nfe': 'xmls-nfe',
    '/xmls-cte': 'xmls-cte',
    '/compara-sped': 'compara-sped',
    '/leitor-xml': 'leitor-xml',
    '/alertas': 'alertas',
    '/configuracoes': 'configuracoes'
  };

  return { name: map[raw] || 'dashboard', params: {} };
}

function navigate(path) {
  window.location.hash = `#${path}`;
}

function resolvePageMetaForRoute(route = state.route) {
  if (route.name === 'client-details') {
    const client = findClientById(route.params.id);
    if (client) {
      return {
        title: client.razaoSocial,
        description: `Detalhes operacionais do cliente ${formatCnpj(client.cnpj)}.`
      };
    }
  }

  return pageMeta[route.name] || pageMeta.dashboard;
}

function resolvePageMeta() {
  return resolvePageMetaForRoute(state.route);
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
    buscaNfeAtiva: formData.get('buscaNfeAtiva') === 'on',
    codigoEmpresaDominio: String(formData.get('codigoEmpresaDominio') || '').trim()
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
      nfeHabilitado: payload.buscaNfeAtiva,
      codigoEmpresaDominio: payload.codigoEmpresaDominio ? Number(payload.codigoEmpresaDominio) : undefined
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

async function buscarCodigoEmpresaDominioAutomatico() {
  if (state.modal?.kind !== 'client-form') {
    return;
  }

  const clientId = String(state.modal.clientId || '').trim();
  if (!clientId) {
    pushToast('Salve o cliente primeiro para buscar o codigo pelo CNPJ.', 'error');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A busca automatica na Dominio so esta disponivel com a API real conectada.', 'error');
    return;
  }

  state.modal = {
    ...state.modal,
    buscandoCodigoEmpresa: true
  };
  render();

  try {
    const result = await apiRequest('/nfse/dominio/codigo-empresa', {
      method: 'POST',
      body: { clienteId: clientId }
    });

    if (state.modal?.kind === 'client-form') {
      state.modal = {
        ...state.modal,
        buscandoCodigoEmpresa: false,
        codigoEmpresaDominioOverride: String(result?.codigoEmpresaDominio ?? '')
      };
      render();
    }

    const client = findClientById(clientId);
    if (client) {
      client.codigoEmpresaDominio = result?.codigoEmpresaDominio ?? client.codigoEmpresaDominio;
    }

    pushToast(`Codigo da empresa Dominio encontrado: ${result?.codigoEmpresaDominio}.`, 'success');
  } catch (error) {
    if (state.modal?.kind === 'client-form') {
      state.modal = {
        ...state.modal,
        buscandoCodigoEmpresa: false
      };
      render();
    }
    pushToast(`Falha ao buscar o codigo da empresa na Dominio: ${toErrorMessage(error)}`, 'error');
  }
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
            : sourceMode === 'dominio_chave'
              ? 'Ative a rotina para preparar o download manual por chave via catalogo da Dominio'
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
      : sourceMode === 'dominio_chave'
        ? `${rows.length} controle(s) preparados para download manual por chave`
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
      `${getNfeSourceMode() === 'dominio' ? 'Importacao NF-e ligada' : getNfeSourceMode() === 'dominio_chave' ? 'Download por chave ligado' : 'NF-e ligada'} para ${Number(result?.clientesComSucesso || 0)} cliente(s). Controles preparados: ${Number(result?.controlesCriadosOuReativados || 0)}.${
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
      `${getNfeSourceMode() === 'dominio' ? 'Importacao NF-e ligada' : getNfeSourceMode() === 'dominio_chave' ? 'Download por chave ligado' : 'NF-e ligada'} para o cliente: ${Number(result?.controlesCriadosOuReativados || 0)} controle(s) preparado(s).${
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
      `${getNfeSourceMode() === 'dominio' ? 'Importacao' : getNfeSourceMode() === 'dominio_chave' ? 'Download por chave' : 'Busca'} de NF-e iniciada para todos os controles ativos. Aguarde a conclusao.`,
      'info'
    );
    const result = await apiRequest('/nfe/sync/rodar-agora-geral', {
      method: 'POST'
    });
    state.nfeLastRunReport = buildNfeRunReport(result);
    pushToast(
      buildNfeRunToastMessage(
        getNfeSourceMode() === 'dominio'
          ? 'Importacao de NF-e executada'
          : getNfeSourceMode() === 'dominio_chave'
            ? 'Download por chave executado'
            : 'Busca de NF-e executada',
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
        getNfeSourceMode() === 'dominio' ? 'Importacao' : getNfeSourceMode() === 'dominio_chave' ? 'Download por chave' : 'Busca'
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
        getNfeSourceMode() === 'dominio'
          ? 'Importacao NF-e executada'
          : getNfeSourceMode() === 'dominio_chave'
            ? 'Download por chave executado'
            : 'Sincronizacao NF-e executada',
        response
      ),
      Number(response?.failures || 0) > 0 ? 'error' : 'success'
    );
    await refreshApiData();
  } catch (error) {
    pushToast(`Falha ao executar sincronizacao NF-e: ${toErrorMessage(error)}`, 'error');
  }
}

async function submitNfeDominioImportForm(form) {
  const data = new FormData(form);
  const clienteId = String(data.get('clienteId') || NFE_DOMINIO_ALL_CLIENTS_OPTION).trim() || NFE_DOMINIO_ALL_CLIENTS_OPTION;
  const ambiente = String(data.get('ambiente') || 'producao').trim() || 'producao';
  const limitValue = Number(data.get('limit') || 200);
  const dataEmissaoInicio = String(data.get('dataEmissaoInicio') || '').trim();
  const dataEmissaoFim = String(data.get('dataEmissaoFim') || '').trim();

  if (dataEmissaoInicio && dataEmissaoFim && dataEmissaoInicio > dataEmissaoFim) {
    pushToast('A data inicial nao pode ser maior que a data final.', 'error');
    return;
  }

  const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 5000) : 200;
  const targetClients =
    clienteId === NFE_DOMINIO_ALL_CLIENTS_OPTION
      ? getNfeEligibleClients()
      : getNfeEligibleClients().filter((client) => client.id === clienteId);

  if (!targetClients.length) {
    pushToast('Nenhuma empresa elegivel foi encontrada para importar XMLs da Dominio.', 'error');
    return;
  }

  try {
    const scopeLabel =
      targetClients.length === 1 ? targetClients[0]?.razaoSocial || 'Empresa selecionada' : 'Todas as empresas selecionadas';
    const periodLabel = formatDominioImportPeriodLabel(dataEmissaoInicio, dataEmissaoFim);
    const initialRows = buildDominioImportOverlayRows(targetClients, periodLabel);

    openDominioImportReportModal({
      scopeLabel,
      totalClients: targetClients.length,
      currentMessage: `Preparando importacao manual da Dominio para ${targetClients.length} empresa(s)...`,
      rows: initialRows
    });

    pushToast(`Importacao manual da Dominio iniciada para ${targetClients.length} empresa(s). Aguarde a conclusao.`, 'info');

    let aggregatedReport = createEmptyNfeRunReport();
    let successfulClients = 0;
    let failedClients = 0;
    let overlayRows = initialRows;

    for (let index = 0; index < targetClients.length; index += 1) {
      const client = targetClients[index];
      const body = {
        clienteId: client.id,
        ambiente,
        limit,
        ...(dataEmissaoInicio ? { dataEmissaoInicio } : {}),
        ...(dataEmissaoFim ? { dataEmissaoFim } : {})
      };

      overlayRows = patchDominioImportOverlayRow(overlayRows, client.id, {
        status: 'preparando',
        stepLabel: 'Preparando requisicao',
        message: `Separando filtros de emissao (${periodLabel}) para ${client.razaoSocial}.`
      });
      updateDominioImportOverlayState({
        processedClients: index,
        successfulClients,
        failedClients,
        importedDocuments: Number(aggregatedReport.documentsSaved || 0),
        importSummary: aggregatedReport.importSummary,
        currentMessage: `Etapa ${index + 1} de ${targetClients.length}: preparando ${client.razaoSocial}.`,
        rows: overlayRows
      });

      overlayRows = patchDominioImportOverlayRow(overlayRows, client.id, {
        status: 'importando',
        stepLabel: 'Consultando catalogo',
        message: 'Aguardando retorno do backend...'
      });
      updateDominioImportOverlayState({
        currentMessage: `Etapa ${index + 1} de ${targetClients.length}: consultando a Dominio para ${client.razaoSocial}.`,
        rows: overlayRows
      });

      try {
        const result = await apiRequest('/nfe/importar-dominio', {
          method: 'POST',
          body,
          timeoutMs: 120000
        });

        aggregatedReport = mergeNfeRunReports(aggregatedReport, buildNfeRunReportFromDominioImport(result, body));
        const resultFailures = Number(result?.falhas || 0);
        if (resultFailures > 0) {
          failedClients += 1;
        } else {
          successfulClients += 1;
        }

        overlayRows = patchDominioImportOverlayRow(overlayRows, client.id, {
          status: resultFailures > 0 ? 'concluido_com_falhas' : 'concluido',
          stepLabel: resultFailures > 0 ? 'Concluido com falhas' : 'Importacao concluida',
          importedCount: Number(result?.xmlsPersistidos || 0),
          importSummary: normalizeDominioImportSummary(result?.resumoImportacao),
          failureCount: resultFailures,
          message: buildDominioImportRowMessage(result)
        });
        updateDominioImportOverlayState({
          processedClients: index + 1,
          successfulClients,
          failedClients,
          importedDocuments: Number(aggregatedReport.documentsSaved || 0),
          importSummary: aggregatedReport.importSummary,
          currentMessage: `Etapa ${index + 1} de ${targetClients.length}: ${client.razaoSocial} concluida.`,
          rows: overlayRows
        });
      } catch (error) {
        failedClients += 1;
        aggregatedReport = mergeNfeRunReports(
          aggregatedReport,
          buildClientLevelDominioImportFailureReport({
            clientId: client.id,
            ambiente,
            message: toErrorMessage(error)
          })
        );

        overlayRows = patchDominioImportOverlayRow(overlayRows, client.id, {
          status: 'erro',
          stepLabel: 'Falha na API',
          failureCount: 1,
          message: toErrorMessage(error)
        });
        updateDominioImportOverlayState({
          processedClients: index + 1,
          successfulClients,
          failedClients,
          importedDocuments: Number(aggregatedReport.documentsSaved || 0),
          importSummary: aggregatedReport.importSummary,
          currentMessage: `Etapa ${index + 1} de ${targetClients.length}: falha ao importar ${client.razaoSocial}.`,
          rows: overlayRows
        });
      }
    }

    state.nfeLastRunReport = aggregatedReport;
    updateDominioImportOverlayState({
      running: false,
      processedClients: targetClients.length,
      successfulClients,
      failedClients,
      importedDocuments: Number(aggregatedReport.documentsSaved || 0),
      importSummary: aggregatedReport.importSummary,
      currentMessage: buildDominioImportCompletionMessage(aggregatedReport, targetClients.length),
      rows: overlayRows
    });

    pushToast(
      `${buildDominioImportCompletionMessage(aggregatedReport, targetClients.length)}${
        Number(aggregatedReport.failures || 0) > 0 ? `, ${Number(aggregatedReport.failures || 0)} falha(s)` : ''
      }.`,
      Number(aggregatedReport.failures || 0) > 0 ? 'error' : 'success'
    );
    await refreshApiData();
  } catch (error) {
    if (state.modal?.kind === 'dominio-import-report') {
      updateDominioImportOverlayState({
        running: false,
        currentMessage: `Falha ao executar importacao manual da Dominio: ${toErrorMessage(error)}`
      });
    }
    pushToast(`Falha ao importar XMLs da Dominio: ${toErrorMessage(error)}`, 'error');
  }
}

function buildNfeRunReport(response) {
  return {
    executedAt: new Date().toISOString(),
    processed: Number(response?.processed || 0),
    documentsSaved: Number(response?.documentsSaved || 0),
    failures: Number(response?.failures || 0),
    importSummary: normalizeDominioImportSummary(response?.importSummary),
    executionDetails: Array.isArray(response?.executionDetails) ? response.executionDetails : [],
    failureDetails: Array.isArray(response?.failureDetails) ? response.failureDetails : []
  };
}

function buildNfeRunReportFromDominioImport(response, request) {
  const clientId = String(request?.clienteId || '').trim();
  const ambiente = String(response?.ambiente || request?.ambiente || 'producao').trim() || 'producao';
  const rows = (Array.isArray(response?.detalhes) ? response.detalhes : []).map((detail) => {
    const cnpjConsulta = normalizeDigits(detail?.cnpjEmpresa || '');
    const estabelecimento = findEstablishmentByClientAndCnpj(clientId, cnpjConsulta);
    return {
      kind: 'documento',
      status: detail?.status || 'falha',
      clientId,
      estabelecimentoId: estabelecimento?.id || '',
      ambiente,
      cnpjConsulta,
      catalogoId: Number(detail?.catalogoId || 0),
      chaveAcesso: detail?.chaveAcesso || '',
      numeroNfe: detail?.numeroNfe || '',
      serie: detail?.serie || '',
      modelo: detail?.modelo || '',
      categoria: detail?.categoria || '',
      mensagem: detail?.mensagem || ''
    };
  });

  return {
    executedAt: new Date().toISOString(),
    processed: Number(response?.estabelecimentosConsultados || 0),
    documentsSaved: Number(response?.xmlsPersistidos || 0),
    failures: Number(response?.falhas || 0),
    importSummary: normalizeDominioImportSummary(response?.resumoImportacao),
    executionDetails: rows,
    failureDetails: rows.filter((row) => row.status === 'falha')
  };
}

function createEmptyNfeRunReport() {
  return {
    executedAt: new Date().toISOString(),
    processed: 0,
    documentsSaved: 0,
    failures: 0,
    importSummary: normalizeDominioImportSummary(),
    executionDetails: [],
    failureDetails: []
  };
}

function mergeNfeRunReports(base, addition) {
  const current = base || createEmptyNfeRunReport();
  const incoming = addition || createEmptyNfeRunReport();
  const executionDetails = [
    ...(Array.isArray(current.executionDetails) ? current.executionDetails : []),
    ...(Array.isArray(incoming.executionDetails) ? incoming.executionDetails : [])
  ];

  return {
    executedAt: incoming.executedAt || current.executedAt || new Date().toISOString(),
    processed: Number(current.processed || 0) + Number(incoming.processed || 0),
    documentsSaved: Number(current.documentsSaved || 0) + Number(incoming.documentsSaved || 0),
    failures: Number(current.failures || 0) + Number(incoming.failures || 0),
    importSummary: mergeDominioImportSummaries(current.importSummary, incoming.importSummary),
    executionDetails,
    failureDetails: executionDetails.filter((row) => row.status === 'falha')
  };
}

function buildClientLevelDominioImportFailureReport({ clientId, ambiente, message }) {
  return {
    executedAt: new Date().toISOString(),
    processed: 1,
    documentsSaved: 0,
    failures: 1,
    importSummary: normalizeDominioImportSummary(),
    executionDetails: [
      {
        kind: 'controle',
        status: 'falha',
        clientId,
        estabelecimentoId: '',
        ambiente,
        cnpjConsulta: '',
        catalogoId: 0,
        chaveAcesso: '',
        numeroNfe: '',
        serie: '',
        modelo: '',
        categoria: '',
        mensagem: message || 'Falha ao importar XMLs da Dominio'
      }
    ],
    failureDetails: []
  };
}

function normalizeDominioImportSummary(summary) {
  return {
    nfeDocumentos: Number(summary?.nfeDocumentos || 0),
    nfeEventos: Number(summary?.nfeEventos || 0),
    cteDocumentos: Number(summary?.cteDocumentos || 0),
    cteEventos: Number(summary?.cteEventos || 0),
    nfseDocumentos: Number(summary?.nfseDocumentos || 0),
    outrosDocumentos: Number(summary?.outrosDocumentos || 0),
    totalDocumentosPrincipais: Number(summary?.totalDocumentosPrincipais || 0),
    totalEventos: Number(summary?.totalEventos || 0),
    totalXmlsImportados: Number(summary?.totalXmlsImportados || 0)
  };
}

function mergeDominioImportSummaries(base, addition) {
  const current = normalizeDominioImportSummary(base);
  const incoming = normalizeDominioImportSummary(addition);
  return {
    nfeDocumentos: current.nfeDocumentos + incoming.nfeDocumentos,
    nfeEventos: current.nfeEventos + incoming.nfeEventos,
    cteDocumentos: current.cteDocumentos + incoming.cteDocumentos,
    cteEventos: current.cteEventos + incoming.cteEventos,
    nfseDocumentos: current.nfseDocumentos + incoming.nfseDocumentos,
    outrosDocumentos: current.outrosDocumentos + incoming.outrosDocumentos,
    totalDocumentosPrincipais: current.totalDocumentosPrincipais + incoming.totalDocumentosPrincipais,
    totalEventos: current.totalEventos + incoming.totalEventos,
    totalXmlsImportados: current.totalXmlsImportados + incoming.totalXmlsImportados
  };
}

function renderDominioImportSummaryPanel(summary, options = {}) {
  const normalized = normalizeDominioImportSummary(summary);
  if (!normalized.totalXmlsImportados) {
    return '';
  }

  const extraDocumentLabel = normalized.outrosDocumentos ? ` + ${normalized.outrosDocumentos} outro(s)` : '';
  return `
    <div style="margin-bottom:18px; padding:14px; border:1px solid var(--line); border-radius:14px; background:var(--surface-alt);">
      <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
        <div>
          <strong>Composicao dos XMLs importados</strong>
          ${
            options?.subtitle
              ? `<div style="margin-top:4px; color:var(--text-secondary); font-size:13px;">${escapeHtml(options.subtitle)}</div>`
              : ''
          }
        </div>
        <div class="progress-meta">
          <span>Documentos principais: <strong>${escapeHtml(String(normalized.totalDocumentosPrincipais))}</strong></span>
          <span>Eventos: <strong>${escapeHtml(String(normalized.totalEventos))}</strong></span>
        </div>
      </div>
      <div class="form-grid four" style="margin-top:14px;">
        ${detailItem('NF-e documento', String(normalized.nfeDocumentos))}
        ${detailItem('NF-e evento', String(normalized.nfeEventos))}
        ${detailItem('CT-e documento', String(normalized.cteDocumentos))}
        ${detailItem('CT-e evento', String(normalized.cteEventos))}
        ${detailItem('NFS-e documento', String(normalized.nfseDocumentos))}
        ${detailItem('Outros documentos', String(normalized.outrosDocumentos))}
        ${detailItem('Total bruto', String(normalized.totalXmlsImportados))}
        ${detailItem('Comparacao com dashboard', `NF-e + CT-e exibem documentos, nao eventos${extraDocumentLabel}`)}
      </div>
    </div>
  `;
}

function buildDominioImportCompositionLabel(summary) {
  const normalized = normalizeDominioImportSummary(summary);
  if (!normalized.totalXmlsImportados) {
    return 'Sem XMLs importados.';
  }

  const parts = [
    `NF-e: ${normalized.nfeDocumentos}`,
    `CT-e: ${normalized.cteDocumentos}`,
    `NFS-e: ${normalized.nfseDocumentos}`,
    `Eventos: ${normalized.nfeEventos + normalized.cteEventos}`
  ];
  if (normalized.outrosDocumentos) {
    parts.push(`Outros: ${normalized.outrosDocumentos}`);
  }
  return parts.join(' • ');
}

function buildDominioImportRowMessage(response) {
  const imported = Number(response?.xmlsPersistidos || 0);
  const failures = Number(response?.falhas || 0);
  return `XMLs importados: ${imported}. ${buildDominioImportCompositionLabel(response?.resumoImportacao)} Falhas: ${failures}.`;
}

function buildDominioImportCompletionMessage(report, totalClients) {
  return `Importacao manual concluida: ${Number(report?.documentsSaved || 0)} XML(s) importado(s) em ${Number(totalClients || 0)} empresa(s). ${buildDominioImportCompositionLabel(report?.importSummary)}`;
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
    eventos: String(data.get('eventos') || 'Todos'),
    schemaDoc: String(data.get('schemaDoc') || 'Todos'),
    valorMin: String(data.get('valorMin') || '').trim(),
    valorMax: String(data.get('valorMax') || '').trim(),
    xmlCompleto: String(data.get('xmlCompleto') || 'Todos'),
    ambiente: String(data.get('ambiente') || 'producao')
  };
  state.selectedNfeIds = new Set();

  await executeNfeDocsSearch();
}

async function applyCteDocsFilters(form) {
  const data = new FormData(form);
  const rawTipoEvento = String(data.get('tipoEvento') || '').trim();
  state.filters.cteDocs = {
    cliente: String(data.get('cliente') || ''),
    tipo: String(data.get('tipo') || 'Todos'),
    cnpj: normalizeDigits(String(data.get('cnpj') || '')),
    numero: String(data.get('numero') || '').trim(),
    chave: normalizeDigits(String(data.get('chave') || '')),
    emissaoInicio: String(data.get('emissaoInicio') || ''),
    emissaoFim: String(data.get('emissaoFim') || ''),
    status: String(data.get('status') || 'Todos'),
    eventos: String(data.get('eventos') || 'Todos'),
    tipoEvento: rawTipoEvento === 'Todos' ? '' : rawTipoEvento,
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

async function runNfeDownloadByKeyForCurrentDocumentsClient() {
  const clientId = state.filters.nfeDocs.cliente && state.filters.nfeDocs.cliente !== 'Todos' ? state.filters.nfeDocs.cliente : '';
  if (!clientId) {
    pushToast('Selecione uma empresa para executar o download por chave.', 'error');
    return;
  }

  await runNfeDownloadByKey({ clienteId: clientId });
}

async function runNfeDownloadByKey(payload = null) {
  if (!canUseNfeManualDownloadByKey()) {
    pushToast('O download por chave exige uma origem de NF-e baseada na Dominio.', 'error');
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('O download por chave so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const body = payload?.clienteId
    ? {
        clienteId: payload.clienteId,
        ...(payload?.estabelecimentoId ? { estabelecimentoId: payload.estabelecimentoId } : {}),
        ...(payload?.ambiente ? { ambiente: payload.ambiente } : {}),
        ...(payload?.limitControles ? { limitControles: payload.limitControles } : {})
      }
    : null;
  const isGlobal = !body?.clienteId;
  const client = body?.clienteId ? findClientById(body.clienteId) : null;
  const clientName = client?.razaoSocial || (isGlobal ? 'Todos os clientes' : 'Cliente selecionado');

  try {
    openDownloadByKeyReportModal({
      showClientColumn: isGlobal,
      clientName,
      pendingCount: 0,
      downloadedCount: 0,
      errorCount: 0,
      currentMessage: 'Lendo chaves pendentes na Dominio desde 02/01/2026...',
      rows: []
    });

    const preview = await apiRequest(isGlobal ? '/nfe/sync/download-por-chave/preview-global' : '/nfe/sync/download-por-chave/preview', {
      method: 'POST',
      ...(body ? { body } : {}),
      timeoutMs: 3 * 60 * 1000
    });

    const previewRows = buildDownloadByKeyPreviewRows(preview?.rows, isGlobal);
    const pendingCount = Number(preview?.pendingDownloads || 0);
    const previewErrorCount = countDownloadByKeyErrorRows(previewRows);

    updateDownloadByKeyOverlayState({
      running: pendingCount > 0,
      pendingCount,
      downloadedCount: 0,
      errorCount: previewErrorCount,
      currentMessage:
        pendingCount > 0
          ? 'Chaves localizadas no historico desde 02/01/2026. Iniciando download oficial por chave...'
          : 'Nenhuma chave pendente foi localizada no historico desde 02/01/2026 para esta execucao.',
      rows: previewRows
    });

    if (pendingCount === 0) {
      pushToast(
        previewErrorCount > 0
          ? 'Nenhuma chave pendente foi localizada, mas houve falhas na preparacao da auditoria.'
          : 'Nenhuma chave pendente foi localizada na Dominio para download.',
        previewErrorCount > 0 ? 'error' : 'info'
      );
      return;
    }

    const runningRows = buildDownloadByKeyRunningRows(previewRows);
    updateDownloadByKeyOverlayState({
      running: true,
      rows: runningRows,
      currentMessage: 'Download oficial em andamento. Aguarde o retorno do backend...'
    });

    const result = await apiRequest(
      isGlobal ? '/nfe/sync/download-por-chave/executar-global' : '/nfe/sync/download-por-chave/executar',
      {
        method: 'POST',
        ...(body ? { body } : {}),
        timeoutMs: resolveDownloadByKeyTimeoutMs(pendingCount)
      }
    );

    state.nfeLastRunReport = buildNfeRunReport(result);
    const resolvedRows = buildDownloadByKeyResolvedRows(runningRows, result);
    const downloadedCount = countDownloadByKeyRowsByStatus(resolvedRows, 'Baixada');
    const errorCount = countDownloadByKeyErrorRows(resolvedRows);

    updateDownloadByKeyOverlayState({
      running: false,
      rows: resolvedRows,
      downloadedCount,
      errorCount,
      currentMessage: `Download concluido. ${downloadedCount} chave(s) baixada(s) e ${errorCount} erro(s) registrado(s).`
    });

    await refreshApiData();
    await refreshStoredDocumentSearchesAfterDownloadByKey();
    pushToast(
      `Download por chave concluido: ${Number(result?.documentsSaved || 0)} documento(s) salvo(s)${Number(result?.failures || 0) > 0 ? `, ${Number(result?.failures || 0)} falha(s)` : ''}.`,
      Number(result?.failures || 0) > 0 ? 'error' : 'success'
    );
  } catch (error) {
    if (state.modal?.kind === 'download-by-key-report') {
      const failedRows = buildDownloadByKeyResolvedRows(Array.isArray(state.modal.rows) ? state.modal.rows : [], {
        executionDetails: [],
        failureDetails: []
      }).map((row) =>
        row.kind === 'documento' && row.statusLabel === 'Baixando'
          ? {
              ...row,
              statusLabel: 'Erro',
              statusTone: 'danger',
              message: `Falha de API: ${toErrorMessage(error)}`
            }
          : row
      );

      updateDownloadByKeyOverlayState({
        running: false,
        rows: failedRows,
        errorCount: countDownloadByKeyErrorRows(failedRows),
        currentMessage: `Falha ao executar download por chave: ${toErrorMessage(error)}`
      });
    }

    pushToast(`Falha ao executar download por chave: ${toErrorMessage(error)}`, 'error');
  }
}

async function refreshStoredDocumentSearchesAfterDownloadByKey() {
  if (state.dataSource !== 'api') {
    return;
  }

  if (state.nfeSearch.hasSearched && state.nfeSearch.lastQuery?.cliente) {
    await executeNfeDocsSearch();
  }

  if (state.cteSearch.hasSearched && state.cteSearch.lastQuery?.cliente) {
    await executeCteDocsSearch();
  }
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
  const shouldOpenOverlay = Boolean(clientId && state.dataSource === 'api');

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
    if (shouldOpenOverlay) {
      openPastNsuRecoveryReportModal({
        executionMode: 'full',
        rowMode: 'nsu',
        clientName: selectedClient?.razaoSocial || 'Cliente selecionado',
        totalCount: 0,
        currentMessage: 'Preparando reprocessamento dos NSUs ja consultados...',
        summary: {
          controlesEncontrados: 0,
          controlesProcessados: 0,
          nsusAvaliados: 0,
          nsusConsultados: 0,
          documentosSalvos: 0,
          documentosGapResolvidos: 0,
          documentosAdicionaisSalvos: 0,
          nsusIgnoradosComDocumento: 0,
          documentosIgnoradosExistentes: 0,
          semDocumento: 0,
          falhas: 0
        },
        rows: []
      });
    }
    startExecutionMonitor(
      'Recuperacao',
      selectedClient ? 1 : state.clients.length || 1,
      'Reprocessando NSUs ja consultados. Notas existentes serao ignoradas...'
    );
    state.executionMonitor.currentClientName = selectedClient?.razaoSocial || 'Todos os controles';
    state.executionMonitor.updatedAt = new Date().toISOString();
    render();

    let result;

    if (shouldOpenOverlay && clientId) {
      const execution = await apiRequest('/sync/reprocessar-nsus-passados/execucao', {
        method: 'POST',
        body: { clienteId: clientId },
        timeoutMs: 2 * 60 * 1000
      });

      updatePastNsuRecoveryOverlayState({
        running: execution?.status === 'running',
        executionMode: 'full',
        rowMode: 'nsu',
        totalCount: Number(execution?.summary?.controlesEncontrados || 0),
        currentMessage: String(execution?.currentMessage || 'Execucao iniciada.'),
        summary: execution?.summary || {},
        rows: buildPastNsuRecoveryLiveRows(execution)
      });

      let latestExecution = execution;
      while (latestExecution?.status === 'running') {
        await wait(900);
        latestExecution = await apiRequest(
          `/sync/reprocessar-nsus-passados/execucao/${encodeURIComponent(String(execution?.executionId || ''))}`,
          {
            method: 'GET',
            timeoutMs: 2 * 60 * 1000
          }
        );

        updatePastNsuRecoveryOverlayState({
          running: latestExecution?.status === 'running',
          executionMode: 'full',
          rowMode: 'nsu',
          totalCount: Number(latestExecution?.summary?.controlesEncontrados || 0),
          currentMessage: String(latestExecution?.currentMessage || 'Reprocessamento em andamento...'),
          summary: latestExecution?.summary || {},
          rows: buildPastNsuRecoveryLiveRows(latestExecution)
        });
      }

      result = latestExecution?.summary || {};
    } else {
      result = await apiRequest('/sync/reprocessar-nsus-passados', {
        method: 'POST',
        body: clientId ? { clienteId: clientId } : {},
        timeoutMs: 10 * 60 * 1000
      });
    }

    if (shouldOpenOverlay) {
      updatePastNsuRecoveryOverlayState({
        running: false,
        executionMode: 'full',
        rowMode: state.modal?.rowMode || 'controle',
        totalCount: Number(result?.controlesEncontrados || 0),
        currentMessage: String(result?.ultimaMensagem || 'Reprocessamento manual concluido.'),
        summary: result,
        rows:
          state.modal?.rowMode === 'nsu' && clientId
            ? Array.isArray(state.modal?.rows)
              ? state.modal.rows
              : buildPastNsuRecoveryLiveRows({ rows: [] })
            : buildPastNsuRecoveryAuditRows(result)
      });
    }

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
    if (shouldOpenOverlay) {
      updatePastNsuRecoveryOverlayState({
        running: false,
        currentMessage: `Falha ao recuperar NSUs passados: ${toErrorMessage(error)}`,
        summary: {
          controlesEncontrados: 0,
          controlesProcessados: 0,
          nsusAvaliados: 0,
          nsusConsultados: 0,
          documentosSalvos: 0,
          documentosGapResolvidos: 0,
          documentosAdicionaisSalvos: 0,
          nsusIgnoradosComDocumento: 0,
          documentosIgnoradosExistentes: 0,
          semDocumento: 0,
          falhas: 1
        },
        rows: []
      });
    }
    pushToast(`Falha ao recuperar NSUs passados: ${toErrorMessage(error)}`, 'error');
  }
}

async function runNfseGapAuditForContext(context) {
  if (state.dataSource !== 'api') {
    pushToast('A auditoria por NSU so esta disponivel com a API real conectada.', 'error');
    return;
  }

  if (!context.clientId || !context.client) {
    pushToast('Busque os XMLs da empresa antes de auditar as lacunas por NSU.', 'error');
    return;
  }

  if (!context.cnpjConsulta) {
    pushToast('Nao foi possivel identificar o CNPJ emissor para auditar as lacunas.', 'error');
    return;
  }

  if (!context.lacunas.length) {
    pushToast('Nenhuma lacuna valida foi encontrada na busca atual.', 'error');
    return;
  }

  try {
    pushToast(
      `Auditoria das lacunas iniciada para ${context.client.razaoSocial || 'Cliente selecionado'}. Esta operacao pode demorar.`,
      'info'
    );
    openPastNsuRecoveryReportModal({
      executionMode: 'gap-audit',
      title: 'Auditoria das lacunas por NSU',
      runningLabel: 'auditoria em andamento.',
      completedLabel: 'auditoria concluida.',
      rowMode: 'nsu',
      clientName: context.client.razaoSocial || 'Cliente selecionado',
      totalCount: 0,
      currentMessage: 'Preparando faixas provaveis de NSU para as lacunas detectadas...',
      summary: {
        controlesEncontrados: 0,
        controlesProcessados: 0,
        nsusAvaliados: 0,
        nsusConsultados: 0,
        documentosSalvos: 0,
        documentosGapResolvidos: 0,
        documentosAdicionaisSalvos: 0,
        nsusIgnoradosComDocumento: 0,
        documentosIgnoradosExistentes: 0,
        semDocumento: 0,
        falhas: 0
      },
      rows: []
    });

    startExecutionMonitor(
      'Auditoria',
      1,
      'Auditando os NSUs provaveis a partir das lacunas de numeracao...'
    );
    state.executionMonitor.currentClientName = context.client.razaoSocial || 'Cliente selecionado';
    state.executionMonitor.updatedAt = new Date().toISOString();
    render();

    const execution = await apiRequest('/sync/reprocessar-nsus-passados/execucao', {
      method: 'POST',
      body: {
        clienteId: context.clientId,
        cnpjConsulta: context.cnpjConsulta,
        ambiente: context.ambiente,
        lacunas: context.lacunas
      },
      timeoutMs: 2 * 60 * 1000
    });

    updatePastNsuRecoveryOverlayState({
      running: execution?.status === 'running',
      executionMode: 'gap-audit',
      title: 'Auditoria das lacunas por NSU',
      runningLabel: 'auditoria em andamento.',
      completedLabel: 'auditoria concluida.',
      rowMode: 'nsu',
      totalCount: Number(execution?.summary?.controlesEncontrados || 0),
      currentMessage: String(execution?.currentMessage || 'Execucao iniciada.'),
      summary: execution?.summary || {},
      rows: buildPastNsuRecoveryLiveRows(execution)
    });

    let latestExecution = execution;
    while (latestExecution?.status === 'running') {
      await wait(900);
      latestExecution = await apiRequest(
        `/sync/reprocessar-nsus-passados/execucao/${encodeURIComponent(String(execution?.executionId || ''))}`,
        {
          method: 'GET',
          timeoutMs: 2 * 60 * 1000
        }
      );

      updatePastNsuRecoveryOverlayState({
        running: latestExecution?.status === 'running',
        executionMode: 'gap-audit',
        title: 'Auditoria das lacunas por NSU',
        runningLabel: 'auditoria em andamento.',
        completedLabel: 'auditoria concluida.',
        rowMode: 'nsu',
        totalCount: Number(latestExecution?.summary?.controlesEncontrados || 0),
        currentMessage: String(latestExecution?.currentMessage || 'Auditoria em andamento...'),
        summary: latestExecution?.summary || {},
        rows: buildPastNsuRecoveryLiveRows(latestExecution)
      });
    }

    const result = latestExecution?.summary || {};
    updatePastNsuRecoveryOverlayState({
      running: false,
      executionMode: 'gap-audit',
      title: 'Auditoria das lacunas por NSU',
      runningLabel: 'auditoria em andamento.',
      completedLabel: 'auditoria concluida.',
      rowMode: 'nsu',
      totalCount: Number(result?.controlesEncontrados || 0),
      currentMessage: String(result?.ultimaMensagem || 'Auditoria manual concluida.'),
      summary: result,
      rows: Array.isArray(state.modal?.rows) ? state.modal.rows : buildPastNsuRecoveryLiveRows({ rows: [] })
    });

    state.executionMonitor.total = Number(result?.controlesEncontrados || 1);
    state.executionMonitor.processed = Number(result?.controlesProcessados || 0);
    state.executionMonitor.successful = Number(result?.documentosGapResolvidos || 0);
    state.executionMonitor.failed = Number(result?.falhas || 0);
    state.executionMonitor.message = 'Auditoria concluida. Atualizando painel...';
    state.executionMonitor.updatedAt = new Date().toISOString();
    render();

    await refreshApiData();
    if (state.xmlSearch.hasSearched && state.xmlSearch.lastQuery?.cliente === context.clientId) {
      await executeXmlSearch();
    }

    finishExecutionMonitor(
      `Auditoria finalizada. Lacunas resolvidas: ${Number(result?.documentosGapResolvidos || 0)}. XMLs adicionais: ${Number(result?.documentosAdicionaisSalvos || 0)}. NSUs sem documento proprio: ${Number(result?.semDocumento || 0)}.`
    );
    pushToast(
      `Auditoria das lacunas concluida: ${Number(result?.documentosGapResolvidos || 0)} lacuna(s) resolvida(s) e ${Number(result?.documentosAdicionaisSalvos || 0)} XML(s) adicional(is).`,
      Number(result?.falhas || 0) > 0 ? 'error' : 'success'
    );
  } catch (error) {
    state.executionMonitor.failed += 1;
    finishExecutionMonitor('Auditoria das lacunas finalizada com falha.');
    updatePastNsuRecoveryOverlayState({
      running: false,
      currentMessage: `Falha ao auditar lacunas por NSU: ${toErrorMessage(error)}`,
      summary: {
        controlesEncontrados: 0,
        controlesProcessados: 0,
        nsusAvaliados: 0,
        nsusConsultados: 0,
        documentosSalvos: 0,
        documentosGapResolvidos: 0,
        documentosAdicionaisSalvos: 0,
        nsusIgnoradosComDocumento: 0,
        documentosIgnoradosExistentes: 0,
        semDocumento: 0,
        falhas: 1
      },
      rows: []
    });
    pushToast(`Falha ao auditar lacunas por NSU: ${toErrorMessage(error)}`, 'error');
  }
}

async function runNfseGapAuditFromCurrentSearch() {
  await runNfseGapAuditForContext(getCurrentNfseGapContext());
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
  state.selectedNfeIds = new Set();
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
    state.cteSearch.total = mapped.length;
    state.cteSearch.totalPages = mapped.length > 0 ? 1 : 0;
    state.cteSearch.page = 1;
    state.cteSearch.pageSize = mapped.length || SEARCH_PAGE_SIZE;
    state.tableState.cteDocs = 'data';
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
    state.xmlSearch.numberingValidation = null;
    state.xmlSearch.informativeRows = 0;
    state.nfseFiscalReader.rows = [];
    state.nfseFiscalReader.summary = null;
    state.nfseFiscalReader.resumoPorMunicipio = null;
    state.nfseFiscalReader.lastQuery = null;
    state.nfseFiscalReader.lastLoadedAt = null;
    state.xmlSearch.total = 0;
    state.xmlSearch.totalPages = 0;
    state.xmlSearch.page = 1;
    state.tableState.xmls = 'data';
    state.tableState.nfseFiscalReader = 'data';
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
    state.xmlSearch.numberingValidation = null;
    state.xmlSearch.informativeRows = 0;
    state.nfseFiscalReader.rows = [];
    state.nfseFiscalReader.summary = null;
    state.nfseFiscalReader.resumoPorMunicipio = null;
    state.nfseFiscalReader.lastQuery = null;
    state.nfseFiscalReader.lastLoadedAt = null;
    state.xmlSearch.total = 0;
    state.xmlSearch.totalPages = 0;
    state.xmlSearch.page = 1;
    state.tableState.xmls = 'data';
    state.tableState.nfseFiscalReader = 'data';
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
    state.xmlSearch.numberingValidation = null;
    state.xmlSearch.informativeRows = 0;
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
    const matchesClient =
      filters.cliente === 'Todos' ||
      !filters.cliente ||
      xml.clientId === filters.cliente ||
      xml.custodiaClienteId === filters.cliente ||
      (Array.isArray(xml.vinculoClienteIds) && xml.vinculoClienteIds.includes(filters.cliente));
    const matchesCnpj = !filters.cnpj || normalizeDigits(xml.cnpj).includes(filters.cnpj);
    const matchesNumero = !filters.numero || String(xml.numeroNfse).includes(filters.numero);

    if (xml?.isNumberingException) {
      const matchesTipo = filters.tipo === 'Todos' || filters.tipo === 'Emitida';
      return matchesClient && matchesCnpj && matchesNumero && matchesTipo;
    }

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
    const matchesEventos =
      filters.eventos === 'Todos' ||
      (filters.eventos === 'Com eventos' && doc.temEventos) ||
      (filters.eventos === 'Sem eventos' && !doc.temEventos) ||
      (filters.eventos === 'Canceladas' && doc.cancelada);
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
      matchesEventos &&
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
    const matchesEventos =
      filters.eventos === 'Todos' ||
      (filters.eventos === 'Com eventos' && doc.temEventos) ||
      (filters.eventos === 'Sem eventos' && !doc.temEventos) ||
      (filters.eventos === 'Canceladas' && doc.cancelada);
    const matchesTipoEvento = matchesDocumentEventTypeFilter(doc, filters.tipoEvento);
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
      matchesEventos &&
      matchesTipoEvento &&
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
  renderPreservingScroll();
}

function updateNfeSort(key) {
  const current = state.sort.nfeDocs;
  state.sort.nfeDocs = {
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
  };
  renderPreservingScroll();
}

function updateCteSort(key) {
  const current = state.sort.cteDocs;
  state.sort.cteDocs = {
    key,
    direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
  };
  renderPreservingScroll();
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
    case 'contraparte':
      return xml.contraparteNome || '';
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

function toSortableBrNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return 0;
  }

  const stringValue = String(value).trim();
  const normalized = stringValue.includes(',') ? stringValue.replace(/\./g, '').replace(',', '.') : stringValue;
  const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
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
  state.xmlSearch.numberingValidation = null;
  state.xmlSearch.informativeRows = 0;
  state.xmlSearch.lastSearchedAt = null;
  state.xmlSearch.page = 1;
  state.xmlSearch.pageSize = SEARCH_PAGE_SIZE;
  state.xmlSearch.total = 0;
  state.xmlSearch.totalPages = 0;
  state.tableState.xmls = 'data';
  state.nfseFiscalReader.rows = [];
  state.nfseFiscalReader.summary = null;
  state.nfseFiscalReader.resumoPorMunicipio = null;
  state.nfseFiscalReader.lastQuery = null;
  state.nfseFiscalReader.lastLoadedAt = null;
  state.nfseFiscalReader.exportConfig = {
    ...(state.nfseFiscalReader.exportConfig || {}),
    exporting: false
  };
  state.tableState.nfseFiscalReader = 'data';
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
  state.selectedNfeIds = new Set();
  state.filters.nfeDocs = {
    cliente: 'Todos',
    tipo: 'Todos',
    cnpj: '',
    numero: '',
    chave: '',
    emissaoInicio: '',
    emissaoFim: '',
    status: 'Todos',
    eventos: 'Todos',
    schemaDoc: 'Todos',
    valorMin: '',
    valorMax: '',
    xmlCompleto: 'Todos',
    ambiente: 'producao'
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
    eventos: 'Todos',
    tipoEvento: '',
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
  state.tableState.nfseFiscalReader = 'loading';
  state.nfseFiscalReader.rows = [];
  state.nfseFiscalReader.summary = null;
  state.nfseFiscalReader.resumoPorMunicipio = null;
  state.nfseFiscalReader.lastQuery = { ...state.filters.xmls };
  state.nfseFiscalReader.exportConfig = {
    ...(state.nfseFiscalReader.exportConfig || {}),
    exporting: false
  };
  render();

  try {
    const query = buildXmlSearchQuery(state.filters.xmls, 1, SEARCH_PAGE_SIZE, true);
    const [payloadRaw, fiscalReaderRaw] = await Promise.allSettled([
      apiRequest(`/nfse?${query.toString()}`),
      apiRequest(`/nfse/leitura-fiscal?${query.toString()}`)
    ]);
    if (payloadRaw.status !== 'fulfilled') {
      throw payloadRaw.reason;
    }
    const payload = normalizePaginatedResponse(payloadRaw.value);
    const xmls = buildXmlFilesFromApi(payload.items, state.clients, state.filters.xmls.cliente);
    state.xmlFiles = mergeXmlFilesById(state.xmlFiles, xmls);
    const filteredXmls = getFilteredXmlsFromSource(xmls);
    const informativeRows = await loadXmlNumberingExceptionRowsForSearch(state.filters.xmls, filteredXmls);
    state.xmlSearch.results = [...filteredXmls, ...informativeRows];
    state.xmlSearch.numberingValidation = payload.validacaoNumeracao;
    state.xmlSearch.informativeRows = informativeRows.length;
    state.xmlSearch.lastSearchedAt = new Date().toISOString();
    state.xmlSearch.page = 1;
    state.xmlSearch.pageSize = payload.pageSize;
    state.xmlSearch.total = payload.total;
    state.xmlSearch.totalPages = payload.totalPages;
    state.tableState.xmls = 'data';
    if (fiscalReaderRaw.status === 'fulfilled') {
      const normalizedFiscalReader = normalizeNfseFiscalReaderResponse(fiscalReaderRaw.value);
      state.nfseFiscalReader.rows = normalizedFiscalReader.items;
      state.nfseFiscalReader.summary = normalizedFiscalReader.summary;
      state.nfseFiscalReader.resumoPorMunicipio = normalizedFiscalReader.resumoPorMunicipio;
      state.nfseFiscalReader.lastLoadedAt = new Date().toISOString();
      state.tableState.nfseFiscalReader = 'data';
    } else {
      state.nfseFiscalReader.rows = [];
      state.nfseFiscalReader.summary = null;
      state.nfseFiscalReader.resumoPorMunicipio = null;
      state.nfseFiscalReader.lastLoadedAt = null;
      state.tableState.nfseFiscalReader = 'error';
      pushToast(`Falha ao montar a leitura fiscal das NFS-e: ${toErrorMessage(fiscalReaderRaw.reason)}`, 'error');
    }
    reportIfListingCapped('nota(s)', payload);
  } catch (error) {
    state.xmlSearch.results = [];
    state.xmlSearch.numberingValidation = null;
    state.xmlSearch.informativeRows = 0;
    state.xmlSearch.total = 0;
    state.xmlSearch.totalPages = 0;
    state.tableState.xmls = 'error';
    state.nfseFiscalReader.rows = [];
    state.nfseFiscalReader.summary = null;
    state.nfseFiscalReader.resumoPorMunicipio = null;
    state.nfseFiscalReader.lastLoadedAt = null;
    state.tableState.nfseFiscalReader = 'error';
    pushToast(`Falha ao buscar XMLs: ${toErrorMessage(error)}`, 'error');
  }

  render();
}

async function submitNfseFiscalDominioExportForm(form) {
  if (state.dataSource !== 'api') {
    pushToast('A exportacao Dominio do leitor NFS-e depende da API real.', 'error');
    return;
  }

  if (!state.filters.xmls.cliente) {
    pushToast('Selecione uma empresa e rode a busca antes de exportar.', 'error');
    return;
  }

  if (!Array.isArray(state.nfseFiscalReader.rows) || !state.nfseFiscalReader.rows.length) {
    pushToast('Nenhuma linha fiscal foi carregada para exportacao.', 'error');
    return;
  }

  const exportableRows = getNfseFiscalReaderExportableRows(state.nfseFiscalReader.rows);
  if (!exportableRows.length) {
    pushToast('As linhas carregadas estao canceladas; nao ha NFS-e elegivel para exportacao.', 'error');
    return;
  }

  const data = new FormData(form);
  const codigoEmpresa = String(data.get('codigoEmpresa') || '').trim();
  const tipoRegistro = String(data.get('tipoRegistro') || 'Entrada').trim() === 'Servico' ? 'Servico' : 'Entrada';
  const contas = tipoRegistro === 'Entrada' && String(data.get('contas') || '').trim() === 'PorFornecedor' ? 'PorFornecedor' : 'Padrao';
  const produtoPadrao = String(data.get('produtoPadrao') || '557').trim();

  if (!codigoEmpresa || Number(codigoEmpresa) < 0) {
    pushToast('Informe um codigo de empresa Dominio valido.', 'error');
    return;
  }

  if (!produtoPadrao || Number(produtoPadrao) <= 0) {
    pushToast('Informe um produto padrao valido.', 'error');
    return;
  }

  state.nfseFiscalReader.exportConfig = {
    codigoEmpresa,
    tipoRegistro,
    contas,
    produtoPadrao,
    exporting: true
  };
  render();

  try {
    const searchQuery = buildXmlSearchQuery(state.filters.xmls, 1, SEARCH_PAGE_SIZE, true);
    const requestBody = Object.fromEntries(searchQuery.entries());

    const payload = await apiRequest('/nfse/leitura-fiscal/exportar-dominio', {
      method: 'POST',
      body: {
        ...requestBody,
        all: true,
        codigoEmpresa: Number(codigoEmpresa),
        tipoRegistro,
        contas,
        produtoPadrao: Number(produtoPadrao)
      },
      timeoutMs: 2 * 60 * 1000
    });

    downloadFromPayload(payload, 'DOMINIO-NFSE.txt');
    const ignoredCancelled = state.nfseFiscalReader.rows.length - exportableRows.length;
    pushToast(
      `Exportacao Dominio do leitor NFS-e gerada com ${exportableRows.length} linha(s)${ignoredCancelled ? `; ${ignoredCancelled} cancelada(s) ignorada(s)` : ''}.`,
      'success'
    );
  } catch (error) {
    pushToast(`Falha ao exportar layout Dominio da leitura fiscal: ${toErrorMessage(error)}`, 'error');
  } finally {
    state.nfseFiscalReader.exportConfig = {
      codigoEmpresa,
      tipoRegistro,
      contas,
      produtoPadrao,
      exporting: false
    };
    render();
  }
}

async function loadNfseGapAuditOverview(options = {}) {
  if (state.dataSource !== 'api') {
    state.nfseGapAuditOverview = {
      rows: [],
      lastLoadedAt: null
    };
    state.tableState.nfseGapAudit = 'data';
    render();
    return;
  }

  const shouldKeepRows = Boolean(options.silent && state.nfseGapAuditOverview.rows.length);
  if (!shouldKeepRows) {
    state.tableState.nfseGapAudit = 'loading';
    render();
  }

  try {
    const payload = await apiRequest('/nfse/auditoria-lacunas');
    state.nfseGapAuditOverview = {
      rows: normalizeNfseGapAuditOverviewRows(payload),
      lastLoadedAt: new Date().toISOString()
    };
    state.tableState.nfseGapAudit = 'data';
  } catch (error) {
    state.tableState.nfseGapAudit = 'error';
    if (!options.silent) {
      pushToast(`Falha ao carregar a auditoria de lacunas: ${toErrorMessage(error)}`, 'error');
    }
  }

  render();
}

async function submitNfseRecoverByKeyForm(form) {
  if (state.modal?.kind !== 'nfse-recover-by-key') {
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A recuperacao por chave so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const data = new FormData(form);
  const clienteId = String(data.get('clienteId') || state.modal.clientId || '').trim();
  const cnpjConsulta = normalizeDigits(String(data.get('cnpjConsulta') || state.modal.cnpjConsulta || ''));
  const ambiente = String(data.get('ambiente') || state.modal.ambiente || 'producao').trim() || 'producao';
  const keyText = String(data.get('chaves') || '');
  const chavesAcesso = extractNfseRecoveryKeysFromText(keyText);

  if (!clienteId) {
    pushToast('Cliente nao informado para a recuperacao das NFS-e faltantes.', 'error');
    return;
  }

  if (!cnpjConsulta) {
    pushToast('CNPJ emissor nao informado para a recuperacao das NFS-e faltantes.', 'error');
    return;
  }

  if (!chavesAcesso.length) {
    pushToast('Cole ao menos uma chave de acesso valida para recuperar os XMLs faltantes.', 'error');
    return;
  }

  state.modal = {
    ...state.modal,
    submitting: true,
    ambiente,
    keyText,
    errorMessage: '',
    result: null
  };
  render();

  try {
    const response = await apiRequest('/nfse/recuperar-por-chave', {
      method: 'POST',
      body: {
        clienteId,
        estabelecimentoId: state.modal.estabelecimentoId || undefined,
        cnpjConsulta,
        ambiente,
        chavesAcesso
      },
      timeoutMs: Math.max(180000, chavesAcesso.length * 45000)
    });

    state.modal = {
      ...state.modal,
      submitting: false,
      ambiente,
      keyText,
      errorMessage: '',
      result: response
    };
    render();

    await refreshApiData();

    if (state.xmlSearch.hasSearched && state.xmlSearch.lastQuery?.cliente === clienteId) {
      await executeXmlSearch();
    }

    const recovered = Number(response?.documentsRecovered || 0);
    const failures = Number(response?.failures || 0);
    pushToast(
      `Recuperacao de NFS-e concluida: ${recovered} XML(s) recuperado(s)${failures ? `, ${failures} falha(s)` : ''}.`,
      failures ? 'error' : 'success'
    );
  } catch (error) {
    state.modal = {
      ...state.modal,
      submitting: false,
      ambiente,
      keyText,
      errorMessage: toErrorMessage(error)
    };
    render();
    pushToast(`Falha ao recuperar NFS-e por chave: ${toErrorMessage(error)}`, 'error');
  }
}

async function submitNfseRecoverByDpsForm(form) {
  if (state.modal?.kind !== 'nfse-recover-by-dps') {
    return;
  }

  if (state.dataSource !== 'api') {
    pushToast('A recuperacao por DPS so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const data = new FormData(form);
  const clienteId = String(data.get('clienteId') || state.modal.clientId || '').trim();
  const cnpjConsulta = normalizeDigits(String(data.get('cnpjConsulta') || state.modal.cnpjConsulta || ''));
  const ambiente = String(state.modal.ambiente || 'producao').trim() || 'producao';
  const lacunas = Array.isArray(state.modal.lacunas) ? state.modal.lacunas : [];
  const requestedCount = lacunas.reduce(
    (total, gap) => total + Math.max(0, Number(gap?.numeroFinal || 0) - Number(gap?.numeroInicial || 0) + 1),
    0
  );

  if (!clienteId) {
    pushToast('Cliente nao informado para a recuperacao das NFS-e faltantes.', 'error');
    return;
  }

  if (!cnpjConsulta) {
    pushToast('CNPJ emissor nao informado para a recuperacao das NFS-e faltantes.', 'error');
    return;
  }

  if (!lacunas.length) {
    pushToast('Nenhuma lacuna valida foi encontrada para a recuperacao por DPS.', 'error');
    return;
  }

  state.modal = {
    ...state.modal,
    submitting: true,
    errorMessage: '',
    result: null
  };
  render();

  try {
    const response = await apiRequest('/nfse/recuperar-por-dps', {
      method: 'POST',
      body: {
        clienteId,
        estabelecimentoId: state.modal.estabelecimentoId || undefined,
        cnpjConsulta,
        ambiente,
        lacunas
      },
      timeoutMs: Math.max(180000, requestedCount * 45000)
    });

    state.modal = {
      ...state.modal,
      submitting: false,
      errorMessage: '',
      result: response
    };
    render();

    await refreshApiData();

    if (state.xmlSearch.hasSearched && state.xmlSearch.lastQuery?.cliente === clienteId) {
      await executeXmlSearch();
    }

    const recovered = Number(response?.documentsRecovered || 0);
    const failures = Number(response?.failures || 0);
    pushToast(
      `Recuperacao por DPS concluida: ${recovered} XML(s) recuperado(s)${failures ? `, ${failures} falha(s)` : ''}.`,
      failures ? 'error' : 'success'
    );
  } catch (error) {
    state.modal = {
      ...state.modal,
      submitting: false,
      errorMessage: toErrorMessage(error)
    };
    render();
    pushToast(`Falha ao recuperar NFS-e por DPS: ${toErrorMessage(error)}`, 'error');
  }
}

async function runNfseGapAuditRecoverAllByDps() {
  if (state.dataSource !== 'api') {
    pushToast('A recuperacao por DPS so esta disponivel com a API real conectada.', 'error');
    return;
  }

  if (state.nfseGapAuditRecoverAll.active) {
    return;
  }

  const rows = Array.isArray(state.nfseGapAuditOverview.rows) ? state.nfseGapAuditOverview.rows : [];
  const targets = rows
    .map((row) => ({ row, context: getNfseGapContextFromAuditRow(row) }))
    .filter((entry) => entry.context.clientId && entry.context.cnpjConsulta && entry.context.lacunas.length > 0);

  if (!targets.length) {
    pushToast('Nenhuma empresa com lacunas validas foi encontrada para recuperar por DPS.', 'info');
    return;
  }

  state.nfseGapAuditRecoverAll.active = true;
  render();

  pushToast(`Recuperacao por DPS iniciada para ${targets.length} empresa(s). Esta operacao pode demorar.`, 'info');
  startExecutionMonitor(
    'Recuperacao por DPS (todas as empresas)',
    targets.length,
    'Recuperando DPS faltantes por empresa...'
  );

  let totalRecovered = 0;
  let totalFailures = 0;
  let companiesWithFailure = 0;

  for (const { row, context } of targets) {
    const clientName = row?.razaoSocial || context.client?.razaoSocial || 'Empresa selecionada';

    try {
      const response = await apiRequest('/nfse/recuperar-por-dps', {
        method: 'POST',
        body: {
          clienteId: context.clientId,
          cnpjConsulta: context.cnpjConsulta,
          ambiente: context.ambiente,
          lacunas: context.lacunas
        },
        timeoutMs: Math.max(180000, context.requestedNumbers * 45000)
      });

      const recovered = Number(response?.documentsRecovered || 0);
      const failures = Number(response?.failures || 0);
      totalRecovered += recovered;
      totalFailures += failures;
      if (failures > 0) {
        companiesWithFailure += 1;
      }

      updateExecutionMonitorStep(
        clientName,
        failures === 0,
        `${clientName}: ${recovered} XML(s) recuperado(s)${failures ? `, ${failures} falha(s)` : ''}.`
      );
    } catch (error) {
      companiesWithFailure += 1;
      updateExecutionMonitorStep(clientName, false, `${clientName}: falha ao recuperar - ${toErrorMessage(error)}`);
    }
  }

  state.nfseGapAuditRecoverAll.active = false;
  finishExecutionMonitor(
    `Recuperacao por DPS finalizada. ${totalRecovered} XML(s) recuperado(s) em ${targets.length} empresa(s).`
  );

  await loadNfseGapAuditOverview({ silent: true });
  if (state.xmlSearch.hasSearched) {
    await executeXmlSearch();
  }

  pushToast(
    `Recuperacao por DPS concluida: ${totalRecovered} XML(s) recuperado(s)${
      totalFailures ? `, ${totalFailures} falha(s) em ${companiesWithFailure} empresa(s)` : ''
    }.`,
    totalFailures ? 'error' : 'success'
  );
}

function extractNfseRecoveryKeysFromText(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }

  const matches = raw.match(/\d{50}/g) || [];
  if (!matches.length) {
    return [];
  }

  return [...new Set(matches.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizePaginatedResponse(payload) {
  if (Array.isArray(payload)) {
    return {
      items: payload,
      total: payload.length,
      page: 1,
      pageSize: payload.length || SEARCH_PAGE_SIZE,
      totalPages: payload.length ? 1 : 0,
      validacaoNumeracao: null
    };
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const total = Number(payload?.total ?? items.length ?? 0);
  const page = Number(payload?.page ?? 1);
  const pageSize = Number(payload?.pageSize ?? SEARCH_PAGE_SIZE);
  const totalPages = Number(payload?.totalPages ?? (pageSize > 0 ? Math.ceil(total / pageSize) : 0));
  const validacaoNumeracao = normalizeXmlNumberingValidation(payload?.validacaoNumeracao);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    validacaoNumeracao
  };
}

function normalizeNfseGapAuditOverviewRows(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((row) => ({
      clientId: String(row?.clienteId || '').trim(),
      razaoSocial: String(row?.razaoSocial || '').trim(),
      cnpjConsulta: normalizeDigits(String(row?.cnpjConsulta || '')),
      totalDocumentosAnalisados: Number(row?.totalDocumentosAnalisados || 0),
      totalNumerosValidos: Number(row?.totalNumerosValidos || 0),
      totalFaixasLacuna: Number(row?.totalFaixasLacuna || 0),
      totalNumerosPulados: Number(row?.totalNumerosPulados || 0),
      lacunas: Array.isArray(row?.lacunas)
        ? row.lacunas.map((gap) => ({
            ambiente: String(gap?.ambiente || ''),
            serie: gap?.serie == null ? null : String(gap.serie),
            numeroInicial: Number(gap?.numeroInicial || 0),
            numeroFinal: Number(gap?.numeroFinal || 0),
            quantidade: Number(gap?.quantidade || 0)
          }))
        : []
    }))
    .filter((row) => row.clientId);
}

function normalizeNfseNumberingExceptionRows(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((row) => ({
      id: String(row?.id || '').trim(),
      clienteId: String(row?.clienteId || '').trim(),
      cnpjConsulta: normalizeDigits(String(row?.cnpjConsulta || '')),
      ambiente: String(row?.ambiente || 'producao'),
      numeroNfse: Number(row?.numeroNfse || 0),
      tipo: String(row?.tipo || 'inutilizada'),
      observacao: row?.observacao == null ? '' : String(row.observacao),
      createdAt: row?.createdAt ? String(row.createdAt) : '',
      updatedAt: row?.updatedAt ? String(row.updatedAt) : ''
    }))
    .filter((row) => row.id && row.clienteId && row.numeroNfse > 0);
}

async function loadXmlNumberingExceptionRowsForSearch(filters, existingXmls = []) {
  const numeroPesquisado = Number.parseInt(String(filters?.numero || '').trim(), 10);
  if (!Number.isInteger(numeroPesquisado) || numeroPesquisado <= 0) {
    return [];
  }

  if (!filters?.cliente || filters?.tipo === 'Tomada') {
    return [];
  }

  const xmls = Array.isArray(existingXmls) ? existingXmls : [];
  if (xmls.some((xml) => xml?.tipo === 'Emitida' && Number.parseInt(String(xml?.numeroNfse || ''), 10) === numeroPesquisado)) {
    return [];
  }

  const client = findClientById(filters.cliente);
  const cnpjConsulta = normalizeDigits(client?.cnpj || '');
  if (!client || !cnpjConsulta) {
    return [];
  }

  try {
    const query = new URLSearchParams({
      clienteId: client.id,
      cnpjConsulta
    });
    const payload = await apiRequest(`/nfse/numeracao-excecoes?${query.toString()}`);
    const exceptions = normalizeNfseNumberingExceptionRows(payload).filter((row) => row.numeroNfse === numeroPesquisado);
    if (!exceptions.length) {
      return [];
    }

    const selectedException =
      exceptions.find((row) => row.ambiente === 'producao') ||
      [...exceptions].sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0))[0];

    return selectedException ? [buildXmlNumberingExceptionRow(selectedException, client)] : [];
  } catch (error) {
    console.error('Falha ao carregar excecao de numeracao para a busca de XMLs.', error);
    return [];
  }
}

function buildXmlNumberingExceptionRow(exception, client) {
  const timestamp = exception.updatedAt || exception.createdAt || new Date().toISOString();
  return {
    id: `xml-exception-${exception.id}`,
    apiNfseId: '',
    clientId: exception.clienteId,
    estabelecimentoId: null,
    cliente: client?.razaoSocial || 'Cliente nao identificado',
    cnpj: exception.cnpjConsulta || normalizeDigits(client?.cnpj || ''),
    municipio: '-',
    numeroNfse: String(exception.numeroNfse),
    codigoVerificacao: '-',
    chaveAcesso: '',
    ambiente: exception.ambiente || 'producao',
    dataEmissao: timestamp,
    dataDownload: timestamp,
    valor: 0,
    tipo: 'Emitida',
    statusArmazenamento: 'Excecao aplicada',
    statusFiscal: mapNfseNumberingExceptionTypeLabel(exception.tipo),
    cancelada: false,
    dataCancelamento: null,
    codigoServicoPrestado: '-',
    descricaoServico: exception.observacao || 'Numeracao marcada manualmente como excecao.',
    eventos: [],
    eventosResumo: [],
    caminhoServidor: '-',
    prestador: client?.razaoSocial || '-',
    tomador: '-',
    contraparteNome: 'Excecao de numeracao',
    iss: 0,
    conteudoXml: null,
    isNumberingException: true,
    numberingExceptionId: exception.id,
    numberingExceptionType: exception.tipo,
    numberingExceptionObservacao: exception.observacao || ''
  };
}

function normalizeXmlNumberingValidation(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const lacunas = Array.isArray(payload.lacunas)
    ? payload.lacunas.map((gap) => ({
        ambiente: String(gap?.ambiente || ''),
        serie: gap?.serie == null ? null : String(gap.serie),
        numeroInicial: Number(gap?.numeroInicial || 0),
        numeroFinal: Number(gap?.numeroFinal || 0),
        quantidade: Number(gap?.quantidade || 0)
      }))
    : [];

  return {
    aplicada: Boolean(payload.aplicada),
    motivo: payload?.motivo ? String(payload.motivo) : '',
    cnpjPrestador: payload?.cnpjPrestador ? String(payload.cnpjPrestador) : null,
    totalDocumentosAnalisados: Number(payload?.totalDocumentosAnalisados || 0),
    totalNumerosValidos: Number(payload?.totalNumerosValidos || 0),
    totalFaixasLacuna: Number(payload?.totalFaixasLacuna || 0),
    totalNumerosPulados: Number(payload?.totalNumerosPulados || 0),
    possuiNumeracaoPulada: Boolean(payload?.possuiNumeracaoPulada),
    lacunas
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

  const selectedIds = [...state.selectedAlertIds];
  void (async () => {
    let resolvedCount = 0;

    for (const alert of state.alerts) {
      if (!selectedIds.includes(alert.id)) {
        continue;
      }

      try {
        await setAlertResolved(alert, true);
        resolvedCount += 1;
      } catch (error) {
        pushToast(`Falha ao resolver alerta "${alert.titulo}": ${toErrorMessage(error)}`, 'error');
      }
    }

    if (resolvedCount > 0) {
      pushToast(`${resolvedCount} alerta(s) marcado(s) como resolvido(s).`, 'success');
    }

    state.selectedAlertIds = new Set();
    render();
  })();
}

async function markNfseRetentionAlertsResolvedByCompany(companyId) {
  const normalizedCompanyId = String(companyId || '').trim();
  if (!normalizedCompanyId) {
    pushToast('Selecione uma empresa para marcar os alertas como resolvidos.', 'error');
    return;
  }

  const alerts = getFilteredNfseRetentionAlerts(normalizedCompanyId).filter((alert) => alert.status !== 'Resolvido');
  if (!alerts.length) {
    pushToast('Nao ha alertas em aberto para a empresa selecionada.', 'info');
    return;
  }

  let resolvedCount = 0;

  for (const alert of alerts) {
    try {
      await setAlertResolved(alert, true);
      resolvedCount += 1;
    } catch (error) {
      pushToast(`Falha ao resolver a NFS-e ${alert.numeroDocumento || alert.chaveAcesso || alert.id}: ${toErrorMessage(error)}`, 'error');
    }
  }

  if (resolvedCount > 0) {
    pushToast(
      `${resolvedCount} alerta(s) da empresa ${alerts[0]?.cliente || 'selecionada'} marcado(s) como resolvido(s).`,
      'success'
    );
  }

  render();
}

function resolveAlert(alertId) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) {
    return;
  }

  void (async () => {
    try {
      await setAlertResolved(alert, true);
      pushToast(`Alerta "${alert.titulo}" resolvido.`, 'success');
    } catch (error) {
      pushToast(`Falha ao resolver alerta: ${toErrorMessage(error)}`, 'error');
    }
    render();
  })();
}

function unresolveAlert(alertId) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) {
    return;
  }

  void (async () => {
    try {
      await setAlertResolved(alert, false);
      pushToast(`Alerta "${alert.titulo}" reaberto.`, 'success');
    } catch (error) {
      pushToast(`Falha ao reabrir alerta: ${toErrorMessage(error)}`, 'error');
    }
    render();
  })();
}

async function openAlertDocument(alertId, options = {}) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) {
    return;
  }
  const returnToModal = options.returnToModal ? cloneModalState(options.returnToModal) : null;
  const preferDetails = options.preferDetails !== false;

  if (alert.tipo === 'CT-e') {
    let doc = findCteForAlert(alert);

    if (!doc && state.dataSource === 'api' && alert.documentoId && alert.clientId) {
      try {
        const raw = await apiRequest(`/cte/${encodeURIComponent(alert.documentoId)}?clienteId=${encodeURIComponent(alert.clientId)}`);
        const mapped = buildCteDocumentsFromApi([raw], state.clients)[0] || null;
        if (mapped) {
          state.cteDocuments = mergeCteDocumentsById(state.cteDocuments, [mapped]);
          doc = mapped;
        }
      } catch (error) {
        pushToast(`Falha ao carregar CT-e do alerta: ${toErrorMessage(error)}`, 'error');
        return;
      }
    }

    if (!doc) {
      pushToast('Nao foi possivel localizar o CT-e vinculado a este alerta.', 'error');
      return;
    }

    state.drawer = null;
    state.modal = null;
    await openCteDetails(doc.id);
    return;
  }

  if (alert.tipo === 'NFS-e') {
    let doc = findNfseForAlert(alert);

    if (!doc && state.dataSource === 'api' && alert.documentoId && alert.clientId) {
      try {
        const raw = await apiRequest(`/nfse/${encodeURIComponent(alert.documentoId)}?clienteId=${encodeURIComponent(alert.clientId)}`);
        const mapped = buildXmlFilesFromApi([raw], state.clients, alert.clientId)[0] || null;
        if (mapped) {
          state.xmlFiles = mergeXmlFilesById(state.xmlFiles, [mapped]);
          doc = mapped;
        }
      } catch (error) {
        pushToast(`Falha ao carregar NFS-e do alerta: ${toErrorMessage(error)}`, 'error');
        return;
      }
    }

    if (!doc) {
      pushToast('Nao foi possivel localizar a NFS-e vinculada a este alerta.', 'error');
      return;
    }

    state.drawer = null;
    state.modal = null;
    if (preferDetails) {
      await openXmlDetails(doc.id, {
        returnToModal,
        alertId: alert.id
      });
    } else {
      await openXmlViewer(doc.id, { returnToModal });
    }
    return;
  }

  pushToast('Este alerta nao possui documento vinculado para visualizacao.', 'info');
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
    case 'xml-toggle-numbering-validation': {
      await updateXmlNumberingValidation(payload.xmlId, Boolean(payload.ignore));
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

function getCteDisagreementAlerts() {
  return [...state.alerts]
    .filter((alert) => alert.origem === 'cte-desacordo' || (alert.tipo === 'CT-e' && alert.canToggleResolved))
    .sort((a, b) => {
      const leftResolved = a.status === 'Resolvido' ? 1 : 0;
      const rightResolved = b.status === 'Resolvido' ? 1 : 0;
      return leftResolved - rightResolved || Date.parse(b.dataHora || 0) - Date.parse(a.dataHora || 0);
    });
}

function getOpenCteDisagreementAlerts() {
  return getCteDisagreementAlerts().filter((alert) => alert.status !== 'Resolvido');
}

function isNfseRetentionAlert(alert) {
  return Boolean(
    alert &&
      alert.tipo === 'NFS-e' &&
      (alert.origem === 'nfse-retencao-entrada' || (Array.isArray(alert.retencoes) && alert.retencoes.length > 0))
  );
}

function getNfseRetentionAlerts() {
  return [...state.alerts]
    .filter((alert) => isNfseRetentionAlert(alert))
    .sort((a, b) => {
      const leftResolved = a.status === 'Resolvido' ? 1 : 0;
      const rightResolved = b.status === 'Resolvido' ? 1 : 0;
      return leftResolved - rightResolved || Date.parse(b.dataHora || 0) - Date.parse(a.dataHora || 0);
    });
}

function getOpenNfseRetentionAlerts() {
  return getNfseRetentionAlerts().filter((alert) => alert.status !== 'Resolvido');
}

function getFilteredNfseRetentionAlerts(companyId = '') {
  const normalizedCompanyId = String(companyId || '').trim();
  if (!normalizedCompanyId) {
    return getNfseRetentionAlerts();
  }

  return getNfseRetentionAlerts().filter((alert) => String(alert?.clientId || '').trim() === normalizedCompanyId);
}

function openModal(modal) {
  state.modal = modal;
  render();
}

async function openXmlReader30Fullscreen() {
  openModal({
    kind: 'xml-reader30-nfe-fullscreen'
  });

  await wait(0);

  const fullscreenTarget =
    modalRoot?.querySelector?.('.xml-reader30-fullscreen-modal') ||
    modalRoot;

  if (fullscreenTarget instanceof HTMLElement && typeof fullscreenTarget.requestFullscreen === 'function' && !document.fullscreenElement) {
    try {
      await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' });
    } catch (error) {
      console.warn('Nao foi possivel abrir o leitor NF-e em fullscreen nativo.', error);
    }
  }
}

function closeModal() {
  if (!state.modal) {
    return;
  }

  if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
    void document.exitFullscreen().catch((error) => {
      console.warn('Nao foi possivel sair do fullscreen nativo.', error);
    });
  }

  state.modal = state.modal.returnTo ? cloneModalState(state.modal.returnTo) : null;
  render();
}

function cloneModalState(modal) {
  if (!modal || typeof modal !== 'object') {
    return null;
  }

  return {
    ...modal,
    returnTo: modal.returnTo ? cloneModalState(modal.returnTo) : null
  };
}

function getModalCloseActionLabel(modal) {
  const returnTo = modal?.returnTo;
  if (!returnTo) {
    return 'Fechar';
  }
  if (returnTo.kind === 'nfse-retention-alerts') {
    return 'Voltar aos alertas';
  }
  if (returnTo.kind === 'xml-details' || returnTo.kind === 'nfe-details' || returnTo.kind === 'cte-details') {
    return 'Voltar aos detalhes';
  }
  return 'Voltar';
}

function openPastNsuRecoveryReportModal(params) {
  openModal({
    kind: 'past-nsu-recovery-report',
    running: true,
    executionMode: params?.executionMode || 'full',
    title: params?.title || 'Auditoria do reprocessamento de NSUs',
    runningLabel: params?.runningLabel || 'reprocessamento em andamento.',
    completedLabel: params?.completedLabel || 'reprocessamento concluido.',
    rowMode: params?.rowMode || 'controle',
    clientName: params?.clientName || 'Cliente selecionado',
    totalCount: Number(params?.totalCount || 0),
    currentMessage: params?.currentMessage || 'Preparando reprocessamento...',
    summary: params?.summary || {},
    rows: Array.isArray(params?.rows) ? params.rows : []
  });
}

function buildNfseGapContext({ clientId, client = null, cnpjConsulta, lacunasRaw }) {
  const rawGaps = Array.isArray(lacunasRaw) ? lacunasRaw : [];
  const lacunas = rawGaps
    .map((gap) => ({
      ambiente: String(gap?.ambiente || '') === 'producao_restrita' ? 'producao_restrita' : 'producao',
      serie: gap?.serie == null ? null : String(gap.serie),
      numeroInicial: Number(gap?.numeroInicial || 0),
      numeroFinal: Number(gap?.numeroFinal || 0)
    }))
    .filter((gap) => gap.numeroInicial > 0 && gap.numeroFinal >= gap.numeroInicial);
  const primeiroAmbiente = String(lacunas[0]?.ambiente || '').trim();
  const ambiente = primeiroAmbiente === 'producao_restrita' ? 'producao_restrita' : 'producao';
  const requestedNumbers = lacunas.reduce((total, gap) => total + (gap.numeroFinal - gap.numeroInicial + 1), 0);

  return {
    clientId,
    client,
    cnpjConsulta,
    lacunas,
    ambiente,
    requestedNumbers,
    gapPreview: summarizeXmlNumberingGaps(rawGaps)
      .slice(0, 5)
      .map((gap) => formatXmlNumberingGap(gap))
  };
}

function findNfseGapAuditRowByClientId(clientId) {
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) {
    return null;
  }

  return state.nfseGapAuditOverview.rows.find((row) => row?.clientId === normalizedClientId) || null;
}

function getCurrentNfseGapContext() {
  const query = state.xmlSearch.lastQuery;
  const validation = state.xmlSearch.numberingValidation;
  const clientId = String(query?.cliente || '').trim();
  const client = findClientById(clientId);

  return buildNfseGapContext({
    clientId,
    client,
    cnpjConsulta: normalizeDigits(validation?.cnpjPrestador || client?.cnpj || ''),
    lacunasRaw: Array.isArray(validation?.lacunas) ? validation.lacunas : []
  });
}

function getNfseGapContextFromAuditRow(row) {
  const clientId = String(row?.clientId || '').trim();
  const client = findClientById(clientId);

  return buildNfseGapContext({
    clientId,
    client,
    cnpjConsulta: normalizeDigits(row?.cnpjConsulta || client?.cnpj || ''),
    lacunasRaw: Array.isArray(row?.lacunas) ? row.lacunas : []
  });
}

async function loadNfseNumberingExceptionsForModal() {
  if (state.modal?.kind !== 'nfse-numbering-exception') {
    return;
  }

  state.modal = {
    ...state.modal,
    loading: true,
    errorMessage: ''
  };
  render();

  try {
    const query = new URLSearchParams();
    query.set('clienteId', state.modal.clientId || '');
    if (state.modal.cnpjConsulta) {
      query.set('cnpjConsulta', state.modal.cnpjConsulta);
    }
    const payload = await apiRequest(`/nfse/numeracao-excecoes?${query.toString()}`);
    if (state.modal?.kind !== 'nfse-numbering-exception') {
      return;
    }
    state.modal = {
      ...state.modal,
      loading: false,
      exceptions: normalizeNfseNumberingExceptionRows(payload)
    };
    render();
  } catch (error) {
    if (state.modal?.kind !== 'nfse-numbering-exception') {
      return;
    }
    state.modal = {
      ...state.modal,
      loading: false,
      errorMessage: toErrorMessage(error)
    };
    render();
  }
}

function openNfseNumberingExceptionModalForContext(context) {
  if (state.dataSource !== 'api') {
    pushToast('O cadastro de excecoes de numeracao so esta disponivel com a API real conectada.', 'error');
    return;
  }

  if (!context?.clientId || !context?.client || !context?.cnpjConsulta) {
    pushToast('Nao foi possivel identificar a empresa da numeracao a ser ignorada.', 'error');
    return;
  }

  openModal({
    kind: 'nfse-numbering-exception',
    clientId: context.clientId,
    clientName: context.client.razaoSocial || 'Cliente selecionado',
    cnpjConsulta: context.cnpjConsulta,
    ambiente: context.ambiente || 'producao',
    numeroNfse: '',
    tipo: 'inutilizada',
    observacao: '',
    submitting: false,
    loading: true,
    errorMessage: '',
    exceptions: []
  });
  void loadNfseNumberingExceptionsForModal();
}

function parseNfseNumberingExceptionNumbers(rawValue) {
  const source = String(rawValue || '')
    .replace(/[–—]/g, '-')
    .replace(/\r/g, '')
    .trim();

  if (!source) {
    return { numbers: [], invalidTokens: [] };
  }

  const tokens = source
    .split(/[\n,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const numbers = [];
  const invalidTokens = [];
  const seen = new Set();

  tokens.forEach((token) => {
    const compact = token.replace(/\s+/g, ' ').trim();
    if (!compact) {
      return;
    }

    const rangeMatch = compact.match(/^(\d+)\s*(?:-|a)\s*(\d+)$/i);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
        invalidTokens.push(token);
        return;
      }

      for (let value = start; value <= end; value += 1) {
        if (seen.has(value)) {
          continue;
        }
        seen.add(value);
        numbers.push(value);
      }
      return;
    }

    const fragments = compact
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);

    fragments.forEach((fragment) => {
      if (!/^\d+$/.test(fragment)) {
        invalidTokens.push(fragment);
        return;
      }

      const parsed = Number.parseInt(fragment, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        invalidTokens.push(fragment);
        return;
      }

      if (!seen.has(parsed)) {
        seen.add(parsed);
        numbers.push(parsed);
      }
    });
  });

  return {
    numbers,
    invalidTokens
  };
}

function openNfseRecoverByKeyModalForContext(context) {
  if (state.dataSource !== 'api') {
    pushToast('A recuperacao por chave so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const { clientId, client, cnpjConsulta, ambiente, gapPreview } = context;
  const estabelecimento = findEstablishmentByClientAndCnpj(clientId, cnpjConsulta);

  if (!clientId || !client) {
    pushToast('Busque os XMLs da empresa antes de iniciar a recuperacao por chave.', 'error');
    return;
  }

  if (!cnpjConsulta) {
    pushToast('Nao foi possivel identificar o CNPJ emissor para recuperar as NFS-e faltantes.', 'error');
    return;
  }

  openModal({
    kind: 'nfse-recover-by-key',
    clientId,
    clientName: client.razaoSocial || 'Cliente selecionado',
    cnpjConsulta,
    estabelecimentoId: estabelecimento?.id || '',
    ambiente,
    keyText: '',
    submitting: false,
    result: null,
    errorMessage: '',
    gapPreview
  });
}

function openNfseRecoverByKeyModal() {
  openNfseRecoverByKeyModalForContext(getCurrentNfseGapContext());
}

function openNfseRecoverByDpsModalForContext(context) {
  if (state.dataSource !== 'api') {
    pushToast('A recuperacao por DPS so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const { clientId, client, cnpjConsulta, ambiente, gapPreview, lacunas } = context;
  const estabelecimento = findEstablishmentByClientAndCnpj(clientId, cnpjConsulta);

  if (!clientId || !client) {
    pushToast('Busque os XMLs da empresa antes de iniciar a recuperacao por DPS.', 'error');
    return;
  }

  if (!cnpjConsulta) {
    pushToast('Nao foi possivel identificar o CNPJ emissor para recuperar as NFS-e faltantes.', 'error');
    return;
  }

  if (!Array.isArray(lacunas) || !lacunas.length) {
    pushToast('Nenhuma lacuna valida foi encontrada para a recuperacao por DPS.', 'error');
    return;
  }

  openModal({
    kind: 'nfse-recover-by-dps',
    clientId,
    clientName: client.razaoSocial || 'Cliente selecionado',
    cnpjConsulta,
    estabelecimentoId: estabelecimento?.id || '',
    ambiente,
    lacunas,
    submitting: false,
    result: null,
    errorMessage: '',
    gapPreview
  });
}

function openNfseRecoverByDpsModal() {
  openNfseRecoverByDpsModalForContext(getCurrentNfseGapContext());
}

async function openXmlSearchForGapContext(context) {
  if (!context?.clientId) {
    pushToast('Nao foi possivel identificar a empresa da lacuna selecionada.', 'error');
    return;
  }

  state.filters.xmls = {
    cliente: context.clientId,
    tipo: 'Emitida',
    cnpj: '',
    numero: '',
    municipio: 'Todos',
    emissaoInicio: '',
    emissaoFim: '',
    downloadInicio: '',
    downloadFim: '',
    status: 'Armazenado'
  };
  state.xmlSearch.hasSearched = false;
  state.xmlSearch.results = [];
  state.xmlSearch.lastQuery = null;
  state.xmlSearch.numberingValidation = null;
  state.xmlSearch.informativeRows = 0;
  state.xmlSearch.total = 0;
  state.xmlSearch.totalPages = 0;
  state.selectedXmlIds = new Set();
  state.nfseFiscalReader.rows = [];
  state.nfseFiscalReader.summary = null;
  state.nfseFiscalReader.resumoPorMunicipio = null;
  state.nfseFiscalReader.lastQuery = null;
  state.nfseFiscalReader.lastLoadedAt = null;
  state.tableState.nfseFiscalReader = 'data';

  navigate('/xmls');
  await wait(0);
  await executeXmlSearch();
}

async function submitNfseNumberingExceptionForm(form) {
  if (state.modal?.kind !== 'nfse-numbering-exception') {
    return;
  }

  const data = new FormData(form);
  const clienteId = String(data.get('clienteId') || state.modal.clientId || '').trim();
  const cnpjConsulta = normalizeDigits(String(data.get('cnpjConsulta') || state.modal.cnpjConsulta || ''));
  const ambiente = String(data.get('ambiente') || state.modal.ambiente || 'producao').trim() || 'producao';
  const numeroNfseRaw = String(data.get('numeroNfse') || '').trim();
  const tipo = String(data.get('tipo') || state.modal.tipo || 'inutilizada').trim() || 'inutilizada';
  const observacao = String(data.get('observacao') || '').trim();
  const { numbers: numerosNfse, invalidTokens } = parseNfseNumberingExceptionNumbers(numeroNfseRaw);

  if (!clienteId || !cnpjConsulta || numerosNfse.length === 0) {
    state.modal = {
      ...state.modal,
      errorMessage: 'Informe cliente, CNPJ e ao menos um numero valido da NFS-e para registrar a excecao.'
    };
    render();
    return;
  }

  if (invalidTokens.length) {
    state.modal = {
      ...state.modal,
      errorMessage: `Nao foi possivel interpretar estes itens: ${invalidTokens.join(', ')}.`
    };
    render();
    return;
  }

  state.modal = {
    ...state.modal,
    submitting: true,
    ambiente,
    numeroNfse: numeroNfseRaw,
    tipo,
    observacao,
    errorMessage: ''
  };
  render();

  try {
    for (const numeroNfse of numerosNfse) {
      await apiRequest('/nfse/numeracao-excecoes', {
        method: 'POST',
        body: {
          clienteId,
          cnpjConsulta,
          ambiente,
          numeroNfse,
          tipo,
          observacao: observacao || undefined
        }
      });
    }

    if (state.modal?.kind === 'nfse-numbering-exception') {
      state.modal = {
        ...state.modal,
        submitting: false,
        numeroNfse: '',
        observacao: '',
        errorMessage: ''
      };
      render();
    }

    await refreshApiData();
    if (state.xmlSearch.hasSearched && state.xmlSearch.lastQuery?.cliente === clienteId) {
      await executeXmlSearch();
    }
    await loadNfseNumberingExceptionsForModal();
    pushToast(
      `${numerosNfse.length} excecao(oes) de numeracao salva(s) com sucesso.`,
      'success'
    );
  } catch (error) {
    if (state.modal?.kind !== 'nfse-numbering-exception') {
      return;
    }
    state.modal = {
      ...state.modal,
      submitting: false,
      errorMessage: toErrorMessage(error)
    };
    render();
    pushToast(`Falha ao salvar a excecao de numeracao: ${toErrorMessage(error)}`, 'error');
  }
}

async function deleteNfseNumberingException(exceptionId) {
  if (state.modal?.kind !== 'nfse-numbering-exception') {
    return;
  }

  const clienteId = String(state.modal.clientId || '').trim();
  if (!exceptionId || !clienteId) {
    return;
  }

  state.modal = {
    ...state.modal,
    submitting: true,
    errorMessage: ''
  };
  render();

  try {
    await apiRequest(`/nfse/numeracao-excecoes/${encodeURIComponent(exceptionId)}?clienteId=${encodeURIComponent(clienteId)}`, {
      method: 'DELETE'
    });
    if (state.modal?.kind === 'nfse-numbering-exception') {
      state.modal = {
        ...state.modal,
        submitting: false
      };
      render();
    }
    await refreshApiData();
    if (state.xmlSearch.hasSearched && state.xmlSearch.lastQuery?.cliente === clienteId) {
      await executeXmlSearch();
    }
    await loadNfseNumberingExceptionsForModal();
    pushToast('Excecao de numeracao removida com sucesso.', 'success');
  } catch (error) {
    if (state.modal?.kind !== 'nfse-numbering-exception') {
      return;
    }
    state.modal = {
      ...state.modal,
      submitting: false,
      errorMessage: toErrorMessage(error)
    };
    render();
    pushToast(`Falha ao remover a excecao de numeracao: ${toErrorMessage(error)}`, 'error');
  }
}

function openNfseContaContabilConfigModal(clientId) {
  if (state.dataSource !== 'api') {
    pushToast('O cadastro de contas por codigo de servico so esta disponivel com a API real conectada.', 'error');
    return;
  }

  const client = findClientById(clientId);
  if (!client) {
    pushToast('Nao foi possivel identificar a empresa selecionada.', 'error');
    return;
  }

  openModal({
    kind: 'nfse-conta-contabil-config',
    clientId,
    clientName: client.razaoSocial || 'Cliente selecionado',
    codigoServico: '',
    contaContabil: '',
    submitting: false,
    loading: true,
    errorMessage: '',
    configs: []
  });
  void loadNfseContaContabilConfigsForModal();
}

async function loadNfseContaContabilConfigsForModal() {
  if (state.modal?.kind !== 'nfse-conta-contabil-config') {
    return;
  }

  state.modal = {
    ...state.modal,
    loading: true,
    errorMessage: ''
  };
  render();

  try {
    const query = new URLSearchParams({ clienteId: state.modal.clientId || '' });
    const payload = await apiRequest(`/nfse/contas-contabeis?${query.toString()}`);
    if (state.modal?.kind !== 'nfse-conta-contabil-config') {
      return;
    }
    const configs = Array.isArray(payload) ? payload : [];
    state.modal = {
      ...state.modal,
      loading: false,
      configs: [...configs].sort((left, right) => String(left.codigoServico || '').localeCompare(String(right.codigoServico || '')))
    };
    render();
  } catch (error) {
    if (state.modal?.kind !== 'nfse-conta-contabil-config') {
      return;
    }
    state.modal = {
      ...state.modal,
      loading: false,
      errorMessage: toErrorMessage(error)
    };
    render();
  }
}

async function submitNfseContaContabilConfigForm(form) {
  if (state.modal?.kind !== 'nfse-conta-contabil-config') {
    return;
  }

  const data = new FormData(form);
  const clienteId = String(data.get('clienteId') || state.modal.clientId || '').trim();
  const codigoServico = String(data.get('codigoServico') || '').trim();
  const contaContabil = String(data.get('contaContabil') || '').trim();

  if (!clienteId || !codigoServico || !contaContabil) {
    state.modal = {
      ...state.modal,
      errorMessage: 'Informe o codigo do servico e a conta contabil para salvar a configuracao.'
    };
    render();
    return;
  }

  state.modal = {
    ...state.modal,
    submitting: true,
    codigoServico,
    contaContabil,
    errorMessage: ''
  };
  render();

  try {
    await apiRequest('/nfse/contas-contabeis', {
      method: 'POST',
      body: {
        clienteId,
        codigoServico,
        contaContabil
      }
    });

    if (state.modal?.kind === 'nfse-conta-contabil-config') {
      state.modal = {
        ...state.modal,
        submitting: false,
        codigoServico: '',
        contaContabil: '',
        errorMessage: ''
      };
      render();
    }

    await loadNfseContaContabilConfigsForModal();
    pushToast('Configuracao de conta contabil salva com sucesso.', 'success');
  } catch (error) {
    if (state.modal?.kind !== 'nfse-conta-contabil-config') {
      return;
    }
    state.modal = {
      ...state.modal,
      submitting: false,
      errorMessage: toErrorMessage(error)
    };
    render();
    pushToast(`Falha ao salvar a configuracao de conta contabil: ${toErrorMessage(error)}`, 'error');
  }
}

async function toggleNfseContaContabilConfigAtivo(configId, nextAtivo) {
  if (state.modal?.kind !== 'nfse-conta-contabil-config') {
    return;
  }

  const clienteId = String(state.modal.clientId || '').trim();
  if (!configId || !clienteId) {
    return;
  }

  state.modal = {
    ...state.modal,
    submitting: true,
    errorMessage: ''
  };
  render();

  try {
    await apiRequest(`/nfse/contas-contabeis/${encodeURIComponent(configId)}?clienteId=${encodeURIComponent(clienteId)}`, {
      method: 'PATCH',
      body: { ativo: nextAtivo }
    });
    if (state.modal?.kind === 'nfse-conta-contabil-config') {
      state.modal = {
        ...state.modal,
        submitting: false
      };
      render();
    }
    await loadNfseContaContabilConfigsForModal();
    pushToast(`Configuracao ${nextAtivo ? 'ativada' : 'desativada'} com sucesso.`, 'success');
  } catch (error) {
    if (state.modal?.kind !== 'nfse-conta-contabil-config') {
      return;
    }
    state.modal = {
      ...state.modal,
      submitting: false,
      errorMessage: toErrorMessage(error)
    };
    render();
    pushToast(`Falha ao atualizar a configuracao de conta contabil: ${toErrorMessage(error)}`, 'error');
  }
}

async function deleteNfseContaContabilConfig(configId) {
  if (state.modal?.kind !== 'nfse-conta-contabil-config') {
    return;
  }

  const clienteId = String(state.modal.clientId || '').trim();
  if (!configId || !clienteId) {
    return;
  }

  state.modal = {
    ...state.modal,
    submitting: true,
    errorMessage: ''
  };
  render();

  try {
    await apiRequest(`/nfse/contas-contabeis/${encodeURIComponent(configId)}?clienteId=${encodeURIComponent(clienteId)}`, {
      method: 'DELETE'
    });
    if (state.modal?.kind === 'nfse-conta-contabil-config') {
      state.modal = {
        ...state.modal,
        submitting: false
      };
      render();
    }
    await loadNfseContaContabilConfigsForModal();
    pushToast('Configuracao de conta contabil removida com sucesso.', 'success');
  } catch (error) {
    if (state.modal?.kind !== 'nfse-conta-contabil-config') {
      return;
    }
    state.modal = {
      ...state.modal,
      submitting: false,
      errorMessage: toErrorMessage(error)
    };
    render();
    pushToast(`Falha ao remover a configuracao de conta contabil: ${toErrorMessage(error)}`, 'error');
  }
}

function updatePastNsuRecoveryOverlayState(patch) {
  if (state.modal?.kind !== 'past-nsu-recovery-report') {
    return;
  }

  state.modal = {
    ...state.modal,
    ...patch
  };
  render();
}

function mapPastNsuRecoveryLiveRowStatusLabel(status, documentKind = null) {
  switch (status) {
    case 'ja_baixado':
      return documentKind === 'evento' ? 'Evento ja baixado' : 'Ja baixado';
    case 'consultando':
      return 'Consultando';
    case 'baixado':
      return documentKind === 'evento' ? 'Evento salvo' : 'Baixado';
    case 'sem_documento':
      return state.modal?.kind === 'past-nsu-recovery-report' && state.modal?.executionMode === 'gap-audit'
        ? 'Sem doc. proprio'
        : 'Sem documento';
    case 'erro':
      return 'Erro';
    default:
      return 'Na fila';
  }
}

function toneFromPastNsuRecoveryLiveStatus(status) {
  switch (status) {
    case 'ja_baixado':
      return 'info';
    case 'consultando':
      return 'warning';
    case 'baixado':
      return 'success';
    case 'sem_documento':
      return 'neutral';
    case 'erro':
      return 'danger';
    default:
      return 'neutral';
  }
}

function buildPastNsuRecoveryLiveRows(execution) {
  const rows = Array.isArray(execution?.rows) ? execution.rows : [];
  return rows.map((row) => ({
    nsuLabel: String(row?.nsu || '-'),
    cnpjConsulta: formatCnpj(row?.cnpjConsulta || '-') || '-',
    ambienteLabel: mapNfseAmbienteLabel(row?.ambiente),
    chaveAcesso: String(row?.chaveAcesso || '-'),
    statusLabel: mapPastNsuRecoveryLiveRowStatusLabel(row?.status, row?.documentKind || null),
    statusTone: toneFromPastNsuRecoveryLiveStatus(row?.status),
    message: String(row?.mensagem || '').trim() || '-'
  }));
}

function openDownloadByKeyReportModal(params) {
  openModal({
    kind: 'download-by-key-report',
    running: true,
    showClientColumn: Boolean(params?.showClientColumn),
    clientName: params?.clientName || 'Todos os clientes',
    pendingCount: Number(params?.pendingCount || 0),
    downloadedCount: Number(params?.downloadedCount || 0),
    errorCount: Number(params?.errorCount || 0),
    currentMessage: params?.currentMessage || 'Preparando leitura das chaves pendentes...',
    rows: Array.isArray(params?.rows) ? params.rows : []
  });
}

function updateDownloadByKeyOverlayState(patch) {
  if (state.modal?.kind !== 'download-by-key-report') {
    return;
  }

  state.modal = {
    ...state.modal,
    ...patch
  };
  render();
}

function openDominioImportReportModal(params) {
  openModal({
    kind: 'dominio-import-report',
    running: true,
    scopeLabel: params?.scopeLabel || 'Importacao manual da Dominio',
    totalClients: Number(params?.totalClients || 0),
    processedClients: Number(params?.processedClients || 0),
    successfulClients: Number(params?.successfulClients || 0),
    failedClients: Number(params?.failedClients || 0),
    importedDocuments: Number(params?.importedDocuments || 0),
    importSummary: normalizeDominioImportSummary(params?.importSummary),
    currentMessage: params?.currentMessage || 'Preparando importacao manual...',
    rows: Array.isArray(params?.rows) ? params.rows : []
  });
}

function updateDominioImportOverlayState(patch) {
  if (state.modal?.kind !== 'dominio-import-report') {
    return;
  }

  state.modal = {
    ...state.modal,
    ...patch
  };
  render();
}

function mapDominioImportOverlayStatusLabel(status) {
  switch (status) {
    case 'preparando':
      return 'Preparando';
    case 'importando':
      return 'Consultando';
    case 'concluido':
      return 'Concluido';
    case 'concluido_com_falhas':
      return 'Concluido com falhas';
    case 'erro':
      return 'Erro';
    default:
      return 'Na fila';
  }
}

function toneFromDominioImportOverlayStatus(status) {
  switch (status) {
    case 'preparando':
      return 'warning';
    case 'importando':
      return 'info';
    case 'concluido':
      return 'success';
    case 'concluido_com_falhas':
      return 'warning';
    case 'erro':
      return 'danger';
    default:
      return 'neutral';
  }
}

function buildDominioImportOverlayRows(clients, periodLabel) {
  return (Array.isArray(clients) ? clients : []).map((client) => ({
    clientId: client.id,
    clientLabel: client.razaoSocial || 'Cliente',
    clientDetail: formatCnpj(client.cnpj || ''),
    periodLabel,
    status: 'na_fila',
    stepLabel: 'Aguardando inicio',
    importedCount: 0,
    failureCount: 0,
    importSummary: normalizeDominioImportSummary(),
    message: 'Empresa aguardando processamento.'
  }));
}

function patchDominioImportOverlayRow(rows, clientId, patch) {
  return (Array.isArray(rows) ? rows : []).map((row) => (row.clientId === clientId ? { ...row, ...patch } : row));
}

function formatDominioImportPeriodLabel(dataEmissaoInicio, dataEmissaoFim) {
  const start = dataEmissaoInicio || 'inicio aberto';
  const end = dataEmissaoFim || 'fim aberto';
  return `${start} ate ${end}`;
}

function renderOverlayFailureToolbar({ showOnlyFailures, failureRows, visibleRows, totalRows }) {
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin:-4px 0 14px;">
      <div style="color:var(--text-secondary); font-size:13px;">
        Exibindo <strong>${escapeHtml(String(visibleRows))}</strong> de <strong>${escapeHtml(String(totalRows))}</strong> linha(s)
        ${failureRows ? ` • <strong>${escapeHtml(String(failureRows))}</strong> com falha` : ''}
      </div>
      <button class="btn secondary" type="button" data-action="overlay-toggle-failures">
        ${showOnlyFailures ? 'Mostrar tudo' : 'Somente falhas'}
      </button>
    </div>
  `;
}

function getOverlayVisibleRows(modalKind, rows, showOnlyFailures) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (!showOnlyFailures) {
    return normalizedRows;
  }

  return normalizedRows.filter((row) => shouldKeepOverlayFailureRow(modalKind, row));
}

function countOverlayFailureRows(modalKind, rows) {
  return getOverlayVisibleRows(modalKind, rows, true).length;
}

function shouldKeepOverlayFailureRow(modalKind, row) {
  if (!row) {
    return false;
  }

  if (modalKind === 'dominio-import-report') {
    return Number(row.failureCount || 0) > 0 || row.status === 'erro' || row.status === 'concluido_com_falhas';
  }

  return String(row.statusTone || '') === 'danger';
}

function mapDownloadByKeyDocumentLabel(modelo, kind = 'documento') {
  if (kind === 'controle') {
    return 'Controle';
  }
  if (String(modelo || '') === '57') {
    return 'CT-e';
  }
  if (String(modelo || '') === '55') {
    return 'NF-e';
  }
  return 'Documento';
}

function buildDownloadByKeyPreviewRows(rawRows, showClientColumn = false) {
  return (Array.isArray(rawRows) ? rawRows : []).map((row) => {
    const client = findClientById(row?.clientId);
    const isControl = row?.kind === 'controle';
    return {
      kind: isControl ? 'controle' : 'documento',
      clientId: String(row?.clientId || ''),
      estabelecimentoId: String(row?.estabelecimentoId || ''),
      catalogoId: Number(row?.catalogoId || 0) || null,
      chaveAcesso: String(row?.chaveAcesso || ''),
      modelo: String(row?.modelo || ''),
      clientLabel: client?.razaoSocial || 'Cliente nao localizado',
      clientDetail: showClientColumn ? formatCnpj(client?.cnpj || row?.cnpjConsulta || '') : '',
      keyDetail: isControl
        ? `CNPJ ${formatCnpj(row?.cnpjConsulta || '') || '-'}`
        : `Catalogo ${String(row?.catalogoId || '-')} • ${mapNfeAmbienteLabel(row?.ambiente)}`,
      documentLabel: mapDownloadByKeyDocumentLabel(row?.modelo, row?.kind),
      documentDetail: isControl
        ? `${mapNfeAmbienteLabel(row?.ambiente)} • ${formatCnpj(row?.cnpjConsulta || '') || '-'}`
        : mapNfeAmbienteLabel(row?.ambiente),
      statusLabel: isControl ? 'Erro' : 'Aguardando',
      statusTone: isControl ? 'danger' : 'neutral',
      message: String(row?.mensagem || '').trim() || (isControl ? 'Falha ao preparar o controle.' : 'Chave localizada e aguardando download oficial.')
    };
  });
}

function buildDownloadByKeyRunningRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) =>
    row.kind === 'documento'
      ? {
          ...row,
          statusLabel: 'Baixando',
          statusTone: 'info',
          message: 'Aguardando retorno do backend para esta chave...'
        }
      : row
  );
}

function mapDownloadByKeyFinalStatusLabel(status) {
  return status === 'persistido' ? 'Baixada' : 'Erro';
}

function mapDownloadByKeyFinalStatusTone(status) {
  return status === 'persistido' ? 'success' : 'danger';
}

function buildDownloadByKeyResolvedRows(rows, response) {
  const details = Array.isArray(response?.executionDetails) ? response.executionDetails : [];
  const controlFailures = Array.isArray(response?.failureDetails)
    ? response.failureDetails.filter((detail) => detail?.kind === 'controle')
    : [];

  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (row.kind !== 'documento') {
      return row;
    }

    const detail = details.find(
      (item) =>
        item?.kind === 'documento' &&
        String(item?.clientId || '') === row.clientId &&
        Number(item?.catalogoId || 0) === Number(row.catalogoId || 0)
    );

    if (detail) {
      return {
        ...row,
        chaveAcesso: String(detail?.chaveAcesso || row.chaveAcesso || ''),
        modelo: String(detail?.modelo || row.modelo || ''),
        documentLabel: mapDownloadByKeyDocumentLabel(detail?.modelo || row.modelo),
        statusLabel: mapDownloadByKeyFinalStatusLabel(detail?.status),
        statusTone: mapDownloadByKeyFinalStatusTone(detail?.status),
        message: String(detail?.mensagem || '').trim() || 'Consulta concluida sem mensagem adicional.'
      };
    }

    const controlFailure = controlFailures.find(
      (item) =>
        String(item?.clientId || '') === row.clientId && String(item?.estabelecimentoId || '') === row.estabelecimentoId
    );

    if (controlFailure) {
      return {
        ...row,
        statusLabel: 'Erro',
        statusTone: 'danger',
        message: String(controlFailure?.mensagem || '').trim() || 'Falha no controle antes do download por chave.'
      };
    }

    return {
      ...row,
      statusLabel: 'Erro',
      statusTone: 'danger',
      message: 'Sem retorno individual desta chave na execucao.'
    };
  });
}

function countDownloadByKeyRowsByStatus(rows, targetStatusLabel) {
  return (Array.isArray(rows) ? rows : []).filter((row) => String(row?.statusLabel || '') === targetStatusLabel).length;
}

function countDownloadByKeyErrorRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => String(row?.statusTone || '') === 'danger').length;
}

function resolveDownloadByKeyTimeoutMs(pendingCount) {
  return Math.min(15 * 60 * 1000, Math.max(5 * 60 * 1000, Number(pendingCount || 0) * 12000));
}

function buildPastNsuRecoveryAuditRows(summary) {
  const details = Array.isArray(summary?.detalhes) ? summary.detalhes : [];
  const isGapAudit = Number(summary?.documentosGapResolvidos || 0) > 0 || Number(summary?.documentosAdicionaisSalvos || 0) > 0;

  return details.map((detail) => {
    const status = resolvePastNsuRecoveryStatus(detail);

    return {
      cnpjConsulta: formatCnpj(detail?.cnpjConsulta || '-') || '-',
      ambienteLabel: mapNfseAmbienteLabel(detail?.ambiente),
      nsuRangeLabel: `${String(detail?.nsuInicial || '1')} ate ${String(detail?.nsuFinal || '0')}`,
      resultLabel: isGapAudit
        ? `${Number(detail?.documentosGapResolvidos || 0)} lacuna(s) resolvida(s)`
        : `${Number(detail?.documentosSalvos || 0)} XML(s) salvo(s)`,
      detailLabel: isGapAudit
        ? `${Number(detail?.documentosAdicionaisSalvos || 0)} XML(s) adicional(is), ${Number(detail?.nsusConsultados || 0)} NSU(s) consultado(s), ${Number(detail?.semDocumento || 0)} sem documento proprio`
        : `${Number(detail?.nsusConsultados || 0)} NSU(s) consultado(s), ${Number(detail?.documentosIgnoradosExistentes || 0) + Number(detail?.nsusIgnoradosComDocumento || 0)} existente(s), ${Number(detail?.semDocumento || 0)} sem documento`,
      statusLabel: mapPastNsuRecoveryStatusLabel(status),
      statusTone: toneFromPastNsuRecoveryStatus(status),
      message: buildPastNsuRecoveryRowMessage(detail, status, isGapAudit)
    };
  });
}

function resolvePastNsuRecoveryStatus(detail) {
  if (Number(detail?.falhas || 0) > 0) {
    return 'falha';
  }
  if (Number(detail?.documentosSalvos || 0) > 0) {
    return 'sucesso';
  }
  if (Number(detail?.nsusConsultados || 0) > 0 || Number(detail?.nsusIgnoradosComDocumento || 0) > 0) {
    return 'processado';
  }
  return 'sem_acao';
}

function mapPastNsuRecoveryStatusLabel(status) {
  switch (status) {
    case 'sucesso':
      return 'Concluido';
    case 'falha':
      return 'Falha';
    case 'processado':
      return 'Processado';
    default:
      return 'Sem acao';
  }
}

function toneFromPastNsuRecoveryStatus(status) {
  switch (status) {
    case 'sucesso':
      return 'success';
    case 'falha':
      return 'danger';
    case 'processado':
      return 'info';
    default:
      return 'neutral';
  }
}

function buildPastNsuRecoveryRowMessage(detail, status, isGapAudit = false) {
  if (status === 'falha') {
    return `${Number(detail?.falhas || 0)} falha(s) registrada(s) durante o reprocessamento.`;
  }
  if (isGapAudit && Number(detail?.documentosGapResolvidos || 0) > 0) {
    return `A auditoria confirmou ${Number(detail?.documentosGapResolvidos || 0)} documento(s) da lacuna neste controle.`;
  }
  if (isGapAudit && Number(detail?.documentosAdicionaisSalvos || 0) > 0) {
    return 'Os NSUs consultados trouxeram XMLs adicionais do lote, mas eles nao contam como lacuna resolvida.';
  }
  if (Number(detail?.documentosSalvos || 0) > 0) {
    return 'Foram recuperados XMLs faltantes para este controle.';
  }
  if (Number(detail?.semDocumento || 0) > 0) {
    return 'Os NSUs consultados nao retornaram documento aproveitavel.';
  }
  if (Number(detail?.nsusIgnoradosComDocumento || 0) > 0 || Number(detail?.documentosIgnoradosExistentes || 0) > 0) {
    return 'Os documentos desse intervalo ja estavam armazenados.';
  }
  return 'Nenhuma acao adicional foi necessaria para este controle.';
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

const TOAST_PRESERVED_SCROLL_SELECTORS = [...XML_READER30_SCROLL_SELECTORS, '.nfse-fiscal-reader-scroll'];

function pushToast(message, tone = 'info') {
  const toast = {
    id: createBrowserId(),
    message,
    tone: ['success', 'error', 'info'].includes(tone) ? tone : 'info'
  };

  state.toasts = [...state.toasts, toast].slice(-4);
  renderPreservingScroll(TOAST_PRESERVED_SCROLL_SELECTORS);

  setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== toast.id);
    renderPreservingScroll(TOAST_PRESERVED_SCROLL_SELECTORS);
  }, 3200);
}

function buildPageLoadingPlan(route = state.route) {
  const meta = resolvePageMetaForRoute(route);
  const routeSpecificDescription =
    route?.name === 'auditoria-lacunas'
      ? 'Atualizando dados gerais e a auditoria de lacunas desta tela.'
      : `Atualizando os dados exibidos em ${meta.title}.`;

  return {
    title: `Carregando ${meta.title}`,
    description: routeSpecificDescription,
    initialTask: 'Preparando pagina'
  };
}

function normalizeNfseFiscalReaderResponse(payload) {
  const items = Array.isArray(payload?.items)
    ? payload.items.map((row) => ({
        id: String(row?.id || '').trim(),
        clienteId: String(row?.clienteId || '').trim(),
        estabelecimentoId: String(row?.estabelecimentoId || '').trim(),
        numeroNfse: row?.numeroNfse == null ? '' : String(row.numeroNfse),
        chaveAcesso: String(row?.chaveAcesso || '').trim(),
        cancelada: Boolean(row?.cancelada),
        dataEmissao: row?.dataEmissao ? String(row.dataEmissao) : '',
        prestador: String(row?.prestador || '').trim(),
        cnpjPrestador: normalizeDigits(String(row?.cnpjPrestador || '')),
        tomador: String(row?.tomador || '').trim(),
        cnpjTomador: normalizeDigits(String(row?.cnpjTomador || '')),
        municipio: String(row?.municipio || '').trim(),
        codigoServicoPrestado: String(row?.codigoServicoPrestado || '').trim(),
        descricaoServico: String(row?.descricaoServico || '').trim(),
        layout: String(row?.layout || '').trim(),
        localPrestacao: String(row?.localPrestacao || '').trim(),
        localIncidenciaIss: String(row?.localIncidenciaIss || '').trim(),
        valorServico: row?.valorServico ?? '',
        valorLiquidoNfse: row?.valorLiquidoNfse ?? '',
        valorTotalRetencoes: row?.valorTotalRetencoes ?? '',
        valorIss: row?.valorIss ?? '',
        valorIssRetido: row?.valorIssRetido ?? '',
        valorIssRetidoReal: row?.valorIssRetidoReal ?? '',
        valorIrrf: row?.valorIrrf ?? '',
        valorInss: row?.valorInss ?? '',
        valorCsll: row?.valorCsll ?? '',
        valorPis: row?.valorPis ?? '',
        valorCofins: row?.valorCofins ?? '',
        aliquotaIss: row?.aliquotaIss ?? '',
        aliquotaRealIss: row?.aliquotaRealIss ?? '',
        retencaoIss: String(row?.retencaoIss || '').trim(),
        retencaoFederal: String(row?.retencaoFederal || '').trim(),
        totalRetencoesFederais: row?.totalRetencoesFederais ?? '',
        statusProcessamento: String(row?.statusProcessamento || '').trim(),
        erroProcessamento: String(row?.erroProcessamento || '').trim(),
        camposComProblema: Array.isArray(row?.camposComProblema)
          ? row.camposComProblema.map((item) => String(item || '').trim()).filter(Boolean)
          : []
      }))
    : [];
  const summary = payload?.summary
    ? {
        totalDocumentosFiltrados: Number(payload.summary.totalDocumentosFiltrados || 0),
        totalDocumentosLidos: Number(payload.summary.totalDocumentosLidos || 0),
        totalDocumentosComErro: Number(payload.summary.totalDocumentosComErro || 0),
        totalDocumentosSemXml: Number(payload.summary.totalDocumentosSemXml || 0),
        valorServicoTotal: Number(payload.summary.valorServicoTotal || 0),
        valorLiquidoTotal: Number(payload.summary.valorLiquidoTotal || 0),
        valorRetidoTotal: Number(payload.summary.valorRetidoTotal || 0),
        valorIssTotal: Number(payload.summary.valorIssTotal || 0),
        valorIssRetidoRealTotal: Number(payload.summary.valorIssRetidoRealTotal || 0),
        totalRetencoesFederais: Number(payload.summary.totalRetencoesFederais || 0)
      }
    : null;
  const normalizeResumoPorMunicipio = (list) =>
    Array.isArray(list)
      ? list.map((item) => ({
          municipio: String(item?.municipio || '').trim() || 'Nao informado',
          quantidadeNotas: Number(item?.quantidadeNotas || 0),
          valorServicoTotal: Number(item?.valorServicoTotal || 0),
          valorLiquidoTotal: Number(item?.valorLiquidoTotal || 0),
          valorIssTotal: Number(item?.valorIssTotal || 0)
        }))
      : [];
  const resumoPorMunicipio = {
    localPrestacao: normalizeResumoPorMunicipio(payload?.resumoPorMunicipio?.localPrestacao),
    localIncidenciaIss: normalizeResumoPorMunicipio(payload?.resumoPorMunicipio?.localIncidenciaIss)
  };

  return {
    items,
    total: Number(payload?.total || items.length || 0),
    summary,
    resumoPorMunicipio
  };
}

function startPageLoading(plan = {}) {
  state.pageLoading = {
    active: true,
    title: String(plan.title || 'Carregando pagina'),
    description: String(plan.description || 'Atualizando dados da pagina atual.'),
    currentTask: String(plan.initialTask || 'Preparando pagina'),
    completedTasks: []
  };
}

function updatePageLoadingTask(task) {
  const label = String(task || '').trim();
  if (!state.pageLoading.active || !label) {
    return;
  }

  const current = String(state.pageLoading.currentTask || '').trim();
  if (current && current !== label) {
    state.pageLoading.completedTasks = [...state.pageLoading.completedTasks, current].slice(-4);
  }

  state.pageLoading.currentTask = label;
  render();
}

function stopPageLoading() {
  state.pageLoading = {
    active: false,
    title: '',
    description: '',
    currentTask: '',
    completedTasks: []
  };
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

async function refreshApiData(options = {}) {
  if (state.dataSource !== 'api') {
    render();
    return;
  }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  try {
    await hydrateFromApi({ onProgress });
    await ensureRouteDataLoaded({ silent: true, onProgress });
  } catch (error) {
    if (!options.silent) {
      pushToast(`Falha ao atualizar dados reais: ${toErrorMessage(error)}`, 'error');
    }
  }
  render();
}

async function loadAuthAdminData(options = {}) {
  if (state.auth.user?.role !== 'admin') {
    return;
  }

  state.auth.adminData.loading = true;
  render();

  try {
    const defaultReport = createEmptyAuthAdminData().report;
    const currentReport = state.auth.adminData.report || defaultReport;
    const report = {
      periodoInicio: String(currentReport.periodoInicio || defaultReport.periodoInicio),
      periodoFim: String(currentReport.periodoFim || defaultReport.periodoFim)
    };
    const reportParams = new URLSearchParams({
      periodoInicio: report.periodoInicio,
      periodoFim: report.periodoFim
    });
    const [users, sessions, events, reportRows] = await Promise.all([
      apiRequest('/auth/usuarios'),
      apiRequest('/auth/sessoes?limit=100'),
      apiRequest('/auth/eventos-acesso?limit=100'),
      apiRequest(`/auth/relatorio-tempo-acesso?${reportParams.toString()}`)
    ]);

    state.auth.adminData.users = Array.isArray(users) ? users : [];
    state.auth.adminData.sessions = Array.isArray(sessions) ? sessions : [];
    state.auth.adminData.events = Array.isArray(events) ? events : [];
    state.auth.adminData.report = {
      periodoInicio: report.periodoInicio,
      periodoFim: report.periodoFim,
      rows: Array.isArray(reportRows) ? reportRows : []
    };
    state.auth.adminData.lastLoadedAt = new Date().toISOString();
  } catch (error) {
    if (!options.silent) {
      pushToast(`Falha ao carregar administracao de acessos: ${toErrorMessage(error)}`, 'error');
    }
  } finally {
    state.auth.adminData.loading = false;
    render();
  }
}

function renderAuthAccessSettingsPanel() {
  if (state.auth.user?.role !== 'admin') {
    return '<div class="table-state error">Apenas administradores podem gerenciar usuarios e acessos.</div>';
  }

  const adminData = state.auth.adminData;
  const loading = adminData.loading;
  const users = Array.isArray(adminData.users) ? adminData.users : [];
  const sessions = Array.isArray(adminData.sessions) ? adminData.sessions : [];
  const events = Array.isArray(adminData.events) ? adminData.events : [];
  const report = adminData.report || createEmptyAuthAdminData().report;
  const reportRows = Array.isArray(report.rows) ? report.rows : [];
  const reportTotalDurationMs = reportRows.reduce((total, row) => total + Number(row?.totalDurationMs || 0), 0);

  return `
    <div class="stack" style="gap:16px;">
      <div class="kpi-grid">
        ${kpiItem('Usuarios', users.length)}
        ${kpiItem('Sessoes ativas', sessions.filter((session) => session.ativa).length)}
        ${kpiItem('Eventos recentes', events.length)}
        ${kpiItem('Tempo no periodo', formatDurationMs(reportTotalDurationMs))}
        ${kpiItem('Ultima carga', adminData.lastLoadedAt ? formatDateTime(adminData.lastLoadedAt) : '-')}
      </div>

      <div class="stack-actions" style="justify-content:flex-start;">
        <button class="btn secondary" type="button" data-action="settings-auth-reload" ${loading ? 'disabled' : ''}>
          ${loading ? 'Atualizando...' : 'Atualizar acessos'}
        </button>
      </div>

      <form id="settingsAuthUserForm" class="form-grid four">
        <label class="field">
          Usuario
          <input name="username" required />
        </label>
        <label class="field">
          Nome
          <input name="nome" />
        </label>
        <label class="field">
          Perfil
          <select name="role">${renderOptions(['admin', 'comum', 'cliente'], 'comum', { admin: 'Administrador', comum: 'Comum', cliente: 'Cliente' })}</select>
        </label>
        <label class="field">
          Cliente vinculado
          <select name="clienteId">${renderClientOptionsForAuthUser()}</select>
        </label>
        <label class="field" style="grid-column: span 2;">
          Senha inicial
          <input name="password" type="password" minlength="1" required />
        </label>
        <label class="field-inline" style="align-self:end;">
          <input name="ativo" type="checkbox" checked />
          <span>Usuario ativo</span>
        </label>
        <div class="stack-actions" style="grid-column: span 4; justify-content:flex-start;">
          <button class="btn primary" type="submit" ${state.settings.acessos.creatingUser ? 'disabled' : ''}>
            ${state.settings.acessos.creatingUser ? 'Criando...' : 'Criar usuario'}
          </button>
        </div>
      </form>

      <div class="card">
        <div class="card-header" style="margin-bottom:12px;">
          <div>
            <h3 style="margin:0;">Relatorio de tempo por usuario</h3>
            <p class="card-subtitle" style="margin:6px 0 0 0;">Soma o tempo logado por usuario dentro do periodo selecionado.</p>
          </div>
        </div>
        <form id="settingsAuthReportForm" class="form-grid four">
          <label class="field">
            Periodo inicial
            <input name="periodoInicio" type="date" value="${escapeHtml(report.periodoInicio || '')}" required />
          </label>
          <label class="field">
            Periodo final
            <input name="periodoFim" type="date" value="${escapeHtml(report.periodoFim || '')}" required />
          </label>
          <div class="stack-actions" style="grid-column: span 2; justify-content:flex-start; align-self:end;">
            <button class="btn secondary" type="submit" ${loading ? 'disabled' : ''}>
              ${loading ? 'Atualizando...' : 'Gerar relatorio'}
            </button>
          </div>
        </form>
      </div>

      <div class="card" style="padding:0; overflow:auto;">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Perfil</th>
              <th>Sessoes no periodo</th>
              <th>Sessoes ativas</th>
              <th>Tempo total</th>
              <th>Ultima atividade</th>
            </tr>
          </thead>
          <tbody>
            ${
              reportRows.length
                ? reportRows
                    .map(
                      (row) => `
                        <tr>
                          <td>
                            <strong>${escapeHtml(row.nome || row.username)}</strong>
                            <div class="row-sub">${escapeHtml(row.username)}</div>
                          </td>
                          <td>${statusBadge(formatAuthRoleLabel(row.role), row.role === 'admin' ? 'info' : row.role === 'comum' ? 'success' : 'neutral')}</td>
                          <td>${escapeHtml(String(row.totalSessions || 0))}</td>
                          <td>${escapeHtml(String(row.activeSessions || 0))}</td>
                          <td>${escapeHtml(formatDurationMs(row.totalDurationMs))}</td>
                          <td>${escapeHtml(row.lastActivityAt ? formatDateTime(row.lastActivityAt) : '-')}</td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td colspan="6"><div class="table-state">Nenhum acesso encontrado no periodo informado.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>

      <div class="card" style="padding:0; overflow:auto;">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Perfil</th>
              <th>Cliente</th>
              <th>Ultimo login</th>
              <th>Status</th>
              <th style="width:200px;">Acoes</th>
            </tr>
          </thead>
          <tbody>
            ${
              users.length
                ? users
                    .map(
                      (user) => `
                        <tr>
                          <td>
                            <strong>${escapeHtml(user.nome || user.username)}</strong>
                            <div class="row-sub">${escapeHtml(user.username)}</div>
                          </td>
                          <td>${statusBadge(formatAuthRoleLabel(user.role), user.role === 'admin' ? 'info' : user.role === 'comum' ? 'success' : 'neutral')}</td>
                          <td>${escapeHtml(resolveClientName(user.clienteId))}</td>
                          <td>${escapeHtml(user.ultimoLoginAt ? formatDateTime(user.ultimoLoginAt) : '-')}</td>
                          <td>${statusBadge(user.ativo ? 'Ativo' : 'Inativo', user.ativo ? 'success' : 'neutral')}</td>
                          <td>
                            <div class="stack-actions" style="justify-content:flex-start;">
                              <button class="btn secondary" type="button" data-action="auth-user-reset-password" data-user-id="${escapeHtml(user.id)}">Resetar senha</button>
                              <button class="btn ${user.ativo ? 'secondary' : 'primary'}" type="button" data-action="auth-user-toggle-active" data-user-id="${escapeHtml(user.id)}" data-next-active="${user.ativo ? 'false' : 'true'}">
                                ${user.ativo ? 'Desativar' : 'Ativar'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td colspan="6"><div class="table-state">Nenhum usuario cadastrado.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>

      <div class="card" style="padding:0; overflow:auto;">
        <table>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Inicio</th>
              <th>Ultima atividade</th>
              <th>Duracao</th>
              <th>Origem</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${
              sessions.length
                ? sessions
                    .map(
                      (session) => `
                        <tr>
                          <td>${escapeHtml(session.nome || session.username)}</td>
                          <td>${escapeHtml(formatDateTime(session.loginAt))}</td>
                          <td>${escapeHtml(formatDateTime(session.lastSeenAt))}</td>
                          <td>${escapeHtml(formatDurationMs(session.durationMs))}</td>
                          <td>${escapeHtml(session.ip || '-')}</td>
                          <td>${statusBadge(session.ativa ? 'Ativa' : session.logoutAt ? 'Logout' : session.revokedAt ? 'Revogada' : 'Expirada', session.ativa ? 'success' : 'neutral')}</td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td colspan="6"><div class="table-state">Nenhuma sessao registrada.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>

      <div class="card" style="padding:0; overflow:auto;">
        <table>
          <thead>
            <tr>
              <th>Quando</th>
              <th>Tipo</th>
              <th>Usuario</th>
              <th>IP</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            ${
              events.length
                ? events
                    .map(
                      (event) => `
                        <tr>
                          <td>${escapeHtml(formatDateTime(event.createdAt))}</td>
                          <td>${statusBadge(formatAccessEventLabel(event.tipo), toneFromAccessEvent(event.tipo))}</td>
                          <td>${escapeHtml(event.username || '-')}</td>
                          <td>${escapeHtml(event.ip || '-')}</td>
                          <td>${escapeHtml(formatAccessEventDetails(event.detalhes))}</td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td colspan="5"><div class="table-state">Nenhum evento de acesso registrado.</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderClientOptionsForAuthUser() {
  const options = [''];
  const labels = { '': 'Sem vinculo de cliente' };

  state.clients.forEach((client) => {
    options.push(client.id);
    labels[client.id] = client.razaoSocial;
  });

  return renderOptions(options, '', labels);
}

function syncDashboardAutoRefresh() {
  if (dashboardAutoRefreshTimer) {
    window.clearInterval(dashboardAutoRefreshTimer);
    dashboardAutoRefreshTimer = null;
  }

  if (!state.dataReady || state.dataSource !== 'api' || state.route.name !== 'dashboard') {
    return;
  }

  dashboardAutoRefreshTimer = window.setInterval(() => {
    void refreshDashboardRouteData({ silent: true });
  }, DASHBOARD_AUTO_REFRESH_INTERVAL_MS);
}

async function refreshDashboardRouteData(options = {}) {
  if (!state.dataReady || state.dataSource !== 'api' || state.route.name !== 'dashboard' || dashboardAutoRefreshRunning) {
    return;
  }

  dashboardAutoRefreshRunning = true;
  try {
    await refreshApiData(options);
  } finally {
    dashboardAutoRefreshRunning = false;
  }
}

async function ensureRouteDataLoaded(options = {}) {
  if (state.dataSource !== 'api') {
    return;
  }

  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  if (state.route.name === 'auditoria-lacunas') {
    onProgress?.('Carregando auditoria de lacunas');
    await loadNfseGapAuditOverview(options);
    return;
  }

  if (state.route.name === 'configuracoes' && state.settings.tab === 'acessos' && state.auth.user?.role === 'admin') {
    onProgress?.('Carregando usuarios, sessoes, eventos e relatorio de acesso');
    await loadAuthAdminData({ silent: options.silent });
  }
}

function shouldLoadRouteData(route = state.route) {
  if (state.dataSource !== 'api') {
    return false;
  }

  if (route?.name === 'auditoria-lacunas') {
    return !state.nfseGapAuditOverview.lastLoadedAt;
  }

  if (route?.name === 'configuracoes' && state.settings.tab === 'acessos' && state.auth.user?.role === 'admin') {
    return !state.auth.adminData.lastLoadedAt;
  }

  return false;
}

async function refreshExecutionMonitorNow() {
  if (state.dataSource === 'api') {
    await refreshApiData();
  }
  syncExecutionMonitorWithData();
  render();
}

async function submitAuthLoginForm(form) {
  const formData = new FormData(form);
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');

  if (!username || !password) {
    pushToast('Informe usuario e senha para entrar.', 'error');
    return;
  }

  state.auth.authenticating = true;
  render();

  try {
    const payload = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username, password },
      skipAuth: true,
      skipAuthRefresh: true
    });

    applyAuthPayload(payload);
    state.auth.initialized = true;
    render();
    await initializeData();
    pushToast(`Sessao iniciada para ${state.auth.user?.nome || state.auth.user?.username || username}.`, 'success');
  } catch (error) {
    pushToast(`Falha no login: ${toErrorMessage(error)}`, 'error');
  } finally {
    state.auth.authenticating = false;
    render();
  }
}

async function performLogout() {
  try {
    if (state.auth.accessToken) {
      await apiRequest('/auth/logout', {
        method: 'POST',
        sessionActivity: 'passive',
        suppressAuthFailureToast: true
      });
    }
  } catch {}

  finalizeLoggedOutState();
}

async function submitSettingsAuthUserForm(form) {
  state.settings.acessos.creatingUser = true;
  render();

  try {
    const formData = new FormData(form);
    const role = String(formData.get('role') || 'admin');
    const clienteId = String(formData.get('clienteId') || '').trim();

    await apiRequest('/auth/usuarios', {
      method: 'POST',
      body: {
        username: String(formData.get('username') || '').trim(),
        nome: String(formData.get('nome') || '').trim() || undefined,
        password: String(formData.get('password') || ''),
        role,
        clienteId: role === 'cliente' && clienteId ? clienteId : undefined,
        ativo: formData.get('ativo') === 'on'
      }
    });

    form.reset();
    pushToast('Usuario criado com sucesso.', 'success');
    await loadAuthAdminData();
  } catch (error) {
    pushToast(`Falha ao criar usuario: ${toErrorMessage(error)}`, 'error');
  } finally {
    state.settings.acessos.creatingUser = false;
    render();
  }
}

async function submitSettingsAuthReportForm(form) {
  const formData = new FormData(form);
  const periodoInicio = String(formData.get('periodoInicio') || '').trim();
  const periodoFim = String(formData.get('periodoFim') || '').trim();

  if (!periodoInicio || !periodoFim) {
    pushToast('Informe o periodo inicial e final do relatorio.', 'error');
    return;
  }

  if (periodoInicio > periodoFim) {
    pushToast('O periodo inicial nao pode ser maior que o periodo final.', 'error');
    return;
  }

  state.auth.adminData.report = {
    ...(state.auth.adminData.report || {}),
    periodoInicio,
    periodoFim,
    rows: Array.isArray(state.auth.adminData.report?.rows) ? state.auth.adminData.report.rows : []
  };
  render();
  await loadAuthAdminData();
}

async function toggleAuthUserActive(userId, ativo) {
  const user = state.auth.adminData.users.find((item) => item.id === userId);
  if (!user) {
    return;
  }

  try {
    await apiRequest(`/auth/usuarios/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: {
        ativo
      }
    });
    pushToast(`Usuario ${ativo ? 'ativado' : 'desativado'} com sucesso.`, 'success');
    await loadAuthAdminData();
  } catch (error) {
    pushToast(`Falha ao atualizar usuario: ${toErrorMessage(error)}`, 'error');
  }
}

async function promptAndResetAuthUserPassword(userId) {
  const user = state.auth.adminData.users.find((item) => item.id === userId);
  if (!user) {
    return;
  }

  const password = window.prompt(`Defina a nova senha para ${user.username}:`, '');
  if (!password) {
    return;
  }

  if (password.length < 1) {
    pushToast('Informe a nova senha do usuario.', 'error');
    return;
  }

  try {
    await apiRequest(`/auth/usuarios/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      body: {
        password
      }
    });
    pushToast('Senha redefinida e sessoes antigas revogadas.', 'success');
    await loadAuthAdminData();
  } catch (error) {
    pushToast(`Falha ao redefinir senha: ${toErrorMessage(error)}`, 'error');
  }
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

function syncAliquotaDraftPeriodosFromForm(form) {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const data = new FormData(form);
  const aliquotas = data.getAll('aliquota');
  const datasInicio = data.getAll('dataInicio');
  const datasFim = data.getAll('dataFim');

  state.settings.aliquotas.draftPeriodos = aliquotas.map((aliquota, index) => ({
    aliquota: String(aliquota ?? ''),
    dataInicio: String(datasInicio[index] ?? ''),
    dataFim: String(datasFim[index] ?? '')
  }));
}

async function submitSettingsAliquotasForm(form) {
  syncAliquotaDraftPeriodosFromForm(form);

  const periodos = (state.settings.aliquotas.draftPeriodos || []).map((periodo) => ({
    aliquota: Number(String(periodo.aliquota).replace(',', '.')),
    dataInicio: String(periodo.dataInicio || '').trim(),
    dataFim: String(periodo.dataFim || '').trim() || null
  }));

  const periodoInvalido = periodos.find(
    (periodo) => !Number.isFinite(periodo.aliquota) || periodo.aliquota <= 0 || !periodo.dataInicio
  );
  if (!periodos.length || periodoInvalido) {
    state.settings.aliquotas.errorMessage = 'Informe uma aliquota valida (maior que zero) e a data de inicio em todos os periodos.';
    render();
    return;
  }

  if (state.dataSource !== 'api') {
    const normalizados = normalizeMonofasicoAliquotaPeriodos(periodos);
    state.settings.aliquotas.periodos = normalizados;
    state.settings.aliquotas.draftPeriodos = cloneMonofasicoAliquotaPeriodos(normalizados);
    state.settings.aliquotas.errorMessage = '';
    render();
    pushToast('Aliquotas salvas no modo mock.', 'success');
    return;
  }

  state.settings.aliquotas.saving = true;
  state.settings.aliquotas.errorMessage = '';
  render();

  try {
    const response = await apiRequest('/nfe/xml-reader30/aliquotas-monofasico', {
      method: 'PUT',
      body: { periodos }
    });

    const normalizados = normalizeMonofasicoAliquotaPeriodos(response?.periodos);
    state.settings.aliquotas.periodos = normalizados;
    state.settings.aliquotas.draftPeriodos = cloneMonofasicoAliquotaPeriodos(normalizados);
    state.settings.aliquotas.saving = false;
    render();
    pushToast('Aliquotas do monofasico atualizadas com sucesso.', 'success');
  } catch (error) {
    state.settings.aliquotas.saving = false;
    state.settings.aliquotas.errorMessage = toErrorMessage(error);
    render();
    pushToast(`Falha ao salvar aliquotas: ${toErrorMessage(error)}`, 'error');
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

function normalizeMonofasicoAliquotaPeriodos(rawPeriodos) {
  return (Array.isArray(rawPeriodos) ? rawPeriodos : [])
    .map((periodo) => ({
      aliquota: Number(periodo?.aliquota),
      dataInicio: String(periodo?.dataInicio || ''),
      dataFim: periodo?.dataFim ? String(periodo.dataFim) : null
    }))
    .filter((periodo) => Number.isFinite(periodo.aliquota) && periodo.dataInicio)
    .sort((left, right) => Date.parse(left.dataInicio) - Date.parse(right.dataInicio));
}

function cloneMonofasicoAliquotaPeriodos(periodos) {
  return (Array.isArray(periodos) ? periodos : []).map((periodo) => ({ ...periodo }));
}

function applyMonofasicoAliquotasToSettings(config) {
  const periodos = normalizeMonofasicoAliquotaPeriodos(config?.periodos);
  if (!periodos.length) {
    return;
  }

  state.settings.aliquotas.periodos = periodos;
  if (!Array.isArray(state.settings.aliquotas.draftPeriodos)) {
    state.settings.aliquotas.draftPeriodos = cloneMonofasicoAliquotaPeriodos(periodos);
  }
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
      estabelecimentoIdPrincipal: primaryEstablishment?.id || null,
      codigoEmpresaDominio: client.codigoEmpresaDominio ?? null
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

function buildXmlFilesFromApi(nfseDocs, clients, contextClienteId) {
  const docs = Array.isArray(nfseDocs) ? nfseDocs : [];
  const clientById = Object.fromEntries(clients.map((client) => [client.id, client]));

  return docs
    .map((doc) => {
      const vinculoClienteIds = Array.isArray(doc.vinculos)
        ? doc.vinculos.map((vinculo) => vinculo.clienteId).filter(Boolean)
        : [];
      // O documento so chega aqui porque o backend ja o retornou para uma consulta
      // escopada em contextClienteId (via NfseDocumento.clienteId OU NfseDocumentoVinculo),
      // ou porque foi buscado individualmente com esse clienteId autorizado. Por isso
      // confiamos direto no contexto da busca em vez de reconferir localmente contra
      // doc.clienteId/vinculos (cuja presenca no payload pode variar) - senao a nota some
      // dos filtros client-side mesmo tendo sido retornada corretamente pela API.
      const effectiveClienteId = contextClienteId || doc.clienteId;
      const client = clientById[effectiveClienteId] || null;
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

      const contraparteNome =
        tipo === 'Tomada'
          ? doc.razaoSocialPrestador || '-'
          : doc.razaoSocialTomador || '-';

      return {
        id: `xml-${doc.id}`,
        apiNfseId: doc.id,
        clientId: effectiveClienteId,
        custodiaClienteId: doc.clienteId,
        vinculoClienteIds,
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
        contraparteNome,
        iss: toNumber(doc.valorIss),
        conteudoXml: null,
        leituraFiscal: doc.leituraFiscal || null,
        ignorarNumeracaoValidacao: Boolean(doc.ignorarNumeracaoValidacao),
        ignorarNumeracaoObservacao: doc.ignorarNumeracaoObservacao || '',
        substitui: doc.substitui ? { ...doc.substitui, linkedXmlId: `xml-${doc.substitui.id}` } : null,
        substituidaPor: doc.substituidaPor ? { ...doc.substituidaPor, linkedXmlId: `xml-${doc.substituidaPor.id}` } : null
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
  return mapFiscalStatusCode(status);
}

function mapFiscalStatusCode(status) {
  const raw = String(status || '').trim();
  if (!raw) {
    return '-';
  }

  const codeLabels = {
    '100': 'Autorizada',
    '101': 'Cancelada',
    '110': 'Uso denegado',
    '128': 'Lote de evento processado',
    '135': 'Evento registrado e vinculado',
    '136': 'Evento registrado nao vinculado',
    '150': 'Autorizada fora do prazo',
    '151': 'Cancelamento homologado',
    '155': 'Cancelamento homologado fora do prazo'
  };

  return codeLabels[raw] || raw;
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

function isRejeicaoEventoApi(evento) {
  const tipoEvento = normalizeSearchText(evento?.tipoEvento);
  const descricao = normalizeSearchText(evento?.descricao);
  return tipoEvento.includes('rejeicao') || tipoEvento.includes('rejei') || descricao.includes('rejeicao') || descricao.includes('rejei');
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
    return `<div style="padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt); color:var(--text-secondary);">Nenhum evento vinculado.</div>`;
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
            <article style="padding:12px 14px; border:1px solid var(--line); border-radius:12px; background:var(--surface-alt);">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:6px;">
                <strong>${escapeHtml(title)}</strong>
                <span class="chip ${isCancelamentoEventoApi(evento) ? 'danger' : 'info'}">${escapeHtml(tipo)}</span>
              </div>
              <div style="display:grid; gap:4px;">
                <span><small style="color:var(--text-secondary);">Data</small> <strong>${escapeHtml(dataEvento)}</strong></span>
                <span><small style="color:var(--text-secondary);">Descricao</small> <strong>${escapeHtml(descricao)}</strong></span>
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

function formatEventoFilterLabel(evento) {
  if (isRejeicaoEventoApi(evento)) {
    return 'Rejeicao';
  }

  if (isCancelamentoEventoApi(evento)) {
    return 'Cancelamento';
  }

  const descricao = String(evento?.descricao || '').trim();
  if (descricao) {
    return descricao;
  }

  const tipoEvento = String(evento?.tipoEvento || '').trim();
  return tipoEvento || '';
}

function getCteEventTypeFilterOptions() {
  const primaryOptions = [
    'Rejeicao',
    'Cancelamento',
    'Desacordo',
    'Registro de Passagem',
    'MDF-e Autorizado',
    'Autorizado o uso do CT-e'
  ];
  const seen = new Set();
  const ordered = [];
  const docs = [...(Array.isArray(state.cteDocuments) ? state.cteDocuments : []), ...(Array.isArray(state.cteSearch.results) ? state.cteSearch.results : [])];

  const pushOption = (value) => {
    const raw = String(value || '').trim();
    if (!raw) {
      return;
    }
    const normalized = normalizeSearchText(raw);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    ordered.push(raw);
  };

  primaryOptions.forEach(pushOption);

  docs.forEach((doc) => {
    const eventos = Array.isArray(doc?.eventos) ? doc.eventos : [];
    eventos.forEach((evento) => {
      pushOption(formatEventoFilterLabel(evento));
    });
  });

  pushOption(state.filters.cteDocs.tipoEvento);

  const primaryNormalized = new Set(primaryOptions.map((value) => normalizeSearchText(value)).filter(Boolean));
  const dynamicOptions = ordered
    .filter((value) => !primaryNormalized.has(normalizeSearchText(value)))
    .sort((left, right) => left.localeCompare(right, 'pt-BR'));

  return [...ordered.filter((value) => primaryNormalized.has(normalizeSearchText(value))), ...dynamicOptions];
}

function matchesDocumentEventTypeFilter(doc, eventTypeFilter) {
  const normalizedFilter = normalizeSearchText(eventTypeFilter);
  if (!normalizedFilter || normalizedFilter === 'todos') {
    return true;
  }

  const eventos = Array.isArray(doc?.eventos) ? doc.eventos : [];
  if (!eventos.length) {
    return false;
  }

  return eventos.some((evento) => {
    const searchParts = [
      String(evento?.tipoEvento || '').trim(),
      String(evento?.descricao || '').trim(),
      formatEventoResumoLabel(evento),
      formatEventoCardTitle(evento)
    ]
      .map((value) => normalizeSearchText(value))
      .filter(Boolean);

    return searchParts.some((part) => part.includes(normalizedFilter));
  });
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
        cancelada: normalizeSearchText(statusFiscal).includes('cancel'),
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
        temEventos: eventos.length > 0,
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
    .filter((doc) => isCteAccessKey(doc?.chaveAcesso))
    .map((doc) => {
      const client = clientById[doc.clienteId] || null;
      const isConsultaResumo = String(doc.schemaDoc || '').startsWith('retConsSitCTe');
      const tipoBase = mapCteTipoLabel(doc.tipoRelacao);
      const tipo = tipoBase === 'Nao identificado' && isConsultaResumo ? 'Consulta por chave' : tipoBase;
      const eventos = Array.isArray(doc.eventos) ? doc.eventos : [];
      const cancelamentoEvento = eventos.find(isCancelamentoEventoApi) || null;
      const emitenteCnpj = normalizeDigits(doc.cnpjEmitente || '');
      const destinatarioCnpj = normalizeDigits(doc.cnpjDestinatario || '');
      const contraparteNome =
        tipo === 'Emitido' ? doc.razaoSocialDestinatario : tipo === 'Recebido' ? doc.razaoSocialEmitente : '-';
      const contraparteCnpj =
        tipo === 'Emitido' ? destinatarioCnpj : tipo === 'Recebido' ? emitenteCnpj : '';
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
        dataEmissao: doc.dataEmissao || doc.dataAutorizacao || doc.createdAt || doc.updatedAt,
        dataAutorizacao: doc.dataAutorizacao || doc.updatedAt || doc.createdAt,
        valor: doc.valorTotal == null ? null : toNumber(doc.valorTotal),
        tipo,
        statusFiscal,
        cancelada: normalizeSearchText(statusFiscal).includes('cancel'),
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
        temEventos: eventos.length > 0,
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
    const validadeFormatada = cert.validade ? formatDate(cert.validade) : '-';
    const diasRestantes = Math.max(Number(cert.diasRestantes || 0), 0);
    if (cert.status === 'Vencido') {
      alerts.push({
        id: `cert-vencido-${cert.id}`,
        severity: 'Critico',
        tipo: 'Certificado',
        titulo: `Certificado vencido em ${validadeFormatada}`,
        descricao: `O certificado ${cert.apelido} venceu em ${validadeFormatada} e pode bloquear a sincronizacao.`,
        clientId: cert.clientId,
        cliente: cert.cliente,
        dataHora: cert.ultimaValidacao || new Date().toISOString(),
        status: 'Aberto',
        origem: 'validacao-certificado',
        mensagemTecnica: `O certificado ${cert.apelido} do cliente ${cert.cliente} venceu em ${validadeFormatada}.`,
        sugestaoAcao: 'Atualizar certificado digital do cliente.',
        historicoTentativas: [],
        allowsReprocess: true,
        validadeCertificado: cert.validade || null
      });
    } else if (cert.status === 'A vencer') {
      alerts.push({
        id: `cert-vencer-${cert.id}`,
        severity: 'Atencao',
        tipo: 'Certificado',
        titulo: `Certificado vence em ${validadeFormatada}`,
        descricao: `Planejar renovacao do certificado ${cert.apelido}. Restam ${diasRestantes} dia(s).`,
        clientId: cert.clientId,
        cliente: cert.cliente,
        dataHora: cert.ultimaValidacao || new Date().toISOString(),
        status: 'Em analise',
        origem: 'monitor-validade',
        mensagemTecnica: `O certificado ${cert.apelido} do cliente ${cert.cliente} vence em ${validadeFormatada}. Restam ${diasRestantes} dia(s) para renovacao.`,
        sugestaoAcao: 'Solicitar renovacao antes do vencimento.',
        historicoTentativas: [],
        allowsReprocess: false,
        validadeCertificado: cert.validade || null
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
      if (row?.acao !== 'update' && row?.acao !== 'delete') {
        return;
      }
      const client = clientById[row.clienteId];
      const auditActionMeta = mapAuditActionMeta(row.acao);
      const auditEntityLabel = mapAuditEntityLabel(row.entidade);
      alerts.push({
        id: `audit-${row.id}`,
        severity: 'Informativo',
        tipo: mapAuditAlertType(row.entidade),
        titulo: `${auditEntityLabel} ${auditActionMeta.titleSuffix}`,
        descricao: `A auditoria registrou que ${auditEntityLabel.toLowerCase()} ${auditActionMeta.descriptionSuffix}.`,
        clientId: row.clienteId,
        cliente: client?.razaoSocial || 'Cliente nao identificado',
        dataHora: row.createdAt || new Date().toISOString(),
        status: 'Em analise',
        origem: 'auditoria',
        mensagemTecnica: buildAuditTechnicalMessage(row, auditEntityLabel, auditActionMeta),
        sugestaoAcao: 'Registrar acompanhamento interno, se necessario.',
        historicoTentativas: [],
        allowsReprocess: false
      });
    });

  return alerts.sort((a, b) => Date.parse(b.dataHora || 0) - Date.parse(a.dataHora || 0)).slice(0, 120);
}

function mapAuditActionMeta(action) {
  switch (String(action || '').toLowerCase()) {
    case 'create':
      return {
        actionLabel: 'criacao',
        titleSuffix: 'criado no sistema',
        descriptionSuffix: 'foi criado no sistema'
      };
    case 'delete':
      return {
        actionLabel: 'exclusao',
        titleSuffix: 'excluido do sistema',
        descriptionSuffix: 'foi excluido do sistema'
      };
    case 'update':
      return {
        actionLabel: 'atualizacao',
        titleSuffix: 'atualizado no sistema',
        descriptionSuffix: 'foi atualizado no sistema'
      };
    default:
      return {
        actionLabel: 'alteracao',
        titleSuffix: 'alterado no sistema',
        descriptionSuffix: 'foi alterado no sistema'
      };
  }
}

function mapAuditEntityLabel(entity) {
  switch (normalizeSearchText(entity)) {
    case 'cte':
      return 'CT-e';
    case 'nfe':
      return 'NF-e';
    case 'nfse':
      return 'NFS-e';
    case 'certificados':
    case 'certificado':
      return 'Certificado';
    case 'clientes':
    case 'cliente':
      return 'Cliente';
    case 'estabelecimentos':
    case 'estabelecimento':
      return 'Estabelecimento';
    case 'sync':
      return 'Rotina de sincronizacao';
    case 'alertas':
    case 'alerta':
      return 'Alerta';
    default:
      return formatAuditEntityFallback(entity);
  }
}

function mapAuditAlertType(entity) {
  switch (normalizeSearchText(entity)) {
    case 'cte':
      return 'CT-e';
    case 'certificados':
    case 'certificado':
      return 'Certificado';
    case 'sync':
      return 'Busca';
    case 'clientes':
    case 'cliente':
      return 'Cliente';
    default:
      return 'Cliente';
  }
}

function buildAuditTechnicalMessage(row, entityLabel, actionMeta) {
  const details = [
    `A auditoria registrou uma ${actionMeta.actionLabel} na entidade ${entityLabel}.`,
    row?.entidadeId ? `ID do registro: ${row.entidadeId}.` : null,
    row?.ip ? `IP de origem: ${row.ip}.` : null,
    row?.userAgent ? `User-Agent: ${row.userAgent}` : null
  ].filter(Boolean);

  return details.join(' ');
}

function formatAuditEntityFallback(entity) {
  const value = String(entity || '').trim();
  if (!value) {
    return 'Registro';
  }

  return value
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildPersistentAlertsFromApi(alertsRaw) {
  return (Array.isArray(alertsRaw) ? alertsRaw : []).map((alert) => ({
    id: String(alert?.id || ''),
    eventId: String(alert?.eventId || ''),
    severity: String(alert?.severity || 'Atencao'),
    tipo: String(alert?.tipo || 'CT-e'),
    titulo: String(alert?.titulo || 'Alerta operacional'),
    descricao: String(alert?.descricao || ''),
    clientId: String(alert?.clientId || ''),
    cliente: String(alert?.cliente || 'Cliente nao identificado'),
    dataHora: String(alert?.dataHora || new Date().toISOString()),
    status: String(alert?.status || 'Aberto'),
    origem: String(alert?.origem || 'server'),
    mensagemTecnica: String(alert?.mensagemTecnica || '-'),
    sugestaoAcao: String(alert?.sugestaoAcao || '-'),
    historicoTentativas: Array.isArray(alert?.historicoTentativas) ? alert.historicoTentativas.map((entry) => String(entry)) : [],
    allowsReprocess: Boolean(alert?.allowsReprocess),
    persistence: String(alert?.persistence || 'server'),
    canToggleResolved: Boolean(alert?.canToggleResolved),
    documentoId: String(alert?.documentoId || ''),
    chaveAcesso: String(alert?.chaveAcesso || ''),
    numeroDocumento: String(alert?.numeroDocumento || ''),
    eventoTipo: String(alert?.eventoTipo || ''),
    eventoDescricao: String(alert?.eventoDescricao || ''),
    resolvedAt: alert?.resolvedAt ? String(alert.resolvedAt) : null,
    emissor: String(alert?.emissor || ''),
    retencoes: Array.isArray(alert?.retencoes) ? alert.retencoes.map((entry) => String(entry || '')) : []
  }));
}

function buildResolvedAlertsStoreFromApi(resolutionsRaw) {
  const store = {};

  (Array.isArray(resolutionsRaw) ? resolutionsRaw : []).forEach((resolution) => {
    const alertId = String(resolution?.alertId || '').trim();
    const fingerprint = String(resolution?.fingerprint || '').trim();
    if (!alertId || !fingerprint) {
      return;
    }

    store[alertId] = {
      fingerprint,
      resolvedAt: resolution?.resolvedAt ? String(resolution.resolvedAt) : new Date().toISOString()
    };
  });

  return store;
}

function applyResolvedAlertState(alerts) {
  const nextStore = {};

  alerts.forEach((alert) => {
    if (isServerPersistedAlert(alert)) {
      return;
    }
    const fingerprint = buildAlertFingerprint(alert);
    const persistedServer = state.serverResolvedAlerts?.[alert.id];
    if (persistedServer?.fingerprint === fingerprint) {
      alert.status = 'Resolvido';
      return;
    }

    const persistedLocal = state.resolvedAlerts[alert.id];
    if (persistedLocal?.fingerprint === fingerprint) {
      alert.status = 'Resolvido';
      nextStore[alert.id] = persistedLocal;
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

function clearLocalResolvedAlertState(alert) {
  delete state.resolvedAlerts[alert.id];
  saveResolvedAlertsStore(state.resolvedAlerts);
}

function isServerPersistedAlert(alert) {
  return String(alert?.persistence || '').toLowerCase() === 'server';
}

async function setAlertResolved(alert, resolved) {
  if (isServerPersistedAlert(alert)) {
    const response = await apiRequest(`/alertas/cte-desacordo/${encodeURIComponent(alert.eventId)}/resolucao`, {
      method: 'PUT',
      body: { resolvido: resolved }
    });
    Object.assign(alert, buildPersistentAlertsFromApi([response])[0] || {});
    return;
  }

  if (state.dataSource === 'api') {
    const fingerprint = buildAlertFingerprint(alert);
    const response = await apiRequest(`/alertas/resolucoes/${encodeURIComponent(alert.id)}`, {
      method: 'PUT',
      body: {
        resolvido: resolved,
        fingerprint,
        clientId: alert.clientId || undefined,
        origem: alert.origem || undefined,
        titulo: alert.titulo || undefined
      }
    });

    if (resolved) {
      state.serverResolvedAlerts[alert.id] = {
        fingerprint: String(response?.fingerprint || fingerprint),
        resolvedAt: response?.resolvedAt ? String(response.resolvedAt) : new Date().toISOString()
      };
      alert.status = 'Resolvido';
    } else {
      delete state.serverResolvedAlerts[alert.id];
      alert.status = 'Aberto';
    }

    clearLocalResolvedAlertState(alert);
    return;
  }

  if (resolved) {
    markAlertAsResolved(alert);
    return;
  }

  alert.status = 'Aberto';
  clearLocalResolvedAlertState(alert);
}

function buildAlertFingerprint(alert) {
  if (alert?.origem === 'monitor-validade' || alert?.origem === 'validacao-certificado') {
    return JSON.stringify([
      alert.id,
      alert.origem || '',
      alert.clientId || '',
      alert.validadeCertificado || ''
    ]);
  }

  return JSON.stringify([
    alert.id,
    alert.origem || '',
    alert.dataHora || '',
    alert.titulo || '',
    alert.descricao || '',
    alert.mensagemTecnica || ''
  ]);
}

function renderAlertResolvedCheckbox(alert, options = {}) {
  if (!alert?.canToggleResolved) {
    return '';
  }

  return `
    <label style="display:inline-flex; align-items:center; gap:6px; color:var(--text-secondary); font-size:${options.compact ? '12px' : '13px'};">
      <input type="checkbox" data-action="alert-toggle-resolved" data-alert-id="${escapeHtml(alert.id)}" ${alert.status === 'Resolvido' ? 'checked' : ''} />
      <span>Resolvido</span>
    </label>
  `;
}

function renderAlertDocumentLine(alert) {
  const numero = String(alert?.numeroDocumento || '').trim();
  const chave = String(alert?.chaveAcesso || '').trim();
  const documentType = String(alert?.tipo || '').trim() || 'Documento';
  if (numero) {
    return `${documentType} ${numero}`;
  }
  if (chave) {
    return `${documentType} ${chave}`;
  }
  return '-';
}

function hasAlertDocumentAction(alert) {
  return alert?.tipo === 'CT-e' || alert?.tipo === 'NFS-e';
}

function renderAlertOpenDocumentLabel(alert) {
  if (alert?.tipo === 'NFS-e') {
    return 'Ver NFS-e';
  }
  if (alert?.tipo === 'CT-e') {
    return 'Ver CT-e';
  }
  return 'Ver documento';
}

function buildAlertPriorityMeta(alert) {
  const parts = [String(alert?.cliente || 'Cliente nao identificado').trim()];
  const documentLine = renderAlertDocumentLine(alert);
  if (documentLine !== '-') {
    parts.push(documentLine);
  }
  parts.push(formatDateTime(alert?.dataHora));
  return parts.filter(Boolean).join(' • ');
}

function toggleAlertResolved(alertId, resolved) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) {
    return;
  }

  void (async () => {
    try {
      await setAlertResolved(alert, resolved);
      pushToast(
        resolved ? `Alerta "${alert.titulo}" resolvido.` : `Alerta "${alert.titulo}" reaberto.`,
        'success'
      );
    } catch (error) {
      pushToast(`Falha ao atualizar alerta: ${toErrorMessage(error)}`, 'error');
    }
    render();
  })();
}

function readStoredTheme() {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'Escuro' ? 'Escuro' : 'Claro';
  } catch (error) {
    return 'Claro';
  }
}

function applyTheme(tema) {
  const normalized = tema === 'Escuro' ? 'Escuro' : 'Claro';
  document.documentElement.setAttribute('data-theme', normalized);
}

function setTheme(tema) {
  const normalized = tema === 'Escuro' ? 'Escuro' : 'Claro';
  state.settings.geral.tema = normalized;
  applyTheme(normalized);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
  } catch (error) {
    console.warn('Falha ao salvar o tema no navegador.', error);
  }
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

function loadXmlReader30NfeColumnOrderStore() {
  try {
    const raw = window.localStorage.getItem(XML_READER30_NFE_COLUMN_ORDER_STORAGE_KEY);
    if (!raw) {
      return [...XML_READER30_NFE_DEFAULT_COLUMN_ORDER];
    }

    const parsed = JSON.parse(raw);
    return normalizeXmlReader30NfeColumnOrder(Array.isArray(parsed) ? parsed : []);
  } catch (error) {
    console.warn('Falha ao carregar a ordem das colunas da NF-e no leitor XML 3.0.', error);
    return [...XML_READER30_NFE_DEFAULT_COLUMN_ORDER];
  }
}

function saveXmlReader30NfeColumnOrderStore(columnOrder) {
  try {
    window.localStorage.setItem(
      XML_READER30_NFE_COLUMN_ORDER_STORAGE_KEY,
      JSON.stringify(normalizeXmlReader30NfeColumnOrder(columnOrder))
    );
  } catch (error) {
    console.warn('Falha ao persistir a ordem das colunas da NF-e no leitor XML 3.0.', error);
  }
}

function normalizeXmlReader30NfeColumnWidthsStore(widths) {
  const normalized = {};

  if (!widths || typeof widths !== 'object') {
    return normalized;
  }

  XML_READER30_NFE_DEFAULT_COLUMN_ORDER.forEach((columnKey) => {
    const rawWidth = widths[columnKey];
    if (!Number.isFinite(rawWidth)) {
      return;
    }

    normalized[columnKey] = normalizeXmlReader30NfeColumnWidth(columnKey, rawWidth);
  });

  return normalized;
}

function loadXmlReader30NfeColumnWidthsStore() {
  try {
    const raw = window.localStorage.getItem(XML_READER30_NFE_COLUMN_WIDTHS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return normalizeXmlReader30NfeColumnWidthsStore(parsed);
  } catch (error) {
    console.warn('Falha ao carregar as larguras das colunas da NF-e no leitor XML 3.0.', error);
    return {};
  }
}

function saveXmlReader30NfeColumnWidthsStore(columnWidths) {
  try {
    window.localStorage.setItem(
      XML_READER30_NFE_COLUMN_WIDTHS_STORAGE_KEY,
      JSON.stringify(normalizeXmlReader30NfeColumnWidthsStore(columnWidths))
    );
  } catch (error) {
    console.warn('Falha ao persistir as larguras das colunas da NF-e no leitor XML 3.0.', error);
  }
}

function normalizeXmlReader30NfeRegime(regime) {
  const normalized = String(regime || '').trim().toLowerCase();
  if (normalized === 'simples_nacional' || normalized === 'simples nacional' || normalized === 'simples') {
    return 'simples_nacional';
  }
  if (normalized === 'lucro_presumido' || normalized === 'lucro presumido' || normalized === 'presumido') {
    return 'lucro_presumido';
  }
  if (normalized === 'lucro_real' || normalized === 'lucro real' || normalized === 'real') {
    return 'lucro_real';
  }
  return 'lucro_real';
}

function loadXmlReader30NfeRegimeStore() {
  try {
    const raw = window.localStorage.getItem(XML_READER30_NFE_REGIME_STORAGE_KEY);
    return normalizeXmlReader30NfeRegime(raw || 'lucro_real');
  } catch (error) {
    console.warn('Falha ao carregar o regime da empresa no leitor XML 3.0.', error);
    return 'lucro_real';
  }
}

function saveXmlReader30NfeRegimeStore(regime) {
  try {
    window.localStorage.setItem(XML_READER30_NFE_REGIME_STORAGE_KEY, normalizeXmlReader30NfeRegime(regime));
  } catch (error) {
    console.warn('Falha ao persistir o regime da empresa no leitor XML 3.0.', error);
  }
}

function getXmlReader30NfeRegimeHiddenColumns(regime) {
  if (normalizeXmlReader30NfeRegime(regime) !== 'simples_nacional') {
    return [];
  }

  return [...XML_READER30_NFE_SIMPLE_NATIONAL_HIDDEN_COLUMNS];
}

function normalizeXmlReader30NfeColumnOrder(columnOrder) {
  const seen = new Set();
  const normalized = [];

  (Array.isArray(columnOrder) ? columnOrder : []).forEach((key) => {
    const columnKey = String(key || '').trim();
    if (!columnKey || seen.has(columnKey) || !XML_READER30_NFE_DEFAULT_COLUMN_ORDER.includes(columnKey)) {
      return;
    }
    seen.add(columnKey);
    normalized.push(columnKey);
  });

  XML_READER30_NFE_DEFAULT_COLUMN_ORDER.forEach((key) => {
    if (!seen.has(key)) {
      normalized.push(key);
    }
  });

  return normalized;
}

function moveXmlReader30NfeColumn(columnOrder, sourceKey, targetKey, insertAfter) {
  const normalized = normalizeXmlReader30NfeColumnOrder(columnOrder);
  const filtered = normalized.filter((key) => key !== sourceKey);
  const targetIndex = filtered.indexOf(targetKey);
  if (targetIndex < 0) {
    return normalized;
  }

  const nextIndex = insertAfter ? targetIndex + 1 : targetIndex;
  filtered.splice(nextIndex, 0, sourceKey);
  return normalizeXmlReader30NfeColumnOrder(filtered);
}

function loadCompareSpedHistoryStore() {
  try {
    const raw = window.localStorage.getItem(COMPARE_SPED_HISTORY_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => normalizeCompareSpedHistoryItem(item)).filter(Boolean);
  } catch (error) {
    console.warn('Falha ao carregar historico de comparacoes SPED do navegador.', error);
    return [];
  }
}

function saveCompareSpedHistoryStore(history) {
  try {
    const serializable = (Array.isArray(history) ? history : [])
      .map((item) => normalizeCompareSpedHistoryItem(item))
      .filter(Boolean)
      .map(({ artifact, ...item }) => item)
      .slice(0, COMPARE_SPED_HISTORY_LIMIT);
    window.localStorage.setItem(COMPARE_SPED_HISTORY_STORAGE_KEY, JSON.stringify(serializable));
  } catch (error) {
    console.warn('Falha ao persistir historico de comparacoes SPED no navegador.', error);
  }
}

function normalizeCompareSpedHistoryItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const report = item.report && typeof item.report === 'object' ? item.report : null;
  const generatedAt = String(item.generatedAt || report?.generatedAt || new Date().toISOString());
  const clientIdValue = item.clientId ?? report?.clientId ?? '';
  const clientNameValue = item.clientName || report?.companyName || 'Cliente selecionado';
  const clientCnpjValue = item.clientCnpj || report?.clientCnpj || '';
  const competenceValue = item.competence || report?.competence || '';
  const sourceFileNameValue = item.sourceFileName || report?.sourceFileName || 'comparacao-sped.txt';
  const outputFormatValue = item.outputFormat || report?.outputFormat || 'Excel';
  return {
    id: String(item.id || `${generatedAt}-${Math.random().toString(36).slice(2, 8)}`),
    clientId: clientIdValue == null ? '' : String(clientIdValue),
    clientName: String(clientNameValue || 'Cliente selecionado'),
    clientCnpj: clientCnpjValue == null ? '' : String(clientCnpjValue),
    competence: competenceValue == null ? '' : String(competenceValue),
    sourceFileName: String(sourceFileNameValue || 'comparacao-sped.txt'),
    outputFormat: outputFormatValue === 'PDF' ? 'PDF' : 'Excel',
    generatedAt,
    report: report || {},
    artifact: item.artifact && item.artifact.blobUrl ? item.artifact : null
  };
}

function buildCompareSpedHistoryItem(item) {
  return normalizeCompareSpedHistoryItem(item);
}

function compareSpedHistoryKey(item) {
  const normalized = normalizeCompareSpedHistoryItem(item);
  if (!normalized) {
    return '';
  }

  return [
    normalized.clientId || '',
    normalized.clientName || '',
    normalized.competence || '',
    normalized.sourceFileName || '',
    normalized.generatedAt || '',
    normalized.outputFormat || ''
  ].join('|');
}

function mergeCompareSpedHistorySources(...sources) {
  const merged = [];
  const seen = new Map();

  sources.forEach((source) => {
    (Array.isArray(source) ? source : []).forEach((item) => {
      const normalized = normalizeCompareSpedHistoryItem(item);
      if (!normalized) {
        return;
      }

      const key = compareSpedHistoryKey(normalized);
      seen.set(key, normalized);
    });
  });

  seen.forEach((item) => {
    merged.push(item);
  });

  return merged.sort((left, right) => Date.parse(String(right.generatedAt || 0)) - Date.parse(String(left.generatedAt || 0)));
}

async function persistCompareSpedHistoryItem(item) {
  const payload = normalizeCompareSpedHistoryItem(item);
  if (!payload) {
    throw new Error('Historico de comparacao invalido.');
  }

  const response = await apiRequest('/comparacoes-sped', {
    method: 'POST',
    body: {
      clienteId: payload.clientId || undefined,
      clientName: payload.clientName,
      clientCnpj: payload.clientCnpj || undefined,
      competence: payload.competence || undefined,
      sourceFileName: payload.sourceFileName,
      outputFormat: payload.outputFormat,
      generatedAt: payload.generatedAt,
      report: payload.report
    }
  });

  return response ? normalizeCompareSpedHistoryItem({ ...response, artifact: payload.artifact }) : payload;
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

  if (cert?.arquivoDisponivel === false) {
    return 'Arquivo ausente';
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

function restoreAuthState() {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    state.auth.accessToken = String(parsed?.accessToken || '').trim();
    state.auth.refreshToken = String(parsed?.refreshToken || '').trim();
    state.auth.sessionExpiresAt = String(parsed?.sessionExpiresAt || '').trim();
    state.auth.user = parsed?.user && typeof parsed.user === 'object' ? parsed.user : null;
  } catch {
    clearStoredAuthState();
  }
}

function persistAuthState() {
  try {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: state.auth.accessToken,
        refreshToken: state.auth.refreshToken,
        sessionExpiresAt: state.auth.sessionExpiresAt,
        user: state.auth.user
      })
    );
  } catch {}
}

function clearStoredAuthState() {
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
}

function clearAuthState() {
  state.auth.accessToken = '';
  state.auth.refreshToken = '';
  state.auth.sessionExpiresAt = '';
  state.auth.user = null;
  state.auth.adminData = createEmptyAuthAdminData();
  lastAuthInteractionAt = 0;
  lastAuthActivityPingAt = 0;
  authActivityPingPromise = null;
  clearAuthInactivityTimer();
  clearStoredAuthState();
}

function applyAuthPayload(payload, options = {}) {
  state.auth.accessToken = String(payload?.accessToken || '').trim();
  state.auth.refreshToken = String(payload?.refreshToken || '').trim();
  state.auth.sessionExpiresAt = String(payload?.sessionExpiresAt || '').trim();
  state.auth.user = payload?.user && typeof payload.user === 'object' ? payload.user : null;
  if (options.trackInteraction === false) {
    scheduleAuthInactivityTimeout();
  } else {
    registerAuthInteraction({ skipPing: true });
  }
  persistAuthState();
}

async function ensureAuthenticatedSession() {
  if (!state.auth.accessToken && !state.auth.refreshToken) {
    return false;
  }

  state.auth.authenticating = true;
  render();

  try {
    if (state.auth.accessToken) {
      const me = await apiRequest('/auth/me', {
        skipAuthRefresh: false,
        suppressAuthFailureToast: true
      });
      state.auth.user = me?.user || null;
      scheduleAuthInactivityTimeout();
      persistAuthState();
      return Boolean(state.auth.user);
    }

    return await refreshAccessSession({ silent: true });
  } catch {
    finalizeLoggedOutState();
    return false;
  } finally {
    state.auth.authenticating = false;
  }
}

async function refreshAccessSession(options = {}) {
  if (authRefreshPromise) {
    return authRefreshPromise;
  }

  const refreshToken = String(state.auth.refreshToken || '').trim();
  if (!refreshToken) {
    return false;
  }

  const sessionActivity = resolveAuthSessionActivityHeader(options);

  authRefreshPromise = (async () => {
    try {
      const payload = await performApiRequest('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        sessionActivity,
        skipAuth: true,
        skipAuthRefresh: true,
        suppressAuthFailureToast: options.silent
      });
      applyAuthPayload(payload, { trackInteraction: sessionActivity === 'active' });
      return true;
    } catch {
      finalizeLoggedOutState();
      return false;
    } finally {
      authRefreshPromise = null;
    }
  })();

  return authRefreshPromise;
}

async function apiRequest(path, options = {}) {
  const { skipAuth = false, skipAuthRefresh = false } = options;

  try {
    return await performApiRequest(path, options);
  } catch (error) {
    if (!skipAuth && !skipAuthRefresh && shouldAttemptAuthRefresh(path, error)) {
      const refreshed = await refreshAccessSession({ silent: true });
      if (refreshed) {
        return performApiRequest(path, { ...options, skipAuthRefresh: true });
      }

      if (!options.suppressAuthFailureToast) {
        pushToast('Sua sessao expirou. Entre novamente para continuar.', 'error');
      }
    }

    throw error;
  }
}

async function performApiRequest(path, options = {}) {
  const { method = 'GET', body, timeoutMs = API_TIMEOUT_MS, skipAuth = false, headers: extraHeaders = {} } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { ...extraHeaders };
    headers['X-Session-Activity'] = resolveAuthSessionActivityHeader(options);
    const init = {
      method,
      headers,
      signal: controller.signal
    };

    if (!skipAuth && state.auth.accessToken) {
      headers.Authorization = `Bearer ${state.auth.accessToken}`;
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await fetch(path, init);
    if (!response.ok) {
      const errorText = await safeReadResponseText(response);
      const error = new Error(`HTTP ${response.status}${errorText ? ` - ${errorText}` : ''}`);
      error.status = response.status;
      throw error;
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

function shouldAttemptAuthRefresh(path, error) {
  const status = Number(error?.status || 0);
  if (status !== 401) {
    return false;
  }

  if (!state.auth.refreshToken) {
    return false;
  }

  return path !== '/auth/login' && path !== '/auth/refresh';
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
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const raw = String(value ?? '').trim();
  if (!raw) {
    return 0;
  }

  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,(?=\d{2}(?:\D|$)|\d+$)/g, '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '00000000';
  }
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function extractCalendarDateKey(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return '';
    }
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }

  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(4, 8)}-${text.slice(2, 4)}-${text.slice(0, 2)}`;
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatIsoDate(value) {
  return extractCalendarDateKey(value) || extractCalendarDateKey(new Date()) || new Date().toISOString().slice(0, 10);
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

function resolveClientName(clientId) {
  const client = findClientById(clientId);
  return client?.razaoSocial || '-';
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

function findEstablishmentByClientAndCnpj(clientId, cnpj) {
  if (!clientId || !cnpj) {
    return null;
  }

  const normalizedCnpj = normalizeDigits(cnpj);
  const rows = Array.isArray(state.establishmentsByClient?.[clientId]) ? state.establishmentsByClient[clientId] : [];
  return rows.find((item) => normalizeDigits(item?.cnpj || '') === normalizedCnpj) || null;
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

function findCteByChaveAcesso(chaveAcesso) {
  const chaveNormalizada = normalizeDigits(chaveAcesso || '');
  if (!chaveNormalizada) {
    return null;
  }

  return (
    state.cteSearch.results.find((doc) => normalizeDigits(doc?.chaveAcesso || '') === chaveNormalizada) ||
    state.cteDocuments.find((doc) => normalizeDigits(doc?.chaveAcesso || '') === chaveNormalizada) ||
    null
  );
}

function findCteForAlert(alert) {
  if (!alert || alert.tipo !== 'CT-e') {
    return null;
  }

  return (
    findCteById(alert.documentoId) ||
    state.cteSearch.results.find((doc) => doc.apiCteId === alert.documentoId) ||
    state.cteDocuments.find((doc) => doc.apiCteId === alert.documentoId) ||
    findCteByChaveAcesso(alert.chaveAcesso) ||
    null
  );
}

function findNfseByChaveAcesso(chaveAcesso) {
  const chaveNormalizada = normalizeDigits(chaveAcesso || '');
  if (!chaveNormalizada) {
    return null;
  }

  return (
    state.xmlSearch.results.find((doc) => normalizeDigits(doc?.chaveAcesso || '') === chaveNormalizada) ||
    state.xmlFiles.find((doc) => normalizeDigits(doc?.chaveAcesso || '') === chaveNormalizada) ||
    null
  );
}

function findNfseForAlert(alert) {
  if (!alert || alert.tipo !== 'NFS-e') {
    return null;
  }

  return (
    findXmlById(alert.documentoId) ||
    state.xmlSearch.results.find((doc) => doc.apiNfseId === alert.documentoId) ||
    state.xmlFiles.find((doc) => doc.apiNfseId === alert.documentoId) ||
    findNfseByChaveAcesso(alert.chaveAcesso) ||
    null
  );
}

function canSyncXmlEvents(xml) {
  return Boolean(state.dataSource === 'api' && xml?.apiNfseId && xml?.clientId && normalizeDigits(xml?.chaveAcesso || '').length > 0);
}

function canSyncNfeEvents(doc) {
  return Boolean(
    state.dataSource === 'api' &&
      doc?.apiNfeId &&
      doc?.clientId &&
      normalizeDigits(doc?.chaveAcesso || '').length > 0
  );
}

function extractModeloFromAccessKey(chaveAcesso) {
  const normalized = normalizeDigits(chaveAcesso || '');
  if (normalized.length < 22) {
    return '';
  }

  return normalized.slice(20, 22);
}

function isCteAccessKey(chaveAcesso) {
  return extractModeloFromAccessKey(chaveAcesso) === '57';
}

function canSyncCteEvents(doc) {
  return Boolean(
    state.dataSource === 'api' &&
      doc?.apiCteId &&
      doc?.clientId &&
      normalizeDigits(doc?.chaveAcesso || '').length > 0 &&
      isCteAccessKey(doc?.chaveAcesso)
  );
}

function mapClientOptions() {
  return state.clients.reduce((acc, client) => {
    acc[client.id] = `${client.razaoSocial} (${formatCnpj(client.cnpj)})`;
    return acc;
  }, {});
}

function getNfeSourceMode() {
  if (state.nfeSchedulerStatus?.sourceMode === 'dominio') {
    return 'dominio';
  }
  if (state.nfeSchedulerStatus?.sourceMode === 'dominio_chave') {
    return 'dominio_chave';
  }
  return 'distribuicao';
}

function canUseNfeManualDownloadByKey() {
  return getNfeSourceMode() === 'dominio' || getNfeSourceMode() === 'dominio_chave';
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

function mapNfseAmbienteLabel(ambiente) {
  if (ambiente === 'producao_restrita') {
    return 'Homologacao';
  }

  return 'Producao';
}

function mapNfseNumberingExceptionTypeLabel(tipo) {
  return tipo === 'nao_existe' ? 'Nao existe' : 'Inutilizada';
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
  const dateKey = extractCalendarDateKey(value);
  if (!dateKey) {
    return '-';
  }

  const [year, month, day] = dateKey.split('-');
  return `${day}/${month}/${year}`;
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

function formatAccessEventLabel(value) {
  const map = {
    login_sucesso: 'Login ok',
    login_falha: 'Login falhou',
    logout: 'Logout',
    token_renovado: 'Sessao renovada',
    sessao_expirada: 'Sessao expirada',
    acesso_negado: 'Acesso negado'
  };

  return map[value] || value || '-';
}

function formatAccessEventDetails(value) {
  if (!value || typeof value !== 'object') {
    return '-';
  }

  const motivo = value.motivo ? String(value.motivo) : '';
  const path = value.path ? String(value.path) : '';
  const metodo = value.metodo ? String(value.metodo) : '';
  return [motivo, metodo, path].filter(Boolean).join(' • ') || '-';
}

function toneFromAccessEvent(value) {
  if (value === 'login_falha' || value === 'acesso_negado' || value === 'sessao_expirada') {
    return 'danger';
  }
  if (value === 'login_sucesso' || value === 'token_renovado') {
    return 'success';
  }
  return 'neutral';
}

function formatCurrency(value) {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatOptionalCurrency(value) {
  if (value == null || value === '') {
    return '-';
  }
  return formatCurrency(value);
}

function sumListedDocumentValues(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    if (!shouldIncludeDocumentValueInSum(item)) {
      return sum;
    }

    return sum + toNumber(item?.valor);
  }, 0);
}

function shouldIncludeDocumentValueInSum(item) {
  if (!item || item.cancelada) {
    return false;
  }

  const normalizedStatus = normalizeSearchText(
    item.statusFiscal || item.statusLabel || item.status || ''
  );

  return normalizedStatus.includes('autoriz');
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

async function openNfeDetails(nfeId) {
  const doc = findNfeById(nfeId);
  if (!doc) {
    pushToast('NF-e nao encontrada.', 'error');
    return;
  }

  if (doc.xmlCompletoDisponivel) {
    try {
      await ensureNfeContentLoaded(doc);
    } catch (error) {
      pushToast(`Nao foi possivel enriquecer os detalhes da NF-e agora: ${toErrorMessage(error)}`, 'info');
    }
  }

  openModal({ kind: 'nfe-details', nfeId });
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

async function downloadNfeDanfeById(nfeId) {
  const doc = findNfeById(nfeId);
  if (!doc) {
    pushToast('NF-e nao encontrada.', 'error');
    return;
  }

  if (!doc.xmlCompletoDisponivel) {
    pushToast('DANFE indisponivel para NF-e sem XML completo armazenado.', 'error');
    return;
  }

  if (!doc.apiNfeId || !doc.clientId) {
    pushToast('Documento sem referencia para gerar DANFE na API.', 'error');
    return;
  }

  try {
    const payload = await apiRequest(`/nfe/${doc.apiNfeId}/danfe?clienteId=${encodeURIComponent(doc.clientId)}`);
    downloadFromPayload(payload, `DANFE-${doc.chaveAcesso}.pdf`);
    pushToast(`Download do DANFE ${doc.numeroNfe || doc.chaveAcesso} iniciado.`, 'success');
  } catch (error) {
    pushToast(`Falha ao baixar DANFE da NF-e: ${toErrorMessage(error)}`, 'error');
  }
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

async function openCteDetails(cteId) {
  const doc = findCteById(cteId);
  if (!doc) {
    pushToast('CT-e nao encontrado.', 'error');
    return;
  }

  if (doc.xmlCompletoDisponivel) {
    try {
      await ensureCteContentLoaded(doc);
    } catch (error) {
      pushToast(`Nao foi possivel enriquecer os detalhes do CT-e agora: ${toErrorMessage(error)}`, 'info');
    }
  }

  openModal({ kind: 'cte-details', cteId });
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

async function openXmlViewer(xmlId, options = {}) {
  const xml = findXmlById(xmlId);
  if (!xml) {
    pushToast('XML nao encontrado.', 'error');
    return;
  }

  try {
    await ensureXmlContentLoaded(xml);
    openModal({
      kind: 'xml-view',
      xmlId,
      returnTo: options.returnToModal ? cloneModalState(options.returnToModal) : state.modal?.kind === 'xml-details' ? cloneModalState(state.modal) : null
    });
  } catch (error) {
    pushToast(`Falha ao carregar XML: ${toErrorMessage(error)}`, 'error');
  }
}

async function openXmlDetails(xmlId, options = {}) {
  let xml = findXmlById(xmlId);
  if (!xml) {
    pushToast('XML nao encontrado.', 'error');
    return;
  }

  if (xml.apiNfseId && xml.clientId) {
    try {
      xml = (await ensureNfseDetailsLoaded(xml)) || xml;
      await ensureXmlContentLoaded(xml);
    } catch (error) {
      pushToast(`Nao foi possivel enriquecer os detalhes da NFS-e agora: ${toErrorMessage(error)}`, 'info');
    }
  }

  openModal({
    kind: 'xml-details',
    xmlId: xml.id,
    alertId: String(options.alertId || '').trim(),
    returnTo: options.returnToModal ? cloneModalState(options.returnToModal) : null
  });
}

async function updateXmlNumberingValidation(xmlId, ignore) {
  const xml = findXmlById(xmlId);
  if (!xml || !xml.apiNfseId || !xml.clientId) {
    pushToast('NFS-e nao encontrada para alterar a validacao de numeracao.', 'error');
    return;
  }

  try {
    await apiRequest(`/nfse/${encodeURIComponent(xml.apiNfseId)}/validacao-numeracao`, {
      method: 'POST',
      body: {
        clienteId: xml.clientId,
        ignorar: Boolean(ignore),
        observacao: ignore ? 'Documento desconsiderado manualmente na validacao de numeracao.' : undefined
      }
    });

    await refreshApiData();
    if (state.xmlSearch.hasSearched && state.xmlSearch.lastQuery?.cliente === xml.clientId) {
      await executeXmlSearch();
    }

    pushToast(
      ignore
        ? `A NFS-e ${xml.numeroNfse || xml.chaveAcesso || xml.id} foi desconsiderada na validacao de numeracao.`
        : `A NFS-e ${xml.numeroNfse || xml.chaveAcesso || xml.id} voltou a participar da validacao de numeracao.`,
      'success'
    );
  } catch (error) {
    pushToast(`Falha ao atualizar a validacao de numeracao da NFS-e: ${toErrorMessage(error)}`, 'error');
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

async function downloadSelectedNfeBatch(tipoArquivo = 'ambos') {
  const allowedTypes = ['ambos', 'xml', 'danfe'];
  const normalizedType = allowedTypes.includes(tipoArquivo) ? tipoArquivo : 'ambos';
  const selectedDocs = getFilteredNfeDocuments().filter((doc) => state.selectedNfeIds.has(doc.id) && doc.apiNfeId);

  if (!selectedDocs.length) {
    pushToast('Selecione ao menos uma NF-e da listagem atual.', 'error');
    return;
  }

  const ids = [...new Set(selectedDocs.map((doc) => doc.apiNfeId))];
  const clientIds = [...new Set(selectedDocs.map((doc) => doc.clientId).filter(Boolean))];
  const body = {
    ids,
    tipoArquivo: normalizedType
  };

  if (clientIds.length === 1) {
    body.clienteId = clientIds[0];
  }

  try {
    const payload = await apiRequest('/nfe/download-lote', {
      method: 'POST',
      body,
      timeoutMs: 2 * 60 * 1000
    });
    downloadFromPayload(payload, `nfe-lote-${normalizedType}.zip`);
    const errorsCount = Array.isArray(payload?.erros) ? payload.erros.length : 0;
    const included = Number(payload?.totalArquivosIncluidos || 0);
    pushToast(
      `Download em lote iniciado: ${included} arquivo(s) no ZIP${errorsCount ? `, ${errorsCount} aviso(s)` : ''}.`,
      errorsCount ? 'info' : 'success'
    );
  } catch (error) {
    pushToast(`Falha ao baixar lote de NF-e: ${toErrorMessage(error)}`, 'error');
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
    (xml) => canSyncXmlEvents(xml)
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
    const summary = await runManualEventsSyncOverlay({
      documentType: 'nfse',
      scope: 'listagem',
      targets,
      requestSync: (target) => requestNfseEventsSync(target.clientId, [target.apiNfseId]),
      fetchUpdatedDocument: fetchUpdatedNfseDocumentAfterEventSync
    });
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

  if (!canSyncXmlEvents(xml)) {
    pushToast('Esta NFS-e nao possui dados suficientes para consultar eventos.', 'error');
    return;
  }

  state.xmlEventsSyncRunning = true;
  render();
  pushToast(`Sincronizando eventos da NFS-e ${xml.numeroNfse || xml.chaveAcesso || xml.id}...`, 'info');

  try {
    const summary = await runManualEventsSyncOverlay({
      documentType: 'nfse',
      scope: 'individual',
      targets: [xml],
      requestSync: (target) => requestNfseEventsSync(target.clientId, [target.apiNfseId]),
      fetchUpdatedDocument: fetchUpdatedNfseDocumentAfterEventSync
    });
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
    timeoutMs: Math.max(180000, documentoIds.length * 30000)
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
    const summary = await runManualEventsSyncOverlay({
      documentType: 'nfe',
      scope: 'listagem',
      targets,
      requestSync: (target) => requestNfeEventsSync(target.clientId, [target.apiNfeId]),
      fetchUpdatedDocument: fetchUpdatedNfeDocumentAfterEventSync
    });
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
    const summary = await runManualEventsSyncOverlay({
      documentType: 'nfe',
      scope: 'individual',
      targets: [doc],
      requestSync: (target) => requestNfeEventsSync(target.clientId, [target.apiNfeId]),
      fetchUpdatedDocument: fetchUpdatedNfeDocumentAfterEventSync
    });
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
    timeoutMs: Math.max(180000, documentoIds.length * 30000)
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
    const summary = await runManualEventsSyncOverlay({
      documentType: 'cte',
      scope: 'listagem',
      targets,
      requestSync: (target) => requestCteEventsSync(target.clientId, [target.apiCteId]),
      fetchUpdatedDocument: fetchUpdatedCteDocumentAfterEventSync
    });
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
    const summary = await runManualEventsSyncOverlay({
      documentType: 'cte',
      scope: 'individual',
      targets: [doc],
      requestSync: (target) => requestCteEventsSync(target.clientId, [target.apiCteId]),
      fetchUpdatedDocument: fetchUpdatedCteDocumentAfterEventSync
    });
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
    timeoutMs: Math.max(180000, documentoIds.length * 30000)
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

async function runManualEventsSyncOverlay(params) {
  const targets = Array.isArray(params?.targets) ? params.targets.filter(Boolean) : [];
  const aggregate = {
    documentosProcessados: 0,
    documentosAnalisados: 0,
    documentosComEventos: 0,
    eventosEncontrados: 0,
    eventosImportados: 0,
    falhas: 0,
    detalhes: []
  };

  const rows = targets.map((target, index) => buildPendingEventsSyncRow(params.documentType, target, index));
  openModal({
    kind: 'events-sync-report',
    documentType: params.documentType,
    scope: params.scope || 'listagem',
    running: true,
    processedCount: 0,
    totalCount: targets.length,
    documentosComEventos: 0,
    eventosImportados: 0,
    falhas: 0,
    currentMessage: targets.length ? 'Preparando consultas...' : 'Nenhum documento selecionado.',
    rows,
    summary: aggregate
  });

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const baseRow = rows[index];
    rows[index] = {
      ...baseRow,
      eventLabel: 'Pesquisando...',
      statusLabel: 'Consultando',
      statusTone: 'info',
      message: 'Consultando eventos no servico externo...'
    };
    updateEventsSyncOverlayState({
      running: true,
      processedCount: index,
      totalCount: targets.length,
      documentosComEventos: aggregate.documentosComEventos,
      eventosImportados: aggregate.eventosImportados,
      falhas: aggregate.falhas,
      currentMessage: `Consultando ${index + 1} de ${targets.length}: ${target.chaveAcesso || baseRow.documentLabel}`,
      rows,
      summary: aggregate
    });

    try {
      const summary = await params.requestSync(target);
      const detail = normalizeSingleEventsSyncDetail(summary, target);
      const updatedDocument =
        detail.status !== 'falha_certificado' &&
        detail.status !== 'falha_api' &&
        typeof params.fetchUpdatedDocument === 'function'
          ? await params.fetchUpdatedDocument(target).catch(() => null)
          : null;

      aggregate.documentosProcessados += Number(summary?.documentosProcessados || 0);
      aggregate.documentosAnalisados += Number(summary?.documentosAnalisados || 0);
      aggregate.documentosComEventos += Number(summary?.documentosComEventos || 0);
      aggregate.eventosEncontrados += Number(summary?.eventosEncontrados || 0);
      aggregate.eventosImportados += Number(summary?.eventosImportados || 0);
      aggregate.falhas += Number(summary?.falhas || 0);
      aggregate.detalhes.push(detail);

      rows[index] = buildResolvedEventsSyncRow(params.documentType, target, detail, updatedDocument, index);
    } catch (error) {
      const detail = buildFailedEventsSyncDetail(target, error);
      aggregate.documentosProcessados += 1;
      aggregate.documentosAnalisados += 1;
      aggregate.falhas += 1;
      aggregate.detalhes.push(detail);
      rows[index] = buildResolvedEventsSyncRow(params.documentType, target, detail, null, index);
    }

    updateEventsSyncOverlayState({
      running: true,
      processedCount: index + 1,
      totalCount: targets.length,
      documentosComEventos: aggregate.documentosComEventos,
      eventosImportados: aggregate.eventosImportados,
      falhas: aggregate.falhas,
      currentMessage:
        index + 1 < targets.length
          ? `Aguardando a proxima consulta...`
          : 'Finalizando auditoria da busca manual...',
      rows,
      summary: aggregate
    });
  }

  updateEventsSyncOverlayState({
    running: false,
    processedCount: targets.length,
    totalCount: targets.length,
    documentosComEventos: aggregate.documentosComEventos,
    eventosImportados: aggregate.eventosImportados,
    falhas: aggregate.falhas,
    currentMessage: 'Busca manual concluida.',
    rows,
    summary: aggregate
  });

  return {
    documentosProcessados: aggregate.documentosProcessados || targets.length,
    documentosAnalisados: aggregate.documentosAnalisados || targets.length,
    documentosComEventos: aggregate.documentosComEventos,
    eventosEncontrados: aggregate.eventosEncontrados,
    eventosImportados: aggregate.eventosImportados,
    falhas: aggregate.falhas,
    detalhes: aggregate.detalhes
  };
}

function updateEventsSyncOverlayState(patch) {
  if (state.modal?.kind !== 'events-sync-report') {
    return;
  }

  state.modal = {
    ...state.modal,
    ...patch
  };
  render();
}

function buildPendingEventsSyncRow(documentType, target, index) {
  const documentLabel = resolveSyncAuditDocumentLabel(documentType, null, target, index);
  const secondaryLabel = resolveSyncAuditSecondaryLabel(documentType, null, target);

  return {
    documentLabel,
    secondaryLabel,
    chaveAcesso: String(target?.chaveAcesso || '-'),
    eventLabel: Array.isArray(target?.eventos) && target.eventos.length ? buildCurrentEventLabelFromDocument(target) : 'Na fila',
    eventCountLabel: '0 encontrado(s) / 0 importado(s)',
    statusLabel: 'Na fila',
    statusTone: 'neutral',
    message: 'Aguardando consulta manual...',
    openActionId: target?.id || null
  };
}

function buildResolvedEventsSyncRow(documentType, target, detail, updatedDocument, index) {
  const document = updatedDocument || target;
  const eventLabel = resolveSyncAuditEventLabel(detail, document);

  return {
    documentLabel: resolveSyncAuditDocumentLabel(documentType, detail, document, index),
    secondaryLabel: resolveSyncAuditSecondaryLabel(documentType, detail, document),
    chaveAcesso: String(detail?.chaveAcesso || document?.chaveAcesso || '-'),
    eventLabel,
    eventCountLabel: `${Number(detail?.eventosEncontrados || 0)} encontrado(s) / ${Number(detail?.eventosImportados || 0)} importado(s)`,
    statusLabel: mapSyncAuditStatusLabel(detail?.status),
    statusTone: resolveSyncAuditStatusTone(detail?.status),
    message:
      normalizeSyncAuditMessage(detail) || (detail?.status === 'sincronizado' ? 'Consulta concluida com sucesso.' : '-'),
    openActionId: document?.id || target?.id || null
  };
}

function normalizeSingleEventsSyncDetail(summary, target) {
  const detail = Array.isArray(summary?.detalhes) ? summary.detalhes[0] : null;
  if (detail) {
    return detail;
  }

  return {
    documentoId: target?.apiNfeId || target?.apiCteId || target?.apiNfseId || target?.id,
    chaveAcesso: target?.chaveAcesso || '',
    numeroDocumento: target?.numeroNfe || target?.numeroCte || target?.numeroNfse || null,
    status: Number(summary?.falhas || 0) > 0 ? 'falha_api' : Number(summary?.eventosEncontrados || 0) > 0 ? 'sincronizado' : 'sem_eventos',
    eventosEncontrados: Number(summary?.eventosEncontrados || 0),
    eventosImportados: Number(summary?.eventosImportados || 0),
    mensagem: ''
  };
}

function buildFailedEventsSyncDetail(target, error) {
  const message = toErrorMessage(error);
  const isCertificateFailure = normalizeSearchText(message).includes('certificado');

  return {
    documentoId: target?.apiNfeId || target?.apiCteId || target?.apiNfseId || target?.id,
    chaveAcesso: target?.chaveAcesso || '',
    numeroDocumento: target?.numeroNfe || target?.numeroCte || target?.numeroNfse || null,
    status: isCertificateFailure ? 'falha_certificado' : 'falha_api',
    eventosEncontrados: 0,
    eventosImportados: 0,
    mensagem: message
  };
}

async function fetchUpdatedNfseDocumentAfterEventSync(target) {
  if (!target?.apiNfseId || !target?.clientId) {
    return null;
  }

  const raw = await apiRequest(`/nfse/${target.apiNfseId}?clienteId=${encodeURIComponent(target.clientId)}`);
  const mapped = buildXmlFilesFromApi([raw], state.clients, target.clientId)[0] || null;
  if (mapped) {
    replaceDocumentInStateCollections('nfse', mapped);
  }
  return mapped;
}

async function fetchUpdatedNfeDocumentAfterEventSync(target) {
  if (!target?.apiNfeId || !target?.clientId) {
    return null;
  }

  const raw = await apiRequest(`/nfe/${target.apiNfeId}?clienteId=${encodeURIComponent(target.clientId)}`);
  const mapped = buildNfeDocumentsFromApi([raw], state.clients)[0] || null;
  if (mapped) {
    replaceDocumentInStateCollections('nfe', mapped);
  }
  return mapped;
}

async function fetchUpdatedCteDocumentAfterEventSync(target) {
  if (!target?.apiCteId || !target?.clientId) {
    return null;
  }

  const raw = await apiRequest(`/cte/${target.apiCteId}?clienteId=${encodeURIComponent(target.clientId)}`);
  const mapped = buildCteDocumentsFromApi([raw], state.clients)[0] || null;
  if (mapped) {
    replaceDocumentInStateCollections('cte', mapped);
  }
  return mapped;
}

function replaceDocumentInStateCollections(documentType, mapped) {
  if (!mapped?.id) {
    return;
  }

  if (documentType === 'nfse') {
    state.xmlSearch.results = replaceItemInCollection(state.xmlSearch.results, mapped);
    state.xmlFiles = replaceItemInCollection(state.xmlFiles, mapped);
    return;
  }

  if (documentType === 'cte') {
    state.cteSearch.results = replaceItemInCollection(state.cteSearch.results, mapped);
    state.cteDocuments = replaceItemInCollection(state.cteDocuments, mapped);
    return;
  }

  state.nfeSearch.results = replaceItemInCollection(state.nfeSearch.results, mapped);
  state.nfeDocuments = replaceItemInCollection(state.nfeDocuments, mapped);
}

function replaceItemInCollection(collection, mapped) {
  const items = Array.isArray(collection) ? collection : [];
  const index = items.findIndex((item) => item?.id === mapped.id);
  if (index === -1) {
    return items;
  }

  const next = [...items];
  next[index] = {
    ...next[index],
    ...mapped
  };
  return next;
}

function buildCurrentEventLabelFromDocument(document) {
  const eventos = Array.isArray(document?.eventos) ? document.eventos : [];
  const labels = [...new Set(eventos.map((evento) => formatEventoResumoLabel(evento)).filter(Boolean))];
  return labels.length ? labels.join(' / ') : 'Evento';
}

function openEventsSyncReportModal(documentType, summary, scope = 'listagem') {
  openModal({
    kind: 'events-sync-report',
    documentType,
    summary,
    scope
  });
}

function buildEventsSyncAuditRows(documentType, summary) {
  const details = Array.isArray(summary?.detalhes) ? summary.detalhes : [];

  return details.map((detail, index) => {
    const document = findDocumentBySyncAudit(documentType, detail?.documentoId);
    const documentLabel = resolveSyncAuditDocumentLabel(documentType, detail, document, index);
    const secondaryLabel = resolveSyncAuditSecondaryLabel(documentType, detail, document);
    const eventLabel = resolveSyncAuditEventLabel(detail, document);
    const statusTone = resolveSyncAuditStatusTone(detail?.status);

    return {
      documentLabel,
      secondaryLabel,
      chaveAcesso: String(detail?.chaveAcesso || document?.chaveAcesso || '-'),
      eventLabel,
      eventCountLabel: `${Number(detail?.eventosEncontrados || 0)} encontrado(s) / ${Number(detail?.eventosImportados || 0)} importado(s)`,
      statusLabel: mapSyncAuditStatusLabel(detail?.status),
      statusTone,
      message: normalizeSyncAuditMessage(detail),
      openActionId: document?.id || null
    };
  });
}

function normalizeSyncAuditMessage(detail) {
  const raw = String(detail?.mensagem || '').trim();
  if (!raw) {
    return '';
  }

  const normalized = normalizeSearchText(raw);
  if (raw.startsWith('{') || raw.startsWith('[') || normalized.includes('"lotedfe"') || normalized.includes('"statusprocessamento"')) {
    if (detail?.status === 'sem_eventos') {
      return 'Nenhum evento encontrado no ADN';
    }

    if (detail?.status === 'nao_localizado_endpoint_eventos') {
      return 'Nao localizado no endpoint de eventos';
    }

    return 'Resposta retornada pelo servico externo fora do formato esperado.';
  }

  return raw;
}

function findDocumentBySyncAudit(documentType, documentoId) {
  if (!documentoId) {
    return null;
  }

  if (documentType === 'nfse') {
    return (
      state.xmlSearch.results.find((item) => item.apiNfseId === documentoId) ||
      state.xmlFiles.find((item) => item.apiNfseId === documentoId) ||
      null
    );
  }

  if (documentType === 'cte') {
    return (
      state.cteSearch.results.find((item) => item.apiCteId === documentoId) ||
      state.cteDocuments.find((item) => item.apiCteId === documentoId) ||
      null
    );
  }

  return (
    state.nfeSearch.results.find((item) => item.apiNfeId === documentoId) ||
    state.nfeDocuments.find((item) => item.apiNfeId === documentoId) ||
    null
  );
}

function resolveSyncAuditDocumentLabel(documentType, detail, document, index) {
  if (documentType === 'nfse') {
    return document?.numeroNfse || `NFS-e ${index + 1}`;
  }

  if (documentType === 'cte') {
    return document?.numeroCte || detail?.numeroDocumento || `CT-e ${index + 1}`;
  }

  return document?.numeroNfe || detail?.numeroDocumento || `NF-e ${index + 1}`;
}

function resolveSyncAuditSecondaryLabel(documentType, detail, document) {
  if (documentType === 'nfse') {
    const ambienteBruto = document?.ambiente || detail?.ambiente || detail?.diagnostico?.ambienteDocumento || '';
    const ambiente = ambienteBruto ? mapNfseAmbienteLabel(ambienteBruto) : '';
    const estabelecimento = document?.prestador || document?.cliente || '';
    return [ambiente, estabelecimento].filter(Boolean).join(' • ');
  }

  const ambiente = document?.ambiente ? mapNfeAmbienteLabel(document.ambiente) : '';
  const tipo = document?.tipo || '';
  return [tipo, ambiente].filter(Boolean).join(' • ');
}

function resolveSyncAuditEventLabel(detail, document) {
  if (detail?.status === 'falha_certificado') {
    return 'Falha de certificado';
  }

  if (detail?.status === 'falha_api') {
    return 'Falha na consulta';
  }

  if (detail?.status === 'nao_localizado_endpoint_eventos') {
    return 'Nao localizado no endpoint';
  }

  if (detail?.status === 'sem_eventos') {
    return 'Sem evento';
  }

  const eventos = Array.isArray(document?.eventos) ? document.eventos : [];
  const labels = [...new Set(eventos.map((evento) => formatEventoResumoLabel(evento)).filter(Boolean))];
  if (labels.length > 0) {
    return labels.join(' / ');
  }

  return Number(detail?.eventosEncontrados || 0) > 0 ? `${Number(detail?.eventosEncontrados || 0)} evento(s)` : 'Evento localizado';
}

function mapSyncAuditStatusLabel(status) {
  switch (status) {
    case 'sincronizado':
      return 'Sincronizado';
    case 'nao_localizado_endpoint_eventos':
      return 'Nao localizado no endpoint';
    case 'sem_eventos':
      return 'Sem evento';
    case 'falha_certificado':
      return 'Falha de certificado';
    case 'falha_api':
      return 'Falha de API';
    default:
      return 'Processado';
  }
}

function resolveSyncAuditStatusTone(status) {
  switch (status) {
    case 'sincronizado':
      return 'success';
    case 'nao_localizado_endpoint_eventos':
      return 'warning';
    case 'sem_eventos':
      return 'neutral';
    case 'falha_certificado':
    case 'falha_api':
      return 'danger';
    default:
      return 'info';
  }
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
    'Fornecedor / cliente',
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
    xml.contraparteNome || '-',
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

async function ensureNfseDetailsLoaded(xml) {
  if (!xml.apiNfseId || !xml.clientId) {
    throw new Error('Documento sem referencia para recuperar detalhes na API');
  }

  const raw = await apiRequest(`/nfse/${xml.apiNfseId}?clienteId=${encodeURIComponent(xml.clientId)}`);
  const mapped = buildXmlFilesFromApi([raw], state.clients, xml.clientId)[0] || null;
  if (!mapped) {
    return xml;
  }

  mapped.conteudoXml = xml.conteudoXml || null;
  replaceDocumentInStateCollections('nfse', mapped);
  return findXmlById(mapped.id) || mapped;
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

function resetCompareSpedState() {
  state.compareSped.status = 'idle';
  state.compareSped.sourceFileName = '';
  state.compareSped.sourceCompetence = '';
  state.compareSped.sourceCompanyId = '';
  state.compareSped.outputFormat = 'Excel';
  state.compareSped.generatedAt = null;
  state.compareSped.report = null;
  state.compareSped.artifact = null;
  state.compareSped.lastError = '';
}

function addCompareSpedHistoryItem(item) {
  const currentHistory = Array.isArray(state.compareSped.history) ? state.compareSped.history : [];
  const incoming = normalizeCompareSpedHistoryItem(item);
  const history = [incoming, ...currentHistory.filter((entry) => compareSpedHistoryKey(entry) !== compareSpedHistoryKey(incoming))];

  while (history.length > COMPARE_SPED_HISTORY_LIMIT) {
    const removed = history.pop();
    if (removed?.artifact?.blobUrl) {
      URL.revokeObjectURL(removed.artifact.blobUrl);
    }
  }

  state.compareSped.history = history;
  saveCompareSpedHistoryStore(history);
}

function triggerBrowserDownloadFromUrl(fileName, blobUrl) {
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function submitCompareSpedForm(form, submitter = null) {
  const data = new FormData(form);
  const companyId = String(data.get('empresa') || '').trim();
  const competence = String(data.get('competencia') || '').trim();
  const submitterFormat = String(submitter?.getAttribute?.('data-output-format') || '').trim();
  const selectedOutput = submitterFormat || String(data.get('saida') || 'Excel').trim();
  const outputFormat = selectedOutput === 'PDF' ? 'PDF' : 'Excel';
  const file = data.get('arquivoSped');

  if (!companyId) {
    pushToast('Selecione uma empresa antes de gerar a comparacao.', 'error');
    return;
  }

  if (!(file instanceof File) || !file.name) {
    pushToast('Envie o arquivo TXT do SPED Fiscal.', 'error');
    return;
  }

  if (!file.name.toLowerCase().endsWith('.txt')) {
    pushToast('Nesta primeira etapa utilize um arquivo TXT do SPED Fiscal.', 'error');
    return;
  }

  const client = findClientById(companyId);
  if (!client) {
    pushToast('Empresa selecionada nao encontrada.', 'error');
    return;
  }

  state.compareSped.status = 'processing';
  state.compareSped.sourceCompanyId = companyId;
  state.compareSped.sourceCompetence = competence;
  state.compareSped.sourceFileName = file.name;
  state.compareSped.outputFormat = outputFormat;
  state.compareSped.generatedAt = null;
  state.compareSped.report = null;
  state.compareSped.artifact = null;
  state.compareSped.lastError = '';
  render();

  try {
    const fileText = await file.text();
    const parsed = parseCompareSpedFile(fileText);
    const dateRange = resolveCompareSpedDateRange(parsed.documents, competence);
    const dominioDocs = await fetchCompareSpedCompanyDocuments({
      client,
      dateRange
    });
    const effectiveCompetence = String(competence || '').trim() || getCompareSpedCompetence(parsed.documents) || formatCompareMonth(dateRange?.dataInicio || '');
    const report = buildCompareSpedReport({
      client,
      competence: effectiveCompetence,
      sourceFileName: file.name,
      parsedDocuments: parsed.documents,
      dominioDocuments: dominioDocs,
      parsingWarnings: parsed.warnings,
      outputFormat
    });
    const artifact = buildCompareSpedArtifact(report, outputFormat);
    const generatedAt = new Date().toISOString();
    const pendingHistoryItem = buildCompareSpedHistoryItem({
      id: `${generatedAt}-${Math.random().toString(36).slice(2, 8)}`,
      generatedAt,
      clientId: client.id,
      clientName: client.razaoSocial || 'Cliente selecionado',
      clientCnpj: client.cnpj || '',
      competence: effectiveCompetence,
      sourceFileName: file.name,
      outputFormat,
      report,
      artifact
    });

    let savedHistoryItem = pendingHistoryItem;
    try {
      const persisted = await persistCompareSpedHistoryItem(pendingHistoryItem);
      savedHistoryItem = persisted || pendingHistoryItem;
    } catch (persistError) {
      console.warn('Falha ao persistir historico de comparacao SPED.', persistError);
      pushToast('Comparacao gerada, mas o historico foi salvo apenas neste navegador.', 'warning');
    }

    state.compareSped.status = 'done';
    state.compareSped.report = report;
    state.compareSped.artifact = artifact;
    state.compareSped.generatedAt = generatedAt;
    addCompareSpedHistoryItem(savedHistoryItem);
    state.compareSped.lastError = '';
    render();
    pushToast(`Comparacao gerada com sucesso em formato ${outputFormat === 'PDF' ? 'PDF' : 'Excel'}.`, 'success');
  } catch (error) {
    state.compareSped.status = 'error';
    state.compareSped.lastError = toErrorMessage(error);
    render();
    pushToast(`Falha ao gerar comparacao: ${toErrorMessage(error)}`, 'error');
  }
}

async function downloadCompareSpedArtifact() {
  const artifact = state.compareSped.artifact;
  if (!artifact?.blobUrl) {
    pushToast('Gere a comparacao antes de baixar o arquivo.', 'error');
    return;
  }

  triggerBrowserDownloadFromUrl(artifact.fileName, artifact.blobUrl);
  pushToast(`Download de ${artifact.fileName} iniciado.`, 'success');
}

async function downloadCompareSpedHistoryItem(compareId) {
  const history = Array.isArray(state.compareSped.history) ? state.compareSped.history : [];
  const historyItem = history.find((item) => item.id === compareId);
  if (!historyItem) {
    pushToast('Nao foi possivel localizar a comparacao selecionada.', 'error');
    return;
  }

  let artifact = historyItem.artifact;
  if (!artifact?.blobUrl && historyItem.report) {
    artifact = buildCompareSpedArtifact(historyItem.report, historyItem.outputFormat || 'Excel');
    historyItem.artifact = artifact;
  }

  if (!artifact?.blobUrl) {
    pushToast('Nao foi possivel recriar o arquivo para download novamente.', 'error');
    return;
  }

  triggerBrowserDownloadFromUrl(artifact.fileName, artifact.blobUrl);
  pushToast(`Download de ${artifact.fileName} iniciado novamente.`, 'success');
}

function parseCompareSpedFile(text) {
  const documents = [];
  const warnings = [];
  const seenKeys = new Set();
  const participants = new Map();
  const pendingDocuments = [];
  const rawLines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  rawLines.forEach((line, index) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || !trimmed.startsWith('|')) {
      return;
    }

    const fields = trimmed.split('|').slice(1, -1);
    const recordType = fields[0];
    if (recordType === '0150') {
      const participantCode = String(fields[1] || '').trim();
      if (participantCode) {
        participants.set(participantCode, {
          codigo: participantCode,
          nome: String(fields[2] || '').trim() || '-',
          cnpj: normalizeDigits(fields[4] || fields[5] || ''),
          cpf: normalizeDigits(fields[5] || ''),
          rawFields: fields
        });
      }
      return;
    }

    if (recordType !== 'C100') {
      return;
    }

    pendingDocuments.push({
      sourceLine: index + 1,
      recordType,
      modelo: String(fields[4] || '').trim(),
      codPart: String(fields[3] || '').trim(),
      serie: String(fields[6] || '').trim(),
      numero: String(fields[7] || '').trim(),
      chaveAcesso: normalizeDigits(fields[8] || ''),
      dataEmissao: parseCompareSpedDate(fields[9]),
      valor: toNumber(fields[11]),
      rawFields: fields
    });
  });

  pendingDocuments.forEach((spedDocument) => {
    const participant = participants.get(spedDocument.codPart) || null;
    const enrichedDocument = {
      ...spedDocument,
      tipoDocumento: describeCompareSpedModel(spedDocument.modelo),
      emitenteNome: participant?.nome || '-',
      emitenteCnpj: participant?.cnpj || participant?.cpf || ''
    };
    const fingerprint = buildCompareCandidateKeys(enrichedDocument)[0] || '';
    if (seenKeys.has(fingerprint)) {
      warnings.push(`Documento repetido no SPED: linha ${enrichedDocument.sourceLine}, chave ${enrichedDocument.chaveAcesso || enrichedDocument.numero || '-'} .`);
      return;
    }

    seenKeys.add(fingerprint);
    documents.push(enrichedDocument);
  });

  return { documents, warnings };
}

async function fetchCompareSpedCompanyDocuments({ client, dateRange }) {
  const [storedDocs, dominioDocs] = await Promise.all([
    fetchCompareSpedStoredDocuments({ client, dateRange }),
    fetchCompareSpedDominioPreviewDocuments({ client, dateRange })
  ]);

  return mergeCompareSpedCompanyDocuments(storedDocs, dominioDocs);
}

async function fetchCompareSpedStoredDocuments({ client, dateRange }) {
  const query = buildNfeSearchQuery(
    {
      cliente: client.id,
      tipo: 'Recebida',
      ambiente: 'producao',
      emissaoInicio: dateRange?.dataInicio || '',
      emissaoFim: dateRange?.dataFim || '',
      status: 'Todos',
      eventos: 'Todos',
      schemaDoc: 'Todos',
      xmlCompleto: 'Todos',
      cnpj: '',
      numero: '',
      chave: '',
      valorMin: '',
      valorMax: ''
    },
    1,
    SEARCH_PAGE_SIZE,
    true
  );

  const payload = normalizePaginatedResponse(await apiRequest(`/nfe?${query.toString()}`));
  return buildNfeDocumentsFromApi(payload.items, state.clients).map((doc) => ({
    ...doc,
    tipoDocumento: describeCompareSpedModel(doc.modelo || '55')
  }));
}

async function fetchCompareSpedDominioPreviewDocuments({ client, dateRange }) {
  const response = normalizePaginatedResponse(
    await apiRequest('/nfe/dominio/documentos/preview', {
      method: 'POST',
      body: {
        clienteId: client.id,
        limit: 5000,
        ...(dateRange?.dataInicio ? { dataEmissaoInicio: dateRange.dataInicio } : {}),
        ...(dateRange?.dataFim ? { dataEmissaoFim: dateRange.dataFim } : {})
      }
    })
  );

  return response.items.map((item, index) => ({
    id: `dominio-preview-${item.catalogoId || index}`,
    apiNfeId: null,
    clientId: client.id,
    cliente: client.razaoSocial || 'Cliente nao identificado',
    estabelecimentoId: null,
    chaveAcesso: item.chaveAcesso || '-',
    numeroNfe: item.numeroNfe || '-',
    serie: item.serie || '-',
    modelo: item.modelo || '55',
    ambiente: 'producao',
    dataEmissao: item.dataEmissao || null,
    dataAutorizacao: item.dataEmissao || null,
    valor: toNumber(item.valor),
    tipoDocumento: describeCompareSpedModel(item.modelo || '55'),
    tipo: 'Recebida',
    statusFiscal: 'Disponivel na Dominio',
    cancelada: false,
    schemaDoc: 'dominio_xml',
    xmlCompletoDisponivel: true,
    resumoDisponivel: true,
    caminhoServidor: '-',
    emitenteNome: item.emitenteNome || '-',
    emitenteCnpj: normalizeDigits(item.emitenteCnpj || ''),
    destinatarioNome: item.destinatarioNome || '-',
    destinatarioCnpj: normalizeDigits(item.destinatarioCnpj || ''),
    contraparteNome: item.emitenteNome || '-',
    contraparteCnpj: normalizeDigits(item.emitenteCnpj || ''),
    eventos: [],
    temEventos: false,
    eventosResumo: [],
    conteudoXml: null
  }));
}

function mergeCompareSpedCompanyDocuments(storedDocs, dominioDocs) {
  const merged = [];
  const seenKeys = new Set();
  const appendDocument = (doc) => {
    if (!doc) {
      return;
    }

    const candidateKeys = buildCompareCandidateKeys(doc).filter(Boolean);
    const dedupeKey = candidateKeys[0] || `${normalizeDigits(doc.chaveAcesso || '')}-${normalizeDigits(doc.numeroNfe || doc.numero || '')}-${normalizeDigits(doc.serie || '')}-${formatCompareMonth(doc.dataEmissao || '')}`;
    if (!dedupeKey || seenKeys.has(dedupeKey)) {
      return;
    }

    seenKeys.add(dedupeKey);
    merged.push(doc);
  };

  (Array.isArray(storedDocs) ? storedDocs : []).forEach(appendDocument);
  (Array.isArray(dominioDocs) ? dominioDocs : []).forEach(appendDocument);

  return merged.sort((left, right) => Date.parse(right?.dataEmissao || 0) - Date.parse(left?.dataEmissao || 0));
}

function buildCompareSpedReport({ client, competence, sourceFileName, parsedDocuments, dominioDocuments, parsingWarnings, outputFormat }) {
  const normalizedCompetence = String(competence || '').trim();
  const inferredCompetence = getCompareSpedCompetence(parsedDocuments);
  const activeCompetence = normalizedCompetence || inferredCompetence || '';
  const companyDocs = Array.isArray(dominioDocuments) ? dominioDocuments : [];
  const spedDocs = filterCompareSpedByCompetence(parsedDocuments, activeCompetence);
  const dominioDocs = filterCompareDominioByCompetence(companyDocs, activeCompetence);
  const matchResult = matchCompareSpedDocuments(spedDocs, dominioDocs);
  const rows = matchResult.rows;
  const matchedCount = matchResult.matchedCount;
  const onlySpedCount = matchResult.onlySpedCount;
  const onlyDominioCount = matchResult.onlyDominioCount;
  const divergentCount = matchResult.divergentCount;

  const issuesCount = rows.filter((row) => row.status !== 'OK').length;
  const warnings = [...(Array.isArray(parsingWarnings) ? parsingWarnings : [])];
  const summary = {
    spedDocs: spedDocs.length,
    dominioDocs: dominioDocs.length,
    matchedDocs: matchedCount,
    onlySpedDocs: onlySpedCount,
    onlyDominioDocs: onlyDominioCount,
    divergentDocs: divergentCount,
    issuesCount,
    warningsCount: warnings.length
  };

  return {
    clientId: client.id,
    companyName: client.razaoSocial || 'Empresa selecionada',
    clientCnpj: normalizeDigits(client.cnpj || ''),
    competence: activeCompetence,
    sourceFileName,
    generatedAt: new Date().toISOString(),
    outputFormat,
    summary,
    rows,
    warnings,
    source: {
      parsedDocs: parsedDocuments.length,
      companyDocs: companyDocs.length
    }
  };
}

function filterCompareSpedByCompetence(documents, competence) {
  if (!competence) {
    return [...documents];
  }

  return documents.filter((doc) => formatCompareMonth(doc.dataEmissao) === competence);
}

function filterCompareDominioByCompetence(documents, competence) {
  if (!competence) {
    return [...documents];
  }

  return documents.filter((doc) => formatCompareMonth(doc.dataEmissao) === competence);
}

function matchCompareSpedDocuments(spedDocs, dominioDocs) {
  const rows = [];
  const usedSped = new Set();
  const usedDominio = new Set();
  const spedIndexed = (Array.isArray(spedDocs) ? spedDocs : []).map((doc, idx) => ({ ...doc, __compareIndex: idx }));
  const dominioIndexed = (Array.isArray(dominioDocs) ? dominioDocs : []).map((doc, idx) => ({ ...doc, __compareIndex: idx }));
  const spedIndex = buildCompareIndex(spedIndexed);
  const dominioIndex = buildCompareIndex(dominioIndexed);
  let matchedCount = 0;
  let onlySpedCount = 0;
  let onlyDominioCount = 0;
  let divergentCount = 0;

  const consumeMatch = (spedDoc, dominioDoc) => {
    const diffs = compareSpedAndDominioDocs(spedDoc, dominioDoc);
    const status = diffs.length ? 'Divergente' : 'OK';
    if (status === 'OK') {
      matchedCount += 1;
    } else {
      divergentCount += 1;
    }

    rows.push({
      status,
      chave: spedDoc.chaveAcesso || dominioDoc.chaveAcesso || '-',
      tipoSped: spedDoc.tipoDocumento || describeCompareSpedModel(spedDoc.modelo) || '-',
      tipoDominio: dominioDoc.tipoDocumento || describeCompareSpedModel(dominioDoc.modelo) || '-',
      numeroSped: spedDoc.numero || spedDoc.numeroNfe || '-',
      numeroDominio: dominioDoc.numeroNfe || dominioDoc.numero || '-',
      serieSped: spedDoc.serie || '-',
      serieDominio: dominioDoc.serie || '-',
      dataSped: spedDoc.dataEmissao || '-',
      dataDominio: formatDate(dominioDoc.dataEmissao || ''),
      valorSped: spedDoc.valor,
      valorDominio: dominioDoc.valor,
      diferencaValor: toNumber(dominioDoc.valor) - toNumber(spedDoc.valor),
      emitenteNomeSped: spedDoc.emitenteNome || '-',
      emitenteCnpjSped: spedDoc.emitenteCnpj || '',
      emitenteNomeDominio: dominioDoc.emitenteNome || '-',
      emitenteCnpjDominio: dominioDoc.emitenteCnpj || '',
      observacao: diffs.join('; ') || 'Documento encontrado nas duas bases.'
    });
  };

  const tryMatchByKey = (keys) => {
    for (const key of keys) {
      const spedBucket = spedIndex.get(key) || [];
      const dominioBucket = dominioIndex.get(key) || [];
      const spedDoc = spedBucket.find((doc) => !usedSped.has(doc.__compareIndex));
      const dominioDoc = dominioBucket.find((doc) => !usedDominio.has(doc.__compareIndex));

      if (spedDoc && dominioDoc) {
        usedSped.add(spedDoc.__compareIndex);
        usedDominio.add(dominioDoc.__compareIndex);
        consumeMatch(spedDoc, dominioDoc);
        return true;
      }
    }

    return false;
  };

  spedIndexed.forEach((spedDoc) => {
    const keys = buildCompareCandidateKeys(spedDoc);
    const matched = tryMatchByKey(keys);
    if (!matched) {
      onlySpedCount += 1;
      rows.push({
        status: 'Somente no SPED',
        chave: spedDoc.chaveAcesso || '-',
        tipoSped: spedDoc.tipoDocumento || describeCompareSpedModel(spedDoc.modelo) || '-',
        tipoDominio: '-',
        numeroSped: spedDoc.numero || '-',
        numeroDominio: '-',
        serieSped: spedDoc.serie || '-',
        serieDominio: '-',
        dataSped: spedDoc.dataEmissao || '-',
        dataDominio: '-',
        valorSped: spedDoc.valor,
        valorDominio: null,
        diferencaValor: null,
        emitenteNomeSped: spedDoc.emitenteNome || '-',
        emitenteCnpjSped: spedDoc.emitenteCnpj || '',
        emitenteNomeDominio: '-',
        emitenteCnpjDominio: '',
        observacao: 'Documento localizado apenas no SPED.'
      });
    }
  });

  dominioIndexed.forEach((dominioDoc) => {
    if (!usedDominio.has(dominioDoc.__compareIndex)) {
      onlyDominioCount += 1;
      rows.push({
        status: 'Somente no Dominio',
        chave: dominioDoc?.chaveAcesso || '-',
        tipoSped: '-',
        tipoDominio: dominioDoc?.tipoDocumento || describeCompareSpedModel(dominioDoc?.modelo) || '-',
        numeroSped: '-',
        numeroDominio: dominioDoc?.numeroNfe || '-',
        serieSped: '-',
        serieDominio: dominioDoc?.serie || '-',
        dataSped: '-',
        dataDominio: formatDate(dominioDoc?.dataEmissao || ''),
        valorSped: null,
        valorDominio: dominioDoc?.valor ?? null,
        diferencaValor: null,
        emitenteNomeSped: '-',
        emitenteCnpjSped: '',
        emitenteNomeDominio: dominioDoc?.emitenteNome || '-',
        emitenteCnpjDominio: dominioDoc?.emitenteCnpj || '',
        observacao: 'Documento localizado apenas na Dominio.'
      });
    }
  });

  return {
    rows,
    matchedCount,
    onlySpedCount,
    onlyDominioCount,
    divergentCount
  };
}

function compareSpedAndDominioDocs(spedDoc, dominioDoc) {
  const diffs = [];

  const numeroSped = normalizeCompareDocumentNumberKey(spedDoc.numero || '');
  const numeroDominio = normalizeCompareDocumentNumberKey(dominioDoc.numeroNfe || dominioDoc.numero || '');
  if (numeroSped !== numeroDominio) {
    diffs.push(`Numero ${spedDoc.numero || '-'} x ${dominioDoc.numeroNfe || '-'}`);
  }

  const serieSped = normalizeCompareSeriesKey(spedDoc.serie || '');
  const serieDominio = normalizeCompareSeriesKey(dominioDoc.serie || '');
  if (serieSped !== serieDominio) {
    diffs.push(`Serie ${spedDoc.serie || '-'} x ${dominioDoc.serie || '-'}`);
  }

  const valorSped = toNumber(spedDoc.valor);
  const valorDominio = toNumber(dominioDoc.valor);
  if (Math.abs(valorSped - valorDominio) > 0.01) {
    diffs.push(`Valor ${formatCurrency(valorSped)} x ${formatCurrency(valorDominio)}`);
  }

  const dataSped = normalizeCompareDateKey(spedDoc.dataEmissao || '');
  const dataDominio = normalizeCompareDateKey(dominioDoc.dataEmissao || '');
  if (dataSped && dataDominio && dataSped !== dataDominio) {
    diffs.push(`Data ${formatDate(dataSped)} x ${formatDate(dataDominio)}`);
  }

  return diffs;
}

function buildCompareIndex(documents) {
  const index = new Map();
  (Array.isArray(documents) ? documents : []).forEach((doc, idx) => {
    const enriched = doc.__compareIndex == null ? { ...doc, __compareIndex: idx } : doc;
    buildCompareCandidateKeys(enriched).forEach((key) => {
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key).push(enriched);
    });
  });
  return index;
}

function buildCompareCandidateKeys(doc) {
  const keys = [];
  const chave = normalizeDigits(doc?.chaveAcesso || '');
  if (chave.length >= 40) {
    keys.push(`CHAVE:${chave}`);
  }

  const modelo = normalizeCompareModelKey(doc?.modelo || '');
  const serie = normalizeCompareSeriesKey(doc?.serie || '');
  const numero = normalizeCompareDocumentNumberKey(doc?.numero || doc?.numeroNfe || '');
  const exactDate = normalizeCompareDateKey(doc?.dataEmissao || '');
  const monthDate = formatCompareMonth(doc?.dataEmissao || '');
  const value = Number.isFinite(Number(doc?.valor)) ? Number(toNumber(doc.valor)).toFixed(2) : '0.00';
  const partyCnpj = normalizeDigits(doc?.emitenteCnpj || doc?.contraparteCnpj || doc?.cnpj || '');

  if (serie || numero) {
    if (partyCnpj && exactDate) {
      keys.push(`DOC-PARTY-DATE:${modelo}|${partyCnpj}|${serie}|${numero}|${exactDate}`);
    }
    if (partyCnpj && monthDate) {
      keys.push(`DOC-PARTY-MONTH:${modelo}|${partyCnpj}|${serie}|${numero}|${monthDate}`);
    }
    if (partyCnpj) {
      keys.push(`DOC-PARTY-VALUE:${modelo}|${partyCnpj}|${serie}|${numero}|${value}`);
    }
    if (exactDate) {
      keys.push(`DOC-DATE:${modelo}|${serie}|${numero}|${exactDate}`);
    }
    if (monthDate) {
      keys.push(`DOC-MONTH:${modelo}|${serie}|${numero}|${monthDate}`);
    }
    keys.push(`FALLBACK:${modelo}|${serie}|${numero}|${exactDate || monthDate || '-'}|${value}`);
  }

  return [...new Set(keys)];
}

function buildCompareFingerprint(doc) {
  return buildCompareCandidateKeys(doc)[0] || '';
}

function normalizeCompareDocumentNumberKey(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '-';
  }

  const digits = normalizeDigits(raw);
  if (digits) {
    return String(Number(digits));
  }

  return raw.toUpperCase();
}

function normalizeCompareSeriesKey(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '-';
  }

  const digits = normalizeDigits(raw);
  if (digits) {
    return String(Number(digits));
  }

  return raw.toUpperCase();
}

function normalizeCompareModelKey(value) {
  const raw = String(value || '').trim();
  return raw || '-';
}

function parseCompareSpedDate(value) {
  const raw = String(value || '').trim();
  if (!/^\d{8}$/.test(raw)) {
    return '';
  }

  const day = raw.slice(0, 2);
  const month = raw.slice(2, 4);
  const year = raw.slice(4, 8);
  return `${year}-${month}-${day}`;
}

function normalizeCompareDateKey(value) {
  return extractCalendarDateKey(value);
}

function resolveCompareSpedDateRange(documents, competence) {
  const normalizedCompetence = String(competence || '').trim();
  if (/^\d{4}-\d{2}$/.test(normalizedCompetence)) {
    const [year, month] = normalizedCompetence.split('-');
    const start = `${year}-${month}-01`;
    const endDate = new Date(Number(year), Number(month), 0);
    const end = endDate.toISOString().slice(0, 10);
    return { dataInicio: start, dataFim: end };
  }

  const dates = (Array.isArray(documents) ? documents : [])
    .map((doc) => normalizeCompareDateKey(doc.dataEmissao))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (!dates.length) {
    return null;
  }

  return {
    dataInicio: dates[0],
    dataFim: dates[dates.length - 1]
  };
}

function getCompareSpedCompetence(documents) {
  const months = new Set(
    (Array.isArray(documents) ? documents : [])
      .map((doc) => formatCompareMonth(doc.dataEmissao))
      .filter(Boolean)
  );

  return months.size === 1 ? [...months][0] : '';
}

function formatCompareMonth(value) {
  const dateKey = extractCalendarDateKey(value);
  return dateKey ? dateKey.slice(0, 7) : '';
}

function buildCompareSpedArtifact(report, outputFormat) {
  const fileName = `comparacao-sped-${toSafeFileName(report.companyName)}-${report.competence || 'geral'}-${compactDate(report.generatedAt)}.${outputFormat === 'PDF' ? 'pdf' : 'xls'}`;
  if (outputFormat === 'PDF') {
    const blob = buildComparePdfBlob(report);
    const blobUrl = URL.createObjectURL(blob);
    return {
      fileName,
      contentType: 'application/pdf',
      blob,
      blobUrl
    };
  }

  const blob = buildCompareExcelBlob(report);
  const blobUrl = URL.createObjectURL(blob);
  return {
    fileName,
    contentType: 'application/vnd.ms-excel',
    blob,
    blobUrl
  };
}

function buildCompareExcelBlob(report) {
  const xml = buildCompareSpreadsheetXml(report);
  return new Blob([`\ufeff${xml}`], { type: 'application/vnd.ms-excel;charset=utf-8' });
}

function buildCompareSpreadsheetXml(report) {
  const sheetNames = ['Resumo', 'Faltantes no SPED', 'Faltantes na Dominio'];
  const worksheets = [
    buildCompareSummaryWorksheet(report),
    buildCompareDocumentWorksheet(report, 'Faltantes no SPED', 'dominio'),
    buildCompareDocumentWorksheet(report, 'Faltantes na Dominio', 'sped')
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
    <Author>NotaSync</Author>
    <LastAuthor>NotaSync</LastAuthor>
    <Created>${escapeHtml(new Date().toISOString())}</Created>
    <Company>NotaSync</Company>
  </DocumentProperties>
  <ExcelWorkbook xmlns="urn:schemas-microsoft-com:office:excel">
    <ProtectStructure>False</ProtectStructure>
    <ProtectWindows>False</ProtectWindows>
  </ExcelWorkbook>
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center" />
      <Font ss:FontName="Calibri" ss:Size="10" />
    </Style>
    <Style ss:ID="SheetTitle">
      <Font ss:Bold="1" ss:Size="14" ss:Color="#0E3E70" />
      <Interior ss:Color="#B8CBE8" ss:Pattern="Solid" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9CF" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9CF" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9CF" />
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#8EA9CF" />
      </Borders>
    </Style>
    <Style ss:ID="MetaLabel">
      <Font ss:Bold="1" ss:Color="#1F9D55" />
    </Style>
    <Style ss:ID="MetaValue">
      <Font ss:Color="#111827" />
    </Style>
    <Style ss:ID="MetaLabelAlt" ss:Parent="MetaLabel">
      <Interior ss:Color="#E7EFF9" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="MetaValueAlt" ss:Parent="MetaValue">
      <Interior ss:Color="#E7EFF9" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="Header">
      <Font ss:Bold="1" ss:Color="#FFFFFF" />
      <Interior ss:Color="#1F4E78" ss:Pattern="Solid" />
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F4E78" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F4E78" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F4E78" />
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1F4E78" />
      </Borders>
    </Style>
    <Style ss:ID="Cell">
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DCE2" />
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DCE2" />
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DCE2" />
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8DCE2" />
      </Borders>
    </Style>
    <Style ss:ID="CellAlt" ss:Parent="Cell">
      <Interior ss:Color="#E7EFF9" ss:Pattern="Solid" />
    </Style>
    <Style ss:ID="CellDate" ss:Parent="Cell">
      <NumberFormat ss:Format="dd/mm/yyyy" />
    </Style>
    <Style ss:ID="CellDateAlt" ss:Parent="CellAlt">
      <NumberFormat ss:Format="dd/mm/yyyy" />
    </Style>
    <Style ss:ID="CellMoney" ss:Parent="Cell">
      <NumberFormat ss:Format="R$ #,##0.00" />
    </Style>
    <Style ss:ID="CellMoneyAlt" ss:Parent="CellAlt">
      <NumberFormat ss:Format="R$ #,##0.00" />
    </Style>
  </Styles>
  ${sheetNames
    .map((sheetName, index) => `<Worksheet ss:Name="${escapeHtml(sheetName)}">${worksheets[index]}</Worksheet>`)
    .join('')}
</Workbook>`;
}

function buildCompareSummaryWorksheet(report) {
  const totals = getCompareReportTotals(report);
  const summaryRows = [
    ['Empresa', report.companyName],
    ['CNPJ', formatCnpj(report.clientCnpj || '')],
    ['Arquivo SPED', report.sourceFileName],
    ['Competencia', report.competence || 'Nao informada'],
    ['SPED documentos', report.summary.spedDocs],
    ['SPED valor total', formatCurrency(totals.totalSpedValue)],
    ['Dominio documentos', report.summary.dominioDocs],
    ['Dominio valor total', formatCurrency(totals.totalDominioValue)],
    ['Encontrados nas duas bases', report.summary.matchedDocs],
    ['Somente no SPED', report.summary.onlySpedDocs],
    ['Somente no SPED valor', formatCurrency(totals.onlySpedValue)],
    ['Somente na Dominio', report.summary.onlyDominioDocs],
    ['Somente na Dominio valor', formatCurrency(totals.onlyDominioValue)],
    ['Divergentes', report.summary.divergentDocs],
    ['Avisos', report.summary.warningsCount]
  ];

  const warningRows = report.warnings.length
    ? report.warnings.map((warning) => [warning])
    : [['Nenhum aviso encontrado.']];
  const summaryBodyRows = summaryRows
    .map((row, index) => {
      const labelStyle = index % 2 === 0 ? 'MetaLabel' : 'MetaLabelAlt';
      const valueStyle = index % 2 === 0 ? 'MetaValue' : 'MetaValueAlt';
      const value = row[1];
      const isNumeric = typeof value === 'number' && Number.isFinite(value);

      return `
      <Row>
        <Cell ss:StyleID="${labelStyle}"><Data ss:Type="String">${escapeHtml(String(row[0] || ''))}</Data></Cell>
        <Cell ss:StyleID="${valueStyle}"><Data ss:Type="${isNumeric ? 'Number' : 'String'}">${escapeHtml(String(value ?? ''))}</Data></Cell>
      </Row>`;
    })
    .join('');

  return `
    <Table>
      <Column ss:Width="220" />
      <Column ss:Width="420" />
      <Row ss:Height="22">
        <Cell ss:MergeAcross="1" ss:StyleID="SheetTitle"><Data ss:Type="String">Comparacao SPED x Dominio</Data></Cell>
      </Row>
      ${summaryBodyRows}
      <Row />
      <Row ss:Height="22">
        <Cell ss:MergeAcross="0" ss:StyleID="SheetTitle"><Data ss:Type="String">Avisos</Data></Cell>
      </Row>
      <Row>
        <Cell ss:StyleID="Header"><Data ss:Type="String">Mensagem</Data></Cell>
      </Row>
      ${warningRows.map((row, index) => `<Row><Cell ss:StyleID="${index % 2 === 0 ? 'Cell' : 'CellAlt'}"><Data ss:Type="String">${escapeHtml(String(row[0] || ''))}</Data></Cell></Row>`).join('')}
    </Table>
  `;
}

function buildCompareDocumentWorksheet(report, title, source) {
  const rows = source === 'dominio'
    ? report.rows.filter((row) => row.status === 'Somente no Dominio')
    : report.rows.filter((row) => row.status === 'Somente no SPED');
  const headers = ['Tipo', 'Serie', 'Numero', 'Data', 'Cnpj_Cpf_Emit', 'Rz_Social_Emit', 'Valor', 'Chave'];
  const sheetRows = rows.map((row) => {
    const isDominio = source === 'dominio';
    const tipo = isDominio ? row.tipoDominio || '-' : row.tipoSped || '-';
    const serie = isDominio ? row.serieDominio || '-' : row.serieSped || '-';
    const numero = isDominio ? row.numeroDominio || '-' : row.numeroSped || '-';
    const data = isDominio ? row.dataDominio || '-' : row.dataSped || '-';
    const cnpj = isDominio ? row.emitenteCnpjDominio || '' : row.emitenteCnpjSped || '';
    const nome = isDominio ? row.emitenteNomeDominio || '-' : row.emitenteNomeSped || '-';
    const valor = isDominio ? pickCompareRowValue(row.valorDominio, row.valorSped) : pickCompareRowValue(row.valorSped, row.valorDominio);

    return [tipo, serie, numero, data, cnpj, nome, valor, row.chave || '-'];
  });
  const totalValue = sheetRows.reduce((sum, row) => sum + (Number.isFinite(Number(row[6])) ? Number(row[6]) : 0), 0);

  return `
    <Table>
      <Column ss:Width="90" />
      <Column ss:Width="70" />
      <Column ss:Width="90" />
      <Column ss:Width="95" />
      <Column ss:Width="150" />
      <Column ss:Width="280" />
      <Column ss:Width="95" />
      <Column ss:Width="250" />
      <Row ss:Height="22">
        <Cell ss:MergeAcross="7" ss:StyleID="SheetTitle"><Data ss:Type="String">${escapeHtml(title)}</Data></Cell>
      </Row>
      <Row>
        <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Qtd. notas</Data></Cell>
        <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${rows.length}</Data></Cell>
        <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Valor total</Data></Cell>
        <Cell ss:StyleID="CellMoney"><Data ss:Type="Number">${totalValue}</Data></Cell>
      </Row>
      <Row>
        ${headers.map((header) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${escapeHtml(header)}</Data></Cell>`).join('')}
      </Row>
      ${
        sheetRows.length
          ? sheetRows
              .map(
                (row, index) => {
                  const baseStyle = index % 2 === 0 ? 'Cell' : 'CellAlt';
                  const dateStyle = index % 2 === 0 ? 'CellDate' : 'CellDateAlt';
                  const moneyStyle = index % 2 === 0 ? 'CellMoney' : 'CellMoneyAlt';
                  return `
                  <Row>
                    <Cell ss:StyleID="${baseStyle}"><Data ss:Type="String">${escapeHtml(String(row[0] || '-'))}</Data></Cell>
                    <Cell ss:StyleID="${baseStyle}"><Data ss:Type="String">${escapeHtml(String(row[1] || '-'))}</Data></Cell>
                    <Cell ss:StyleID="${baseStyle}"><Data ss:Type="String">${escapeHtml(String(row[2] || '-'))}</Data></Cell>
                    ${
                      toSpreadsheetDateTime(row[3])
                        ? `<Cell ss:StyleID="${dateStyle}"><Data ss:Type="DateTime">${escapeHtml(toSpreadsheetDateTime(row[3]))}</Data></Cell>`
                        : `<Cell ss:StyleID="${baseStyle}"><Data ss:Type="String">${escapeHtml(String(row[3] || '-'))}</Data></Cell>`
                    }
                    <Cell ss:StyleID="${baseStyle}"><Data ss:Type="String">${escapeHtml(formatCnpj(row[4] || ''))}</Data></Cell>
                    <Cell ss:StyleID="${baseStyle}"><Data ss:Type="String">${escapeHtml(String(row[5] || '-'))}</Data></Cell>
                    <Cell ss:StyleID="${moneyStyle}"><Data ss:Type="Number">${Number.isFinite(Number(row[6])) ? Number(row[6]) : 0}</Data></Cell>
                    <Cell ss:StyleID="${baseStyle}"><Data ss:Type="String">${escapeHtml(String(row[7] || '-'))}</Data></Cell>
                  </Row>
                `;
                }
              )
              .join('')
          : `<Row><Cell ss:StyleID="Cell" ss:MergeAcross="7"><Data ss:Type="String">Nenhum documento localizado.</Data></Cell></Row>`
      }
    </Table>
  `;
}

function describeCompareSpedModel(modelo) {
  const code = String(modelo || '').trim();
  if (!code) {
    return '-';
  }
  if (code === '55') {
    return 'NF-e';
  }
  if (code === '57') {
    return 'CT-e';
  }
  if (code === '65') {
    return 'NFC-e';
  }
  return `Modelo ${code}`;
}

function getCompareReportTotals(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows.reduce(
    (acc, row) => {
      acc.totalSpedValue += Number.isFinite(Number(row?.valorSped)) ? Number(row.valorSped) : 0;
      acc.totalDominioValue += Number.isFinite(Number(row?.valorDominio)) ? Number(row.valorDominio) : 0;

      if (row?.status === 'Somente no SPED') {
        acc.onlySpedValue += Number.isFinite(Number(row?.valorSped)) ? Number(row.valorSped) : 0;
      }

      if (row?.status === 'Somente no Dominio') {
        acc.onlyDominioValue += Number.isFinite(Number(row?.valorDominio)) ? Number(row.valorDominio) : 0;
      }

      return acc;
    },
    {
      totalSpedValue: 0,
      totalDominioValue: 0,
      onlySpedValue: 0,
      onlyDominioValue: 0
    }
  );
}

function toSpreadsheetDateTime(value) {
  const text = String(value || '').trim();
  if (!text || text === '-') {
    return '';
  }

  const slashMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month}-${day}T00:00:00.000`;
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${month}-${day}T00:00:00.000`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    const year = String(parsed.getFullYear());
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T00:00:00.000`;
  }

  return '';
}

function toCompareApiDateRangeBoundary(value, endOfDay) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}${endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z'}`;
  }

  return text;
}

function pickCompareRowValue(primaryValue, fallbackValue) {
  if (primaryValue != null && primaryValue !== '' && Number.isFinite(Number(primaryValue))) {
    return Number(primaryValue);
  }

  if (fallbackValue != null && fallbackValue !== '' && Number.isFinite(Number(fallbackValue))) {
    return Number(fallbackValue);
  }

  return 0;
}

function buildComparePdfBlob(report) {
  const pdfBytes = buildComparePdfDocument(report);
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

function stripPdfText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

function escapePdfText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function buildComparePdfDocument(report) {
  const pageWidth = 595;
  const pageHeight = 842;
  const totals = getCompareReportTotals(report);
  const onlySpedRows = (Array.isArray(report.rows) ? report.rows : []).filter((row) => row.status === 'Somente no SPED');
  const onlyDominioRows = (Array.isArray(report.rows) ? report.rows : []).filter((row) => row.status === 'Somente no Dominio');
  const divergentRows = (Array.isArray(report.rows) ? report.rows : []).filter((row) => row.status === 'Divergente');
  const sections = [
    {
      title: 'Faltantes no SPED',
      description: 'Documentos presentes na Dominio e ausentes no arquivo enviado.',
      tone: 'warning',
      rows: onlyDominioRows,
      source: 'dominio',
      total: totals.onlyDominioValue,
      count: report.summary.onlyDominioDocs
    },
    {
      title: 'Faltantes na Dominio',
      description: 'Documentos presentes no SPED e ainda nao localizados na base.',
      tone: 'info',
      rows: onlySpedRows,
      source: 'sped',
      total: totals.onlySpedValue,
      count: report.summary.onlySpedDocs
    },
    {
      title: 'Divergencias',
      description: 'Documentos encontrados nas duas bases, mas com diferencas de dados.',
      tone: 'danger',
      rows: divergentRows,
      source: 'compare',
      total: null,
      count: report.summary.divergentDocs
    }
  ];

  const pageModels = [
    {
      kind: 'overview',
      report,
      totals,
      sections
    }
  ];

  sections.forEach((section) => {
    pageModels.push(
      ...buildComparePdfSectionPageModels({
        report,
        section,
        pageWidth,
        pageHeight
      })
    );
  });

  const pages = pageModels.map((pageModel, index) =>
    buildComparePdfPageContent({
      ...pageModel,
      pageWidth,
      pageHeight,
      pageNumber: index + 1,
      totalPages: pageModels.length
    })
  );

  return buildComparePdfBinary(pages, pageWidth, pageHeight);
}

function buildComparePdfSectionPageModels({ report, section, pageWidth, pageHeight }) {
  const preparedRows = (Array.isArray(section.rows) ? section.rows : []).map((row) => buildComparePdfSectionRow(section, row));
  const rowsByPage = chunkComparePdfSectionRows(preparedRows, pageHeight);
  return rowsByPage.map((rows) => ({
    kind: 'section',
    report,
    section,
    rows,
    pageWidth,
    pageHeight
  }));
}

function chunkComparePdfSectionRows(rows, pageHeight) {
  const headerTop = 22;
  const headerHeight = 56;
  const tableTop = headerTop + headerHeight + 14;
  const tableHeaderHeight = 24;
  const bottomLimit = pageHeight - 34;
  const rowGap = 4;
  const chunks = [];
  let current = [];
  let cursorTop = tableTop + tableHeaderHeight;

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (current.length && cursorTop + row.height > bottomLimit) {
      chunks.push(current);
      current = [];
      cursorTop = tableTop + tableHeaderHeight;
    }

    current.push(row);
    cursorTop += row.height + rowGap;
  });

  if (current.length || !chunks.length) {
    chunks.push(current);
  }

  return chunks;
}

function buildComparePdfPageContent(pageModel) {
  if (pageModel.kind === 'section') {
    return buildComparePdfSectionPageContent(pageModel);
  }

  return buildComparePdfOverviewPageContent(pageModel);
}

function buildComparePdfOverviewPageContent({ report, totals, sections, pageWidth, pageHeight, pageNumber, totalPages }) {
  const marginX = 28;
  const content = [];
  const topBannerHeight = 116;
  const cardGap = 10;
  const cardWidth = Math.floor((pageWidth - marginX * 2 - cardGap) / 2);
  const cardHeight = 58;
  const cardXs = [marginX, marginX + cardWidth + cardGap];

  drawPdfRect(content, 0, 0, pageWidth, pageHeight, { fill: '#F7F9FC', pageHeight });
  drawPdfRect(content, 0, 0, pageWidth, topBannerHeight, { fill: '#173B6C', pageHeight });
  drawPdfRect(content, 0, topBannerHeight - 8, pageWidth, 8, { fill: '#F2C94C', pageHeight });

  drawPdfText(content, 'Comparacao SPED x Dominio', marginX, 34, {
    pageHeight,
    size: 19,
    bold: true,
    color: '#FFFFFF'
  });
  drawPdfText(content, stripPdfText(report.companyName || 'Empresa selecionada'), marginX, 58, {
    pageHeight,
    size: 11.5,
    color: '#EAF1FF'
  });
  drawPdfText(content, `CNPJ ${stripPdfText(formatCnpj(report.clientCnpj || ''))}`, marginX, 74, {
    pageHeight,
    size: 9.2,
    color: '#EAF1FF'
  });
  drawPdfText(content, `Arquivo ${stripPdfText(report.sourceFileName || '-')}`, marginX, 90, {
    pageHeight,
    size: 9,
    color: '#D7E4F8'
  });
  drawPdfText(content, `Competencia ${stripPdfText(report.competence || 'Nao informada')}`, marginX, 104, {
    pageHeight,
    size: 9,
    color: '#D7E4F8'
  });

  drawPdfRect(content, pageWidth - 182, 18, 154, 78, { fill: '#214F8A', pageHeight });
  drawPdfText(content, 'Gerado em', pageWidth - 166, 36, {
    pageHeight,
    size: 8.5,
    color: '#DDE8F9'
  });
  drawPdfText(content, stripPdfText(formatDateTime(report.generatedAt || '')), pageWidth - 166, 52, {
    pageHeight,
    size: 11,
    bold: true,
    color: '#FFFFFF'
  });
  drawPdfText(content, `${sections.length} secoes`, pageWidth - 166, 72, {
    pageHeight,
    size: 8.5,
    color: '#DDE8F9'
  });

  const summaryCards = [
    { label: 'SPED lidos', value: String(report.summary.spedDocs || 0), accent: '#1F4E78', note: `Total ${formatCurrency(totals.totalSpedValue)}` },
    { label: 'Dominio lidos', value: String(report.summary.dominioDocs || 0), accent: '#0F9D58', note: `Total ${formatCurrency(totals.totalDominioValue)}` },
    { label: 'Somente no SPED', value: String(report.summary.onlySpedDocs || 0), accent: '#D97706', note: `Valor ${formatCurrency(totals.onlySpedValue)}` },
    { label: 'Somente na Dominio', value: String(report.summary.onlyDominioDocs || 0), accent: '#2563EB', note: `Valor ${formatCurrency(totals.onlyDominioValue)}` }
  ];

  summaryCards.forEach((card, index) => {
    const x = cardXs[index % 2];
    const y = 136 + Math.floor(index / 2) * (cardHeight + cardGap);
    drawPdfRect(content, x, y, cardWidth, cardHeight, {
      fill: '#FFFFFF',
      stroke: '#D5DCE8',
      lineWidth: 1,
      pageHeight
    });
    drawPdfRect(content, x, y, 8, cardHeight, { fill: card.accent, pageHeight });
    drawPdfText(content, card.label, x + 16, y + 18, {
      pageHeight,
      size: 9,
      bold: true,
      color: '#3A4A61'
    });
    drawPdfText(content, card.value, x + 16, y + 38, {
      pageHeight,
      size: 17,
      bold: true,
      color: '#0F172A'
    });
    drawPdfText(content, card.note, x + 92, y + 40, {
      pageHeight,
      size: 8.5,
      color: '#64748B'
    });
  });

  drawPdfRect(content, marginX, 260, pageWidth - marginX * 2, 88, {
    fill: '#FFFFFF',
    stroke: '#D5DCE8',
    lineWidth: 1,
    pageHeight
  });
  drawPdfText(content, 'Resumo da comparacao', marginX + 16, 280, {
    pageHeight,
    size: 11,
    bold: true,
    color: '#1F2937'
  });
  drawPdfText(content, `Encontrados nas duas bases ${String(report.summary.matchedDocs || 0)}`, marginX + 16, 300, {
    pageHeight,
    size: 9.5,
    color: '#334155'
  });
  drawPdfText(content, `Divergencias ${String(report.summary.divergentDocs || 0)}`, marginX + 16, 316, {
    pageHeight,
    size: 9.5,
    color: '#334155'
  });
  drawPdfText(content, `Avisos ${String(report.summary.warningsCount || 0)}`, marginX + 16, 332, {
    pageHeight,
    size: 9.5,
    color: '#334155'
  });
  drawPdfText(content, `Entrada SPED ${stripPdfText(report.sourceFileName || '-')}`, marginX + 220, 300, {
    pageHeight,
    size: 9.5,
    color: '#334155'
  });
  drawPdfText(content, `Gerado no formato ${stripPdfText(report.outputFormat || 'Excel')}`, marginX + 220, 316, {
    pageHeight,
    size: 9.5,
    color: '#334155'
  });
  drawPdfText(content, `Ultima atualizacao ${stripPdfText(formatDateTime(report.generatedAt || ''))}`, marginX + 220, 332, {
    pageHeight,
    size: 9.5,
    color: '#334155'
  });

  if (Array.isArray(report.warnings) && report.warnings.length) {
    drawPdfRect(content, marginX, 382, pageWidth - marginX * 2, 132, {
      fill: '#FFF8E7',
      stroke: '#F2C94C',
      lineWidth: 1,
      pageHeight
    });
    drawPdfText(content, 'Avisos da leitura', marginX + 16, 400, {
      pageHeight,
      size: 11,
      bold: true,
      color: '#7A5C00'
    });
    const warningLines = [];
    report.warnings.slice(0, 6).forEach((warning) => {
      warningLines.push(...wrapPdfTextToWidth(stripPdfText(warning), pageWidth - marginX * 2 - 32, 9));
    });
    warningLines.slice(0, 8).forEach((line, index) => {
      drawPdfText(content, `- ${line}`, marginX + 18, 420 + index * 15, {
        pageHeight,
        size: 8.8,
        color: '#6B4E00'
      });
    });
  } else {
    drawPdfRect(content, marginX, 382, pageWidth - marginX * 2, 72, {
      fill: '#FFFFFF',
      stroke: '#D5DCE8',
      lineWidth: 1,
      pageHeight
    });
    drawPdfText(content, 'Nenhum aviso encontrado.', marginX + 16, 412, {
      pageHeight,
      size: 10,
      color: '#64748B'
    });
  }

  drawPdfFooter(content, pageWidth, pageHeight, pageNumber, totalPages);
  return content.join('\n');
}

function buildComparePdfSectionPageContent({ section, rows, pageWidth, pageHeight, pageNumber, totalPages }) {
  const marginX = 24;
  const headerTop = 22;
  const headerHeight = 56;
  const tableTop = headerTop + headerHeight + 14;
  const content = [];
  const columns = [
    { key: 'numero', label: 'Numero', width: 54, align: 'left' },
    { key: 'data', label: 'Data', width: 72, align: 'left' },
    { key: 'valor', label: 'Valor', width: 72, align: 'right' },
    { key: 'fornecedor', label: 'Fornecedor / cliente', width: 144, align: 'left' },
    { key: 'chave', label: 'Chave', width: 122, align: 'left' },
    { key: 'obs', label: 'Observacao', width: 67, align: 'left' }
  ];
  const tableWidth = columns.reduce((acc, column) => acc + column.width, 0);
  const countLabel = `${rows.length} itens`;
  const totalLabel = section.total != null ? `Valor ${formatCurrency(section.total)}` : `${String(section.count || 0)} divergencias`;

  drawPdfRect(content, 0, 0, pageWidth, pageHeight, { fill: '#F7F9FC', pageHeight });
  drawPdfRect(content, marginX, headerTop, pageWidth - marginX * 2, headerHeight, {
    fill: '#FFFFFF',
    stroke: '#D5DCE8',
    lineWidth: 1,
    pageHeight
  });
  drawPdfRect(content, marginX, headerTop, 6, headerHeight, {
    fill: sectionToneColor(section.tone),
    pageHeight
  });
  drawPdfText(content, section.title, marginX + 16, headerTop + 16, {
    pageHeight,
    size: 14,
    bold: true,
    color: '#0F172A'
  });
  drawPdfText(content, section.description, marginX + 16, headerTop + 35, {
    pageHeight,
    size: 8.8,
    color: '#64748B'
  });
  drawPdfRect(content, pageWidth - marginX - 92, headerTop + 14, 78, 24, {
    fill: sectionToneSoftColor(section.tone),
    stroke: sectionToneColor(section.tone),
    lineWidth: 1,
    pageHeight
  });
  drawPdfText(content, countLabel, pageWidth - marginX - 84, headerTop + 30, {
    pageHeight,
    size: 8.7,
    bold: true,
    color: sectionToneColor(section.tone)
  });
  drawPdfText(content, totalLabel, pageWidth - marginX - 182, headerTop + 30, {
    pageHeight,
    size: 8.5,
    bold: true,
    color: '#334155'
  });

  let x = marginX;
  columns.forEach((column) => {
    drawPdfRect(content, x, tableTop, column.width, 24, {
      fill: '#173B6C',
      stroke: '#173B6C',
      lineWidth: 1,
      pageHeight
    });
    drawPdfText(content, column.label, x + 6, tableTop + 16, {
      pageHeight,
      size: 8,
      bold: true,
      color: '#FFFFFF'
    });
    x += column.width;
  });

  let currentY = tableTop + 26;
  if (!rows.length) {
    drawPdfRect(content, marginX, currentY, tableWidth, 42, {
      fill: '#FFFFFF',
      stroke: '#D5DCE8',
      lineWidth: 1,
      pageHeight
    });
    drawPdfText(content, 'Nenhum documento encontrado nesta secao.', marginX + 16, currentY + 24, {
      pageHeight,
      size: 9.5,
      color: '#64748B'
    });
  } else {
    rows.forEach((row, rowIndex) => {
      const fill = rowIndex % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      drawPdfRect(content, marginX, currentY, tableWidth, row.height, {
        fill,
        stroke: '#D5DCE8',
        lineWidth: 1,
        pageHeight
      });

      let cellX = marginX;
      columns.forEach((column) => {
        const cellValue = row[column.key] || '-';
        drawPdfTextBlock(content, cellValue, cellX + 6, currentY + 8, {
          pageHeight,
          width: column.width - 16,
          size: column.key === 'valor' ? 8 : 7.6,
          bold: column.key === 'valor',
          color: '#0F172A',
          align: column.align
        });
        drawPdfRect(content, cellX, currentY, column.width, row.height, {
          stroke: '#D5DCE8',
          lineWidth: 0.7,
          pageHeight
        });
        cellX += column.width;
      });

      currentY += row.height;
    });
  }

  drawPdfFooter(content, pageWidth, pageHeight, pageNumber, totalPages);
  return content.join('\n');
}

function buildComparePdfSectionRow(section, row) {
  const useDominio = section.source === 'dominio';
  const useSped = section.source === 'sped';
  const useCompare = section.source === 'compare';
  const numero = useCompare ? `${row.numeroSped || '-'} / ${row.numeroDominio || '-'}` : useDominio ? row.numeroDominio || '-' : row.numeroSped || '-';
  const data = useCompare ? `${row.dataSped || '-'} / ${row.dataDominio || '-'}` : useDominio ? row.dataDominio || '-' : row.dataSped || '-';
  const valor = useCompare
    ? `${formatOptionalCurrency(row.valorSped)} / ${formatOptionalCurrency(row.valorDominio)}`
    : formatCurrency(pickCompareRowValue(useDominio ? row.valorDominio : row.valorSped, useDominio ? row.valorSped : row.valorDominio));
  const fornecedor = useCompare
    ? `${row.emitenteNomeSped || '-'} / ${row.emitenteNomeDominio || '-'}`
    : useDominio
      ? row.emitenteNomeDominio || '-'
      : row.emitenteNomeSped || '-';
  const chave = stripPdfText(row.chave || '-');
  const observacao = useCompare ? stripPdfText(row.observacao || '-') : stripPdfText(row.observacao || (useSped ? 'Documento localizado apenas no SPED.' : 'Documento localizado apenas na Dominio.'));
  const rowHeight = Math.max(
    30,
    computePdfTextLines(numero, 54, 7.6) * 11,
    computePdfTextLines(data, 72, 7.6) * 11,
    computePdfTextLines(valor, 72, 8) * 11,
    computePdfTextLines(fornecedor, 144, 7.6) * 11,
    computePdfTextLines(chave, 122, 7.6) * 11,
    computePdfTextLines(observacao, 67, 7.4) * 11
  ) + 14;

  return {
    numero,
    data,
    valor,
    fornecedor,
    chave,
    obs: observacao,
    height: rowHeight
  };
}

function buildComparePdfBinary(pages, pageWidth, pageHeight) {
  const normalizedPages = Array.isArray(pages) && pages.length ? pages : ['Sem dados para exibir.'];
  const objects = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [${normalizedPages.map((_, index) => `${6 + index * 2} 0 R`).join(' ')}] /Count ${normalizedPages.length} >>\nendobj\n`,
    `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`
  ];

  normalizedPages.forEach((pageContent, index) => {
    const contentObjectNumber = 5 + index * 2;
    const pageObjectNumber = 6 + index * 2;
    objects.push(
      `${contentObjectNumber} 0 obj\n<< /Length ${pageContent.length} >>\nstream\n${pageContent}\nendstream\nendobj\n`,
      `${pageObjectNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>\nendobj\n`
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  objects.forEach((objectString) => {
    offsets.push(`${String(pdf.length).padStart(10, '0')} 00000 n \n`);
    pdf += objectString;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n${offsets.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function drawPdfFooter(content, pageWidth, pageHeight, pageNumber, totalPages) {
  drawPdfLine(content, 24, 34, pageWidth - 24, 34, '#D5DCE8', 0.7, pageHeight);
  drawPdfText(content, `Pagina ${pageNumber} de ${totalPages}`, 24, 18, {
    pageHeight,
    size: 8.2,
    color: '#64748B'
  });
  drawPdfText(content, 'NotaSync - Comparacao SPED x Dominio', pageWidth - 24, 18, {
    pageHeight,
    size: 8.2,
    align: 'right',
    color: '#64748B'
  });
}

function drawPdfTextBlock(content, text, x, yTop, options) {
  const lines = wrapPdfTextToWidth(text, options.width, options.size || 8.5, options.bold);
  const lineHeight = options.lineHeight || Math.max(10.2, (options.size || 8.5) * 1.35);
  lines.forEach((line, index) => {
    drawPdfText(content, line, x, yTop + index * lineHeight, options);
  });
}

function drawPdfText(content, text, x, yTop, options = {}) {
  const pageHeight = options.pageHeight || 842;
  const size = options.size || 10;
  const font = options.bold ? 'F2' : 'F1';
  const color = options.color || '#111827';
  const sanitizedText = stripPdfText(text);
  const width = measurePdfTextWidth(sanitizedText, size, Boolean(options.bold));
  const xPos = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
  const yPos = pageHeight - yTop - size;
  const [r, g, b] = hexToPdfRgb(color);
  content.push(
    `BT /${font} ${size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${formatPdfNumber(xPos)} ${formatPdfNumber(yPos)} Tm (${escapePdfText(sanitizedText)}) Tj ET`
  );
}

function measurePdfTextWidth(text, size, bold = false) {
  const sanitized = stripPdfText(text || '');
  const factor = bold ? 0.61 : 0.56;
  return sanitized.length * size * factor;
}

function drawPdfRect(content, x, yTop, width, height, options = {}) {
  const pageHeight = options.pageHeight || 842;
  const fill = options.fill ? hexToPdfRgb(options.fill) : null;
  const stroke = options.stroke ? hexToPdfRgb(options.stroke) : null;
  const lineWidth = options.lineWidth || 1;
  const y = pageHeight - yTop - height;
  const operations = ['q'];
  if (fill) {
    operations.push(`${fill[0]} ${fill[1]} ${fill[2]} rg`);
  }
  if (stroke) {
    operations.push(`${stroke[0]} ${stroke[1]} ${stroke[2]} RG ${formatPdfNumber(lineWidth)} w`);
  }
  operations.push(`${formatPdfNumber(x)} ${formatPdfNumber(y)} ${formatPdfNumber(width)} ${formatPdfNumber(height)} re`);
  if (fill && stroke) {
    operations.push('B');
  } else if (fill) {
    operations.push('f');
  } else if (stroke) {
    operations.push('S');
  } else {
    operations.push('n');
  }
  operations.push('Q');
  content.push(operations.join(' '));
}

function drawPdfLine(content, x1, y1Top, x2, y2Top, color, lineWidth = 1, pageHeight = 842) {
  const rgb = hexToPdfRgb(color);
  const y1 = pageHeight - y1Top;
  const y2 = pageHeight - y2Top;
  content.push(`q ${rgb[0]} ${rgb[1]} ${rgb[2]} RG ${formatPdfNumber(lineWidth)} w ${formatPdfNumber(x1)} ${formatPdfNumber(y1)} m ${formatPdfNumber(x2)} ${formatPdfNumber(y2)} l S Q`);
}

function computePdfTextLines(text, width, size, bold = false) {
  return wrapPdfTextToWidth(text, width, size, bold).length;
}

function wrapPdfTextToWidth(text, width, size, bold = false) {
  const sanitized = stripPdfText(text || '').replace(/\s+/g, ' ').trim();
  if (!sanitized) {
    return [''];
  }

  const averageCharWidth = size * (bold ? 0.61 : 0.56);
  const maxChars = Math.max(6, Math.floor(width / averageCharWidth));
  const words = sanitized.split(/\s+/);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      return;
    }

    if (candidate.length > maxChars) {
      const chunks = splitPdfWord(word, maxChars);
      if (current) {
        lines.push(current);
        current = '';
      }
      chunks.forEach((chunk, index) => {
        if (index === chunks.length - 1) {
          current = chunk;
        } else {
          lines.push(chunk);
        }
      });
      return;
    }

    current = candidate;
  });

  if (current) {
    lines.push(current);
  }

  return lines.length ? lines : [sanitized];
}

function splitPdfWord(word, maxChars) {
  const chunks = [];
  let current = '';
  String(word || '').split('').forEach((char) => {
    const candidate = `${current}${char}`;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = char;
      return;
    }
    current = candidate;
  });
  if (current) {
    chunks.push(current);
  }
  return chunks.length ? chunks : [String(word || '')];
}

function hexToPdfRgb(hexColor) {
  const normalized = String(hexColor || '#000000').replace('#', '');
  const value = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => `${char}${char}`)
        .join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  return [formatPdfNumber(r), formatPdfNumber(g), formatPdfNumber(b)];
}

function formatPdfNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(3).replace(/\.?0+$/, '') : '0';
}

function sectionToneColor(tone) {
  if (tone === 'danger') {
    return '#C2410C';
  }
  if (tone === 'info') {
    return '#1D4ED8';
  }
  if (tone === 'warning') {
    return '#B45309';
  }
  return '#173B6C';
}

function sectionToneSoftColor(tone) {
  if (tone === 'danger') {
    return '#FDEEE7';
  }
  if (tone === 'info') {
    return '#E8F0FF';
  }
  if (tone === 'warning') {
    return '#FFF4D6';
  }
  return '#E7EDF7';
}

function openCompareSpedReportModal() {
  if (!state.compareSped.report) {
    pushToast('Gere a comparacao antes de abrir o resumo.', 'info');
    return;
  }

  openModal({ kind: 'compare-sped-report' });
}

function renderCompareSpedReportModal() {
  const report = state.compareSped.report;
  if (!report) {
    return '';
  }

  return `
    <div class="overlay" data-action="overlay-close">
      <div class="modal compare-report-modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <h3 class="modal-title">Resumo da comparacao</h3>
          <p class="modal-subtitle">${escapeHtml(report.companyName)} - ${escapeHtml(report.competence || 'competencia nao informada')}</p>
        </div>
        <div class="modal-body">
          <div class="compare-report-grid">
            ${statCard('file', 'SPED', String(report.summary.spedDocs), 'documentos lidos', 'neutral')}
            ${statCard('file', 'Dominio', String(report.summary.dominioDocs), 'documentos comparados', 'info')}
            ${statCard('alert', 'Divergencias', String(report.summary.issuesCount), 'itens fora do esperado', 'warning')}
          </div>
          <div class="table-wrap compare-report-table">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Chave</th>
                  <th>Numero SPED</th>
                  <th>Numero Dominio</th>
                  <th>Observacao</th>
                </tr>
              </thead>
              <tbody>
                ${
                  report.rows.slice(0, 20).map((row) => `
                    <tr>
                      <td>${escapeHtml(row.status)}</td>
                      <td>${escapeHtml(row.chave)}</td>
                      <td>${escapeHtml(String(row.numeroSped || '-'))}</td>
                      <td>${escapeHtml(String(row.numeroDominio || '-'))}</td>
                      <td>${escapeHtml(row.observacao || '-')}</td>
                    </tr>
                  `).join('')
                }
              </tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn secondary" type="button" data-action="close-modal">Fechar</button>
          <button class="btn primary" type="button" data-action="compare-sped-download">Baixar ${escapeHtml(state.compareSped.outputFormat === 'PDF' ? 'PDF' : 'Excel')}</button>
        </div>
      </div>
    </div>
  `;
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
    compare:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 4v16"></path><path d="M4 8l4-4 4 4"></path><path d="M16 20V4"></path><path d="M12 16l4 4 4-4"></path></svg>',
    menu:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"></path><path d="M3 12h18"></path><path d="M3 18h18"></path></svg>',
    more:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="5" r="1.4"></circle><circle cx="12" cy="12" r="1.4"></circle><circle cx="12" cy="19" r="1.4"></circle></svg>',
    filter:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5z"></path></svg>',
    'arrow-left':
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 12H5"></path><path d="M12 19l-7-7 7-7"></path></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"></path></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 3"></path></svg>',
    info:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><circle cx="12" cy="8" r="1"></circle></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6L9 17l-5-5"></path></svg>',
    pie:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v9l7 4.5"></path><circle cx="12" cy="12" r="9"></circle></svg>',
    coin:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v9"></path><path d="M15 9.8c0-1.3-1.3-2.3-3-2.3s-3 .9-3 2.1c0 2.7 6 1.3 6 4 0 1.3-1.3 2.3-3 2.3s-3-1-3-2.3"></path></svg>'
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

