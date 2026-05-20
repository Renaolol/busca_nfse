import { Injectable, NotFoundException } from '@nestjs/common';
import { Cliente, ClienteEstabelecimento } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    dto: CreateClientDto
  ): Promise<Cliente & { estabelecimentoPrincipal: ClienteEstabelecimento }> {
    const cnpj = dto.cnpj.replace(/\D/g, '');

    return this.prisma.$transaction(async (tx) => {
      const client = await tx.cliente.create({
        data: {
          razaoSocial: dto.razaoSocial,
          nomeFantasia: dto.nomeFantasia,
          cnpj,
          emailResponsavel: dto.emailResponsavel,
          telefone: dto.telefone,
          ativo: dto.ativo ?? true
        }
      });

      const estabelecimentoPrincipal = await tx.clienteEstabelecimento.create({
        data: {
          clienteId: client.id,
          cnpj,
          razaoSocial: dto.razaoSocial,
          inscricaoMunicipal: dto.inscricaoMunicipal,
          ativo: true
        }
      });

      return {
        ...client,
        estabelecimentoPrincipal
      };
    });
  }

  async findAll(): Promise<Cliente[]> {
    return this.prisma.cliente.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string): Promise<Cliente> {
    const client = await this.prisma.cliente.findUnique({ where: { id } });
    if (!client) {
      throw new NotFoundException('Cliente nao encontrado');
    }
    return client;
  }

  async update(id: string, dto: UpdateClientDto): Promise<Cliente> {
    await this.findOne(id);

    const cnpjNormalizado = dto.cnpj?.replace(/\D/g, '');

    return this.prisma.$transaction(async (tx) => {
      const updatedClient = await tx.cliente.update({
        where: { id },
        data: {
          razaoSocial: dto.razaoSocial,
          cnpj: cnpjNormalizado,
          nomeFantasia: dto.nomeFantasia,
          emailResponsavel: dto.emailResponsavel,
          telefone: dto.telefone,
          ativo: dto.ativo
        }
      });

      const principalEstablishment = await tx.clienteEstabelecimento.findFirst({
        where: { clienteId: id },
        orderBy: { createdAt: 'asc' }
      });

      if (principalEstablishment) {
        await tx.clienteEstabelecimento.update({
          where: { id: principalEstablishment.id },
          data: {
            cnpj: cnpjNormalizado,
            razaoSocial: dto.razaoSocial,
            inscricaoMunicipal: dto.inscricaoMunicipal
          }
        });
      }

      return updatedClient;
    });
  }

  async setActive(id: string, ativo: boolean): Promise<Cliente> {
    await this.findOne(id);
    return this.prisma.cliente.update({
      where: { id },
      data: { ativo }
    });
  }
}
