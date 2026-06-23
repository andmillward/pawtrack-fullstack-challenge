import 'fastify';
import type { AuthContext } from './index.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Authenticated caller context, attached by `authMiddleware` for every
     * `/api/*` route. Guaranteed present inside API route handlers; do not
     * read it from unauthenticated routes (e.g. /health).
     */
    auth: AuthContext;
  }
}
