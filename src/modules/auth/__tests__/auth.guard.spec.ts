import { BadRequestException, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '../auth.guard';
import { AuthService } from '../auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { TENANT_SCOPE_KEY, TenantScopeRule } from '../decorators/tenant-scope.decorator';
import { AppRole } from '../auth.types';

describe('AuthGuard', () => {
  const handler = () => undefined;
  class DummyController {}

  let reflector: jest.Mocked<Reflector>;
  let authService: jest.Mocked<AuthService>;
  let guard: AuthGuard;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn()
    } as unknown as jest.Mocked<Reflector>;

    authService = {
      verifyAccessToken: jest.fn()
    } as unknown as jest.Mocked<AuthService>;

    guard = new AuthGuard(reflector, authService);
  });

  function createContext(request: {
    authorization?: string;
    params?: Record<string, string | undefined>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  }): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => DummyController,
      switchToHttp: () => ({
        getRequest: () => ({
          headers: {
            authorization: request.authorization
          },
          params: request.params ?? {},
          query: request.query ?? {},
          body: request.body ?? {}
        })
      })
    } as unknown as ExecutionContext;
  }

  function setupMetadata(options?: {
    isPublic?: boolean;
    roles?: AppRole[];
    scopes?: TenantScopeRule[];
  }) {
    reflector.getAllAndOverride.mockImplementation((metadataKey: unknown) => {
      const key = String(metadataKey);
      if (key === IS_PUBLIC_KEY) {
        return (options?.isPublic ?? false) as never;
      }
      if (key === ROLES_KEY) {
        return options?.roles as never;
      }
      if (key === TENANT_SCOPE_KEY) {
        return options?.scopes as never;
      }

      return undefined as never;
    });
  }

  it('libera rota publica sem token', () => {
    setupMetadata({ isPublic: true });

    const canActivate = guard.canActivate(createContext({}));

    expect(canActivate).toBe(true);
    expect(authService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('exige token bearer em rota protegida', () => {
    setupMetadata();

    expect(() => guard.canActivate(createContext({}))).toThrow(UnauthorizedException);
  });

  it('bloqueia role nao permitida', () => {
    setupMetadata({ roles: ['admin'] });
    authService.verifyAccessToken.mockReturnValue({ username: 'cliente1', role: 'cliente', clienteId: 'cliente-id-1' });

    expect(() => guard.canActivate(createContext({ authorization: 'Bearer token' }))).toThrow(ForbiddenException);
  });

  it('valida escopo de cliente na query', () => {
    setupMetadata({
      scopes: [{ source: 'query', key: 'clienteId', required: true }]
    });
    authService.verifyAccessToken.mockReturnValue({
      username: 'cliente1',
      role: 'cliente',
      clienteId: 'cliente-id-1'
    });

    const canActivate = guard.canActivate(
      createContext({
        authorization: 'Bearer token',
        query: {
          clienteId: 'cliente-id-1'
        }
      })
    );

    expect(canActivate).toBe(true);
  });

  it('preenche clienteId quando regra de injecao estiver habilitada', () => {
    setupMetadata({
      scopes: [{ source: 'query', key: 'clienteId', injectWhenMissing: true }]
    });
    authService.verifyAccessToken.mockReturnValue({
      username: 'cliente1',
      role: 'cliente',
      clienteId: 'cliente-id-1'
    });

    const request = {
      headers: { authorization: 'Bearer token' },
      params: {},
      query: {} as Record<string, unknown>,
      body: {}
    };

    const context = {
      getHandler: () => handler,
      getClass: () => DummyController,
      switchToHttp: () => ({
        getRequest: () => request
      })
    } as unknown as ExecutionContext;

    const canActivate = guard.canActivate(context);

    expect(canActivate).toBe(true);
    expect(request.query.clienteId).toBe('cliente-id-1');
  });

  it('retorna 400 quando clienteId obrigatorio estiver ausente', () => {
    setupMetadata({
      scopes: [{ source: 'body', key: 'clienteId', required: true }]
    });
    authService.verifyAccessToken.mockReturnValue({
      username: 'cliente1',
      role: 'cliente',
      clienteId: 'cliente-id-1'
    });

    expect(() =>
      guard.canActivate(
        createContext({
          authorization: 'Bearer token',
          body: {}
        })
      )
    ).toThrow(BadRequestException);
  });

  it('bloqueia cliente quando rota nao define escopo', () => {
    setupMetadata();
    authService.verifyAccessToken.mockReturnValue({
      username: 'cliente1',
      role: 'cliente',
      clienteId: 'cliente-id-1'
    });

    expect(() => guard.canActivate(createContext({ authorization: 'Bearer token' }))).toThrow(ForbiddenException);
  });
});
