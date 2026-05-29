export type AppRole = 'admin' | 'cliente';

export interface AuthenticatedUser {
  userId?: string;
  username: string;
  role: AppRole;
  clienteId?: string;
}

export interface AuthTokenPayload {
  uid?: string;
  sub: string;
  role: AppRole;
  clienteId?: string;
  iat: number;
  exp: number;
}

export interface AuthUserConfig {
  userId?: string;
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
