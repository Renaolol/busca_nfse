import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import {
  DashboardNfeStatsQueryDto,
  DashboardNfeStatsResponseDto
} from './dto/dashboard-stats.dto';
import { Cst060AnalysisResponseDto, QueryCst060AnalysisDto } from './dto/cst-060-analysis.dto';
import { DownloadDominioNfeXmlDto, GetDominioNfeXmlDto } from './dto/dominio-xml.dto';
import { ImportNfeFromDominioDto } from './dto/import-dominio.dto';
import { EnableAllNfeSyncDto } from './dto/enable-all-sync.dto';
import { EnableNfeSyncDto } from './dto/enable-sync.dto';
import { DownloadNfeDocumentDto } from './dto/download-document.dto';
import { DownloadNfePdfDto } from './dto/download-pdf.dto';
import { DownloadLoteDto } from './dto/download-lote.dto';
import { DownloadLoteResponseDto } from './dto/download-lote-response.dto';
import { ImportNfeXmlDto } from './dto/import-xml.dto';
import { PauseNfeSyncDto } from './dto/pause-sync.dto';
import { PreviewDominioDocumentsDto } from './dto/preview-dominio-documents.dto';
import { QueryNfeByChaveDto } from './dto/query-by-chave.dto';
import { QueryNfeByNsuDto } from './dto/query-by-nsu.dto';
import { QueryNfeDto } from './dto/query-nfe.dto';
import { RunNfeSyncDto } from './dto/run-sync.dto';
import { RunSefazCpfImportDto } from './dto/run-sefaz-cpf-import.dto';
import { ExecuteSefazDiagnosticDto, StartSefazDiagnosticDto } from './dto/sefaz-diagnostic.dto';
import { SincronizarNfeEventosDto, SincronizarNfeEventosResponseDto } from './dto/sincronizar-eventos.dto';
import { StartNfeSyncDto } from './dto/start-sync.dto';
import { UpdateNfeSchedulerSettingsDto } from './dto/update-scheduler-settings.dto';
import { UpdateMonofasicoAliquotasDto } from './dto/update-monofasico-aliquotas.dto';
import { RegistrarNfeManifestacaoDto } from './dto/registrar-manifestacao.dto';
import { NfeService } from './nfe.service';
import { NfeManifestacaoService } from './nfe-manifestacao.service';
import { AuthenticatedRequest } from '../auth/auth.types';

const sefazDiagnosticsSchema: SchemaObject = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      controlId: { type: 'string' },
      estabelecimentoId: { type: 'string' },
      method: { type: 'string', enum: ['distNSU', 'consNSU', 'consChNFe'] },
      clientMode: { type: 'string', enum: ['real', 'mock'] },
      actorType: { type: 'string', enum: ['CPF', 'CNPJ'] },
      ambiente: { type: 'string' },
      httpStatus: { type: 'integer', nullable: true },
      cStat: { type: 'string', nullable: true },
      xMotivo: { type: 'string', nullable: true },
      ultNsu: { type: 'string', nullable: true },
      maxNsu: { type: 'string', nullable: true },
      documentsReceived: { type: 'integer' },
      documentsDecoded: { type: 'integer' },
      docZipDiscarded: { type: 'integer' },
      schemaCounts: { type: 'object', additionalProperties: { type: 'integer' } },
      documentsFiltered: { type: 'integer' },
      documentsAttempted: { type: 'integer' },
      documentsProcessed: { type: 'integer' },
      documentsFailed: { type: 'integer' },
      documentsNotAttempted: { type: 'integer' },
      processingResult: { type: 'string', enum: ['concluido', 'sem_documentos', 'aguardando_sefaz', 'falha'] },
      failureStage: {
        type: 'string',
        enum: ['before_response', 'sefaz_response', 'docZip_decode', 'document_parse_or_persist', 'cursor_update', null],
        nullable: true
      }
    }
  }
};

