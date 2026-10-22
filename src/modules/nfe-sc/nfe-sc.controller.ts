import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AuthenticatedRequest } from '../auth/auth.types';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { ConfigureNfeScSyncDto } from './dto/configure-nfe-sc-sync.dto';
import { NfeScService } from './nfe-sc.service';

class NfeScControlsQuery {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;
}

class NfeScDocumentsQuery extends NfeScControlsQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  pageSize = 100;
}

@ApiTags('nfe-sc')
@Controller('nfe-sc')
@Roles('admin')
export class NfeScController {
  constructor(private readonly service: NfeScService) {}

  @Get('controles')
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  @ApiOperation({ summary: 'Lista os controles independentes de distribuicao de NF-e modelo 55 da SEF/SC.' })
  listControls(@Query() query: NfeScControlsQuery) {
    return this.service.listControls(query.clienteId);
  }

  @Get('documentos')
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  @ApiOperation({ summary: 'Lista com paginação documentos NF-e modelo 55 e eventos importados pela distribuicao SEF/SC, com NSU de origem.' })
  @ApiOkResponse({ schema: { type: 'object', properties: {
    items: { type: 'array', items: { type: 'object' } },
    total: { type: 'integer' }, page: { type: 'integer' }, pageSize: { type: 'integer' }, totalPages: { type: 'integer' }
  } } })
  listDocuments(@Query() query: NfeScDocumentsQuery) {
    return this.service.listDocuments(query.clienteId, query.page, query.pageSize);
  }

  @Post('controles')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  @ApiOperation({
    summary: 'Configura a distribuicao SEF/SC para um CPF de produtor rural.',
    description: 'Somente administradores. Exige confirmacao de que o certificado pertence a contabilista com vinculo previamente verificado na SEF/SC. A SEF/SC revalida a autorizacao em cada consulta; o NotaSync nao consulta credenciais reais ao configurar.'
  })
  configure(@Body() dto: ConfigureNfeScSyncDto, @Req() request: AuthenticatedRequest) {
    return this.service.configure(dto, request.authUser?.userId);
  }

  @Post('controles/:id/rodar-agora')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Inicia uma consulta controlada da distribuicao SEF/SC.' })
  @ApiAcceptedResponse({ schema: { type: 'object', properties: {
    accepted: { type: 'boolean' }, started: { type: 'boolean' }, status: { type: 'string' },
    ultimoNsu: { type: 'string' }, totalDocumentosBaixados: { type: 'integer' }, mensagem: { type: 'string' }
  } } })
  run(@Param('id') id: string, @Body() body: NfeScControlsQuery) {
    return this.service.run(body.clienteId, id);
  }

  @Post('controles/:id/pausar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  @ApiOkResponse({ schema: { type: 'object', properties: { paused: { type: 'boolean' } } } })
  pause(@Param('id') id: string, @Body() body: NfeScControlsQuery) {
    return this.service.pause(body.clienteId, id);
  }
}
