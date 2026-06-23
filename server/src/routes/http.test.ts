import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { store } from '../store/memory-store.js';

const PORTLAND = { 'x-tenant-id': 'tenant_portland', 'x-user-id': 'user_staff_portland' };

function makeApp() {
  return buildApp({ logger: false });
}

// Seed is a shared singleton; reset before each test so created/updated rows
// from one test never leak into the next. In a production situation we'd use
// an in memory DB for testing, separate from the actual data store.
beforeEach(() => store.reset());

test('GET list → 200 with { data, meta } envelope', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/bookings?page=1&limit=5', headers: PORTLAND });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(Array.isArray(body.data));
  assert.equal(body.meta.page, 1);
  assert.equal(body.meta.limit, 5);
  assert.equal(typeof body.meta.total, 'number');
  await app.close();
});

test('pagination is 1-based: page 1 is the first window, pages are disjoint', async () => {
  const app = makeApp();
  // Portland seed has 10 bookings -> two full pages of 5, no overlap, page 1
  // not skipped. The old `offset = page * limit` left page 2 empty.
  const firstPage = (await app.inject({ method: 'GET', url: '/api/bookings?page=1&limit=5', headers: PORTLAND })).json();
  const secondPage = (await app.inject({ method: 'GET', url: '/api/bookings?page=2&limit=5', headers: PORTLAND })).json();
  assert.equal(firstPage.meta.total, 10);
  assert.equal(firstPage.data.length, 5);
  assert.equal(secondPage.data.length, 5);
  const bookingIds = new Set([...firstPage.data, ...secondPage.data].map((booking) => booking.id));
  assert.equal(bookingIds.size, 10); // disjoint pages covering all rows
  await app.close();
});

test('GET unknown booking → 404 error envelope', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/bookings/nope', headers: PORTLAND });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: { code: 'not_found', message: 'Booking not found' } });
  await app.close();
});

test('cross-tenant GET → 404 (isolation holds under new contract)', async () => {
  const app = makeApp();
  // booking_007 belongs to Seattle
  const response = await app.inject({ method: 'GET', url: '/api/bookings/booking_007', headers: PORTLAND });
  assert.equal(response.statusCode, 404);
  await app.close();
});

test('missing auth header → 401 error envelope', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/bookings', headers: { 'x-tenant-id': 'tenant_portland' } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'unauthorized');
  await app.close();
});

test('invalid role → 401', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/bookings', headers: { ...PORTLAND, 'x-user-role': 'superadmin' } });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('POST missing required fields → 422 validation', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'POST', url: '/api/bookings', headers: PORTLAND, payload: { petId: 'pet_001' } });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'validation');
  await app.close();
});

test('POST referencing another tenant\'s pet → 422', async () => {
  const app = makeApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: PORTLAND,
    // pet_006 belongs to Seattle
    payload: { petId: 'pet_006', sitterId: 'sitter_001', scheduledDate: '2026-05-01T09:00:00Z', startTime: '09:00', endTime: '10:00' },
  });
  assert.equal(response.statusCode, 422);
  await app.close();
});

test('POST valid → 201 with { data } and requested status', async () => {
  const app = makeApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: PORTLAND,
    payload: { petId: 'pet_002', sitterId: 'sitter_001', scheduledDate: '2026-05-01T09:00:00Z', startTime: '06:00', endTime: '07:00' },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.data.status, 'requested');
  assert.equal(body.data.tenantId, 'tenant_portland');
  await app.close();
});

test('PATCH invalid transition → 409 conflict', async () => {
  const app = makeApp();
  // booking_004 is 'completed' (terminal)
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/bookings/booking_004/status',
    headers: PORTLAND,
    payload: { status: 'confirmed' },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'conflict');
  await app.close();
});

test('PATCH valid transition → 200 with new status', async () => {
  const app = makeApp();
  // booking_002 is 'requested' → confirm
  const response = await app.inject({
    method: 'PATCH',
    url: '/api/bookings/booking_002/status',
    headers: PORTLAND,
    payload: { status: 'confirmed' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.status, 'confirmed');
  await app.close();
});

test('unknown route → 404 envelope', async () => {
  const app = makeApp();
  const response = await app.inject({ method: 'GET', url: '/api/nope', headers: PORTLAND });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'not_found');
  await app.close();
});