const nfeSyncRunResponseSchema: SchemaObject = {
  type: 'object',
  properties: {
    processed: { type: 'integer' },
    documentsSaved: { type: 'integer' },
    failures: { type: 'integer' },
    sefazDiagnostics: sefazDiagnosticsSchema
  }
};

@ApiTags('nfe')
@Controller('nfe')
export class NfeController {
  constructor(private readonly nfeService: NfeService, private readonly nfeManifestacaoService: NfeManifestacaoService) {}

  @Get('dashboard-stats')
  @ApiOkResponse({ type: DashboardNfeStatsResponseDto })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  dashboardStats(@Query() query: DashboardNfeStatsQueryDto) {
    return this.nfeService.getDashboardStats(query);
  }

  @Get('sync/status')
  @ApiQuery({ name: 'clienteId', required: true })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  statusSync(@Query() query: ClienteScopeQueryDto) {
    return this.nfeService.statusSync(query.clienteId);
  }

  @Get('sync/scheduler-status')
  schedulerStatus() {
    return this.nfeService.schedulerStatus();
  }

  @Get()
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  findAll(@Query() query: QueryNfeDto) {
    return this.nfeService.findAll(query);
  }

  @Get(':id/manifestacoes')
  @Roles('admin')
  @ApiOperation({ summary: 'Lista o histórico de manifestações registradas pelo NotaSync para uma NF-e.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    documentoId: { type: 'string' },
    status: { type: 'string', enum: ['xml_completo_disponivel', 'aguardando_disponibilizacao', 'resumo_disponivel', 'sem_xml'] },
    resumoDisponivel: { type: 'boolean' },
    xmlCompletoDisponivel: { type: 'boolean' },
    historico: { type: 'array', items: { type: 'object' } }
  } } })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  getManifestacoes(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfeManifestacaoService.getHistory(id, query.clienteId);
  }

  @Post(':id/manifestacoes')
  @Roles('admin')
  @ApiOperation({
    summary: 'Registra uma manifestação do destinatário após autorização expressa do usuário.',
    description: 'Aceita CPF e CNPJ com certificado cujo titular corresponda exatamente ao estabelecimento. Não envia eventos automaticamente. Ciência é opcional e não conclusiva; eventos conclusivos exigem operação compatível e respeitam o prazo vigente de 90 dias da autorização. Não use Confirmação apenas para obter XML.'
  })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    id: { type: 'string' }, tipoEvento: { type: 'string' }, nSeqEvento: { type: 'integer' },
    status: { type: 'string', enum: ['registrada', 'registrada_sem_vinculo', 'rejeitada', 'falha_local', 'resultado_indeterminado', 'enviando'] },
    cStat: { type: 'string', nullable: true }, xMotivo: { type: 'string', nullable: true }, nProt: { type: 'string', nullable: true },
    autorizacaoExpressaEm: { type: 'string', format: 'date-time' }, processadoEm: { type: 'string', format: 'date-time', nullable: true }
  } } })
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  registrarManifestacao(
    @Param('id') id: string,
    @Body() dto: RegistrarNfeManifestacaoDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.nfeManifestacaoService.registrar(id, dto, request.authUser?.userId);
  }

  @Get('cst-060-analysis')
  @ApiOperation({
    summary: 'Analisa itens CST 060 de NF-e recebidas',
    description:
      'Para cada item, usa a base vBCSTRet do XML limitada ao valor total do produto (vProd): bases maiores são limitadas a vProd e bases menores são preservadas. Usa pST do XML como alíquota quando informado; sem pST, mantém a alíquota interna solicitada e a regra automática de 4% para pneus.'
  })
  @ApiOkResponse({ type: Cst060AnalysisResponseDto })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  cst060Analysis(@Query() query: QueryCst060AnalysisDto) {
    return this.nfeService.analyzeCst060(query);
  }

  @Get(':id')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  findOne(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfeService.findOne(id, query.clienteId);
  }

  @Get(':id/xml')
  @ApiOkResponse({ type: DownloadNfeDocumentDto })
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  getXml(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfeService.getXml(id, query.clienteId);
  }

  @Get(':id/danfe')
  @ApiOkResponse({ type: DownloadNfePdfDto })
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  getDanfe(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfeService.getDanfe(id, query.clienteId);
  }

  @Post('download-lote')
  @ApiOperation({ summary: 'Baixa XMLs e DANFEs de NF-e em lote; eventos de NFC-e ficam na mesma pasta dos XMLs' })
  @ApiOkResponse({ type: DownloadLoteResponseDto })
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  downloadLote(@Body() dto: DownloadLoteDto) {
    return this.nfeService.downloadLote(dto);
  }

  @Post('importar-xml')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  importXml(@Body() dto: ImportNfeXmlDto) {
    return this.nfeService.importXml(dto);
  }

  @Post('eventos/sincronizar')
  @ApiOkResponse({ type: SincronizarNfeEventosResponseDto })
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  sincronizarEventos(@Body() dto: SincronizarNfeEventosDto) {
    return this.nfeService.sincronizarEventos(dto);
  }

  @Post('importar-dominio')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  importFromDominio(@Body() dto: ImportNfeFromDominioDto) {
    return this.nfeService.importFromDominio(dto);
  }

  @Post('dominio/documentos/preview')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  previewDominioDocuments(@Body() dto: PreviewDominioDocumentsDto) {
    return this.nfeService.previewDominioDocuments(dto);
  }

  @Post('dominio/xml')
  @ApiOkResponse({ type: DownloadDominioNfeXmlDto })
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  getDominioXml(@Body() dto: GetDominioNfeXmlDto) {
    return this.nfeService.getDominioXml(dto);
  }

  @Post('sync/iniciar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  iniciarSync(@Body() dto: StartNfeSyncDto) {
    return this.nfeService.iniciarSync(dto);
  }

  @Post('sync/ativar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  ativarSync(@Body() dto: EnableNfeSyncDto) {
    return this.nfeService.ativarSyncNoNsuAtual(dto);
  }

  @Post('sync/ativar-todos')
  @Roles('admin')
  ativarSyncTodos(@Body() dto: EnableAllNfeSyncDto) {
    return this.nfeService.ativarSyncNoNsuAtualParaTodos(dto);
  }

  @Post('sync/pausar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  pausarSync(@Body() dto: PauseNfeSyncDto) {
    return this.nfeService.pausarSync(dto);
  }

  @Put('sync/scheduler-settings')
  @Roles('admin')
  updateSchedulerSettings(@Body() dto: UpdateNfeSchedulerSettingsDto) {
    return this.nfeService.updateSchedulerSettings(dto);
  }

  @Get('xml-reader30/aliquotas-monofasico')
  getMonofasicoAliquotas() {
    return this.nfeService.getMonofasicoAliquotas();
  }

  @Put('xml-reader30/aliquotas-monofasico')
  @Roles('admin')
  updateMonofasicoAliquotas(@Body() dto: UpdateMonofasicoAliquotasDto) {
    return this.nfeService.updateMonofasicoAliquotas(dto);
  }

  @Post('sync/rodar-agora')
  @ApiOkResponse({
    description: 'Retorna contagens da execucao e diagnósticos sem identificador fiscal ou XML bruto para cada chamada distNSU.',
    schema: nfeSyncRunResponseSchema
  })
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  runNow(@Body() dto: RunNfeSyncDto) {
    return this.nfeService.runNow(dto);
  }

  @Post('sync/rodar-agora-geral')
  @Roles('admin')
  @ApiOkResponse({
    description: 'Retorna contagens da execucao e diagnósticos sem identificador fiscal ou XML bruto para cada chamada distNSU.',
    schema: nfeSyncRunResponseSchema
  })
  runNowGlobal() {
    return this.nfeService.runNowGlobal();
  }

  @Post('sync/rodar-sefaz-cpf')
  @Roles('admin')
  @ApiOkResponse({
    description: 'A recuperacao com periodo inclui cpfDiagnostics com método, situação, cStat/xMotivo, período, consultas, NSUs, documentos retornados e resultados de processamento.',
    schema: {
      type: 'object',
      properties: {
        processed: { type: 'integer' },
        documentsSaved: { type: 'integer' },
        failures: { type: 'integer' },
        sefazDiagnostics: sefazDiagnosticsSchema,
        cpfDiagnostics: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['consNSU'] },
            status: { type: 'string', enum: ['concluida', 'parcial', 'aguardando_sefaz', 'falha', 'sem_documentos'] },
            dataEmissaoInicio: { type: 'string', format: 'date' },
            dataEmissaoFim: { type: 'string', format: 'date' },
            consultasExecutadas: { type: 'integer' },
            nsuAtual: { type: 'string', nullable: true },
            proximoNsu: { type: 'string', nullable: true },
            disponivelApos: { type: 'string', format: 'date-time', nullable: true },
            documentosRetornados: { type: 'integer' },
            xmlsCompletos: { type: 'integer' },
            resumos: { type: 'integer' },
            eventos: { type: 'integer' },
            foraDoPeriodo: { type: 'integer' },
            documentosImportados: { type: 'integer' },
            descartadosComFalha: { type: 'integer' },
            cStat: { type: 'string', nullable: true },
            xMotivo: { type: 'string', nullable: true }
          }
        }
      }
    }
  })
  @ApiOperation({
    summary: 'Importa NF-e manualmente pela SEFAZ para controles cadastrados com CPF',
    description: 'Aceita controleId do produtor, certificadoId, clienteId, ambiente e opcionalmente dataEmissaoInicio/dataEmissaoFim. Sem datas, segue o cursor incremental salvo em distNSU. Com datas, tenta a recuperacao pontual por consNSU a partir do NSU conhecido, filtra emissao localmente e preserva o cursor incremental. O servico nao oferece filtro por data: a NT 2014.002 recomenda distNSU para distribuir o conjunto de documentos; consNSU e consulta pontual, sujeita a no maximo 20 consultas por hora e disponibilidade de 90 dias. A aplicacao limita cada ciclo a 15 consultas consNSU e a busca a 10.000 NSUs. Recuperacoes parciais ficam salvas e o agendador de NF-e tenta retoma-las apos o intervalo, se auto-sync ou a busca noturna estiver habilitada. cStat 656 exige espera de uma hora. A recuperacao nao retrocede nem altera o cursor incremental. A resposta historica inclui contagens e proximo NSU em cpfDiagnostics. O certificado precisa estar vinculado ao produtor selecionado.'
  })
  runNowCpfViaSefazGlobal(@Body() dto: RunSefazCpfImportDto) {
    return this.nfeService.runNowCpfViaSefazGlobal(dto);
  }

  @Get('sync/diagnostico-sefaz/status')
  @Roles('admin')
  @ApiOperation({ summary: 'Consulta o estado seguro do modo temporario de diagnostico SEFAZ.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    active: { type: 'boolean' }, expiresAt: { type: 'string', nullable: true, format: 'date-time' },
    controlId: { type: 'string', nullable: true, format: 'uuid' },
    estabelecimentoId: { type: 'string', nullable: true, format: 'uuid' },
    ambiente: { type: 'string', nullable: true }, actorType: { type: 'string', nullable: true, enum: ['CPF', 'CNPJ'] },
    clientMode: { type: 'string', enum: ['real', 'mock'] }, automaticPaused: { type: 'boolean' }
  } } })
  getSefazDiagnosticModeStatus() {
    return this.nfeService.getSefazDiagnosticModeStatus();
  }

  @Post('sync/diagnostico-sefaz/iniciar')
  @Roles('admin')
  @ApiOperation({ summary: 'Ativa por 30 minutos o modo de diagnostico para um unico controle.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    active: { type: 'boolean' }, expiresAt: { type: 'string', nullable: true, format: 'date-time' },
    controlId: { type: 'string', nullable: true, format: 'uuid' },
    estabelecimentoId: { type: 'string', nullable: true, format: 'uuid' },
    ambiente: { type: 'string', nullable: true }, actorType: { type: 'string', nullable: true, enum: ['CPF', 'CNPJ'] },
    clientMode: { type: 'string', enum: ['real', 'mock'] }, automaticPaused: { type: 'boolean' }
  } } })
  startSefazDiagnosticMode(@Body() dto: StartSefazDiagnosticDto) {
    return this.nfeService.startSefazDiagnosticMode(dto);
  }

  @Post('sync/diagnostico-sefaz/encerrar')
  @Roles('admin')
  @ApiOperation({ summary: 'Encerra o modo temporario de diagnostico SEFAZ.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    active: { type: 'boolean' }, clientMode: { type: 'string', enum: ['real', 'mock'] }, automaticPaused: { type: 'boolean' }
  } } })
  stopSefazDiagnosticMode() {
    return this.nfeService.stopSefazDiagnosticMode();
  }

  @Post('sync/diagnostico-sefaz/consultar')
  @Roles('admin')
  @ApiOperation({
    summary: 'Executa uma consulta SEFAZ manual controlada por distNSU ou consChNFe.',
    description: 'Exige modo real, sessao de diagnostico ativa, certificado vinculado, respeita cStat 137/656 e limita consChNFe/consNSU a 20 consultas por ator por hora. distNSU persiste documentos e so avanca o cursor quando a extracao e a persistencia terminam sem perda.'
  })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    diagnostic: { type: 'object', properties: {
      method: { type: 'string', enum: ['distNSU', 'consNSU', 'consChNFe'] },
      clientMode: { type: 'string', enum: ['real', 'mock'] }, actorType: { type: 'string', enum: ['CPF', 'CNPJ'] },
      httpStatus: { type: 'integer', nullable: true }, cStat: { type: 'string', nullable: true },
      xMotivo: { type: 'string', nullable: true }, ultNsu: { type: 'string', nullable: true },
      maxNsu: { type: 'string', nullable: true }, documentsReceived: { type: 'integer' },
      documentsDecoded: { type: 'integer' }, docZipDiscarded: { type: 'integer' },
      schemaCounts: { type: 'object', additionalProperties: { type: 'integer' } },
      documentsAttempted: { type: 'integer' }, documentsProcessed: { type: 'integer' },
      documentsFailed: { type: 'integer' }, documentsNotAttempted: { type: 'integer' },
      processingResult: { type: 'string', enum: ['concluido', 'sem_documentos', 'aguardando_sefaz', 'falha'] },
      failureStage: { type: 'string', nullable: true }
    } },
    documentsPersisted: { type: 'integer' }, persistenceRequested: { type: 'boolean' }, cursorAdvanced: { type: 'boolean' }
  } } })
  executeSefazDiagnosticQuery(@Body() dto: ExecuteSefazDiagnosticDto) {
    return this.nfeService.executeSefazDiagnosticQuery(dto);
  }

  @Post('sync/download-por-chave/preview')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  previewDownloadByKey(@Body() dto: RunNfeSyncDto) {
    return this.nfeService.previewDownloadByKey(dto);
  }

  @Post('sync/download-por-chave/preview-global')
  @Roles('admin')
  previewDownloadByKeyGlobal() {
    return this.nfeService.previewDownloadByKeyGlobal();
  }

  @Post('sync/download-por-chave/executar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  executeDownloadByKey(@Body() dto: RunNfeSyncDto) {
    return this.nfeService.executeDownloadByKey(dto);
  }

  @Post('sync/download-por-chave/executar-global')
  @Roles('admin')
  executeDownloadByKeyGlobal() {
    return this.nfeService.executeDownloadByKeyGlobal();
  }

  @Post('sync/consultar-nsu')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  consultarNsu(@Body() dto: QueryNfeByNsuDto) {
    return this.nfeService.consultarNsu(dto);
  }

  @Post('sync/consultar-chave')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  consultarChave(@Body() dto: QueryNfeByChaveDto) {
    return this.nfeService.consultarChave(dto);
  }
}
