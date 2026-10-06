import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { ClienteEstabelecimento } from '@prisma/client';
import { CEP_LOOKUP_CLIENT, CepLookupClient, CepLookupResult } from '../../integrations/cep-lookup/cep-lookup.types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEstablishmentDto } from './dto/create-establishment.dto';
import { UpdateEstablishmentDto } from './dto/update-establishment.dto';

@Injectable()
export class EstablishmentsService {
  private readonly logger = new Logger(EstablishmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CEP_LOOKUP_CLIENT) private readonly cepLookupClient: CepLookupClient
  ) {}

  async create(clienteId: string, dto: CreateEstablishmentDto): Promise<ClienteEstabelecimento> {
    try {
      return await this.prisma.clienteEstabelecimento.create({
        data: {
          clienteId,
          cnpj: dto.cnpj,
          razaoSocial: dto.razaoSocial,
          inscricaoMunicipal: dto.inscricaoMunicipal,
          logradouro: dto.logradouro,
          bairro: dto.bairro,
          cep: this.normalizeCep(dto.cep),
          uf: this.normalizeUf(dto.uf),
          municipioCodigoIbge: dto.municipioCodigoIbge,
          municipioNome: dto.municipioNome,
          ativo: dto.ativo ?? true
        }
      });
    } catch (error) {
      if (this.isPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('Ja existe um estabelecimento deste cliente com esse CNPJ');
      }
      if (this.isPrismaErrorCode(error, 'P2003')) {
        throw new NotFoundException('Cliente nao encontrado para vincular o estabelecimento');
      }
      this.logger.error(`Falha inesperada ao cadastrar estabelecimento do cliente ${clienteId}`, this.errorStack(error));
      throw error;
    }
  }

  async lookupCep(rawCep: string) {
    const cep = this.normalizeCep(rawCep);
    if (!cep || cep.length !== 8) {
      throw new BadRequestException('Informe um CEP com 8 digitos');
    }

    let address: CepLookupResult | null;
    try {
      address = await this.cepLookupClient.lookup(cep);
    } catch (error) {
      this.logger.warn(`Falha na consulta do CEP: ${this.errorMessage(error)}`);
      throw new ServiceUnavailableException('Nao foi possivel consultar o CEP agora. Tente novamente.');
    }
    if (!address) throw new NotFoundException('CEP nao localizado');
    return address;
  }

  async listByClient(clienteId: string): Promise<ClienteEstabelecimento[]> {
    return this.prisma.clienteEstabelecimento.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async update(id: string, dto: UpdateEstablishmentDto, clienteId: string): Promise<ClienteEstabelecimento> {
    const found = await this.prisma.clienteEstabelecimento.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('Estabelecimento nao encontrado');
    }
    if (found.clienteId !== clienteId) {
      throw new NotFoundException('Estabelecimento nao encontrado');
    }

    return this.prisma.clienteEstabelecimento.update({
      where: { id },
      data: {
        ...dto,
        cep: this.normalizeCep(dto.cep),
        uf: this.normalizeUf(dto.uf)
      }
    });
  }

  private normalizeUf(value?: string | null): string | undefined {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized || undefined;
  }

  private normalizeCep(value?: string | null): string | undefined {
    const normalized = String(value || '').replace(/\D/g, '').slice(0, 8);
    return normalized || undefined;
  }

  private isPrismaErrorCode(error: unknown, code: string): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private errorStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }
}
