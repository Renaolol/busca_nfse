import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ClientsService } from './clients.service';

@ApiTags('clientes')
@Controller('clientes')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'clienteId', required: false, description: 'Filtro opcional por cliente (obrigatorio para token de cliente)' })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  findAll(@Query('clienteId') clienteId?: string) {
    return this.clientsService.findAll(clienteId);
  }

  @Get(':id')
  @TenantScope({ source: 'params', key: 'id', required: true })
  findOne(@Param('id') id: string) {
    return this.clientsService.findOne(id);
  }

  @Patch(':id')
  @TenantScope({ source: 'params', key: 'id', required: true })
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Post(':id/ativar')
  @Roles('admin')
  activate(@Param('id') id: string) {
    return this.clientsService.setActive(id, true);
  }

  @Post(':id/pausar')
  @Roles('admin')
  pause(@Param('id') id: string) {
    return this.clientsService.setActive(id, false);
  }

  @Post(':id/nfe/ativar')
  @Roles('admin')
  activateNfe(@Param('id') id: string) {
    return this.clientsService.setNfeEnabled(id, true);
  }

  @Post(':id/nfe/pausar')
  @Roles('admin')
  pauseNfe(@Param('id') id: string) {
    return this.clientsService.setNfeEnabled(id, false);
  }
}
