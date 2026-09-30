import { BadRequestException, ConflictException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { PrismaService } from '../../../prisma/prisma.service';
import { SimplesNacionalPlanilhaParserService } from '../simples-nacional-planilha-parser.service';
import { SimplesNacionalService } from '../simples-nacional.service';

describe('SimplesNacionalService', () => {
  let service: SimplesNacionalService;
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    simplesNacionalImportacao: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
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

  const registroImportacao = (dados: Record<string, unknown> = {}) => ({
    id: '550e8400-e29b-41d4-a716-446655440200',
    nomeArquivo: 'empresas.csv',
    status: 'processando',
    layout: null,
    colunaCnpj: null,
    colunaRazaoSocial: null,
    colunaOpcao: null,
    linhasProcessadas: 0,
    totalLinhas: 0,
    totalEmpresas: 0,
    totalIgnoradas: 0,
    totalDuplicadas: 0,
    totalNaoOptantes: 0,
    linhasIgnoradas: null,
    mensagem: null,
    usuarioId: authUser.userId,
    usuarioNome: 'Renan',
    createdAt: new Date('2026-09-30T12:00:00.000Z'),
    updatedAt: new Date('2026-09-30T12:00:00.000Z'),
    concluidoEm: null,
    ...dados
  });

  const arquivo = (texto: string) => Readable.from([Buffer.from(texto, 'utf-8')]);

  async function importar(nomeArquivo: string, conteudo: string) {
    const result = await service.iniciarImportacao(arquivo(conteudo), nomeArquivo, authUser);
    await service.aguardarImportacaoEmAndamento();
    return result;
  }

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (arg: unknown) =>
        typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[])
      ),
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      simplesNacionalImportacao: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(registroImportacao()),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      simplesNacionalEmpresa: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      }
    };

    service = new SimplesNacionalService(prisma as unknown as PrismaService, new SimplesNacionalPlanilhaParserService());
  });

  it('recebe o arquivo, responde em processamento e grava a nova tabela em segundo plano', async () => {
    const result = await importar(
      'empresas.csv',
      'CNPJ;Razao Social\n11222333000181;PADARIA\n11222333000262;PADARIA FILIAL\n04252011000110;OFICINA\nxx;INVALIDA\n'
    );

    expect(result).toEqual(expect.objectContaining({ status: 'processando', nomeArquivo: 'empresas.csv', importadoPor: 'Renan' }));
    expect(prisma.simplesNacionalImportacao.deleteMany).toHaveBeenCalledWith({ where: { status: 'erro' } });
    expect(prisma.simplesNacionalImportacao.create).toHaveBeenCalledWith({
      data: { nomeArquivo: 'empresas.csv', status: 'processando', usuarioId: authUser.userId, usuarioNome: 'Renan' }
    });
    expect(prisma.simplesNacionalEmpresa.deleteMany).toHaveBeenCalledWith({});
    expect(prisma.simplesNacionalEmpresa.createMany).toHaveBeenCalledWith({
      data: [
        { cnpjBase: '11222333', cnpj: '11222333000181', razaoSocial: 'PADARIA', linhaOrigem: 2 },
        { cnpjBase: '04252011', cnpj: '04252011000110', razaoSocial: 'OFICINA', linhaOrigem: 4 }
      ],
      skipDuplicates: true
    });
    expect(prisma.simplesNacionalImportacao.deleteMany).toHaveBeenCalledWith({
      where: { id: { not: '550e8400-e29b-41d4-a716-446655440200' } }
    });
    expect(prisma.simplesNacionalImportacao.update).toHaveBeenCalledWith({
      where: { id: '550e8400-e29b-41d4-a716-446655440200' },
      data: expect.objectContaining({
        status: 'concluida',
        layout: 'planilha',
        colunaCnpj: 'CNPJ',
        colunaRazaoSocial: 'Razao Social',
        totalLinhas: 4,
        totalEmpresas: 2,
        totalIgnoradas: 1,
        totalDuplicadas: 1,
        totalNaoOptantes: 0,
        linhasIgnoradas: [{ linha: 5, valor: 'xx', motivo: 'CNPJ invalido' }]
      })
    });
  });

  it('conta como repetidas as raizes que ja estavam em lotes anteriores', async () => {
    prisma.simplesNacionalEmpresa.createMany.mockResolvedValue({ count: 1 });

    await importar('empresas.csv', 'CNPJ\n11222333000181\n04252011000110\n');

    expect(prisma.simplesNacionalImportacao.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ totalEmpresas: 1, totalDuplicadas: 1 }) })
    );
  });

  it('grava so as empresas com opcao S do arquivo Simples da Receita', async () => {
    const csv = ['"11222333";"S";"20180101";"00000000";"N";"00000000";"00000000"', '"04252011";"N";"20180101";"20240101";"N";"00000000";"00000000"'].join('\n');

    await importar('Simples.csv', csv);

    expect(prisma.simplesNacionalEmpresa.createMany).toHaveBeenCalledWith({
      data: [{ cnpjBase: '11222333', cnpj: null, razaoSocial: null, linhaOrigem: 1 }],
      skipDuplicates: true
    });
    expect(prisma.simplesNacionalImportacao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'concluida', layout: 'receita_simples', totalEmpresas: 1, totalNaoOptantes: 1 })
      })
    );
  });

  it('marca erro e mantem a tabela atual quando a planilha nao tem CNPJ valido', async () => {
    await importar('empresas.csv', 'CNPJ\n123\nabc\n');

    expect(prisma.simplesNacionalImportacao.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'concluida' }) })
    );
    expect(prisma.simplesNacionalImportacao.update).toHaveBeenCalledWith({
      where: { id: '550e8400-e29b-41d4-a716-446655440200' },
      data: {
        status: 'erro',
        mensagem: 'Nenhum CNPJ valido encontrado na coluna "CNPJ". A tabela atual foi mantida.',
        linhasProcessadas: 2
      }
    });
  });

  it('marca erro quando o arquivo nao tem coluna de CNPJ', async () => {
    await importar('empresas.csv', 'Nome;Cidade\nPADARIA;Cascavel\n');

    expect(prisma.simplesNacionalImportacao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'erro', mensagem: expect.stringContaining('coluna de CNPJ') })
      })
    );
  });

  it('rejeita extensao nao suportada sem criar importacao', async () => {
    await expect(service.iniciarImportacao(arquivo('x'), 'empresas.pdf', authUser)).rejects.toThrow(BadRequestException);
    expect(prisma.simplesNacionalImportacao.create).not.toHaveBeenCalled();
  });

  it('rejeita arquivo vazio', async () => {
    await expect(service.iniciarImportacao(Readable.from([]), 'empresas.csv', authUser)).rejects.toThrow('vazio');
    expect(prisma.simplesNacionalImportacao.create).not.toHaveBeenCalled();
  });

  it('bloqueia nova importacao enquanto outra esta em processamento', async () => {
    prisma.simplesNacionalImportacao.findFirst.mockResolvedValue(registroImportacao());

    await expect(service.iniciarImportacao(arquivo('CNPJ\n11222333000181\n'), 'empresas.csv', authUser)).rejects.toThrow(
      ConflictException
    );
    expect(prisma.simplesNacionalImportacao.create).not.toHaveBeenCalled();
  });

  it('libera importacoes que pararam de enviar progresso', async () => {
    await service.getResumo();

    expect(prisma.simplesNacionalImportacao.updateMany).toHaveBeenCalledWith({
      where: { status: 'processando', updatedAt: { lt: expect.any(Date) } },
      data: { status: 'erro', mensagem: expect.stringContaining('interrompida') }
    });
  });

  it('retorna a tabela ativa e a tentativa mais recente', async () => {
    prisma.simplesNacionalImportacao.findFirst
      .mockResolvedValueOnce(registroImportacao({ status: 'concluida', totalEmpresas: 24000000 }))
      .mockResolvedValueOnce(
        registroImportacao({ id: 'nova', status: 'processando', linhasProcessadas: 1500000, createdAt: new Date('2026-09-30T13:00:00.000Z') })
      );

    const result = await service.getResumo();

    expect(result.totalEmpresas).toBe(24000000);
    expect(result.ultimaImportacao).toEqual(expect.objectContaining({ status: 'concluida' }));
    expect(result.ultimaTentativa).toEqual(expect.objectContaining({ id: 'nova', status: 'processando', linhasProcessadas: 1500000 }));
  });

  it('ignora tentativa com erro anterior a tabela ativa', async () => {
    prisma.simplesNacionalImportacao.findFirst
      .mockResolvedValueOnce(registroImportacao({ status: 'concluida', createdAt: new Date('2026-09-30T13:00:00.000Z') }))
      .mockResolvedValueOnce(registroImportacao({ id: 'antiga', status: 'erro' }));

    const result = await service.getResumo();

    expect(result.ultimaTentativa).toBeNull();
  });

  it('consulta CNPJ de filial pela raiz cadastrada', async () => {
    prisma.simplesNacionalEmpresa.findUnique.mockResolvedValue({
      cnpjBase: '11222333',
      cnpj: '11222333000181',
      razaoSocial: 'PADARIA',
      linhaOrigem: 2
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

  it('filtra as raizes optantes em lote', async () => {
    prisma.simplesNacionalEmpresa.findMany.mockResolvedValue([{ cnpjBase: '11222333' }]);

    const result = await service.filtrarBasesOptantes(['11222333000181', '11.222.333/0002-62', '04252011000110', '']);

    expect(prisma.simplesNacionalEmpresa.findMany).toHaveBeenCalledWith({
      where: { cnpjBase: { in: ['11222333', '04252011'] } },
      select: { cnpjBase: true }
    });
    expect(result).toEqual(['11222333']);
  });

  const empresa = (cnpjBase: string, razaoSocial: string | null = null) => ({
    cnpjBase,
    cnpj: null,
    razaoSocial,
    linhaOrigem: 1
  });

  it.each([
    ['11.222.333/0001-81', '11222333'],
    ['11222333000181', '11222333'],
    ['4252011000110', '04252011'],
    ['41273589', '41273589']
  ])('busca por CNPJ ou raiz "%s" direto na chave primaria', async (busca, cnpjBase) => {
    prisma.simplesNacionalEmpresa.findMany.mockResolvedValue([empresa(cnpjBase)]);

    const result = await service.listEmpresas({ busca, page: 1, pageSize: 50 });

    expect(prisma.simplesNacionalEmpresa.findMany).toHaveBeenCalledWith({
      where: { cnpjBase },
      orderBy: { cnpjBase: 'asc' },
      skip: 0,
      take: 51
    });
    expect(prisma.simplesNacionalEmpresa.count).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [{ cnpjBase, cnpj: null, razaoSocial: null, linhaOrigem: 1 }],
      total: null,
      page: 1,
      pageSize: 50,
      totalPages: null,
      temMais: false
    });
  });

  it('busca pelo inicio da raiz usando faixa na chave primaria e indica proxima pagina', async () => {
    prisma.simplesNacionalEmpresa.findMany.mockResolvedValue([empresa('11200001'), empresa('11200002'), empresa('11200003')]);

    const result = await service.listEmpresas({ busca: '112', page: 2, pageSize: 2 });

    expect(prisma.simplesNacionalEmpresa.findMany).toHaveBeenCalledWith({
      where: { cnpjBase: { gte: '11200000', lte: '11299999' } },
      orderBy: { cnpjBase: 'asc' },
      skip: 2,
      take: 3
    });
    expect(result.items.map((item) => item.cnpjBase)).toEqual(['11200001', '11200002']);
    expect(result.temMais).toBe(true);
  });

  it.each([
    ['Adelar', 'adelar:*'],
    ['José da Silva', 'jose:* & da & silva:*'],
    ['113.387.678-10', '11338767810:*'],
    ['IRENILDA OLIVEIRA SILVA 11338767810', 'irenilda:* & oliveira:* & silva:* & 11338767810:*']
  ])('busca por nome "%s" no indice de texto com a consulta %s', async (busca, consulta) => {
    prisma.$queryRaw.mockResolvedValueOnce([{}]).mockResolvedValueOnce([empresa('41273589', 'IRENILDA OLIVEIRA SILVA 11338767810')]);

    const result = await service.listEmpresas({ busca, page: 3, pageSize: 10 });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000 });
    const [configuracao, valoresConfiguracao] = prisma.$queryRaw.mock.calls[0];
    expect(configuracao.join('?')).toContain("set_config('enable_seqscan', 'off', true)");
    expect(valoresConfiguracao).toBe('20000');
    const [sql, ...valores] = prisma.$queryRaw.mock.calls[1];
    expect(sql.join('?')).toContain("simples_nacional_nome_tsvector(razao_social) @@ to_tsquery('simple', ?)");
    expect(valores).toEqual([consulta, 11, 20]);
    expect(prisma.simplesNacionalEmpresa.findMany).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ total: null, temMais: false, items: [expect.objectContaining({ cnpjBase: '41273589' })] })
    );
  });

  it('pede ao menos 2 letras na busca por nome', async () => {
    await expect(service.listEmpresas({ busca: 'a' })).rejects.toThrow('ao menos 2 letras');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('traduz o tempo limite do banco em mensagem para refinar a busca', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('Raw query failed. Code: `57014`. ERROR: canceling statement due to statement timeout'));

    await expect(service.listEmpresas({ busca: 'silva' })).rejects.toThrow('A busca demorou demais');
  });

  it('usa o total gravado na importacao ao listar sem filtro', async () => {
    prisma.simplesNacionalEmpresa.findMany.mockResolvedValue([]);
    prisma.simplesNacionalImportacao.findFirst.mockResolvedValue({ totalEmpresas: 24000000 });

    const result = await service.listEmpresas({});

    expect(prisma.simplesNacionalEmpresa.count).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ total: 24000000, totalPages: 480000, temMais: true }));
  });

  it('atualiza as estatisticas da tabela depois de importar', async () => {
    await importar('empresas.csv', 'CNPJ\n11222333000181\n');

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0][0].join('')).toBe('ANALYZE simples_nacional_empresas');
  });

  it('remove a tabela inteira', async () => {
    prisma.simplesNacionalEmpresa.deleteMany.mockResolvedValue({ count: 2 });
    prisma.simplesNacionalImportacao.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.limpar()).resolves.toEqual({ removidas: 2 });
  });

  it('nao remove a tabela durante uma importacao', async () => {
    prisma.simplesNacionalImportacao.findFirst.mockResolvedValue(registroImportacao());

    await expect(service.limpar()).rejects.toThrow(ConflictException);
    expect(prisma.simplesNacionalEmpresa.deleteMany).not.toHaveBeenCalled();
  });
});
