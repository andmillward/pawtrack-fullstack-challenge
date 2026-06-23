import type { BookingStatusEvent } from '../types/index.js';

/**
 * Port for an append-only audit log of booking status changes.
 *
 * ── In a real environment ──────────────────────────────────────────────────
 * This is backed by a dedicated, append-only table — rows are never updated or
 * deleted:
 *
 *   CREATE TABLE booking_status_events (
 *     id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
 *     booking_id      text        NOT NULL REFERENCES bookings(id),
 *     tenant_id       text        NOT NULL,
 *     previous_status text,                         -- NULL on creation
 *     new_status      text        NOT NULL,
 *     changed_by      text        NOT NULL,
 *     changed_at      timestamptz NOT NULL DEFAULT now()
 *   );
 *   CREATE INDEX ON booking_status_events (booking_id, changed_at);
 *   -- the application role is granted INSERT/SELECT only, never UPDATE/DELETE.
 *
 * Reliable capture: the event row is written in the SAME transaction as the
 * booking status change that is what calling `record()` inline from the
 * service mirrors. So state and audit commit or roll back together A stricter
 * variant captures it with a DB trigger or a SQL:2011 system-versioned
 * (temporal) table (AI's idea) so the trail cannot be bypassed even by direct SQL.
 * If the same change is also published to a message bus, the transactional-outbox
 * pattern keeps the audit row and the published event consistent.
 *
 * The in-memory adapter below is a thin stand-in: it deliberately ignores the
 * production concerns above (durability, retention, tamper-evidence). Swapping
 * in a PostgresAuditLog that implements this same port is the only change the
 * rest of the code would need.
 * ───────────────────────────────────────────────────────────────────────────
 */
export interface AuditLog {
  /** Append one status event. Never mutates or removes existing entries. */
  record(event: BookingStatusEvent): void;
  /** All events for a booking (unordered; callers sort as needed). */
  listForBooking(bookingId: string): BookingStatusEvent[];
}

class InMemoryAuditLog implements AuditLog {
  private events: BookingStatusEvent[] = [];

  record(event: BookingStatusEvent): void {
    this.events.push(event);
  }

  listForBooking(bookingId: string): BookingStatusEvent[] {
    return this.events.filter((event) => event.bookingId === bookingId);
  }

  /** Test-only: clear the in-memory log. A real adapter would not expose this. */
  reset(): void {
    this.events = [];
  }
}

// Swap for a PostgresAuditLog (same AuditLog port) in a real environment.
export const auditLog = new InMemoryAuditLog();
