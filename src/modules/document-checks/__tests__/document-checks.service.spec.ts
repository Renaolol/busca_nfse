import { PrismaService } from '../../../prisma/prisma.service';
import { DocumentChecksService } from '../document-checks.service';

describe('DocumentChecksService', () => {
  let service: DocumentChecksService;
  let prisma: {
    documentoConferencia: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      upsert: jest.Mock;
    };
  };

  const authUser = {
    userId: '550e8400-e29b-41d4-a716-446655440100',
    username: 'renan',
    nome: 'Renan',
    role: 'admin' as const,
    sessionId: '550e8400-e29b-41d4-a716-446655440101',
    sessionExpiresAt: '2026-08-12T18:00:00.000Z'
  };

  beforeEach(() => {
    prisma = {
      documentoConferencia: {
        findMany: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn()
      }
    };

    service = new DocumentChecksService(prisma as unknown as PrismaService);
  });

  it('lista apenas documentos conferidos do usuario autenticado', async () => {
    prisma.documentoConferencia.findMany.mockResolvedValue([
      {
        tipoDocumento: 'nfe',
        documentoId: '550e8400-e29b-41d4-a716-446655440200',
        conferido: true,
        clienteId: '550e8400-e29b-41d4-a716-446655440300',
        conferidoEm: new Date('2026-08-12T12:00:00.000Z')
      }
    ]);

    const result = await service.listForUser(authUser, {
      tipo: 'nfe',
      documentoIds: ['550e8400-e29b-41d4-a716-446655440200']
    });

    expect(prisma.documentoConferencia.findMany).toHaveBeenCalledWith({
      where: {
        usuarioId: authUser.userId,
        tipoDocumento: 'nfe',
        conferido: true,
        documentoId: {
          in: ['550e8400-e29b-41d4-a716-446655440200']
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: 1
    });
    expect(result).toEqual([
      {
        tipo: 'nfe',
        documentoId: '550e8400-e29b-41d4-a716-446655440200',
        conferido: true,
        clienteId: '550e8400-e29b-41d4-a716-446655440300',
        conferidoEm: '2026-08-12T12:00:00.000Z'
      }
    ]);
  });

  it('remove a conferencia quando o documento e desmarcado', async () => {
    prisma.documentoConferencia.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.updateForUser(authUser, {
      tipo: 'cte',
      documentoId: '550e8400-e29b-41d4-a716-446655440201',
      clienteId: '550e8400-e29b-41d4-a716-446655440301',
      conferido: false
    });

    expect(prisma.documentoConferencia.deleteMany).toHaveBeenCalledWith({
      where: {
        usuarioId: authUser.userId,
        tipoDocumento: 'cte',
        documentoId: '550e8400-e29b-41d4-a716-446655440201'
      }
    });
    expect(result).toEqual({
      tipo: 'cte',
      documentoId: '550e8400-e29b-41d4-a716-446655440201',
      conferido: false,
      clienteId: '550e8400-e29b-41d4-a716-446655440301',
      conferidoEm: null
    });
  });

  it('faz upsert da conferencia quando o documento e marcado', async () => {
    prisma.documentoConferencia.upsert.mockResolvedValue({
      tipoDocumento: 'nfse',
      documentoId: '550e8400-e29b-41d4-a716-446655440202',
      conferido: true,
      clienteId: '550e8400-e29b-41d4-a716-446655440302',
      conferidoEm: new Date('2026-08-12T13:00:00.000Z')
    });

    const result = await service.updateForUser(authUser, {
      tipo: 'nfse',
      documentoId: '550e8400-e29b-41d4-a716-446655440202',
      clienteId: '550e8400-e29b-41d4-a716-446655440302',
      conferido: true
    });

    expect(prisma.documentoConferencia.upsert).toHaveBeenCalledWith({
      where: {
        usuarioId_tipoDocumento_documentoId: {
          usuarioId: authUser.userId,
          tipoDocumento: 'nfse',
          documentoId: '550e8400-e29b-41d4-a716-446655440202'
        }
      },
      update: {
        clienteId: '550e8400-e29b-41d4-a716-446655440302',
        conferido: true,
        conferidoEm: expect.any(Date)
      },
      create: {
        usuarioId: authUser.userId,
        clienteId: '550e8400-e29b-41d4-a716-446655440302',
        tipoDocumento: 'nfse',
        documentoId: '550e8400-e29b-41d4-a716-446655440202',
        conferido: true,
        conferidoEm: expect.any(Date)
      }
    });
    expect(result).toEqual({
      tipo: 'nfse',
      documentoId: '550e8400-e29b-41d4-a716-446655440202',
      conferido: true,
      clienteId: '550e8400-e29b-41d4-a716-446655440302',
      conferidoEm: '2026-08-12T13:00:00.000Z'
    });
  });
});
