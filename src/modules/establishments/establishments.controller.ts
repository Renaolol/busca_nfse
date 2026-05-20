import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateEstablishmentDto } from './dto/create-establishment.dto';
import { UpdateEstablishmentDto } from './dto/update-establishment.dto';
import { EstablishmentsService } from './establishments.service';

@ApiTags('estabelecimentos')
@Controller()
export class EstablishmentsController {
  constructor(private readonly establishmentsService: EstablishmentsService) {}

  @Post('clientes/:clienteId/estabelecimentos')
  create(@Param('clienteId') clienteId: string, @Body() dto: CreateEstablishmentDto) {
    return this.establishmentsService.create(clienteId, dto);
  }

  @Get('clientes/:clienteId/estabelecimentos')
  listByClient(@Param('clienteId') clienteId: string) {
    return this.establishmentsService.listByClient(clienteId);
  }

  @Patch('estabelecimentos/:id')
  update(@Param('id') id: string, @Body() dto: UpdateEstablishmentDto) {
    return this.establishmentsService.update(id, dto);
  }
}
