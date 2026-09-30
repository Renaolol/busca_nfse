import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnsupportedMediaTypeException
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiParam,
  ApiTags
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantScope } from '../auth/decorators/tenant-scope.decorator';
import { AuthenticatedRequest } from '../auth/auth.types';
import { ConsultarSimplesNacionalLoteDto } from './dto/consultar-simples-nacional-lote.dto';
import { ImportarSimplesNacionalQueryDto } from './dto/importar-simples-nacional.dto';
import { ListSimplesNacionalEmpresasQueryDto } from './dto/list-simples-nacional-empresas-query.dto';
import {
  SimplesNacionalConsultaDto,
  SimplesNacionalConsultaLoteRespostaDto,
  SimplesNacionalEmpresasPageDto,
  SimplesNacionalImportacaoDto,
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

  @Post('consultas')
  @HttpCode(200)
  @Roles('admin', 'comum', 'cliente')
  @TenantScope({ source: 'body', key: 'clienteId', injectWhenMissing: true })
  @ApiOkResponse({ type: SimplesNacionalConsultaLoteRespostaDto })
  async consultarLote(@Body() dto: ConsultarSimplesNacionalLoteDto): Promise<SimplesNacionalConsultaLoteRespostaDto> {
    return { cnpjBases: await this.simplesNacionalService.filtrarBasesOptantes(dto.cnpjs) };
  }

  @Post('importacoes')
  @HttpCode(202)
  @Roles('admin')
  @ApiConsumes('application/octet-stream')
  @ApiBody({
    description: 'Conteudo bruto do arquivo (.csv, .txt, .xlsx ou .zip), ate 5 GB. O processamento continua em segundo plano.',
    schema: { type: 'string', format: 'binary' }
  })
  @ApiAcceptedResponse({ type: SimplesNacionalImportacaoDto })
  iniciarImportacao(@Req() request: Request & AuthenticatedRequest, @Query() query: ImportarSimplesNacionalQueryDto) {
    const contentType = String(request.headers['content-type'] || '').toLowerCase();
    if (/json|form/.test(contentType)) {
      throw new UnsupportedMediaTypeException('Envie o arquivo com Content-Type application/octet-stream.');
    }

    return this.simplesNacionalService.iniciarImportacao(request, query.nomeArquivo, request.authUser);
  }

  @Delete('empresas')
  @Roles('admin')
  @ApiOkResponse({ type: SimplesNacionalLimpezaDto })
  limpar() {
    return this.simplesNacionalService.limpar();
  }
}
