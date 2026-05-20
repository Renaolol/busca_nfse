import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
  findOne(@Param('id') id: string) {
    return this.nfseService.findOne(id);
  }

  @Get(':id/xml')
  @ApiOkResponse({ type: DownloadDocumentDto })
  getXml(@Param('id') id: string) {
    return this.nfseService.getXml(id);
  }

  @Get(':id/danfse')
  @ApiOkResponse({ type: DownloadDocumentDto })
  getDanfse(@Param('id') id: string) {
    return this.nfseService.getDanfse(id);
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
