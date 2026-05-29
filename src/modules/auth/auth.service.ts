import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LoginDto } from './dto/login.dto';
import { AuthTokenPayload, AuthenticatedUser, AuthUserConfig } from './auth.types';

const DEFAULT_EXPIRES_IN_SECONDS = 12 * 60 * 60;

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly expiresInSeconds: number;
  private readonly users: AuthUserConfig[];

  constructor() {
    this.jwtSecret = this.readJwtSecret();
    this.expiresInSeconds = this.readExpiresInSeconds();
    this.users = this.readUsers();
  }

  login(dto: LoginDto): {
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    user: AuthenticatedUser;
  } {
    const username = dto.username.trim();
    const password = dto.password;

    const user = this.users.find((candidate) => candidate.username === username);
    if (!user || user.password !== password) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const payload: AuthTokenPayload = {
      sub: user.username,
      role: user.role,
      clienteId: user.clienteId,
      iat: nowInSeconds,
      exp: nowInSeconds + this.expiresInSeconds
    };

    return {
      accessToken: this.signToken(payload),
      tokenType: 'Bearer',
      expiresIn: this.expiresInSeconds,
      user: {
        username: user.username,
        role: user.role,
        clienteId: user.clienteId
      }
    };
  }

  verifyAccessToken(token: string): AuthenticatedUser {
    const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
    if (!headerSegment || !payloadSegment || !signatureSegment) {
      throw new UnauthorizedException('Token JWT invalido');
    }

    const header = this.parseJson<Record<string, unknown>>(this.base64UrlDecodeToString(headerSegment), 'Cabecalho JWT invalido');
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

    if (payload.role !== 'admin' && payload.role !== 'cliente') {
      throw new UnauthorizedException('Token JWT sem role valida');
    }

    if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
      throw new UnauthorizedException('Token JWT sem subject valido');
    }

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expirado');
    }

    if (payload.role === 'cliente') {
      if (typeof payload.clienteId !== 'string' || !payload.clienteId.trim()) {
        throw new UnauthorizedException('Token de cliente sem clienteId');
      }
    }

    return {
      username: payload.sub,
      role: payload.role,
      clienteId: payload.clienteId
    };
  }

  private signToken(payload: AuthTokenPayload): string {
    const header = {
      alg: 'HS256',
      typ: 'JWT'
    };

    const headerSegment = this.base64UrlEncode(JSON.stringify(header));
    const payloadSegment = this.base64UrlEncode(JSON.stringify(payload));
    const unsignedToken = `${headerSegment}.${payloadSegment}`;
    const signature = createHmac('sha256', this.jwtSecret).update(unsignedToken).digest();

    return `${unsignedToken}.${this.base64UrlEncode(signature)}`;
  }

  private readJwtSecret(): string {
    const value = process.env.JWT_SECRET?.trim();
    if (!value) {
      throw new Error('JWT_SECRET obrigatoria para autenticacao');
    }

    return value;
  }

  private readExpiresInSeconds(): number {
    const raw = process.env.JWT_EXPIRES_IN_SECONDS?.trim();
    if (!raw) {
      return DEFAULT_EXPIRES_IN_SECONDS;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error('JWT_EXPIRES_IN_SECONDS deve ser inteiro positivo');
    }

    return parsed;
  }

  private readUsers(): AuthUserConfig[] {
    const raw = process.env.AUTH_USERS_JSON?.trim();
    if (!raw) {
      throw new Error('AUTH_USERS_JSON obrigatoria para autenticar usuarios');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('AUTH_USERS_JSON deve conter JSON valido');
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('AUTH_USERS_JSON deve conter um array nao vazio de usuarios');
    }

    const users: AuthUserConfig[] = parsed.map((entry, index) => this.parseUser(entry, index));
    const usernames = new Set<string>();
    for (const user of users) {
      if (usernames.has(user.username)) {
        throw new Error(`AUTH_USERS_JSON contem username duplicado: ${user.username}`);
      }
      usernames.add(user.username);
    }

    return users;
  }

  private parseUser(input: unknown, index: number): AuthUserConfig {
    if (!input || typeof input !== 'object') {
      throw new Error(`AUTH_USERS_JSON usuario na posicao ${index} invalido`);
    }

    const record = input as Record<string, unknown>;
    const username = typeof record.username === 'string' ? record.username.trim() : '';
    const password = typeof record.password === 'string' ? record.password : '';
    const role = record.role;
    const clienteId = typeof record.clienteId === 'string' ? record.clienteId.trim() : undefined;

    if (!username) {
      throw new Error(`AUTH_USERS_JSON usuario na posicao ${index} sem username valido`);
    }

    if (!password) {
      throw new Error(`AUTH_USERS_JSON usuario ${username} sem password`);
    }

    if (role !== 'admin' && role !== 'cliente') {
      throw new Error(`AUTH_USERS_JSON usuario ${username} com role invalida`);
    }

    if (role === 'cliente' && !clienteId) {
      throw new Error(`AUTH_USERS_JSON usuario ${username} role=cliente exige clienteId`);
    }

    return {
      username,
      password,
      role,
      clienteId
    };
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
}
