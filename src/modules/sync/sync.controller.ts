import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClienteScopeQueryDto } from '../../common/dto/cliente-scope-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { SyncService } from './sync.service';
import { TestSingleNsuDto } from './dto/test-single-nsu.dto';
import { StartSyncDto } from './dto/start-sync.dto';

@ApiTags('sync')
@Controller()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('clientes/:clienteId/sync/iniciar')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  iniciar(@Param('clienteId') clienteId: string, @Body() dto: StartSyncDto) {
    return this.syncService.iniciarSync(clienteId, dto);
  }

  @Post('clientes/:clienteId/sync/pausar')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  pausar(@Param('clienteId') clienteId: string) {
    return this.syncService.pausarSync(clienteId);
  }

  @Post('clientes/:clienteId/sync/retomar')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  retomar(@Param('clienteId') clienteId: string) {
    return this.syncService.retomarSync(clienteId);
  }

  @Get('clientes/:clienteId/sync/status')
  @TenantScope({ source: 'params', key: 'clienteId', required: true })
  status(@Param('clienteId') clienteId: string) {
    return this.syncService.statusSync(clienteId);
  }

  @Get('sync/scheduler-status')
  schedulerStatus() {
    return this.syncService.schedulerStatus();
  }

  @Post('sync/rodar-agora')
  @Roles('admin')
  runNow() {
    return this.syncService.runNow();
  }

  @Post('sync/testar-nsu')
  @TenantScope({ source: 'body', key: 'clienteId', required: true })
  testSingleNsu(@Body() dto: TestSingleNsuDto) {
    return this.syncService.testSingleNsu(dto);
  }

  @Get('sync/logs')
  @ApiQuery({ name: 'clienteId', required: true, description: 'Escopo do cliente para leitura de logs' })
  @TenantScope({ source: 'query', key: 'clienteId', required: true })
  logs(@Query() query: ClienteScopeQueryDto) {
    return this.syncService.listLogs(query.clienteId);
  }
}
