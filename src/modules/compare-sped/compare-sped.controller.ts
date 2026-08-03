import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { CompareSpedHistoricoDto } from './dto/compare-sped-historico.dto';
import { ListCompareSpedHistoricoQueryDto } from './dto/list-compare-sped-historico.dto';
import { SaveCompareSpedHistoricoDto } from './dto/save-compare-sped-historico.dto';
import { CompareSpedService } from './compare-sped.service';

@ApiTags('comparacoes-sped')
@Controller('comparacoes-sped')
export class CompareSpedController {
  constructor(private readonly compareSpedService: CompareSpedService) {}

  @Get()
  @ApiOkResponse({ type: CompareSpedHistoricoDto, isArray: true })
  @TenantScope({ source: 'query', key: 'clienteId', injectWhenMissing: true })
  listHistory(@Query() query: ListCompareSpedHistoricoQueryDto) {
    return this.compareSpedService.listHistory(query);
  }

  @Post()
  @ApiCreatedResponse({ type: CompareSpedHistoricoDto })
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  saveHistory(@Body() dto: SaveCompareSpedHistoricoDto) {
    return this.compareSpedService.saveHistory(dto);
  }
}
