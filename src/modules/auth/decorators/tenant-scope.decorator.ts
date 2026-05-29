import { SetMetadata } from '@nestjs/common';

export type TenantScopeSource = 'params' | 'query' | 'body';

export interface TenantScopeRule {
  source: TenantScopeSource;
  key: string;
  required?: boolean;
  injectWhenMissing?: boolean;
}

export const TENANT_SCOPE_KEY = 'tenantScopeRules';

export const TenantScope = (...rules: TenantScopeRule[]) => SetMetadata(TENANT_SCOPE_KEY, rules);
