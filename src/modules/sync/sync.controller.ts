import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { SyncService } from './sync.service';
import { TestSingleNsuDto } from './dto/test-single-nsu.dto';
import { StartSyncDto } from './dto/start-sync.dto';

@ApiTags('sync')
@Controller()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('clientes/:clienteId/sync/iniciar')
  iniciar(@Param('clienteId') clienteId: string, @Body() dto: StartSyncDto) {
    return this.syncService.iniciarSync(clienteId, dto);
  }

  @Post('clientes/:clienteId/sync/pausar')
  pausar(@Param('clienteId') clienteId: string) {
    return this.syncService.pausarSync(clienteId);
  }

  @Post('clientes/:clienteId/sync/retomar')
  retomar(@Param('clienteId') clienteId: string) {
    return this.syncService.retomarSync(clienteId);
  }

  @Get('clientes/:clienteId/sync/status')
  status(@Param('clienteId') clienteId: string) {
    return this.syncService.statusSync(clienteId);
  }

  @Post('sync/rodar-agora')
  runNow() {
    return this.syncService.runNow();
  }

  @Post('sync/testar-nsu')
  testSingleNsu(@Body() dto: TestSingleNsuDto) {
    return this.syncService.testSingleNsu(dto);
  }

  @Get('sync/logs')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para leitura de logs' })
  logs(@Query() query: ClienteScopeQueryDto) {
    return this.syncService.listLogs(query.clienteId);
  }
}
