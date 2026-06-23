import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { store } from '../store/memory-store.js';

export function petRoutes(app: FastifyInstance): void {
  /**
   * GET /api/pets
   * List all pets for the authenticated tenant.
   */
  app.get('/api/pets', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    const pets = store.getPetsByTenant(auth.tenantId);
    return reply.code(200).send({ data: pets });
  });

  /**
   * GET /api/pets/:id
   * Get a single pet by ID.
   */
  app.get('/api/pets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    const { id } = request.params as { id: string };
    const pet = store.getPet(id);

    if (!pet) {
      return reply.code(404).send({ error: 'Pet not found' });
    }

    // Note: this endpoint correctly checks tenant ownership
    if (pet.tenantId !== auth.tenantId) {
      return reply.code(404).send({ error: 'Pet not found' });
    }

    return reply.code(200).send({ data: pet });
  });

  /**
   * GET /api/sitters
   * List all sitters for the authenticated tenant.
   */
  app.get('/api/sitters', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    const sitters = store.getSittersByTenant(auth.tenantId);
    return reply.code(200).send({ data: sitters });
  });
}
