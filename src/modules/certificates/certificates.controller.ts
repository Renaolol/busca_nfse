import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { CertificatesService } from './certificates.service';

@ApiTags('certificados')
@Controller()
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Post('clientes/:clienteId/certificados')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  create(@Param('clienteId') clienteId: string, @Body() dto: CreateCertificateDto) {
    return this.certificatesService.create(clienteId, dto);
  }

  @Get('clientes/:clienteId/certificados')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  listByClient(@Param('clienteId') clienteId: string) {
    return this.certificatesService.listByClient(clienteId);
  }

  @Get('certificados/:id')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao certificado' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  findOne(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.certificatesService.findOne(id, query.clienteId);
  }

  @Post('certificados/:id/ativar')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao certificado' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  activate(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.certificatesService.setActive(id, true, query.clienteId);
  }

  @Post('certificados/:id/desativar')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao certificado' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  deactivate(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.certificatesService.setActive(id, false, query.clienteId);
  }

  @Post('certificados/:id/validar')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao certificado' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  validate(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.certificatesService.validate(id, query.clienteId);
  }

  @Delete('certificados/:id')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao certificado' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  remove(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.certificatesService.remove(id, query.clienteId);
  }
}
