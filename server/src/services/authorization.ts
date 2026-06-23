import type { TenantOwned } from '../types/index.js';

/**
 * Single choke point for tenant ownership checks.
 *
 * Returns the resource only if it belongs to the caller's tenant. Returns
 * `undefined` for BOTH "missing" and "belongs to another tenant", so callers
 * surface an identical not-found response and never disclose the existence of
 * another tenant's resources (no cross-tenant existence disclosure).
 *
 * Routes and services must reach tenant-owned data through this helper rather
 * than re-deriving `resource.tenantId === auth.tenantId` inline.
 */
export function scopeToTenant<T extends TenantOwned>(
  resource: T | undefined,
  tenantId: string,
): T | undefined {
  if (!resource) return undefined;
  return resource.tenantId === tenantId ? resource : undefined;
}
