import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { authMiddleware } from './middleware/auth.js';
import { bookingRoutes } from './routes/bookings.js';
import { petRoutes } from './routes/pets.js';
import { registerErrorHandler } from './lib/http.js';

/**
 * Builds the Fastify app without starting a listener, so it can be driven both
 * by the server bootstrap (index.ts) and by in-process tests (fastify.inject).
 */
export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });

  // Register CORS for frontend. Registered before the auth hook so preflight
  // OPTIONS requests are answered by the CORS plugin and never hit auth.
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Tenant-Id', 'X-User-Id', 'X-User-Role'],
  });

  registerErrorHandler(app);

  // Auth for all /api routes. authMiddleware throws on failure; the error
  // handler renders the 401.
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/')) {
      await authMiddleware(request);
    }
  });

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  bookingRoutes(app);
  petRoutes(app);

  return app;
}
