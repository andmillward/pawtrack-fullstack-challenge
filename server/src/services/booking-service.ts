import { v4 as uuid } from 'uuid';
import type {
  Booking,
  BookingStatus,
  BookingStatusEvent,
  PaginatedResult,
  AuthContext,
} from '../types/index.js';
import { VALID_TRANSITIONS } from '../types/index.js';
import { store } from '../store/memory-store.js';
import { scopeToTenant } from './authorization.js';
import { auditLog } from './audit-log.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { eventBus } from './event-emitter.js';

interface ListBookingsParams {
  tenantId: string;
  page: number;
  limit: number;
  date?: string;
  status?: BookingStatus;
}

interface CreateBookingParams {
  tenantId: string;
  petId: string;
  sitterId: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  createdBy: string;
}

export class BookingService {
  /**
   * List bookings for a tenant with optional date and status filters.
   * Supports pagination.
   */
  public listBookings(params: ListBookingsParams): PaginatedResult<Booking> {
    const { tenantId, page, limit, date, status } = params;

    let bookings = store.getBookingsByTenant(tenantId);

    // Filter by date if provided
    if (date) {
      // Match bookings on the requested date
      bookings = bookings.filter((booking) => booking.scheduledDate.startsWith(date));
    }

    // Filter by status if provided
    if (status) {
      bookings = bookings.filter((booking) => booking.status === status);
    }

    // Sort by scheduled date descending (newest first)
    bookings.sort(
      (first, second) =>
        new Date(second.scheduledDate).getTime() - new Date(first.scheduledDate).getTime(),
    );

    const total = bookings.length;
    // Pagination is 1-based: page 1 starts at offset 0. Clamp defensively for
    // callers outside the schema-validated HTTP layer (where page/limit could
    // be < 1). Previously `offset = page * limit` skipped the entire first page.
    const safeLimit = Math.max(1, limit);
    const safePage = Math.max(1, page);
    const totalPages = Math.ceil(total / safeLimit);

    const offset = (safePage - 1) * safeLimit;
    const paginatedBookings = bookings.slice(offset, offset + safeLimit);

    return {
      data: paginatedBookings,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
    };
  }

  /**
   * Create a new booking.
   * Checks for overlapping bookings with the same sitter.
   */
  public async createBooking(params: CreateBookingParams): Promise<Booking> {
    const { tenantId, petId, sitterId, scheduledDate, startTime, endTime, notes, createdBy } = params;

    // Referential integrity: pet and sitter must exist AND belong to the
    // caller's tenant. Resolved through the same tenant scope as reads, so a
    // booking can never reference another tenant's (or a nonexistent) pet or
    // sitter. Schema validation guarantees the fields are present; only the
    // data layer knows ownership.
    if (!scopeToTenant(store.getPet(petId), tenantId)) {
      throw new ValidationError('Unknown pet for this tenant');
    }
    if (!scopeToTenant(store.getSitter(sitterId), tenantId)) {
      throw new ValidationError('Unknown sitter for this tenant');
    }

    // Temporal sanity. Full duration/overnight handling is T4; here we only
    // reject an unparseable date and a zero-length slot.
    if (Number.isNaN(Date.parse(scheduledDate))) {
      throw new ValidationError('Invalid scheduledDate');
    }
    if (startTime === endTime) {
      throw new ValidationError('endTime must differ from startTime');
    }

    // Check for overlapping bookings with the same sitter
    const existingBookings = store.getAllBookings().filter(
      (booking) => booking.sitterId === sitterId && booking.status !== 'cancelled',
    );

    const hasOverlap = existingBookings.some((existing) => {
      const existingStart = new Date(`${existing.scheduledDate.split('T')[0]}T${existing.startTime}`);
      const existingEnd = new Date(`${existing.scheduledDate.split('T')[0]}T${existing.endTime}`);
      const newStart = new Date(`${scheduledDate.split('T')[0]}T${startTime}`);
      const newEnd = new Date(`${scheduledDate.split('T')[0]}T${endTime}`);

      return newStart < existingEnd && newEnd > existingStart;
    });

    if (hasOverlap) {
      throw new ConflictError('Sitter has an overlapping booking for this time slot');
    }

    // Simulate async operation (like a database write)
    await new Promise(resolve => setTimeout(resolve, 10));

    const now = new Date().toISOString();
    const booking: Booking = {
      id: `booking_${uuid().slice(0, 8)}`,
      tenantId,
      petId,
      sitterId,
      status: 'requested',
      scheduledDate,
      startTime,
      endTime,
      notes,
      createdAt: now,
      updatedAt: now,
      statusChangedAt: now,
      statusChangedBy: createdBy,
    };

    store.createBooking(booking);

    // Audit: record creation as the first status event. Written in the same
    // synchronous unit as the insert above; in a real DB these commit in one
    // transaction, so history can never drift from state.
    auditLog.record({
      id: `event_${uuid().slice(0, 8)}`,
      bookingId: booking.id,
      tenantId: booking.tenantId,
      previousStatus: null,
      newStatus: booking.status,
      changedBy: createdBy,
      changedAt: now,
    });

    eventBus.emit('booking.created', {
      bookingId: booking.id,
      tenantId: booking.tenantId,
      petId: booking.petId,
      sitterId: booking.sitterId,
    });

    return booking;
  }

