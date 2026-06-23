# PawTrack — Remediation Tickets

Prioritized, grouped so critical issues are fixed *through* sound seams rather than
patched per-handler. Two foundations land first and everything else builds on them:

- **Tenant-scoped service helpers** (T1) — one shared ownership/scoping path; no
  handler touches the store directly. Kills the cross-tenant bug class structurally.
- **API response/error contract** (T3) — one `{ error: { code, message } }` envelope +
  correct HTTP codes via a single error handler. Validation, not-found, and conflict
  responses all hang off it.

**Decisions:** scoped *service helpers* (keep the Map store, no full repository layer);
error envelope is the simple `{ error: { code, message } }` shape.

Suggested order: **T1 + T2 → T3 → T4 → T5 → T6 (stretch).**
T1 and T3 are the critical-path enablers; every high-severity ticket depends on one of them.

---

## T1 — Tenant isolation & auth hardening `[CRITICAL]`
Merges the three tenant-leak holes plus forgeable identity into one boundary.

- **Files:** `routes/bookings.ts:21,41-50,89-97`, `services/booking-service.ts`,
  `middleware/auth.ts:19-45`, new `services/authorization.ts`
- **Problems / root causes:**
  - `tenantId = query.tenantId || auth.tenantId` (`bookings.ts:21`) — any caller reads
    any tenant via `?tenantId=`.
  - `GET /:id` and `PATCH /:id/status` look up by raw id with **no tenant check**
    (`bookings.ts:41-50`, `:89-97`) — cross-tenant read *and* write.
  - `X-User-Role` trusted verbatim and `userId` never tied to the tenant (`auth.ts`).
  - Root cause: scoping is copy-pasted per handler (pets got it, bookings didn't);
    `(request as any).auth` casts hide the gaps from the type checker.
- **Right approach:**
  - Every service method takes `tenantId`/`AuthContext`; a shared
    `assertOwnership(resource, auth)` + `getBookingScoped(id, tenantId)` are the *only*
    way routes reach data. Foreign-tenant id → **404** (no existence disclosure).
  - Default tenant is always `auth.tenantId`; drop the query override (re-add later as an
    explicit, role-gated admin path once role is trustworthy).
  - Validate `userId` belongs to `tenantId`; treat role as untrusted for now. Replace
    `as any` with a typed `request.auth` (Fastify module augmentation).
- **Shortcut to avoid:** adding an `if (x.tenantId !== auth.tenantId)` line to each route —
  that *is* the original failure mode. Guard lives in one shared path.
- **Acceptance:** foreign-tenant list/get/patch all blocked; no handler reads `store.*`
  without a tenantId in scope; no `as any` auth casts remain.
- **Depends on:** none. **Effort:** M (~2h).

## T2 — Output escaping (stored XSS) `[CRITICAL]`
- **Files:** `client/app.js:115-166`
- **Problem:** `innerHTML` interpolates user-supplied `booking.notes` (and id/pet/sitter)
  unescaped; seed data already carries a live `<img onerror>` payload (pet_005).
- **Right approach:** render via `textContent`/DOM nodes or a single `escapeHtml()` used at
  every interpolation, so future fields are safe by default.
- **Shortcut to avoid:** escaping only `notes` — make the render path safe-by-construction.
- **Acceptance:** a booking with `notes = <img src=x onerror=alert(1)>` renders as inert text.
- **Depends on:** none (parallel with T1). **Effort:** S–M (~1h).

## T3 — API contract: envelope, status codes, validation `[HIGH]` *(foundational)*
- **Files:** new `lib/http.ts`, all routes, Fastify schemas
- **Problems:** everything returns 200 incl. errors (`bookings.ts:46,81`); four different
  envelope shapes; client sniffs `result.error`/`result.success`; no input validation, so a
  booking can reference a nonexistent or cross-tenant pet/sitter.
- **Right approach:**
  - One success envelope + one `{ error: { code, message } }` error envelope. Typed domain
    errors (`NotFound`/`Forbidden`/`Conflict`/`Validation`) mapped to 404/403/409/422 in a
    single `app.setErrorHandler`. 201 on create.
  - Fastify JSON-schema validation on body/query/params (auto-422). Plus a service-level
    referential check that `petId`/`sitterId` exist and belong to the tenant (reuses T1’s
    scoped lookups), and `endTime > startTime`.
- **Shortcut to avoid:** schema-only validation (can’t know ownership) or hand-editing
  status codes per route without the central handler (drift returns).
- **Acceptance:** not-found→404, invalid transition→409, bad/foreign input→422, create→201;
  all errors share one shape.
- **Depends on:** T1. **Effort:** M (~2h).

## T4 — Booking integrity: atomic conflicts, pagination, timezone `[HIGH]`
Groups the three "wrong/missing data" defects in the booking domain.

- **Files:** `services/booking-service.ts:31-120`, `store/memory-store.ts`, `store/seed.ts`
- **Problems / root causes:**
  - **Double-booking:** check-then-act with an `await` between read and write (TOCTOU);
    conflict check is **sitter-only** — never checks the *pet*, which is the reported
    incident. Overnight slots (end < start) collapse the overlap window.
  - **Pagination:** `offset = page * limit` (`:53`) skips page 1; last page empties.
    Should be `(page - 1) * limit` with clamping.
  - **Date filter:** `scheduledDate.startsWith(date)` (`:39`) compares against each row’s
    stored offset; seed mixes `-07:00`/`-05:00`/`Z`, so boundary bookings are both missed
    and wrongly matched.
- **Right approach:**
  - Move the invariant into one synchronous store method, e.g.
    `createBookingIfNoConflict(booking, predicate)` — check + insert with **no `await`
    between**; remove the artificial `setTimeout`. Predicate covers **pet and sitter**
    overlap, tenant-scoped; conflict → `ConflictError` (409). Note in code that this maps to
    a DB unique constraint / `SELECT … FOR UPDATE` later.
  - Fix offset; clamp `page>=1` and a max `limit`.
  - Store timestamps as UTC instants (+ keep tenant tz); filter by computing the requested
    day’s UTC window in the tenant’s timezone. Normalize seed.
- **Shortcut to avoid:** re-running the `.some()` check just before insert (still not
  atomic); another `startsWith` variant for dates.
- **Acceptance:** concurrent identical creates → exactly one wins, other 409; same-pet and
  same-sitter overlaps both rejected; page 1 returns records 1–N; Portland filter on
  `2026-04-08` includes the 11:30pm-Pacific booking and excludes the next UTC day.
- **Migration note (real scenario):** here we just rewrite `seed.ts`, but in production the
  timezone normalization is a **data migration**, not a hand-edit. We'd write one pure
  transform (`toCanonical(booking, tenantTz)` → adds a UTC instant, keeps the original tz so
  it's reversible) and run it as an idempotent, dry-run-able backfill over existing rows. The
  same transform feeds the seed so the canonical form has a single definition and the two
  can't drift. Hand-editing the seed is the in-memory equivalent of editing prod by hand —
  fine for the challenge, called out so the real process is explicit.
- **Depends on:** T1, T3 (for the 409 shape). **Effort:** M–L (~3h).

## T5 — Frontend correctness: request lifecycle & error surfacing `[HIGH]`
- **Files:** `client/app.js:33,72,168-186,279-311`
- **Problems:**
  - Filter changes, Refresh, and the 15s poll fire uncoordinated requests; an older
    response can repaint over a newer filtered one → looks like "filters reset." (The `:54`
    "stale closure" comment is a red herring — the cause is response ordering.)
  - Client checks `result.error`/`result.success` instead of HTTP status.
- **Right approach:** single source of truth for state + a request-sequencing guard
  (`AbortController` to cancel in-flight, or a monotonic request token so only the latest
  response renders); decouple the poll from user-initiated fetches. Consume T3’s contract
  (`response.ok` + error code) for messages.
- **Shortcut to avoid:** lengthening/removing the poll interval — hides the race.
- **Acceptance:** rapid filter changes during an active poll never render data inconsistent
  with the current filter; server errors show typed messages.
- **Depends on:** T3 (for error surfacing). **Effort:** M (~2h).

## T6 — Architecture: audit trail & event-bus hardening `[MEDIUM]` *(stretch)*
- **Files:** `services/booking-service.ts:144`, `services/event-emitter.ts:12`
- **Problems:** `updateStatus` overwrites `statusChangedBy` ("no history kept"); `emit` runs
  handlers synchronously with no error isolation — one throw breaks the caller; events not
  persisted.
- **Right approach:** append-only status-change log keyed by booking (current status derived
  from latest event), written via the event bus as the audit system of record; isolate
  handler errors and make emission non-blocking with a persistence seam.
- **Depends on:** T1. **Effort:** M–L. Schedule-permitting; good "given more time" item.

---

### Sequence / PR grouping
| PR | Tickets | Rationale |
|----|---------|-----------|
| 1 | T1, T2 | Critical security; T1 is the scoping seam, T2 parallel. Ship first. |
| 2 | T3 | Contract seam — unblocks correct codes/validation everywhere. |
| 3 | T4 | Booking integrity on the atomic primitive + the contract’s 409. |
| 4 | T5 | Frontend race + error surfacing on top of the contract. |
| 5 | T6 | Audit/architecture, schedule-permitting. |
