import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import {
  DashboardNfeStatsQueryDto,
  DashboardNfeStatsResponseDto
} from './dto/dashboard-stats.dto';
import { DownloadNfeDocumentDto } from './dto/download-document.dto';
import { ImportNfeXmlDto } from './dto/import-xml.dto';
import { PauseNfeSyncDto } from './dto/pause-sync.dto';
import { QueryNfeDto } from './dto/query-nfe.dto';
import { RunNfeSyncDto } from './dto/run-sync.dto';
import { StartNfeSyncDto } from './dto/start-sync.dto';
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

  @Post('importar-xml')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  importXml(@Body() dto: ImportNfeXmlDto) {
    return this.nfeService.importXml(dto);
  }

  @Post('sync/iniciar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  iniciarSync(@Body() dto: StartNfeSyncDto) {
    return this.nfeService.iniciarSync(dto);
  }

  @Post('sync/pausar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  pausarSync(@Body() dto: PauseNfeSyncDto) {
    return this.nfeService.pausarSync(dto);
  }

  @Post('sync/rodar-agora')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  runNow(@Body() dto: RunNfeSyncDto) {
    return this.nfeService.runNow(dto);
  }
}
