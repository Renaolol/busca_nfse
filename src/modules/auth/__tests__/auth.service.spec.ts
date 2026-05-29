import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

describe('AuthService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: 'super-secret-key-for-tests',
      JWT_EXPIRES_IN_SECONDS: '3600',
      AUTH_USERS_JSON: JSON.stringify([
        {
          username: 'admin',
          password: 'admin123',
          role: 'admin'
        },
        {
          username: 'cliente1',
          password: 'cliente123',
          role: 'cliente',
          clienteId: '550e8400-e29b-41d4-a716-446655440000'
        }
      ])
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('gera token JWT no login valido', () => {
    const service = new AuthService();

    const result = service.login({ username: 'admin', password: 'admin123' });

    expect(result.tokenType).toBe('Bearer');
    expect(result.expiresIn).toBe(3600);
    expect(result.user).toEqual({
      userId: undefined,
      username: 'admin',
      role: 'admin',
      clienteId: undefined
    });
    expect(typeof result.accessToken).toBe('string');
    expect(result.accessToken.split('.')).toHaveLength(3);
  });

  it('rejeita credenciais invalidas', () => {
    const service = new AuthService();

    expect(() => service.login({ username: 'admin', password: 'senha-errada' })).toThrow(UnauthorizedException);
  });

  it('valida token de cliente e extrai escopo', () => {
    const service = new AuthService();

    const login = service.login({ username: 'cliente1', password: 'cliente123' });
    const user = service.verifyAccessToken(login.accessToken);

    expect(user).toEqual({
      userId: undefined,
      username: 'cliente1',
      role: 'cliente',
      clienteId: '550e8400-e29b-41d4-a716-446655440000'
    });
  });

  it('rejeita token adulterado', () => {
    const service = new AuthService();
    const login = service.login({ username: 'admin', password: 'admin123' });
    const tampered = `${login.accessToken}x`;

    expect(() => service.verifyAccessToken(tampered)).toThrow(UnauthorizedException);
  });

  it('propaga userId quando configurado', () => {
    process.env.AUTH_USERS_JSON = JSON.stringify([
      {
        userId: '550e8400-e29b-41d4-a716-446655440123',
        username: 'admin',
        password: 'admin123',
        role: 'admin'
      }
    ]);

    const service = new AuthService();
    const login = service.login({ username: 'admin', password: 'admin123' });
    const user = service.verifyAccessToken(login.accessToken);

    expect(login.user.userId).toBe('550e8400-e29b-41d4-a716-446655440123');
    expect(user.userId).toBe('550e8400-e29b-41d4-a716-446655440123');
  });

  it('falha ao iniciar quando userId nao e UUID valido', () => {
    process.env.AUTH_USERS_JSON = JSON.stringify([
      {
        userId: 'invalido',
        username: 'admin',
        password: 'admin123',
        role: 'admin'
      }
    ]);

    expect(() => new AuthService()).toThrow('AUTH_USERS_JSON usuario admin com userId invalido');
  });

  it('falha ao iniciar quando AUTH_USERS_JSON nao esta configurado', () => {
    delete process.env.AUTH_USERS_JSON;

    expect(() => new AuthService()).toThrow('AUTH_USERS_JSON obrigatoria');
  });
});