  /**
   * Update booking status with transition validation.
   *
   * The booking is resolved through the caller's tenant scope, so a booking
   * belonging to another tenant is indistinguishable from one that does not
   * exist ('Booking not found') — no cross-tenant reads or writes.
   */
  public updateStatus(
    bookingId: string,
    newStatus: BookingStatus,
    auth: AuthContext,
  ): Booking {
    const booking = scopeToTenant(store.getBooking(bookingId), auth.tenantId);

    if (!booking) {
      throw new NotFoundError('Booking not found');
    }

    const allowedTransitions = VALID_TRANSITIONS[booking.status];
    if (!allowedTransitions.includes(newStatus)) {
      throw new ConflictError(
        `Cannot transition from '${booking.status}' to '${newStatus}'`,
      );
    }

    const changedAt = new Date().toISOString();
    const updatedBooking: Booking = {
      ...booking,
      status: newStatus,
      updatedAt: changedAt,
      // statusChangedAt/By stay on the row as a denormalised "last change"
      // pointer; the full history lives in the append-only audit log below.
      statusChangedAt: changedAt,
      statusChangedBy: auth.userId,
    };

    store.updateBooking(updatedBooking);

    // Audit: append the transition to the immutable history instead of letting
    // the previous statusChangedBy/At be overwritten and lost. Same unit as the
    // write above (one DB transaction in production).
    auditLog.record({
      id: `event_${uuid().slice(0, 8)}`,
      bookingId: updatedBooking.id,
      tenantId: updatedBooking.tenantId,
      previousStatus: booking.status,
      newStatus,
      changedBy: auth.userId,
      changedAt,
    });

    eventBus.emit('booking.statusChanged', {
      bookingId: updatedBooking.id,
      previousStatus: booking.status,
      newStatus,
      changedBy: auth.userId,
    });

    return updatedBooking;
  }

  /**
   * Get a single booking by ID, scoped to the caller's tenant. Returns
   * undefined for both missing and other-tenant bookings (no existence
   * disclosure across tenants).
   */
  public getBooking(bookingId: string, tenantId: string): Booking | undefined {
    return scopeToTenant(store.getBooking(bookingId), tenantId);
  }

  /**
   * Return a booking's immutable status history, oldest first. Scoped to the
   * caller's tenant — a missing or other-tenant booking raises NotFound, so the
   * history endpoint discloses nothing across tenants.
   */
  public getStatusHistory(bookingId: string, tenantId: string): BookingStatusEvent[] {
    if (!scopeToTenant(store.getBooking(bookingId), tenantId)) {
      throw new NotFoundError('Booking not found');
    }
    return auditLog
      .listForBooking(bookingId)
      .sort((first, second) => first.changedAt.localeCompare(second.changedAt));
  }
}

export const bookingService = new BookingService();
