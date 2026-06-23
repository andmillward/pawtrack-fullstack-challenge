import type { FastifyInstance } from 'fastify';
import { store } from '../store/memory-store.js';
import { scopeToTenant } from '../services/authorization.js';
import { sendData } from '../lib/http.js';
import { NotFoundError } from '../lib/errors.js';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1 } },
};

export function petRoutes(app: FastifyInstance): void {
  /**
   * GET /api/pets
   * List all pets for the authenticated tenant.
   */
  app.get('/api/pets', async (request, reply) => {
    const auth = request.auth;
    return sendData(reply, store.getPetsByTenant(auth.tenantId));
  });

  /**
   * GET /api/pets/:id
   * Get a single pet by ID, scoped to the caller's tenant.
   */
  app.get('/api/pets/:id', { schema: { params: idParams } }, async (request, reply) => {
    const auth = request.auth;
    const { id } = request.params as { id: string };
    const pet = scopeToTenant(store.getPet(id), auth.tenantId);
    if (!pet) {
      throw new NotFoundError('Pet not found');
    }
    return sendData(reply, pet);
  });

  /**
   * GET /api/sitters
   * List all sitters for the authenticated tenant.
   */
  app.get('/api/sitters', async (request, reply) => {
    const auth = request.auth;
    return sendData(reply, store.getSittersByTenant(auth.tenantId));
  });
}
