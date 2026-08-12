export type AppRole = 'admin' | 'comum' | 'cliente';

export interface AuthenticatedUser {
  userId: string;
  username: string;
  nome?: string;
  role: AppRole;
  clienteId?: string;
  sessionId: string;
  sessionExpiresAt: string;
}

export interface AuthTokenPayload {
  uid: string;
  sub: string;
  role: AppRole;
  clienteId?: string;
  sid: string;
  iat: number;
  exp: number;
}

export interface AccessRequestContext {
  ip?: string;
  userAgent?: string;
  path?: string;
  method?: string;
}

export interface AuthenticatedRequest {
  authUser?: AuthenticatedUser;
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: Record<string, unknown>;
  headers: {
    authorization?: string;
    'user-agent'?: string | string[];
  };
  ip?: string;
  originalUrl?: string;
  baseUrl?: string;
  route?: { path?: string };
  method?: string;
}
