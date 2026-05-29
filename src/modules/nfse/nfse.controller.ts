import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { DownloadLoteDto } from './dto/download-lote.dto';
import { DownloadDocumentDto } from './dto/download-document.dto';
import { ImportXmlDto } from './dto/import-xml.dto';
import { QueryNfseDto } from './dto/query-nfse.dto';
import { ReprocessarXmlsDto } from './dto/reprocessar-xmls.dto';
import { NfseService } from './nfse.service';

@ApiTags('nfse')
@Controller('nfse')
export class NfseController {
  constructor(private readonly nfseService: NfseService) {}

  @Get()
  findAll(@Query() query: QueryNfseDto) {
    return this.nfseService.findAll(query);
  }

  @Get('separadas')
  findSeparated(@Query() query: QueryNfseDto) {
    return this.nfseService.findSeparated(query);
  }

  @Get(':id')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  findOne(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfseService.findOne(id, query.clienteId);
  }

  @Get(':id/xml')
  @ApiOkResponse({ type: DownloadDocumentDto })
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  getXml(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfseService.getXml(id, query.clienteId);
  }

  @Get(':id/danfse')
  @ApiOkResponse({ type: DownloadDocumentDto })
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para acesso ao documento' })
  getDanfse(@Param('id') id: string, @Query() query: ClienteScopeQueryDto) {
    return this.nfseService.getDanfse(id, query.clienteId);
  }

  @Post('importar-xml')
  importXml(@Body() dto: ImportXmlDto) {
    return this.nfseService.importXml(dto);
  }

  @Post('download-lote')
  downloadLote(@Body() dto: DownloadLoteDto) {
    return this.nfseService.downloadLote(dto);
  }

  @Post('reprocessar-xmls')
  reprocessarXmls(@Body() dto: ReprocessarXmlsDto) {
    return this.nfseService.reprocessarXmls(dto);
  }
}
