import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { CertificateScopeQueryDto } from './dto/certificate-scope-query.dto';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { DownloadCertificateDto } from './dto/download-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';
import { UpdateCertificateNotesDto } from './dto/update-certificate-notes.dto';
import { CertificatesService } from './certificates.service';

@ApiTags('certificados')
@Controller()
export class CertificatesController {
  constructor(private readonly certificatesService: CertificatesService) {}

  @Post('certificados')
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  createStandalone(@Body() dto: CreateCertificateDto) {
    return this.certificatesService.create(dto.clienteId, dto);
  }

  @Post('clientes/:clienteId/certificados')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  create(@Param('clienteId') clienteId: string, @Body() dto: CreateCertificateDto) {
    return this.certificatesService.create(clienteId, dto);
  }

  @Get('certificados')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Filtro opcional por cliente. Quando omitido, lista certificados vinculados e avulsos.'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  listAll(@Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.listAll(query.clienteId);
  }

  @Get('clientes/:clienteId/certificados')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  listByClient(@Param('clienteId') clienteId: string) {
    return this.certificatesService.listByClient(clienteId);
  }

  @Get('certificados/:id')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  findOne(@Param('id') id: string, @Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.findOne(id, query.clienteId);
  }

  @Post('certificados/:id/ativar')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  activate(@Param('id') id: string, @Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.setActive(id, true, query.clienteId);
  }

  @Post('certificados/:id/desativar')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  deactivate(@Param('id') id: string, @Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.setActive(id, false, query.clienteId);
  }

  @Post('certificados/:id/desvincular')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  unlink(@Param('id') id: string, @Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.unlink(id, query.clienteId);
  }

  @Post('certificados/:id/validar')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  validate(@Param('id') id: string, @Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.validate(id, query.clienteId);
  }

  @Patch('certificados/:id')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope(
    { source: 'query', key: 'clienteId', injectWhenMissing: true },
    { source: 'body', key: 'clienteId' }
  )
  update(@Param('id') id: string, @Query() query: CertificateScopeQueryDto, @Body() dto: UpdateCertificateDto) {
    return this.certificatesService.update(id, dto, query.clienteId);
  }

  @Patch('certificados/:id/anotacoes')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  updateNotes(
    @Param('id') id: string,
    @Query() query: CertificateScopeQueryDto,
    @Body() dto: UpdateCertificateNotesDto
  ) {
    return this.certificatesService.updateNotes(id, dto.anotacoes, query.clienteId);
  }

  @Get('certificados/:id/download')
  @ApiOkResponse({ type: DownloadCertificateDto })
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  download(@Param('id') id: string, @Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.download(id, query.clienteId);
  }

  @Delete('certificados/:id')
  @ApiQuery({
    name: 'clienteId',
    required: false,
    description: 'Escopo do cliente quando o certificado esta vinculado'
  })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  remove(@Param('id') id: string, @Query() query: CertificateScopeQueryDto) {
    return this.certificatesService.remove(id, query.clienteId);
  }
}
