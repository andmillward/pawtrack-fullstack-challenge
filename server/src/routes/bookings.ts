import type { FastifyInstance } from 'fastify';
import type { BookingStatus } from '../types/index.js';
import { bookingService } from '../services/booking-service.js';
import { sendData } from '../lib/http.js';
import { NotFoundError } from '../lib/errors.js';

const BOOKING_STATUSES: BookingStatus[] = [
  'requested',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
];
const TIME_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$'; // HH:mm, 24-hour
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$'; // YYYY-MM-DD

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1 } },
};

export function bookingRoutes(app: FastifyInstance): void {
  /**
   * GET /api/bookings
   * List bookings for the caller's tenant with optional filters and pagination.
   */
  app.get(
    '/api/bookings',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
            date: { type: 'string', pattern: DATE_PATTERN },
            status: { type: 'string', enum: BOOKING_STATUSES },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      const query = request.query as {
        page: number;
        limit: number;
        date?: string;
        status?: BookingStatus;
      };

      // Tenant is ALWAYS the authenticated caller's own tenant (T1) — no
      // client-supplied override.
      const result = bookingService.listBookings({
        tenantId: auth.tenantId,
        page: query.page,
        limit: query.limit,
        date: query.date,
        status: query.status,
      });

      return sendData(reply, result.data, 200, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    },
  );

  /**
   * GET /api/bookings/:id
   * Get a single booking by ID, scoped to the caller's tenant.
   */
  app.get(
    '/api/bookings/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params as { id: string };
      const booking = bookingService.getBooking(id, auth.tenantId);
      if (!booking) {
        throw new NotFoundError('Booking not found');
      }
      return sendData(reply, booking);
    },
  );

  /**
   * GET /api/bookings/:id/history
   * Immutable status history for a booking, oldest first (tenant-scoped).
   */
  app.get(
    '/api/bookings/:id/history',
    { schema: { params: idParams } },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params as { id: string };
      return sendData(reply, bookingService.getStatusHistory(id, auth.tenantId));
    },
  );

  /**
   * POST /api/bookings
   * Create a new booking. Returns 201 with the created resource.
   */
  app.post(
    '/api/bookings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['petId', 'sitterId', 'scheduledDate', 'startTime', 'endTime'],
          properties: {
            petId: { type: 'string', minLength: 1 },
            sitterId: { type: 'string', minLength: 1 },
            scheduledDate: { type: 'string', minLength: 1 },
            startTime: { type: 'string', pattern: TIME_PATTERN },
            endTime: { type: 'string', pattern: TIME_PATTERN },
            notes: { type: 'string', maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      const body = request.body as {
        petId: string;
        sitterId: string;
        scheduledDate: string;
        startTime: string;
        endTime: string;
        notes?: string;
      };

      const booking = await bookingService.createBooking({
        tenantId: auth.tenantId,
        petId: body.petId,
        sitterId: body.sitterId,
        scheduledDate: body.scheduledDate,
        startTime: body.startTime,
        endTime: body.endTime,
        notes: body.notes ?? '',
        createdBy: auth.userId,
      });

      return sendData(reply, booking, 201);
    },
  );

  /**
   * PATCH /api/bookings/:id/status
   * Update the status of a booking (scoped to the caller's tenant).
   */
  app.patch(
    '/api/bookings/:id/status',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'string', enum: BOOKING_STATUSES } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth;
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: BookingStatus };

      const booking = bookingService.updateStatus(id, status, auth);
      return sendData(reply, booking);
    },
  );
}
