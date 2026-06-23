/** Any resource scoped to a single tenant. */
export interface TenantOwned {
  tenantId: string;
}

export interface Tenant {
  id: string;
  name: string;
  timezone: string;
}

export interface Pet {
  id: string;
  tenantId: string;
  name: string;
  species: 'dog' | 'cat' | 'bird' | 'rabbit' | 'other';
  breed: string;
  ownerName: string;
  ownerPhone: string;
  notes: string;
}

export type BookingStatus = 'requested' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';

export interface Booking {
  id: string;
  tenantId: string;
  petId: string;
  sitterId: string;
  status: BookingStatus;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  statusChangedAt: string;
  statusChangedBy: string;
}

/** One immutable entry in a booking's status history (the audit log). */
export interface BookingStatusEvent {
  id: string;
  bookingId: string;
  tenantId: string;
  previousStatus: BookingStatus | null; // null = creation
  newStatus: BookingStatus;
  changedBy: string;
  changedAt: string;
}

export interface Sitter {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
}

export interface AuthContext {
  tenantId: string;
  userId: string;
  role: 'admin' | 'staff' | 'sitter';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Valid status transitions
export const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};
