import { Injectable, NotFoundException } from '@nestjs/common';
import { ClienteEstabelecimento } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEstablishmentDto } from './dto/create-establishment.dto';
import { UpdateEstablishmentDto } from './dto/update-establishment.dto';

@Injectable()
export class EstablishmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clienteId: string, dto: CreateEstablishmentDto): Promise<ClienteEstabelecimento> {
    return this.prisma.clienteEstabelecimento.create({
      data: {
        clienteId,
        cnpj: dto.cnpj,
        razaoSocial: dto.razaoSocial,
        inscricaoMunicipal: dto.inscricaoMunicipal,
        municipioCodigoIbge: dto.municipioCodigoIbge,
        municipioNome: dto.municipioNome,
        ativo: dto.ativo ?? true
      }
    });
  }

  async listByClient(clienteId: string): Promise<ClienteEstabelecimento[]> {
    return this.prisma.clienteEstabelecimento.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async update(id: string, dto: UpdateEstablishmentDto): Promise<ClienteEstabelecimento> {
    const found = await this.prisma.clienteEstabelecimento.findUnique({ where: { id } });
    if (!found) {
      throw new NotFoundException('Estabelecimento nao encontrado');
    }

    return this.prisma.clienteEstabelecimento.update({
      where: { id },
      data: dto
    });
  }
}
