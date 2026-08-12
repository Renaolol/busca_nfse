import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuthenticatedRequest } from '../auth/auth.types';
import { AuditService } from './audit.service';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<'http'>() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      method?: string;
      originalUrl?: string;
      baseUrl?: string;
      route?: { path?: string };
      ip?: string;
      headers?: Record<string, string | string[] | undefined>;
      params?: Record<string, string | undefined>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();

    const method = String(request.method ?? '').toUpperCase();
    if (!MUTATION_METHODS.has(method)) {
      return next.handle();
    }

    const routePath = this.resolveRoutePath(request);
    if (routePath.startsWith('/auth/login') || routePath.startsWith('/auth/refresh') || routePath.startsWith('/auth/logout')) {
      return next.handle();
    }

    const acao = this.resolveAction(method);
    const entidade = this.resolveEntity(routePath);
    const entidadeId = this.resolveEntityId(request);
    const clienteId = this.resolveClienteId(request, routePath);
    const userAgentRaw = request.headers?.['user-agent'];
    const userAgent = Array.isArray(userAgentRaw) ? userAgentRaw[0] : userAgentRaw;

    return next.handle().pipe(
      tap(() => {
        void this.auditService
          .create({
            usuarioId: request.authUser?.userId,
            clienteId,
            acao,
            entidade,
            entidadeId,
            ip: request.ip,
            userAgent
          })
          .catch(() => undefined);
      })
    );
  }

  private resolveAction(method: string): string {
    if (method === 'POST') {
      return 'create';
    }

    if (method === 'PATCH' || method === 'PUT') {
      return 'update';
    }

    if (method === 'DELETE') {
      return 'delete';
    }

    return 'mutate';
  }

  private resolveEntity(routePath: string): string {
    const normalized = routePath.startsWith('/') ? routePath.slice(1) : routePath;
    const firstSegment = normalized.split('/').find((segment) => segment && !segment.startsWith(':'));

    if (!firstSegment) {
      return 'sistema';
    }

    return firstSegment.slice(0, 100);
  }

  private resolveEntityId(
    request: Pick<AuthenticatedRequest, 'params' | 'query' | 'body'> & {
      params?: Record<string, string | undefined>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }
  ): string | undefined {
    const paramsId = request.params?.id;
    if (this.isUuid(paramsId)) {
      return paramsId;
    }

    const queryId = this.readString(request.query?.id);
    if (this.isUuid(queryId)) {
      return queryId;
    }

    const bodyId = this.readString(request.body?.id);
    if (this.isUuid(bodyId)) {
      return bodyId;
    }

    return undefined;
  }

  private resolveClienteId(
    request: Pick<AuthenticatedRequest, 'params' | 'query' | 'body' | 'authUser'> & {
      params?: Record<string, string | undefined>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    },
    routePath: string
  ): string | undefined {
    const clienteIdFromParamsId =
      routePath.startsWith('/clientes/') && this.isUuid(request.params?.id) ? request.params?.id : undefined;

    const values = [
      request.params?.clienteId,
      clienteIdFromParamsId,
      this.readString(request.query?.clienteId),
      this.readString(request.query?.cliente_id),
      this.readString(request.body?.clienteId),
      this.readString(request.body?.cliente_id),
      request.authUser?.clienteId
    ];

    for (const value of values) {
      if (this.isUuid(value)) {
        return value;
      }
    }

    return undefined;
  }

  private resolveRoutePath(
    request: Pick<
      AuthenticatedRequest,
      never
    > & {
      baseUrl?: string;
      route?: { path?: string };
      originalUrl?: string;
    }
  ): string {
    const base = request.baseUrl ?? '';
    const path = request.route?.path ?? '';

    if (base || path) {
      return `${base}${path || ''}`;
    }

    const originalUrl = request.originalUrl ?? '';
    const withoutQuery = originalUrl.split('?')[0];
    return withoutQuery || '/';
  }

  private readString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || undefined;
    }

    return undefined;
  }

  private isUuid(value: string | undefined): value is string {
    if (!value) {
      return false;
    }

    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
