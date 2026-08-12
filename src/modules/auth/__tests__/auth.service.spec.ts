import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthService } from '../auth.service';
import { PasswordHashService } from '../password-hash.service';
import { PrismaService } from '../../../prisma/prisma.service';

describe('AuthService', () => {
  const originalEnv = process.env;

  let prisma: jest.Mocked<PrismaService>;
  let passwordHashService: jest.Mocked<PasswordHashService>;
  let service: AuthService;

  const baseUser = {
    id: '550e8400-e29b-41d4-a716-446655440123',
    username: 'admin',
    nome: 'Administrador',
    passwordHash: 'hash-existente',
    role: 'admin' as const,
    clienteId: null,
    ativo: true,
    ultimoLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date('2026-08-12T10:00:00.000Z'),
    updatedAt: new Date('2026-08-12T10:00:00.000Z')
  };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: 'super-secret-key-for-tests',
      JWT_EXPIRES_IN_SECONDS: '3600',
      JWT_REFRESH_EXPIRES_IN_SECONDS: '7200'
    };

    prisma = {
      usuario: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn()
      },
      sessaoUsuario: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn()
      },
      eventoAcesso: {
        create: jest.fn(),
        findMany: jest.fn()
      },
      $transaction: jest.fn(async (input: unknown) => {
        if (Array.isArray(input)) {
          return Promise.all(input as Promise<unknown>[]);
        }

        return (input as (tx: PrismaService) => Promise<unknown>)(prisma);
      })
    } as unknown as jest.Mocked<PrismaService>;

    passwordHashService = {
      verify: jest.fn(),
      hash: jest.fn()
    } as unknown as jest.Mocked<PasswordHashService>;

    service = new AuthService(prisma, passwordHashService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('gera token JWT e refresh token no login valido', async () => {
    prisma.usuario.findUnique.mockResolvedValue(baseUser as never);
    passwordHashService.verify.mockResolvedValue(true);
    prisma.sessaoUsuario.create.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: '',
      loginAt: new Date('2026-08-12T10:01:00.000Z'),
      lastSeenAt: new Date('2026-08-12T10:01:00.000Z'),
      logoutAt: null,
      expiresAt: new Date('2026-08-12T12:01:00.000Z'),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date('2026-08-12T10:01:00.000Z'),
      updatedAt: new Date('2026-08-12T10:01:00.000Z')
    } as never);
    prisma.sessaoUsuario.update.mockImplementation(async ({ where }) => ({
      id: String(where.id),
      usuarioId: baseUser.id,
      refreshTokenHash: 'hash-atualizado',
      loginAt: new Date('2026-08-12T10:01:00.000Z'),
      lastSeenAt: new Date('2026-08-12T10:01:00.000Z'),
      logoutAt: null,
      expiresAt: new Date('2026-08-12T12:01:00.000Z'),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date('2026-08-12T10:01:00.000Z'),
      updatedAt: new Date('2026-08-12T10:01:00.000Z')
    }) as never);
    prisma.usuario.update.mockResolvedValue({
      ...baseUser,
      ultimoLoginAt: new Date('2026-08-12T10:01:00.000Z')
    } as never);
    prisma.eventoAcesso.create.mockResolvedValue({ id: 'evt-1' } as never);

    const result = await service.login(
      { username: 'ADMIN', password: 'admin123' },
      { ip: '127.0.0.1', userAgent: 'jest', path: '/auth/login', method: 'POST' }
    );

    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(3600);
    expect(result.refreshExpiresIn).toBe(7200);
    expect(result.user).toEqual({
      userId: baseUser.id,
      username: 'admin',
      nome: 'Administrador',
      role: 'admin',
      clienteId: undefined,
      sessionId: '550e8400-e29b-41d4-a716-446655440124',
      sessionExpiresAt: result.sessionExpiresAt
    });
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).toMatch(/^550e8400-e29b-41d4-a716-446655440124\./);
  });

  it('rejeita credenciais invalidas', async () => {
    prisma.usuario.findUnique.mockResolvedValue(baseUser as never);
    passwordHashService.verify.mockResolvedValue(false);
    prisma.eventoAcesso.create.mockResolvedValue({ id: 'evt-2' } as never);

    await expect(
      service.login(
        { username: 'admin', password: 'senha-errada' },
        { ip: '127.0.0.1', userAgent: 'jest', path: '/auth/login', method: 'POST' }
      )
    ).rejects.toThrow(UnauthorizedException);
  });

  it('valida token de acesso ativo e extrai sessao', async () => {
    prisma.usuario.findUnique.mockResolvedValue(baseUser as never);
    passwordHashService.verify.mockResolvedValue(true);
    prisma.sessaoUsuario.create.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: '',
      loginAt: new Date(),
      lastSeenAt: new Date(),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 7200_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date(),
      updatedAt: new Date()
    } as never);
    prisma.sessaoUsuario.update.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: '',
      loginAt: new Date(),
      lastSeenAt: new Date(),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 7200_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date(),
      updatedAt: new Date()
    } as never);
    prisma.usuario.update.mockResolvedValue({
      ...baseUser,
      ultimoLoginAt: new Date()
    } as never);
    prisma.eventoAcesso.create.mockResolvedValue({ id: 'evt-3' } as never);

    const login = await service.login(
      { username: 'admin', password: 'admin123' },
      { ip: '127.0.0.1', userAgent: 'jest', path: '/auth/login', method: 'POST' }
    );

    prisma.sessaoUsuario.findUnique.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: createHash('sha256').update(login.refreshToken).digest('hex'),
      loginAt: new Date(),
      lastSeenAt: new Date(),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 7200_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date(),
      updatedAt: new Date(),
      usuario: baseUser
    } as never);

    const user = await service.verifyAccessToken(login.accessToken, {
      ip: '127.0.0.1',
      userAgent: 'jest',
      path: '/clientes',
      method: 'GET'
    });

    expect(user.userId).toBe(baseUser.id);
    expect(user.sessionId).toBe('550e8400-e29b-41d4-a716-446655440124');
  });

  it('rejeita token adulterado', async () => {
    prisma.usuario.findUnique.mockResolvedValue(baseUser as never);
    passwordHashService.verify.mockResolvedValue(true);
    prisma.sessaoUsuario.create.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: '',
      loginAt: new Date(),
      lastSeenAt: new Date(),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 7200_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date(),
      updatedAt: new Date()
    } as never);
    prisma.sessaoUsuario.update.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: '',
      loginAt: new Date(),
      lastSeenAt: new Date(),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 7200_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date(),
      updatedAt: new Date()
    } as never);
    prisma.usuario.update.mockResolvedValue({
      ...baseUser,
      ultimoLoginAt: new Date()
    } as never);
    prisma.eventoAcesso.create.mockResolvedValue({ id: 'evt-4' } as never);

    const login = await service.login(
      { username: 'admin', password: 'admin123' },
      { ip: '127.0.0.1', userAgent: 'jest', path: '/auth/login', method: 'POST' }
    );

    await expect(service.verifyAccessToken(`${login.accessToken}x`)).rejects.toThrow(UnauthorizedException);
  });

  it('renova refresh token de sessao ativa', async () => {
    prisma.sessaoUsuario.findUnique.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: createHash('sha256')
        .update('550e8400-e29b-41d4-a716-446655440124.segredo-antigo')
        .digest('hex'),
      loginAt: new Date(),
      lastSeenAt: new Date(),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 7200_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date(),
      updatedAt: new Date(),
      usuario: baseUser
    } as never);
    prisma.sessaoUsuario.update.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: 'hash-novo',
      loginAt: new Date(),
      lastSeenAt: new Date(),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 7200_000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date(),
      updatedAt: new Date()
    } as never);
    prisma.eventoAcesso.create.mockResolvedValue({ id: 'evt-5' } as never);

    const result = await service.refresh(
      { refreshToken: '550e8400-e29b-41d4-a716-446655440124.segredo-antigo' },
      { ip: '127.0.0.1', userAgent: 'jest', path: '/auth/refresh', method: 'POST' }
    );

    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(result.refreshToken).toMatch(/^550e8400-e29b-41d4-a716-446655440124\./);
    expect(result.refreshToken).not.toBe('550e8400-e29b-41d4-a716-446655440124.segredo-antigo');
  });

  it('agrega tempo de acesso por usuario dentro do periodo informado', async () => {
    prisma.sessaoUsuario.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        usuarioId: baseUser.id,
        refreshTokenHash: 'hash-1',
        loginAt: new Date('2026-08-10T08:00:00.000Z'),
        lastSeenAt: new Date('2026-08-10T10:30:00.000Z'),
        logoutAt: new Date('2026-08-10T10:30:00.000Z'),
        expiresAt: new Date('2026-08-10T12:00:00.000Z'),
        revokedAt: null,
        ip: '127.0.0.1',
        userAgent: 'jest',
        createdAt: new Date('2026-08-10T08:00:00.000Z'),
        updatedAt: new Date('2026-08-10T10:30:00.000Z'),
        usuario: baseUser
      },
      {
        id: 'sess-2',
        usuarioId: baseUser.id,
        refreshTokenHash: 'hash-2',
        loginAt: new Date('2026-08-11T09:00:00.000Z'),
        lastSeenAt: new Date('2026-08-11T09:45:00.000Z'),
        logoutAt: null,
        expiresAt: new Date('2026-08-11T09:45:00.000Z'),
        revokedAt: new Date('2026-08-11T09:45:00.000Z'),
        ip: '127.0.0.1',
        userAgent: 'jest',
        createdAt: new Date('2026-08-11T09:00:00.000Z'),
        updatedAt: new Date('2026-08-11T09:45:00.000Z'),
        usuario: baseUser
      }
    ] as never);

    const result = await service.listAccessTimeReport({
      periodoInicio: '2026-08-10',
      periodoFim: '2026-08-11'
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      usuarioId: baseUser.id,
      username: 'admin',
      role: 'admin',
      totalSessions: 2,
      activeSessions: 0
    });
    expect(result[0].totalDurationMs).toBe(11_700_000);
    expect(result[0].lastActivityAt).toBe('2026-08-11T09:45:00.000Z');
  });

  it('expira sessao apos 10 minutos sem interacao', async () => {
    prisma.usuario.findUnique.mockResolvedValue(baseUser as never);
    passwordHashService.verify.mockResolvedValue(true);
    prisma.sessaoUsuario.create.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: '',
      loginAt: new Date('2026-08-12T10:01:00.000Z'),
      lastSeenAt: new Date('2026-08-12T10:01:00.000Z'),
      logoutAt: null,
      expiresAt: new Date('2026-08-12T12:01:00.000Z'),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date('2026-08-12T10:01:00.000Z'),
      updatedAt: new Date('2026-08-12T10:01:00.000Z')
    } as never);
    prisma.sessaoUsuario.update.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: 'hash-atualizado',
      loginAt: new Date('2026-08-12T10:01:00.000Z'),
      lastSeenAt: new Date('2026-08-12T10:01:00.000Z'),
      logoutAt: null,
      expiresAt: new Date('2026-08-12T12:01:00.000Z'),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date('2026-08-12T10:01:00.000Z'),
      updatedAt: new Date('2026-08-12T10:01:00.000Z')
    } as never);
    prisma.usuario.update.mockResolvedValue({
      ...baseUser,
      ultimoLoginAt: new Date('2026-08-12T10:01:00.000Z')
    } as never);
    prisma.eventoAcesso.create.mockResolvedValue({ id: 'evt-6' } as never);
    prisma.sessaoUsuario.findUnique.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440124',
      usuarioId: baseUser.id,
      refreshTokenHash: createHash('sha256').update('token-refresh').digest('hex'),
      loginAt: new Date('2026-08-12T10:00:00.000Z'),
      lastSeenAt: new Date(Date.now() - 11 * 60 * 1000),
      logoutAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      revokedAt: null,
      ip: '127.0.0.1',
      userAgent: 'jest',
      createdAt: new Date('2026-08-12T10:00:00.000Z'),
      updatedAt: new Date('2026-08-12T10:00:00.000Z'),
      usuario: baseUser
    } as never);
    prisma.sessaoUsuario.updateMany.mockResolvedValue({ count: 1 } as never);

    const login = await service.login(
      { username: 'admin', password: 'admin123' },
      { ip: '127.0.0.1', userAgent: 'jest', path: '/auth/login', method: 'POST' }
    );

    await expect(
      service.verifyAccessToken(login.accessToken, {
        ip: '127.0.0.1',
        userAgent: 'jest',
        path: '/clientes',
        method: 'GET',
        interactive: false
      })
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.sessaoUsuario.updateMany).toHaveBeenCalled();
  });
});
