import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '../types/index.js';
import { store } from '../store/memory-store.js';
import { UnauthorizedError } from '../lib/errors.js';

const VALID_ROLES: ReadonlyArray<AuthContext['role']> = ['admin', 'staff', 'sitter'];

function parseRole(raw: string | undefined): AuthContext['role'] | undefined {
  // Absent role defaults to the least-privileged staff role (documented behaviour).
  if (!raw) return 'staff';
  // An explicitly supplied but unrecognised role is rejected rather than
  // silently coerced, so a typo or probe can never widen access.
  return (VALID_ROLES as readonly string[]).includes(raw)
    ? (raw as AuthContext['role'])
    : undefined;
}

/**
 * Header-based auth STUB. In production this is replaced by JWT verification,
 * where tenant, user, and role are signed claims that cannot be forged.
 *
 * Security note: because these are plain request headers, the caller's
 * identity (X-User-Id) and role (X-User-Role) are NOT trustworthy and must not
 * be used to make authorization decisions. Tenant data isolation is enforced
 * by scoping every query to `tenantId` (see scopeToTenant), never by trusting
 * the role header. Binding a user to a tenant requires a real user store /
 * verified token and is intentionally out of scope for this stub.
 *
 * Required headers:
 *   X-Tenant-Id: the tenant identifier
 *   X-User-Id: the user identifier
 *   X-User-Role: admin | staff | sitter (defaults to staff)
 */
export async function authMiddleware(request: FastifyRequest): Promise<void> {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  const userId = request.headers['x-user-id'] as string | undefined;

  if (!tenantId || !userId) {
    throw new UnauthorizedError('Missing X-Tenant-Id or X-User-Id headers');
  }

  const tenant = store.getTenant(tenantId);
  if (!tenant) {
    throw new UnauthorizedError('Invalid tenant');
  }

  const role = parseRole(request.headers['x-user-role'] as string | undefined);
  if (!role) {
    throw new UnauthorizedError('Invalid X-User-Role');
  }

  // Attach typed auth context for downstream handlers (see types/fastify.d.ts).
  request.auth = { tenantId, userId, role };
}
