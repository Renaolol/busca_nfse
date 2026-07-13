import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { CteService } from './cte.service';
import { DashboardCteStatsQueryDto, DashboardCteStatsResponseDto } from './dto/dashboard-stats.dto';
import { DownloadCteDocumentDto } from './dto/download-document.dto';
import { QueryCteDto } from './dto/query-cte.dto';
import { SincronizarCteEventosDto, SincronizarCteEventosResponseDto } from './dto/sincronizar-eventos.dto';

@ApiTags('cte')
@Controller('cte')
export class CteController {
  constructor(private readonly cteService: CteService) {}

  @Get('dashboard-stats')
  @ApiOkResponse({ type: DashboardCteStatsResponseDto })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  dashboardStats(@Query() query: DashboardCteStatsQueryDto) {
    return this.cteService.getDashboardStats(query);
  }

  @Get()
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  findAll(@Query() query: QueryCteDto) {
    return this.cteService.findAll(query);
  }

  @Get(':id')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  findOne(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.cteService.findOne(id, query.clienteId);
  }

  @Get(':id/xml')
  @ApiOkResponse({ type: DownloadCteDocumentDto })
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  getXml(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.cteService.getXml(id, query.clienteId);
  }

  @Post('eventos/sincronizar')
  @ApiOkResponse({ type: SincronizarCteEventosResponseDto })
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  sincronizarEventos(@Body() dto: SincronizarCteEventosDto) {
    return this.cteService.sincronizarEventos(dto);
  }
}
