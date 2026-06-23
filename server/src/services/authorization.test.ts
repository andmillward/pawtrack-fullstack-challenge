import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeToTenant } from './authorization.js';

const booking = { id: 'booking_001', tenantId: 'tenant_portland', label: 'walk' };

test('returns the resource for a matching tenant', () => {
  // Same reference back — no copying, just an ownership gate.
  assert.equal(scopeToTenant(booking, 'tenant_portland'), booking);
});

test('hides a resource that belongs to another tenant', () => {
  assert.equal(scopeToTenant(booking, 'tenant_seattle'), undefined);
});

test('returns undefined for a missing resource', () => {
  assert.equal(scopeToTenant(undefined, 'tenant_portland'), undefined);
});

test('foreign-tenant and missing are indistinguishable (no existence disclosure)', () => {
  const foreign = scopeToTenant(booking, 'tenant_seattle');
  const missing = scopeToTenant(undefined, 'tenant_seattle');
  assert.equal(foreign, missing);
});

test('does not leak on an empty tenant id', () => {
  assert.equal(scopeToTenant(booking, ''), undefined);
});
