import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { AuditInterceptor } from '../audit.interceptor';
import { AuditService } from '../audit.service';

describe('AuditInterceptor', () => {
  let auditService: jest.Mocked<AuditService>;
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    auditService = {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      list: jest.fn()
    } as unknown as jest.Mocked<AuditService>;

    interceptor = new AuditInterceptor(auditService);
  });

  function createContext(request: Record<string, unknown>): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request
      })
    } as unknown as ExecutionContext;
  }

  function createNextHandler(value: unknown = { ok: true }): CallHandler {
    return {
      handle: () => of(value)
    };
  }

  async function runInterceptor(request: Record<string, unknown>): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(createContext(request), createNextHandler()).subscribe({
        next: () => undefined,
        error: reject,
        complete: resolve
      });
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  it('registra auditoria em operacao de escrita', async () => {
    const request = {
      method: 'POST',
      baseUrl: '/clientes',
      route: { path: '/:id/sync/iniciar' },
      params: { id: '550e8400-e29b-41d4-a716-446655440000' },
      query: {},
      body: {},
      ip: '127.0.0.1',
      headers: { 'user-agent': 'jest' },
      authUser: {
        userId: '550e8400-e29b-41d4-a716-446655440001',
        username: 'admin',
        role: 'admin'
      }
    };

    await runInterceptor(request);

    expect(auditService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: '550e8400-e29b-41d4-a716-446655440001',
        clienteId: '550e8400-e29b-41d4-a716-446655440000',
        acao: 'create',
        entidade: 'clientes',
        entidadeId: '550e8400-e29b-41d4-a716-446655440000',
        ip: '127.0.0.1',
        userAgent: 'jest'
      })
    );
  });

  it('nao registra auditoria para metodo de leitura', async () => {
    await runInterceptor({
      method: 'GET',
      baseUrl: '/clientes',
      route: { path: '' },
      headers: {}
    });

    expect(auditService.create).not.toHaveBeenCalled();
  });

  it('nao registra auditoria para login', async () => {
    await runInterceptor({
      method: 'POST',
      baseUrl: '/auth',
      route: { path: '/login' },
      headers: {}
    });

    expect(auditService.create).not.toHaveBeenCalled();
  });

  it('nao propaga erro quando auditoria falha', async () => {
    auditService.create.mockRejectedValueOnce(new Error('falha'));

    await runInterceptor({
      method: 'PATCH',
      baseUrl: '/clientes',
      route: { path: '/:id' },
      params: { id: '550e8400-e29b-41d4-a716-446655440000' },
      headers: {}
    });

    expect(auditService.create).toHaveBeenCalled();
  });

  it('nao usa params.id como clienteId fora de rotas /clientes/*', async () => {
    await runInterceptor({
      method: 'POST',
      baseUrl: '/certificados',
      route: { path: '/:id/validar' },
      params: { id: '550e8400-e29b-41d4-a716-446655440050' },
      query: { clienteId: '550e8400-e29b-41d4-a716-446655440051' },
      headers: {}
    });

    expect(auditService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clienteId: '550e8400-e29b-41d4-a716-446655440051'
      })
    );
  });
});
