import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SimplesNacionalPlanilhaParserService } from '../simples-nacional-planilha-parser.service';
import { SimplesNacionalService } from '../simples-nacional.service';

describe('SimplesNacionalService', () => {
  let service: SimplesNacionalService;
  let prisma: {
    $transaction: jest.Mock;
    simplesNacionalImportacao: {
      findFirst: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };
    simplesNacionalEmpresa: {
      count: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      createMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  const authUser = {
    userId: '550e8400-e29b-41d4-a716-446655440100',
    username: 'renan',
    nome: 'Renan',
    role: 'admin' as const,
    sessionId: '550e8400-e29b-41d4-a716-446655440101',
    sessionExpiresAt: '2026-09-30T18:00:00.000Z'
  };

  const importacaoRegistro = {
    id: '550e8400-e29b-41d4-a716-446655440200',
    nomeArquivo: 'empresas.csv',
    totalLinhas: 3,
    totalEmpresas: 2,
    totalIgnoradas: 1,
    totalDuplicadas: 0,
    usuarioId: authUser.userId,
    usuarioNome: 'Renan',
    createdAt: new Date('2026-09-30T12:00:00.000Z')
  };

  const toBase64 = (texto: string) => Buffer.from(texto, 'utf-8').toString('base64');

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (operacoes: Promise<unknown>[]) => Promise.all(operacoes)),
      simplesNacionalImportacao: {
        findFirst: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn()
      },
      simplesNacionalEmpresa: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        createMany: jest.fn(),
        deleteMany: jest.fn()
      }
    };

    service = new SimplesNacionalService(
      prisma as unknown as PrismaService,
      new SimplesNacionalPlanilhaParserService()
    );
  });

  it('substitui a tabela anterior ao importar uma nova planilha', async () => {
    prisma.simplesNacionalImportacao.deleteMany.mockResolvedValue({ count: 1 });
    prisma.simplesNacionalImportacao.create.mockResolvedValue(importacaoRegistro);
    prisma.simplesNacionalEmpresa.createMany.mockResolvedValue({ count: 2 });

    const result = await service.importar(
      {
        nomeArquivo: 'empresas.csv',
        arquivoBase64: toBase64('CNPJ;Razao Social\n11222333000181;PADARIA\n04252011000110;OFICINA\nxx;INVALIDA\n')
      },
      authUser
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.simplesNacionalImportacao.deleteMany).toHaveBeenCalledWith({});
    const importacaoId = prisma.simplesNacionalImportacao.create.mock.calls[0][0].data.id;
    expect(prisma.simplesNacionalImportacao.create).toHaveBeenCalledWith({
      data: {
        id: importacaoId,
        nomeArquivo: 'empresas.csv',
        totalLinhas: 3,
        totalEmpresas: 2,
        totalIgnoradas: 1,
        totalDuplicadas: 0,
        usuarioId: authUser.userId,
        usuarioNome: 'Renan'
      }
    });
    expect(prisma.simplesNacionalEmpresa.createMany).toHaveBeenCalledWith({
      data: [
        { importacaoId, cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'PADARIA', linhaOrigem: 2 },
        { importacaoId, cnpjBase: '04252011', cnpj: '04252011000110', razaoSocial: 'OFICINA', linhaOrigem: 3 }
      ]
    });
    expect(result).toEqual({
      importacao: {
        id: importacaoRegistro.id,
        nomeArquivo: 'empresas.csv',
        importadoEm: '2026-09-30T12:00:00.000Z',
        importadoPor: 'Renan',
        totalLinhas: 3,
        totalEmpresas: 2,
        totalIgnoradas: 1,
        totalDuplicadas: 0
      },
      colunaCnpj: 'CNPJ',
      colunaRazaoSocial: 'Razao Social',
      linhasIgnoradas: [{ linha: 4, valor: 'xx', motivo: 'CNPJ invalido' }]
    });
  });

  it('grava empresas em lotes para planilhas grandes', async () => {
    const linhas = ['CNPJ'];
    for (let indice = 1; indice <= 2500; indice += 1) {
      linhas.push(String(indice).padStart(8, '0'));
    }
    prisma.simplesNacionalImportacao.create.mockResolvedValue({ ...importacaoRegistro, totalEmpresas: 2500 });

    await service.importar({ nomeArquivo: 'raizes.csv', arquivoBase64: toBase64(linhas.join('\n')) }, authUser);

    expect(prisma.simplesNacionalEmpresa.createMany).toHaveBeenCalledTimes(3);
    expect(prisma.simplesNacionalEmpresa.createMany.mock.calls.map(([args]) => args.data.length)).toEqual([
      1000, 1000, 500
    ]);
  });

  it('mantem a tabela atual quando a planilha nao tem CNPJ valido', async () => {
    await expect(
      service.importar({ nomeArquivo: 'empresas.csv', arquivoBase64: toBase64('CNPJ\n123\nabc\n') }, authUser)
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita conteudo que nao esta em Base64', async () => {
    await expect(
      service.importar({ nomeArquivo: 'empresas.csv', arquivoBase64: '###' }, authUser)
    ).rejects.toThrow('Base64');
  });

  it('consulta CNPJ de filial pela raiz cadastrada', async () => {
    prisma.simplesNacionalEmpresa.findUnique.mockResolvedValue({
      id: 'empresa-1',
      importacaoId: importacaoRegistro.id,
      cnpjBase: '11222333',
      cnpj: '11222333000181',
      razaoSocial: 'PADARIA',
      linhaOrigem: 2,
      createdAt: new Date('2026-09-30T12:00:00.000Z')
    });

    const result = await service.consultarCnpj('11.222.333/0002-62');

    expect(prisma.simplesNacionalEmpresa.findUnique).toHaveBeenCalledWith({ where: { cnpjBase: '11222333' } });
    expect(result).toEqual({
      cnpj: '11222333000262',
      cnpjBase: '11222333',
      optante: true,
      empresa: { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'PADARIA', linhaOrigem: 2 }
    });
  });

  it('informa nao optante quando a raiz nao esta na tabela', async () => {
    prisma.simplesNacionalEmpresa.findUnique.mockResolvedValue(null);

    const result = await service.consultarCnpj('04252011000110');

    expect(result).toEqual({ cnpj: '04252011000110', cnpjBase: '04252011', optante: false, empresa: null });
  });

  it('rejeita consulta com CNPJ mal formatado', async () => {
    await expect(service.consultarCnpj('123')).rejects.toThrow(BadRequestException);
    expect(prisma.simplesNacionalEmpresa.findUnique).not.toHaveBeenCalled();
  });

  it('filtra os CNPJs optantes em lote', async () => {
    prisma.simplesNacionalEmpresa.findMany.mockResolvedValue([{ cnpjBase: '11222333' }]);

    const result = await service.filtrarOptantes(['11222333000181', '11.222.333/0002-62', '04252011000110', '']);

    expect(prisma.simplesNacionalEmpresa.findMany).toHaveBeenCalledWith({
      where: { cnpjBase: { in: ['11222333', '04252011'] } },
      select: { cnpjBase: true }
    });
    expect([...result]).toEqual(['11222333000181', '11222333000262']);
  });

  it('lista empresas paginadas filtrando por CNPJ ou razao social', async () => {
    prisma.simplesNacionalEmpresa.count.mockResolvedValue(51);
    prisma.simplesNacionalEmpresa.findMany.mockResolvedValue([]);

    const result = await service.listEmpresas({ busca: '11.222', page: 2, pageSize: 50 });

    const where = {
      OR: [
        { razaoSocial: { contains: '11.222', mode: 'insensitive' } },
        { cnpj: { contains: '11222' } },
        { cnpjBase: { contains: '11222' } }
      ]
    };
    expect(prisma.simplesNacionalEmpresa.count).toHaveBeenCalledWith({ where });
    expect(prisma.simplesNacionalEmpresa.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ razaoSocial: 'asc' }, { cnpjBase: 'asc' }],
      skip: 50,
      take: 50
    });
    expect(result).toEqual({ items: [], total: 51, page: 2, pageSize: 50, totalPages: 2 });
  });

  it('retorna resumo com a ultima importacao', async () => {
    prisma.simplesNacionalEmpresa.count.mockResolvedValue(2);
    prisma.simplesNacionalImportacao.findFirst.mockResolvedValue(importacaoRegistro);

    const result = await service.getResumo();

    expect(result.totalEmpresas).toBe(2);
    expect(result.ultimaImportacao).toEqual(expect.objectContaining({ nomeArquivo: 'empresas.csv', importadoPor: 'Renan' }));
  });

  it('remove a tabela inteira', async () => {
    prisma.simplesNacionalEmpresa.deleteMany.mockResolvedValue({ count: 2 });
    prisma.simplesNacionalImportacao.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.limpar()).resolves.toEqual({ removidas: 2 });
  });
});
