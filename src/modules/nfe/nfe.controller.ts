import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import {
  DashboardNfeStatsQueryDto,
  DashboardNfeStatsResponseDto
} from './dto/dashboard-stats.dto';
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
import { SincronizarNfeEventosDto, SincronizarNfeEventosResponseDto } from './dto/sincronizar-eventos.dto';
import { StartNfeSyncDto } from './dto/start-sync.dto';
import { UpdateNfeSchedulerSettingsDto } from './dto/update-scheduler-settings.dto';
import { UpdateMonofasicoAliquotasDto } from './dto/update-monofasico-aliquotas.dto';
import { NfeService } from './nfe.service';

@ApiTags('nfe')
@Controller('nfe')
export class NfeController {
  constructor(private readonly nfeService: NfeService) {}

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
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  runNow(@Body() dto: RunNfeSyncDto) {
    return this.nfeService.runNow(dto);
  }

  @Post('sync/rodar-agora-geral')
  @Roles('admin')
  runNowGlobal() {
    return this.nfeService.runNowGlobal();
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
