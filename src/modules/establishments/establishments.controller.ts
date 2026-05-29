import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { CreateEstablishmentDto } from './dto/create-establishment.dto';
import { UpdateEstablishmentDto } from './dto/update-establishment.dto';
import { EstablishmentsService } from './establishments.service';

@ApiTags('estabelecimentos')
@Controller()
export class EstablishmentsController {
  constructor(private readonly establishmentsService: EstablishmentsService) {}

  @Post('clientes/:clienteId/estabelecimentos')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
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
