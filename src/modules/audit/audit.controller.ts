import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuditService } from './audit.service';

@ApiTags('auditoria')
@Controller('auditoria')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Query('cliente_id') clienteId?: string, @Query('acao') acao?: string) {
    return this.auditService.list({ clienteId, acao });
  }
}
