import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedRequest } from '../auth/auth.types';
import { ImportarSimplesNacionalDto } from './dto/importar-simples-nacional.dto';
import { ListSimplesNacionalEmpresasQueryDto } from './dto/list-simples-nacional-empresas-query.dto';
import {
  SimplesNacionalConsultaDto,
  SimplesNacionalEmpresasPageDto,
  SimplesNacionalImportacaoResultadoDto,
  SimplesNacionalLimpezaDto,
  SimplesNacionalResumoDto
} from './dto/simples-nacional-response.dto';
import { SimplesNacionalService } from './simples-nacional.service';

@ApiTags('simples-nacional')
@Controller('simples-nacional')
export class SimplesNacionalController {
  constructor(private readonly simplesNacionalService: SimplesNacionalService) {}

  @Get()
  @Roles('admin', 'comum')
  @ApiOkResponse({ type: SimplesNacionalResumoDto })
  getResumo() {
    return this.simplesNacionalService.getResumo();
  }

  @Get('empresas')
  @Roles('admin', 'comum')
  @ApiOkResponse({ type: SimplesNacionalEmpresasPageDto })
  listEmpresas(@Query() query: ListSimplesNacionalEmpresasQueryDto) {
    return this.simplesNacionalService.listEmpresas(query);
  }

  @Get('empresas/:cnpj')
  @Roles('admin', 'comum')
  @ApiParam({ name: 'cnpj', description: 'CNPJ completo (14) ou raiz (8), com ou sem pontuacao' })
  @ApiOkResponse({ type: SimplesNacionalConsultaDto })
  consultarCnpj(@Param('cnpj') cnpj: string) {
    return this.simplesNacionalService.consultarCnpj(cnpj);
  }

  @Post('importacoes')
  @Roles('admin')
  @ApiCreatedResponse({ type: SimplesNacionalImportacaoResultadoDto })
  importar(@Req() request: AuthenticatedRequest, @Body() dto: ImportarSimplesNacionalDto) {
    return this.simplesNacionalService.importar(dto, request.authUser);
  }

  @Delete('empresas')
  @Roles('admin')
  @ApiOkResponse({ type: SimplesNacionalLimpezaDto })
  limpar() {
    return this.simplesNacionalService.limpar();
  }
}
