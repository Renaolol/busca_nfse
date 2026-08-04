import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiQuery, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { DownloadLoteDto } from './dto/download-lote.dto';
import { DownloadLoteResponseDto } from './dto/download-lote-response.dto';
import { DownloadDocumentDto } from './dto/download-document.dto';
import { DashboardStatsQueryDto, DashboardStatsResponseDto } from './dto/dashboard-stats.dto';
import { ImportXmlDto } from './dto/import-xml.dto';
import { NfseNumeracaoValidationDto } from './dto/list-nfse-response.dto';
import { QueryNfseDto } from './dto/query-nfse.dto';
import { ReprocessarDanfsesDto, ReprocessarDanfsesResponseDto } from './dto/reprocessar-danfses.dto';
import { ReprocessarXmlsDto } from './dto/reprocessar-xmls.dto';
import { SincronizarNfseEventosDto, SincronizarNfseEventosResponseDto } from './dto/sincronizar-eventos.dto';
import { NfseService } from './nfse.service';

@ApiTags('nfse')
@ApiExtraModels(NfseNumeracaoValidationDto)
@Controller('nfse')
export class NfseController {
  constructor(private readonly nfseService: NfseService) {}

  @Get('dashboard-stats')
  @ApiOkResponse({ type: DashboardStatsResponseDto })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  dashboardStats(@Query() query: DashboardStatsQueryDto) {
    return this.nfseService.getDashboardStats(query);
  }

  @Get()
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true
          }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        pageSize: { type: 'number' },
        totalPages: { type: 'number' },
        validacaoNumeracao: {
          allOf: [{ $ref: getSchemaPath(NfseNumeracaoValidationDto) }]
        }
      }
    }
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  findAll(@Query() query: QueryNfseDto) {
    return this.nfseService.findAll(query);
  }

  @Get('separadas')
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        cnpjConsulta: { type: 'string' },
        totais: {
          type: 'object',
          properties: {
            emitidas: { type: 'number' },
            tomadas: { type: 'number' }
          }
        },
        validacaoNumeracaoEmitidas: {
          allOf: [{ $ref: getSchemaPath(NfseNumeracaoValidationDto) }]
        },
        emitidas: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true
          }
        },
        tomadas: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true
          }
        }
      }
    }
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  findSeparated(@Query() query: QueryNfseDto) {
    return this.nfseService.findSeparated(query);
  }

  @Get(':id')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  findOne(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfseService.findOne(id, query.clienteId);
  }

  @Get(':id/xml')
  @ApiOkResponse({ type: DownloadDocumentDto })
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  getXml(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfseService.getXml(id, query.clienteId);
  }

  @Get(':id/danfse')
  @ApiOkResponse({ type: DownloadDocumentDto })
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  getDanfse(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfseService.getDanfse(id, query.clienteId);
  }

  @Post('importar-xml')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  importXml(@Body() dto: ImportXmlDto) {
    return this.nfseService.importXml(dto);
  }

  @Post('download-lote')
  @ApiOkResponse({ type: DownloadLoteResponseDto })
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  downloadLote(@Body() dto: DownloadLoteDto) {
    return this.nfseService.downloadLote(dto);
  }

  @Post('reprocessar-xmls')
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  reprocessarXmls(@Body() dto: ReprocessarXmlsDto) {
    return this.nfseService.reprocessarXmls(dto);
  }

  @Post('reprocessar-danfses')
  @ApiOkResponse({ type: ReprocessarDanfsesResponseDto })
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  reprocessarDanfses(@Body() dto: ReprocessarDanfsesDto) {
    return this.nfseService.reprocessarDanfses(dto);
  }

  @Post('eventos/sincronizar')
  @ApiOkResponse({ type: SincronizarNfseEventosResponseDto })
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  sincronizarEventos(@Body() dto: SincronizarNfseEventosDto) {
    return this.nfseService.sincronizarEventos(dto);
  }
}
