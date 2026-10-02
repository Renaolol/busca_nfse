import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { ConfigureNfceScSyncDto } from './dto/configure-nfce-sc-sync.dto';
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
  list(@Query() query: NfceScControlsQuery) {
    return this.service.listControls(query.clienteId);
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
  run(@Param('id') id: string, @Body() body: NfceScControlsQuery) {
    return this.service.run(body.clienteId, id);
  }

  @Post('controles/:id/pausar')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  pause(@Param('id') id: string, @Body() body: NfceScControlsQuery) {
    return this.service.pause(body.clienteId, id);
  }
}
