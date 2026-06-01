export const mockSearchRuns = [
  {
    id: 'run-20260601-0200',
    codigo: 'RUN-20260601-0200',
    tipo: 'Automatica',
    data: '2026-06-01',
    inicio: '2026-06-01T02:00:00.000Z',
    fim: '2026-06-01T02:38:00.000Z',
    clientesProcessados: 128,
    xmlsEncontrados: 843,
    xmlsArmazenados: 836,
    falhas: 7,
    status: 'Concluida com avisos',
    resumoStatus: 'Aviso',
    detalhes: [
      {
        clientId: '8da97d8d-1e20-44b2-8c16-c16fc4435d81',
        cliente: 'Comercial Sao Miguel LTDA',
        cnpj: '03456789000190',
        municipio: 'Sao Paulo',
        xmlsEncontrados: 46,
        status: 'Sucesso',
        mensagem: 'Consulta concluida sem divergencias.'
      },
      {
        clientId: '11c50faa-1fd8-44fb-8f9e-a12a5ef2c101',
        cliente: 'Clinica Santa Beatriz SS',
        cnpj: '12456789000174',
        municipio: 'Campinas',
        xmlsEncontrados: 27,
        status: 'Aviso',
        mensagem: 'Certificado vence em 8 dias.'
      },
      {
        clientId: '6bb4a856-cf7f-4e21-8c6a-772631f8b1f3',
        cliente: 'Translog Sul Transportes EIRELI',
        cnpj: '89567890000102',
        municipio: 'Curitiba',
        xmlsEncontrados: 0,
        status: 'Erro',
        mensagem: 'Falha de autenticacao na prefeitura.'
      },
      {
        clientId: '65e42ec6-f287-4ff5-8f2c-65cb743f6f14',
        cliente: 'Metalurgica Forte Aco SA',
        cnpj: '99456789000143',
        municipio: 'Joinville',
        xmlsEncontrados: 62,
        status: 'Sucesso',
        mensagem: 'Lote finalizado com armazenamento completo.'
      }
    ]
  },
  {
    id: 'run-20260531-0200',
    codigo: 'RUN-20260531-0200',
    tipo: 'Automatica',
    data: '2026-05-31',
    inicio: '2026-05-31T02:00:00.000Z',
    fim: '2026-05-31T02:41:00.000Z',
    clientesProcessados: 125,
    xmlsEncontrados: 802,
    xmlsArmazenados: 802,
    falhas: 0,
    status: 'Concluida',
    resumoStatus: 'Sucesso',
    detalhes: []
  },
  {
    id: 'run-20260530-0200',
    codigo: 'RUN-20260530-0200',
    tipo: 'Automatica',
    data: '2026-05-30',
    inicio: '2026-05-30T02:00:00.000Z',
    fim: '2026-05-30T02:48:00.000Z',
    clientesProcessados: 125,
    xmlsEncontrados: 789,
    xmlsArmazenados: 783,
    falhas: 4,
    status: 'Concluida com avisos',
    resumoStatus: 'Aviso',
    detalhes: []
  },
  {
    id: 'run-20260529-1700',
    codigo: 'RUN-20260529-1700',
    tipo: 'Reprocessamento',
    data: '2026-05-29',
    inicio: '2026-05-29T17:00:00.000Z',
    fim: '2026-05-29T17:19:00.000Z',
    clientesProcessados: 19,
    xmlsEncontrados: 58,
    xmlsArmazenados: 58,
    falhas: 1,
    status: 'Concluida com avisos',
    resumoStatus: 'Aviso',
    detalhes: []
  },
  {
    id: 'run-20260529-1030',
    codigo: 'RUN-20260529-1030',
    tipo: 'Manual',
    data: '2026-05-29',
    inicio: '2026-05-29T10:30:00.000Z',
    fim: '2026-05-29T11:22:00.000Z',
    clientesProcessados: 33,
    xmlsEncontrados: 112,
    xmlsArmazenados: 109,
    falhas: 3,
    status: 'Falha critica',
    resumoStatus: 'Erro',
    detalhes: []
  }
];

export const mockRunningExecution = {
  id: 'run-20260601-1400',
  codigo: 'RUN-20260601-1400',
  tipo: 'Manual',
  status: 'Em execucao',
  progressoPercentual: 34,
  clienteAtual: 'Construtora Monte Real SPE',
  processados: 11,
  totalClientes: 32,
  tempoEstimadoMin: 19
};
