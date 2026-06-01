export const mockAlerts = [
  {
    id: 'alert-001',
    severity: 'Critico',
    tipo: 'Certificado',
    titulo: 'Certificado vencido',
    descricao: 'Nao foi possivel autenticar o certificado para consulta noturna.',
    clientId: 'ef55f1a3-8ae2-44ab-bf51-bf9b6d1f9348',
    cliente: 'Padaria Estacao do Pao LTDA',
    dataHora: '2026-06-01T02:03:00.000Z',
    status: 'Aberto',
    origem: 'validacao-certificado',
    mensagemTecnica: 'PKCS12 decrypt failed: certificate expired.',
    sugestaoAcao: 'Atualizar certificado digital e validar novamente.',
    historicoTentativas: ['02:03 Falha autenticacao', '02:06 Reprocessamento automatico falhou'],
    allowsReprocess: true
  },
  {
    id: 'alert-002',
    severity: 'Atencao',
    tipo: 'Certificado',
    titulo: 'Certificado vence em 8 dias',
    descricao: 'Planejar renovacao para evitar parada da rotina.',
    clientId: '11c50faa-1fd8-44fb-8f9e-a12a5ef2c101',
    cliente: 'Clinica Santa Beatriz SS',
    dataHora: '2026-06-01T02:04:00.000Z',
    status: 'Em analise',
    origem: 'monitor-validade',
    mensagemTecnica: 'Validade final: 2026-06-09.',
    sugestaoAcao: 'Solicitar certificado novo ao cliente ainda esta semana.',
    historicoTentativas: ['02:04 alerta gerado'],
    allowsReprocess: false
  },
  {
    id: 'alert-003',
    severity: 'Critico',
    tipo: 'Prefeitura',
    titulo: 'Falha de autenticacao na prefeitura',
    descricao: 'Requisicoes rejeitadas na API municipal integrada.',
    clientId: '6bb4a856-cf7f-4e21-8c6a-772631f8b1f3',
    cliente: 'Translog Sul Transportes EIRELI',
    dataHora: '2026-06-01T02:19:00.000Z',
    status: 'Aberto',
    origem: 'sync-adn',
    mensagemTecnica: 'HTTP 401 no endpoint de distribuicao.',
    sugestaoAcao: 'Verificar cadeia de certificado e horario do servidor.',
    historicoTentativas: ['02:19 tentativa 1', '02:21 tentativa 2', '02:24 tentativa 3'],
    allowsReprocess: true
  },
  {
    id: 'alert-004',
    severity: 'Atencao',
    tipo: 'XML',
    titulo: 'XML encontrado, mas nao armazenado',
    descricao: 'Arquivo baixado, porem sem confirmacao de escrita no servidor.',
    clientId: '77fce60a-956a-4892-8903-3f3a6a33a810',
    cliente: 'Construtora Monte Real SPE',
    dataHora: '2026-06-01T02:32:00.000Z',
    status: 'Aberto',
    origem: 'storage-writer',
    mensagemTecnica: 'I/O timeout no compartilhamento de rede.',
    sugestaoAcao: 'Testar conectividade do caminho UNC e reprocessar lote.',
    historicoTentativas: ['02:32 falha de escrita', '02:34 nova tentativa pendente'],
    allowsReprocess: true
  },
  {
    id: 'alert-005',
    severity: 'Informativo',
    tipo: 'Busca',
    titulo: 'Cliente sem certificado vinculado',
    descricao: 'Busca noturna pulou cliente por falta de certificado.',
    clientId: 'f9622db2-b654-4df1-a96a-335a4869c5f1',
    cliente: 'Ribeiro e Campos Advogados',
    dataHora: '2026-05-31T02:42:00.000Z',
    status: 'Em analise',
    origem: 'pre-check',
    mensagemTecnica: 'Nenhum registro ativo em certificados.',
    sugestaoAcao: 'Cadastrar certificado A1 e habilitar busca automatica.',
    historicoTentativas: ['31/05 02:42 pre-check falhou'],
    allowsReprocess: false
  },
  {
    id: 'alert-006',
    severity: 'Informativo',
    tipo: 'Servidor',
    titulo: 'Servidor interno indisponivel por 2 min',
    descricao: 'Instabilidade curta detectada no compartilhamento de XML.',
    clientId: null,
    cliente: 'Infraestrutura',
    dataHora: '2026-05-31T01:17:00.000Z',
    status: 'Resolvido',
    origem: 'monitor-storage',
    mensagemTecnica: 'Ping packet loss acima de 40% por 120 segundos.',
    sugestaoAcao: 'Sem acao adicional. Evento encerrado.',
    historicoTentativas: ['01:17 alerta aberto', '01:19 recuperacao automatica'],
    allowsReprocess: false
  }
];

export const mockUsers = [
  {
    id: 'usr-001',
    nome: 'Giselle Coelho',
    email: 'giselle@gcont.local',
    perfil: 'Administrador',
    status: 'Ativo'
  },
  {
    id: 'usr-002',
    nome: 'Rafaela Prado',
    email: 'rafaela@gcont.local',
    perfil: 'Operador fiscal',
    status: 'Ativo'
  },
  {
    id: 'usr-003',
    nome: 'Leonardo Martins',
    email: 'leonardo@gcont.local',
    perfil: 'Consulta',
    status: 'Inativo'
  }
];
