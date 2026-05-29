export type AppRole = 'admin' | 'cliente';

export interface AuthenticatedUser {
  username: string;
  role: AppRole;
  clienteId?: string;
}

export interface AuthTokenPayload {
  sub: string;
  role: AppRole;
  clienteId?: string;
  iat: number;
  exp: number;
}

export interface AuthUserConfig {
  username: string;
  password: string;
  role: AppRole;
  clienteId?: string;
}

export interface AuthenticatedRequest {
  authUser?: AuthenticatedUser;
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  headers: {
    authorization?: string;
  };
}
