import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags
} from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { CreateEstablishmentDto } from './dto/create-establishment.dto';
import { LookupCepResponseDto } from './dto/lookup-cep-response.dto';
import { UpdateEstablishmentDto } from './dto/update-establishment.dto';
import { EstablishmentsService } from './establishments.service';

@ApiTags('estabelecimentos')
@Controller()
export class EstablishmentsController {
  constructor(private readonly establishmentsService: EstablishmentsService) {}

  @Get('estabelecimentos/cep/:cep')
  @ApiParam({ name: 'cep', description: 'CEP com 8 digitos, com ou sem pontuacao', example: '88010000' })
  @ApiOkResponse({ type: LookupCepResponseDto, description: 'Endereco e codigo IBGE correspondentes ao CEP.' })
  @ApiBadRequestResponse({ description: 'CEP deve conter oito digitos.' })
  @ApiNotFoundResponse({ description: 'CEP nao localizado.' })
  @ApiServiceUnavailableResponse({ description: 'O servico de consulta CEP esta indisponivel.' })
  lookupCep(@Param('cep') cep: string) {
    return this.establishmentsService.lookupCep(cep);
  }

  @Post('clientes/:clienteId/estabelecimentos')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  @ApiCreatedResponse({ description: 'Estabelecimento cadastrado.' })
  @ApiConflictResponse({ description: 'O cliente ja possui estabelecimento com esse CNPJ.' })
  @ApiNotFoundResponse({ description: 'Cliente nao encontrado.' })
  create(@Param('clienteId') clienteId: string, @Body() dto: CreateEstablishmentDto) {
    return this.establishmentsService.create(clienteId, dto);
  }

  @Get('clientes/:clienteId/estabelecimentos')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  listByClient(@Param('clienteId') clienteId: string) {
    return this.establishmentsService.listByClient(clienteId);
  }

  @Patch('estabelecimentos/:id')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao estabelecimento' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  update(@Param('id') id: string, @Body() dto: UpdateEstablishmentDto, @Query() query: ClienteScopeQueryDto) {
    return this.establishmentsService.update(id, dto, query.clienteId);
  }
}
