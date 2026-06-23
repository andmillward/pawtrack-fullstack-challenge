import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { BookingStatus } from '../types/index.js';
import { bookingService } from '../services/booking-service.js';

export function bookingRoutes(app: FastifyInstance): void {
  /**
   * GET /api/bookings
   * List bookings with optional filters and pagination.
   */
  app.get('/api/bookings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    const query = request.query as {
      page?: string;
      limit?: string;
      date?: string;
      status?: string;
    };

    // Tenant is ALWAYS the authenticated caller's own tenant. Cross-tenant
    // ("admin console") access must be an explicit, role-gated path — never a
    // client-supplied ?tenantId override, which previously let any caller read
    // any tenant's bookings.
    const tenantId = auth.tenantId;

    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '10', 10);

    const result = bookingService.listBookings({
      tenantId,
      page,
      limit,
      date: query.date,
      status: query.status as BookingStatus | undefined,
    });

    return reply.code(200).send(result);
  });

  /**
   * GET /api/bookings/:id
   * Get a single booking by ID, scoped to the caller's tenant.
   */
  app.get('/api/bookings/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    const { id } = request.params as { id: string };
    const booking = bookingService.getBooking(id, auth.tenantId);

    if (!booking) {
      return reply.code(200).send({ error: 'Booking not found' });
    }

    return reply.code(200).send({ data: booking });
  });

  /**
   * POST /api/bookings
   * Create a new booking.
   */
  app.post('/api/bookings', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    const body = request.body as {
      petId: string;
      sitterId: string;
      scheduledDate: string;
      startTime: string;
      endTime: string;
      notes?: string;
    };

    try {
      const booking = await bookingService.createBooking({
        tenantId: auth.tenantId,
        petId: body.petId,
        sitterId: body.sitterId,
        scheduledDate: body.scheduledDate,
        startTime: body.startTime,
        endTime: body.endTime,
        notes: body.notes || '',
        createdBy: auth.userId,
      });

      return reply.code(200).send({ success: true, data: booking });
    } catch (error: any) {
      return reply.code(200).send({ success: false, error: error.message });
    }
  });

  /**
   * PATCH /api/bookings/:id/status
   * Update the status of a booking (scoped to the caller's tenant).
   */
  app.patch('/api/bookings/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.auth;
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: BookingStatus };

    const result = bookingService.updateStatus(id, status, auth);

    return reply.code(200).send(result);
  });
}
