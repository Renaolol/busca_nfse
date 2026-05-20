import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { CertificatesService } from './certificates.service';

@ApiTags('certificados')
@Controller()
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Post('clientes/:clienteId/certificados')
  create(@Param('clienteId') clienteId: string, @Body() dto: CreateCertificateDto) {
    return this.certificatesService.create(clienteId, dto);
  }

  @Get('clientes/:clienteId/certificados')
  listByClient(@Param('clienteId') clienteId: string) {
    return this.certificatesService.listByClient(clienteId);
  }

  @Get('certificados/:id')
  findOne(@Param('id') id: string) {
    return this.certificatesService.findOne(id);
  }

  @Post('certificados/:id/ativar')
  activate(@Param('id') id: string) {
    return this.certificatesService.setActive(id, true);
  }

  @Post('certificados/:id/desativar')
  deactivate(@Param('id') id: string) {
    return this.certificatesService.setActive(id, false);
  }

  @Post('certificados/:id/validar')
  validate(@Param('id') id: string) {
    return this.certificatesService.validate(id);
  }

  @Delete('certificados/:id')
  remove(@Param('id') id: string) {
    return this.certificatesService.remove(id);
  }
}
