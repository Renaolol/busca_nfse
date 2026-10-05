import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { ConfigureNfceScSyncDto } from './dto/configure-nfce-sc-sync.dto';
import { NfceScDiagnosticDownloadDto } from './dto/nfce-sc-diagnostic-download.dto';
import { NfceScRunResponseDto } from './dto/nfce-sc-run-response.dto';
import { NfceScService } from './nfce-sc.service';

class NfceScControlsQuery {
  @ApiProperty()
  @IsUUID()
  clienteId!: string;
}

@ApiTags('nfce-sc')
@Controller('nfce-sc')
export class NfceScController {
  constructor(private readonly service: NfceScService) {}

  @Get('controles')
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  @ApiOperation({
    summary: 'Lista os controles NFC-e SC',
    description: 'O campo status inclui processando enquanto o backend percorre automaticamente os lotes da SEF/SC.'
  })
  list(@Query() query: NfceScControlsQuery) {
    return this.service.listControls(query.clienteId);
  }

  @Get('controles/:id/diagnostico')
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  @ApiOperation({
    summary: 'Baixa os XMLs de diagnostico da ultima resposta NFC-e SC cStat 9999',
    description: 'O ZIP contem os envelopes SOAP de requisicao e resposta, capturados somente em respostas cStat 9999.'
  })
  @ApiOkResponse({ type: NfceScDiagnosticDownloadDto })
  downloadErrorDiagnostic(@Param('id') id: string, @Query() query: NfceScControlsQuery) {
    return this.service.downloadErrorDiagnostic(query.clienteId, id);
  }

  @Get('documentos')
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  listDocuments(@Query() query: NfceScControlsQuery) {
    return this.service.listDocuments(query.clienteId);
  }

  @Post('controles')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  configure(@Body() dto: ConfigureNfceScSyncDto) {
    return this.service.configure(dto);
  }

  @Post('controles/:id/rodar-agora')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Inicia a sincronizacao NFC-e SC e continua automaticamente enquanto houver lotes completos' })
  @ApiAcceptedResponse({ type: NfceScRunResponseDto })
  run(@Param('id') id: string, @Body() body: NfceScControlsQuery) {
    return this.service.run(body.clienteId, id);
  }

  @Post('controles/:id/pausar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  pause(@Param('id') id: string, @Body() body: NfceScControlsQuery) {
    return this.service.pause(body.clienteId, id);
  }
}
