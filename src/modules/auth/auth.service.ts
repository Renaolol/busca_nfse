import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from '@nestjs/common';
import { EventoAcessoTipo, Prisma, SessaoUsuario, Usuario } from '@prisma/client';
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ListAccessEventsQueryDto } from './dto/list-access-events-query.dto';
import { ListSessionsQueryDto } from './dto/list-sessions-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AccessRequestContext, AuthTokenPayload, AuthenticatedUser } from './auth.types';
import { PasswordHashService } from './password-hash.service';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_ACCESS_EXPIRES_IN_SECONDS = 12 * 60 * 60;
const DEFAULT_REFRESH_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS = 60;

type SessionWithUser = SessaoUsuario & {
  usuario: Usuario;
};

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly expiresInSeconds: number;
  private readonly refreshExpiresInSeconds: number;
  private readonly sessionTouchIntervalSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHashService: PasswordHashService
  ) {
    this.jwtSecret = this.readJwtSecret();
    this.expiresInSeconds = this.readPositiveIntegerEnv('JWT_EXPIRES_IN_SECONDS', DEFAULT_ACCESS_EXPIRES_IN_SECONDS);
    this.refreshExpiresInSeconds = this.readPositiveIntegerEnv(
      'JWT_REFRESH_EXPIRES_IN_SECONDS',
      DEFAULT_REFRESH_EXPIRES_IN_SECONDS
    );
    this.sessionTouchIntervalSeconds = this.readPositiveIntegerEnv(
      'AUTH_SESSION_TOUCH_INTERVAL_SECONDS',
      DEFAULT_SESSION_TOUCH_INTERVAL_SECONDS
    );
  }

  async login(
    dto: LoginDto,
    context: AccessRequestContext
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    refreshExpiresIn: number;
    sessionExpiresAt: string;
    user: AuthenticatedUser;
  }> {
    const username = this.normalizeUsername(dto.username);
    const password = dto.password;

    const usuario = await this.prisma.usuario.findUnique({
      where: { username }
    });

    if (!usuario || !usuario.ativo) {
      await this.recordAccessEvent({
        tipo: EventoAcessoTipo.login_falha,
        username,
        clienteId: usuario?.clienteId,
        ip: context.ip,
        userAgent: context.userAgent,
        detalhes: { motivo: usuario ? 'usuario_inativo' : 'credenciais_invalidas' }
      });
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const passwordMatches = await this.passwordHashService.verify(password, usuario.passwordHash);
    if (!passwordMatches) {
      await this.recordAccessEvent({
        tipo: EventoAcessoTipo.login_falha,
        usuarioId: usuario.id,
        username,
        clienteId: usuario.clienteId,
        ip: context.ip,
        userAgent: context.userAgent,
        detalhes: { motivo: 'credenciais_invalidas' }
      });
      throw new UnauthorizedException('Credenciais invalidas');
    }

    this.validateUserConfiguration(usuario);

    const sessionExpiresAt = new Date(Date.now() + this.refreshExpiresInSeconds * 1000);

    const session = await this.prisma.$transaction(async (tx) => {
      const createdSession = await tx.sessaoUsuario.create({
        data: {
          usuarioId: usuario.id,
          refreshTokenHash: '',
          expiresAt: sessionExpiresAt,
          ip: context.ip,
          userAgent: context.userAgent
        }
      });

      const refreshToken = this.generateRefreshToken(createdSession.id);
      const updatedSession = await tx.sessaoUsuario.update({
        where: { id: createdSession.id },
        data: {
          refreshTokenHash: this.hashToken(refreshToken)
        }
      });

      await tx.usuario.update({
        where: { id: usuario.id },
        data: {
          ultimoLoginAt: new Date()
        }
      });

      await tx.eventoAcesso.create({
        data: {
          tipo: EventoAcessoTipo.login_sucesso,
          usuarioId: usuario.id,
          sessaoId: updatedSession.id,
          clienteId: usuario.clienteId,
          username: usuario.username,
          ip: context.ip,
          userAgent: context.userAgent,
          detalhes: {
            metodo: context.method,
            path: context.path
          }
        }
      });

      return {
        ...updatedSession,
        refreshToken
      };
    });

    return this.buildAuthResponse(usuario, session.id, sessionExpiresAt, session.refreshToken);
  }

  async refresh(
    dto: RefreshTokenDto,
    context: AccessRequestContext
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    refreshExpiresIn: number;
    sessionExpiresAt: string;
    user: AuthenticatedUser;
  }> {
    const { sessionId, rawToken } = this.parseRefreshToken(dto.refreshToken);
    const session = await this.prisma.sessaoUsuario.findUnique({
      where: { id: sessionId },
      include: { usuario: true }
    });

    if (!session) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    this.validateUserConfiguration(session.usuario);
    await this.ensureSessionIsUsable(session, context, true);

    const expectedHash = this.hashToken(rawToken);
    const storedHash = Buffer.from(session.refreshTokenHash, 'hex');
    const providedHash = Buffer.from(expectedHash, 'hex');
    if (storedHash.length !== providedHash.length || !timingSafeEqual(storedHash, providedHash)) {
      await this.recordAccessEvent({
        tipo: EventoAcessoTipo.acesso_negado,
        usuarioId: session.usuarioId,
        sessaoId: session.id,
        clienteId: session.usuario.clienteId,
        username: session.usuario.username,
        ip: context.ip,
        userAgent: context.userAgent,
        detalhes: { motivo: 'refresh_token_invalido', path: context.path, metodo: context.method }
      });
      throw new UnauthorizedException('Refresh token invalido');
    }

    const nextSessionExpiresAt = new Date(Date.now() + this.refreshExpiresInSeconds * 1000);
    const nextRefreshToken = this.generateRefreshToken(session.id);

    await this.prisma.$transaction([
      this.prisma.sessaoUsuario.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: this.hashToken(nextRefreshToken),
          expiresAt: nextSessionExpiresAt,
          lastSeenAt: new Date(),
          ip: context.ip ?? session.ip,
          userAgent: context.userAgent ?? session.userAgent
        }
      }),
      this.prisma.eventoAcesso.create({
        data: {
          tipo: EventoAcessoTipo.token_renovado,
          usuarioId: session.usuarioId,
          sessaoId: session.id,
          clienteId: session.usuario.clienteId,
          username: session.usuario.username,
          ip: context.ip,
          userAgent: context.userAgent,
          detalhes: {
            metodo: context.method,
            path: context.path
          }
        }
      })
    ]);

    return this.buildAuthResponse(session.usuario, session.id, nextSessionExpiresAt, nextRefreshToken);
  }

  async logout(authUser: AuthenticatedUser, context: AccessRequestContext): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.sessaoUsuario.updateMany({
      where: {
        id: authUser.sessionId,
        revokedAt: null,
        logoutAt: null
      },
      data: {
        logoutAt: now,
        lastSeenAt: now
      }
    });

    if (updated.count === 0) {
      return;
    }

    await this.recordAccessEvent({
      tipo: EventoAcessoTipo.logout,
      usuarioId: authUser.userId,
      sessaoId: authUser.sessionId,
      clienteId: authUser.clienteId,
      username: authUser.username,
      ip: context.ip,
      userAgent: context.userAgent,
      detalhes: {
        metodo: context.method,
        path: context.path
      }
    });
  }

  async me(authUser: AuthenticatedUser): Promise<{ user: AuthenticatedUser }> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: authUser.userId }
    });

    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException('Usuario autenticado nao encontrado');
    }

    this.validateUserConfiguration(usuario);
    return {
      user: this.mapAuthenticatedUser(usuario, authUser.sessionId, authUser.sessionExpiresAt)
    };
  }

  async verifyAccessToken(token: string, context?: AccessRequestContext): Promise<AuthenticatedUser> {
    const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
    if (!headerSegment || !payloadSegment || !signatureSegment) {
      throw new UnauthorizedException('Token JWT invalido');
    }

    const header = this.parseJson<Record<string, unknown>>(
      this.base64UrlDecodeToString(headerSegment),
      'Cabecalho JWT invalido'
    );
    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new UnauthorizedException('Token JWT com algoritmo invalido');
    }

    const unsignedToken = `${headerSegment}.${payloadSegment}`;
    const expectedSignature = createHmac('sha256', this.jwtSecret).update(unsignedToken).digest();
    const providedSignature = this.base64UrlDecodeToBuffer(signatureSegment, 'Assinatura JWT invalida');

    if (expectedSignature.length !== providedSignature.length || !timingSafeEqual(expectedSignature, providedSignature)) {
      throw new UnauthorizedException('Assinatura JWT invalida');
    }

    const payload = this.parseJson<Partial<AuthTokenPayload>>(this.base64UrlDecodeToString(payloadSegment), 'Payload JWT invalido');
    if (!payload.uid || !payload.sub || !payload.sid || (payload.role !== 'admin' && payload.role !== 'comum' && payload.role !== 'cliente')) {
      throw new UnauthorizedException('Payload JWT invalido');
    }

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expirado');
    }

    const session = await this.prisma.sessaoUsuario.findUnique({
      where: { id: payload.sid },
      include: { usuario: true }
    });

    if (!session) {
      throw new UnauthorizedException('Sessao nao encontrada');
    }

    await this.ensureSessionIsUsable(session, context);

    const usuario = session.usuario;
    this.validateUserConfiguration(usuario);

    if (usuario.id !== payload.uid) {
      throw new UnauthorizedException('Token JWT sem usuario valido');
    }

    return this.mapAuthenticatedUser(usuario, session.id, session.expiresAt.toISOString());
  }

  async registerAccessDenied(
    context: AccessRequestContext,
    details: {
      motivo: string;
      username?: string;
      usuarioId?: string;
      clienteId?: string;
      sessaoId?: string;
    }
  ): Promise<void> {
    await this.recordAccessEvent({
      tipo: EventoAcessoTipo.acesso_negado,
      usuarioId: details.usuarioId,
      sessaoId: details.sessaoId,
      clienteId: details.clienteId,
      username: details.username,
      ip: context.ip,
      userAgent: context.userAgent,
      detalhes: {
        motivo: details.motivo,
        metodo: context.method,
        path: context.path
      }
    });
  }

  async listUsers(filters: ListUsersQueryDto) {
    const where: Prisma.UsuarioWhereInput = {};

    if (typeof filters.ativo === 'boolean') {
      where.ativo = filters.ativo;
    }

    if (filters.clienteId) {
      where.clienteId = filters.clienteId;
    }

    const users = await this.prisma.usuario.findMany({
      where,
      orderBy: [{ ativo: 'desc' }, { username: 'asc' }]
    });

    return users.map((user) => this.mapUserResponse(user));
  }

  async createUser(dto: CreateUserDto) {
    this.validateRoleAndCliente(dto.role, dto.clienteId);

    const username = this.normalizeUsername(dto.username);
    const existingUser = await this.prisma.usuario.findUnique({
      where: { username }
    });
    if (existingUser) {
      throw new ConflictException('Username ja cadastrado');
    }

    const passwordHash = await this.passwordHashService.hash(dto.password);

    const user = await this.prisma.usuario.create({
      data: {
        username,
        nome: dto.nome?.trim() || null,
        passwordHash,
        role: dto.role,
        clienteId: dto.role === 'cliente' ? dto.clienteId : null,
        ativo: dto.ativo ?? true,
        passwordChangedAt: new Date()
      }
    });

    return this.mapUserResponse(user);
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.findUserOrThrow(id);
    const nextRole = dto.role ?? user.role;
    const nextClienteId = dto.role === 'admin' ? undefined : dto.clienteId ?? user.clienteId ?? undefined;

    this.validateRoleAndCliente(nextRole, nextClienteId);

    const username = dto.username ? this.normalizeUsername(dto.username) : undefined;
    if (username && username !== user.username) {
      const existingUser = await this.prisma.usuario.findUnique({
        where: { username }
      });
      if (existingUser && existingUser.id !== user.id) {
        throw new ConflictException('Username ja cadastrado');
      }
    }

    const updatedUser = await this.prisma.usuario.update({
      where: { id },
      data: {
        username,
        nome: dto.nome === undefined ? undefined : dto.nome.trim() || null,
        role: nextRole,
        clienteId: nextRole === 'cliente' ? nextClienteId : null,
        ativo: dto.ativo
      }
    });

    return this.mapUserResponse(updatedUser);
  }

  async resetPassword(id: string, dto: ResetUserPasswordDto) {
    await this.findUserOrThrow(id);
    const passwordHash = await this.passwordHashService.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.usuario.update({
        where: { id },
        data: {
          passwordHash,
          passwordChangedAt: new Date()
        }
      });

      await tx.sessaoUsuario.updateMany({
        where: {
          usuarioId: id,
          revokedAt: null,
          logoutAt: null
        },
        data: {
          revokedAt: new Date()
        }
      });

      return updatedUser;
    });

    return this.mapUserResponse(user);
  }

  async listSessions(filters: ListSessionsQueryDto) {
    const where: Prisma.SessaoUsuarioWhereInput = {};

    if (filters.usuarioId) {
      where.usuarioId = filters.usuarioId;
    }

    if (filters.clienteId) {
      where.usuario = {
        clienteId: filters.clienteId
      };
    }

    if (filters.somenteAtivas) {
      where.revokedAt = null;
      where.logoutAt = null;
      where.expiresAt = {
        gt: new Date()
      };
    }

    const sessions = await this.prisma.sessaoUsuario.findMany({
      where,
      include: { usuario: true },
      orderBy: { loginAt: 'desc' },
      take: filters.limit ?? 200
    });

    return sessions.map((session) => this.mapSessionResponse(session));
  }

  async listAccessEvents(filters: ListAccessEventsQueryDto) {
    const where: Prisma.EventoAcessoWhereInput = {};

    if (filters.tipo) {
      where.tipo = filters.tipo;
    }

    if (filters.usuarioId) {
      where.usuarioId = filters.usuarioId;
    }

    if (filters.clienteId) {
      where.clienteId = filters.clienteId;
    }

    if (filters.username) {
      where.username = this.normalizeUsername(filters.username);
    }

    const events = await this.prisma.eventoAcesso.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.limit ?? 200
    });

    return events.map((event) => ({
      id: event.id,
      tipo: event.tipo,
      usuarioId: event.usuarioId,
      sessaoId: event.sessaoId,
      clienteId: event.clienteId,
      username: event.username,
      ip: event.ip,
      userAgent: event.userAgent,
      detalhes: this.normalizeJsonObject(event.detalhes),
      createdAt: event.createdAt.toISOString()
    }));
  }

  private async findUserOrThrow(id: string): Promise<Usuario> {
    const user = await this.prisma.usuario.findUnique({
      where: { id }
    });

    if (!user) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    return user;
  }

  private validateRoleAndCliente(role: string, clienteId?: string): void {
    if (role !== 'admin' && role !== 'comum' && role !== 'cliente') {
      throw new BadRequestException('Role invalida');
    }

    if (role === 'cliente' && !clienteId) {
      throw new BadRequestException('clienteId obrigatorio para usuario com role=cliente');
    }
  }

  private validateUserConfiguration(usuario: Usuario): void {
    if (usuario.role === 'cliente' && !usuario.clienteId) {
      throw new UnauthorizedException('Usuario de cliente sem clienteId configurado');
    }

    if (!usuario.ativo) {
      throw new UnauthorizedException('Usuario inativo');
    }
  }

  private async ensureSessionIsUsable(
    session: SessionWithUser,
    context: AccessRequestContext | undefined,
    ignoreTouch = false
  ): Promise<void> {
    const now = new Date();
    if (session.logoutAt || session.revokedAt) {
      throw new UnauthorizedException('Sessao encerrada');
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.expireSession(session, context);
      throw new UnauthorizedException('Sessao expirada');
    }

    if (!ignoreTouch) {
      await this.touchSessionIfNeeded(session);
    }
  }

  private async expireSession(session: SessionWithUser, context?: AccessRequestContext): Promise<void> {
    const revokedAt = new Date();
    const updated = await this.prisma.sessaoUsuario.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        logoutAt: null
      },
      data: {
        revokedAt
      }
    });

    if (updated.count === 0) {
      return;
    }

    await this.recordAccessEvent({
      tipo: EventoAcessoTipo.sessao_expirada,
      usuarioId: session.usuarioId,
      sessaoId: session.id,
      clienteId: session.usuario.clienteId,
      username: session.usuario.username,
      ip: context?.ip ?? session.ip,
      userAgent: context?.userAgent ?? session.userAgent,
      detalhes: {
        metodo: context?.method,
        path: context?.path
      }
    });
  }

  private async touchSessionIfNeeded(session: SessionWithUser): Promise<void> {
    const ageInSeconds = (Date.now() - session.lastSeenAt.getTime()) / 1000;
    if (ageInSeconds < this.sessionTouchIntervalSeconds) {
      return;
    }

    await this.prisma.sessaoUsuario.update({
      where: { id: session.id },
      data: {
        lastSeenAt: new Date()
      }
    });
  }

  private buildAuthResponse(usuario: Usuario, sessionId: string, sessionExpiresAt: Date, refreshToken: string) {
    return {
      accessToken: this.signToken({
        uid: usuario.id,
        sub: usuario.username,
        role: usuario.role,
        clienteId: usuario.clienteId ?? undefined,
        sid: sessionId
      }),
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: this.expiresInSeconds,
      refreshExpiresIn: this.refreshExpiresInSeconds,
      sessionExpiresAt: sessionExpiresAt.toISOString(),
      user: this.mapAuthenticatedUser(usuario, sessionId, sessionExpiresAt.toISOString())
    };
  }

  private mapAuthenticatedUser(usuario: Usuario, sessionId: string, sessionExpiresAt: string): AuthenticatedUser {
    return {
      userId: usuario.id,
      username: usuario.username,
      nome: usuario.nome ?? undefined,
      role: usuario.role,
      clienteId: usuario.clienteId ?? undefined,
      sessionId,
      sessionExpiresAt
    };
  }

  private mapUserResponse(usuario: Usuario) {
    return {
      id: usuario.id,
      username: usuario.username,
      nome: usuario.nome ?? undefined,
      role: usuario.role,
      clienteId: usuario.clienteId ?? undefined,
      ativo: usuario.ativo,
      ultimoLoginAt: usuario.ultimoLoginAt?.toISOString() ?? null,
      passwordChangedAt: usuario.passwordChangedAt?.toISOString() ?? null,
      createdAt: usuario.createdAt.toISOString(),
      updatedAt: usuario.updatedAt.toISOString()
    };
  }

  private mapSessionResponse(session: SessionWithUser) {
    const terminalDate = session.logoutAt ?? session.revokedAt ?? (session.expiresAt.getTime() < Date.now() ? session.expiresAt : null);
    const durationMs = Math.max(0, (terminalDate ?? new Date()).getTime() - session.loginAt.getTime());
    const active = !session.logoutAt && !session.revokedAt && session.expiresAt.getTime() > Date.now();

    return {
      id: session.id,
      usuarioId: session.usuarioId,
      username: session.usuario.username,
      nome: session.usuario.nome ?? undefined,
      role: session.usuario.role,
      clienteId: session.usuario.clienteId ?? undefined,
      loginAt: session.loginAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      logoutAt: session.logoutAt?.toISOString() ?? null,
      expiresAt: session.expiresAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString() ?? null,
      ip: session.ip ?? null,
      userAgent: session.userAgent ?? null,
      durationMs,
      ativa: active
    };
  }

  private async recordAccessEvent(data: {
    tipo: EventoAcessoTipo;
    usuarioId?: string;
    sessaoId?: string;
    clienteId?: string;
    username?: string;
    ip?: string;
    userAgent?: string;
    detalhes?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.eventoAcesso.create({
      data: {
        tipo: data.tipo,
        usuarioId: data.usuarioId,
        sessaoId: data.sessaoId,
        clienteId: data.clienteId,
        username: data.username,
        ip: data.ip,
        userAgent: data.userAgent,
        detalhes: data.detalhes ?? undefined
      }
    });
  }

  private signToken(payload: Omit<AuthTokenPayload, 'iat' | 'exp'>): string {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    const completePayload: AuthTokenPayload = {
      ...payload,
      iat: nowInSeconds,
      exp: nowInSeconds + this.expiresInSeconds
    };

    const headerSegment = this.base64UrlEncode(
      JSON.stringify({
        alg: 'HS256',
        typ: 'JWT'
      })
    );
    const payloadSegment = this.base64UrlEncode(JSON.stringify(completePayload));
    const unsignedToken = `${headerSegment}.${payloadSegment}`;
    const signature = createHmac('sha256', this.jwtSecret).update(unsignedToken).digest();

    return `${unsignedToken}.${this.base64UrlEncode(signature)}`;
  }

  private generateRefreshToken(sessionId: string): string {
    const secret = randomBytes(32).toString('base64url');
    return `${sessionId}.${secret}`;
  }

  private parseRefreshToken(value: string): { sessionId: string; rawToken: string } {
    const rawToken = String(value || '').trim();
    const separatorIndex = rawToken.indexOf('.');
    if (separatorIndex <= 0) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    const sessionId = rawToken.slice(0, separatorIndex).trim();
    const secret = rawToken.slice(separatorIndex + 1).trim();
    if (!this.isUuid(sessionId) || !secret) {
      throw new UnauthorizedException('Refresh token invalido');
    }

    return { sessionId, rawToken };
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private normalizeUsername(value: string): string {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();

    if (!normalized) {
      throw new BadRequestException('username obrigatorio');
    }

    return normalized;
  }

  private parseJson<T>(value: string, errorMessage: string): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new UnauthorizedException(errorMessage);
    }
  }

  private base64UrlEncode(value: string | Buffer): string {
    const base64 = Buffer.isBuffer(value) ? value.toString('base64') : Buffer.from(value, 'utf8').toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private base64UrlDecodeToString(value: string): string {
    return this.base64UrlDecodeToBuffer(value, 'Token JWT malformado').toString('utf8');
  }

  private base64UrlDecodeToBuffer(value: string, errorMessage: string): Buffer {
    if (!value || typeof value !== 'string') {
      throw new UnauthorizedException(errorMessage);
    }

    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);

    try {
      return Buffer.from(`${normalized}${padding}`, 'base64');
    } catch {
      throw new UnauthorizedException(errorMessage);
    }
  }

  private readJwtSecret(): string {
    const value = process.env.JWT_SECRET?.trim();
    if (!value) {
      throw new Error('JWT_SECRET obrigatoria para autenticacao');
    }

    return value;
  }

  private readPositiveIntegerEnv(envName: string, defaultValue: number): number {
    const raw = process.env[envName]?.trim();
    if (!raw) {
      return defaultValue;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${envName} deve ser inteiro positivo`);
    }

    return parsed;
  }

  private isUuid(value?: string): value is string {
    if (!value) {
      return false;
    }

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private normalizeJsonObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return null;
    }

    return value as Record<string, unknown>;
  }
}
