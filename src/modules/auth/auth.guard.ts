import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';
import { TENANT_SCOPE_KEY, TenantScopeRule } from './decorators/tenant-scope.decorator';
import { AppRole, AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessToken = this.extractBearerToken(request.headers.authorization);
    if (!accessToken) {
      throw new UnauthorizedException('Token Bearer obrigatorio');
    }

    const authUser = this.authService.verifyAccessToken(accessToken);
    request.authUser = authUser;

    const allowedRoles =
      this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]) ?? ['admin', 'cliente'];

    if (!allowedRoles.includes(authUser.role)) {
      throw new ForbiddenException('Perfil sem permissao para esta rota');
    }

    if (authUser.role === 'admin') {
      return true;
    }

    if (!authUser.clienteId) {
      throw new ForbiddenException('Usuario de cliente sem clienteId no token');
    }

    const scopeRules = this.reflector.getAllAndOverride<TenantScopeRule[]>(TENANT_SCOPE_KEY, [context.getHandler(), context.getClass()]) ?? [];

    if (scopeRules.length === 0) {
      throw new ForbiddenException('Rota nao disponivel para usuario de cliente');
    }

    for (const rule of scopeRules) {
      const container = this.getContainer(request, rule);
      const scopeValue = this.readScopeValue(container, rule.key);

      if (!scopeValue) {
        if (rule.injectWhenMissing) {
          container[rule.key] = authUser.clienteId;
          continue;
        }

        if (rule.required) {
          throw new BadRequestException(`${rule.key} obrigatorio para operacao de cliente`);
        }

        continue;
      }

      if (scopeValue !== authUser.clienteId) {
        throw new ForbiddenException('Escopo de cliente invalido para esta operacao');
      }
    }

    return true;
  }

  private extractBearerToken(authorization?: string): string | null {
    if (!authorization) {
      return null;
    }

    const value = authorization.trim();
    if (!value.toLowerCase().startsWith('bearer ')) {
      return null;
    }

    const token = value.slice(7).trim();
    return token || null;
  }

  private getContainer(request: AuthenticatedRequest, rule: TenantScopeRule): Record<string, unknown> {
    if (rule.source === 'params') {
      if (!request.params || typeof request.params !== 'object') {
        request.params = {};
      }
      return request.params;
    }

    if (rule.source === 'query') {
      if (!request.query || typeof request.query !== 'object') {
        request.query = {};
      }
      return request.query;
    }

    if (!request.body || typeof request.body !== 'object') {
      request.body = {};
    }
    return request.body;
  }

  private readScopeValue(container: Record<string, unknown>, key: string): string | null {
    const value = container[key];

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed || null;
    }

    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim());
      return typeof first === 'string' ? first.trim() : null;
    }

    if (typeof value === 'number') {
      return String(value);
    }

    return null;
  }
}
