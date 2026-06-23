# Full-Stack Engineering Decisions

## Audit Findings
<!-- For each issue you find, document:
     - What the issue is and which file it's in
     - Why it matters (security risk, data integrity, UX impact)
     - Severity (critical / high / medium / low)
     - How you fixed it (fill this in during Phase 2) -->

My initial thought was that the access-control complaints (a customer seeing another customer's bookings) looked like the system wasn't tracking a principal. Request identity and authorization weren't being enforced per request. Also the "stale data" reports smelled like either caching or a client-refresh problem.

My process was multi-staged, first a fresh-eyes pass so AI wouldn't frame the problem for me, then a second pass with Claude reviewing the code blind so I didn't frame the problem for it, then collaboration with it on the fixes, tickets, and tests. The `Found by` column records who caught what, and the **AI Usage** section breaks the workflow down further.

Severity-ordered. Status reflects what's committed; deferred items are tracked in `TICKETS.md`.

| Issue                                                                                                      | File                          | Severity    | Found by | Status                                                                                                                                                                                        |
|------------------------------------------------------------------------------------------------------------|-------------------------------|-------------|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Cross-tenant leak: client `?tenantId` override on list, and no tenant check on `GET`/`PATCH /bookings/:id` | `routes/bookings.ts`          | Critical    | Me       | **Fixed (T1)** — override removed; all booking reads/writes go through `scopeToTenant`; foreign tenant → 404 (no existence disclosure). Need to be top prio, since this exposes sensitive data |
| Stored XSS: booking `notes` interpolated into `innerHTML`                                                  | `client/app.js`               | Critical    | AI       | **Fixed (T2)** — `escapeHtml` + escape-by-default `html` tag + `raw()` in `client/safe-html.js`; I don't love having to use `raw()` and breaking formatting. But this is a big security risk  |
| Forgeable identity/role; no user↔tenant binding                                                            | `middleware/auth.ts`          | High        | Me       | **Partial (T1)** — role validated, identity untrusted for auth; real fix = JWT/principal (proposed)                                                                                           |
| Double-booking: conflict check is sitter-only (never pet), non-atomic (TOCTOU), overnight math inverts     | `services/booking-service.ts` | High        | Me       | **Deferred (T4)** — T3 made the failure a `409`; atomic pet+sitter check is the structural fix                                                                                                |
| Pagination off-by-one (`offset = page * limit`) hides the first page                                       | `services/booking-service.ts` | High        | Me       | **Fixed** — `(page-1)*limit` + clamps + regression test                                                                                                                                       |
| Timezone-naive date filter (`startsWith` on mixed-offset strings)                                          | `services/booking-service.ts` | High        | AI       | **Deferred (T4)** — needs canonical time model + migration                                                                                                                                    |
| Inconsistent contract: everything returns 200; four envelope shapes                                        | `routes/*`                    | High        | AI       | **Fixed (T3)** — one `{data}`/`{data,meta}` + `{error:{code,message}}`; 201/400/404/409/422 via one handler                                                                                   |
| No input validation (types/refs unchecked)                                                                 | `routes/bookings.ts`          | High        | Me       | **Fixed (T3)** — Fastify JSON schemas (422) + service-level referential checks (pet/sitter belong to tenant)                                                                                  |
| Frontend request races: filter changes, refresh, 15s poll overwrite each other                             | `client/app.js`               | Medium–High | Me       | **Deferred (T5)** — out-of-order responses, not the closure                                                                                                                                   |
| No audit trail; `updateStatus` overwrites `statusChangedBy`                                                | `services/booking-service.ts` | Medium      | AI       | **Fixed (Improvement)** — append-only status history                                                                                                                                          |
| Event bus fire-and-forget, no error isolation                                                              | `services/event-emitter.ts`   | Medium      | AI       | **Deferred (T6)** — audit done; bus hardening outstanding                                                                                                                                     |


### Investigated but not actual issues

- **The "stale closure" in the 15s poll** (`client/app.js`, the `// the polling closure still has the old one` comment) — *not* the cause of stale data. `filters` is a reassigned module-level binding the arrow reads lazily, so the poll always uses the latest filters. The real cause is out-of-order responses (a slow earlier request repainting over a newer one). *(Claude debunked the comment; I'd independently flagged old filter responses still landing.)*
- **Caching / cache invalidation** — I suspected a stale cache, but there's no cache layer in the app, so there's nothing to invalidate; the staleness is the response race above. *(Me)*
- **"List bookings returns all of a tenant's bookings, not just the user's"** — looks suspicious but is by design: staff are scoped to their tenant and legitimately see all of it. The reported "seeing another customer's bookings" was a cross-**tenant** leak (the `?tenantId` override + missing `:id` check), not a within-tenant one. *(Me — raised as "is this intentional?")*
- **Conflict-check scans all bookings globally (`getAllBookings`) rather than tenant-scoped** — not a data-isolation bug: it returns nothing to the client and sitter IDs are globally unique, so the global scan is safe (even marginally safer for catching clashes). The real defects were the missing pet check, non-atomicity, and overnight math. The *performance* of loading an ever-growing list into memory is a separate valid concern I raised — folded into the T4 redesign. *(Me)*
- **"Needs more aggressive client-side updating"** — not the fix; more frequent polling would *worsen* the out-of-order race. The durable fix is request sequencing (T5), not more refreshes. *(Me)*

## API Design
<!-- What changes did you make to the API?
     - Status codes, validation, error responses
     - Any conventions you followed (REST, JSON:API, RFC 7807)
     - How would this API evolve for production? -->

T3 introduced one contract, enforced centrally (`lib/http.ts`, `lib/errors.ts`).

- **Response DTOs:** one success DTO `{ data }` for a resource, `{ data, meta }` for a paginated collection and one error DTO, `{ error: { code, message } }`.
- **Status codes:** typed domain errors (`Unauthorized/Forbidden/NotFound/Conflict/Validation`) map to 401/403/404/409/422 in a single `app.setErrorHandler`; `201` on create; a `setNotFoundHandler` gives unknown routes the same error DTO. No more "200 with an error body."
- **Validation:** Fastify JSON-schema on body/query/params (auto-422), plus a service-level referential check that `petId`/`sitterId` exist and belong to the caller's tenant — schema can't know ownership.
- **Convention:** I chose a lean custom error DTO over RFC 7807 deliberately, mostly for time.
- **Production evolution:** move to RFC 7807 `problem+json` if it goes partner-facing; add response schemas, cursor pagination, idempotency keys on `POST`, and API versioning.

## Architecture Observations
<!-- What patterns or anti-patterns did you see?
     - How is business logic organized?
     - What would you change about the data model or service layer?
     - How does this map to DDD or clean architecture? -->

**Anti-patterns in the original:**
- Tenant scoping copy-pasted per handler (so `bookings` drifted out of sync with `pets`); `(request as any).auth` casts hid the gap from the type checker.
- Time stored three redundant, un-reconciled ways (`scheduledDate` + bare `startTime`/`endTime`), so every consumer re-derives "what day/time is this" differently. This is the root of the date-filter and overnight bugs.
- Business logic does check-then-act with an `await` between read and write. Could create a race condition causing things like double bookings.
- Event bus is fire-and-forget with no error isolation.

**What I changed:**
- A single tenant-scoping choke point (`scopeToTenant`) to make the tenant mix-up bug hard to reintroduce.
- An app factory (`buildApp`) so the app is testable in-process via `fastify.inject`. Maybe should have dropped for time. But AI did it pretty quick.
- A typed error/contract layer (`lib/errors.ts`, `lib/http.ts`).
- An `AuditLog` **port** with an in-memory adapter, documented to swap for a Postgres-backed table.

**What I'd change next (data model / service layer):**
- Canonical UTC-instant time model (+ tenant tz), with a real migration.
- Inject the store behind a repository port instead of a module singleton, and make queries *require* a tenantId so an unscoped read is impossible to write.

**Clean-architecture mapping:** routes = interface adapters; `BookingService` = application services; `scopeToTenant` + typed errors = domain rules; `store`/`auditLog` = ports with in-memory adapters. I deliberately kept lightweight scoped service helpers rather than a full repository for now, I figured that would just take too long and out of scope.

## Frontend Approach
<!-- What changes did you make to the frontend?
     - State management approach
     - Error handling strategy
     - Any framework you would use in production and why -->

**Changes made:**
- Extracted `client/safe-html.js`: an escape-by-default `html` tagged template + `raw()` for trusted fragments, so rendering is safe by construction (not just `notes`).
- Updated the client to consume the T3 contract: check `response.ok` + `error.message`, read pagination from `result.meta`.

**State management:** today it's mutable module globals plus a 15s `setInterval`, with three uncoordinated fetch sources. The reported "filters reset" is an **out-of-order response race** (an older poll repaints over a newer filtered result). Deferred to T5.

**Error handling:** now driven by HTTP status + the typed error DTO rather than using `result.success`.

**In production:** I'd move to **React**, with a real data layer like TanStack Query for request dedup, cancellation, and caching. This removes the whole race class structurally. I'll be honest that part of the pull toward React is familiarity (it's what I'm fastest and most confident in), but it also brings the ecosystem, mature data-layer libraries, and tooling that directly addresses the problems here. 
Trade-off: a larger change versus today's zero-dependency vanilla approach.

## Improvement Implemented
<!-- Which improvement did you choose to implement and why?
     Why did you prioritize this one over others? -->

Append-only booking status-history / audit trail.

- **Why:** It fixes an important gap (`updateStatus` was overwriting `statusChangedBy`, destroying history); and it builds on the existing event seam. The other candidates (deeper validation, more tests) were already largely covered by T3 and the test suite, so this added the most impact.
- **How:** an `AuditLog` port with a thin in-memory adapter (the file documents the production `booking_status_events` table + reliable-capture strategies). The event is written **in the same unit as the state change**, not via the best-effort event bus, so state and history can't get de-synced. New tenant-scoped `GET /api/bookings/:id/history`, covered by tests.
- **Scoped deliberately:** per discussion, I kept the in-memory adapter intentionally bare and spent the effort illustrating the real-environment design rather than hardening an in-memory store.

## Improvements Proposed
<!-- Describe 2 additional improvements you would make.
     For each: what, why, estimated effort, and trade-offs. -->

**1. Booking integrity: atomic pet+sitter conflict + canonical time model (with migration).**
- *What:* move the conflict check and insert into one atomic store method (`createBookingIfNoConflict`); check **both** pet and sitter; handle overnight slots by comparing real instants; store a canonical UTC instant (+ tenant tz) and backfill existing rows via an idempotent migration driven by one shared `toCanonical()`.
- *Why:* double-booking is a core reported integrity bug, and the stringly-typed time is the shared root of the date-filter and overnight bugs.
- *Effort:* ~3–4h. *Trade-offs:* the in-memory atomic primitive is a stand-in for a DB transaction / unique constraint. The migration is partly for show in-memory, also, whether two sitters may ever share a pet is a product rule to confirm.
- *Time note:* I'd planned to land T4 within this session too, but the fixing phase ran close to an hour (past the suggested 40-min budget), so I deferred it rather than rush a structural change to booking integrity. Better to ship the critical fixes well-tested than half-do this one.

**2. Frontend request lifecycle + state.**
- *What:* a single source of truth plus request sequencing (`AbortController` or a monotonic request token so only the latest response renders), and decouple polling from user actions; ideally adopt a data-fetching library.
- *Why:* directly fixes the third reported complaint: "filters reset & stale data" / an out-of-order-response update.
- *Effort:* ~2h vanilla, more with a framework. *Trade-offs:* vanilla keeps zero dependencies but is hand-rolled; a data layer is the durable fix but a bigger change.

*(Real JWT auth + a principal model, and event-bus hardening, are also written up in `TICKETS.md`.)*

**Smaller UI improvements** (lower effort, higher polish):
- Make the status-transition buttons clearer about what each one does.
- Add search / filter by time range.
- Show a friendlier, memorable booking reference instead of the raw `booking_…` id.
- Re-introduce *safe* formatting for notes/descriptions. Admittedly I kind of messed this up, and former bold tag is just showing up raw instead of as intended. Now that output is escaped, allow a controlled subset (e.g. sanitized markdown) so legitimate emphasis renders without reopening the XSS hole.

## AI Usage
<!-- If you used AI tools, describe:
     - Which tools and how you used them
     - What you validated or changed from AI suggestions
     - What you chose NOT to use AI for and why
     If you did not use AI tools, simply state that. -->

I used Claude Code.

**How I used it.** I ran my own audit pass first. Fresh eyes, before any prompting so it wouldn't frame the problem for me. Then I had it review the code blind to surface what I'd missed, and collaborated with it from there to lay out and prioritize the tickets, implement the fixes, and write and expand the tests. It's much faster at laying out the full scope of a problem in a readable format, which is mainly how I leaned on it for ticketing.

**What I validated or changed.** Pushed back when it over-reached (it wanted to replace the in-memory store with a repository layer), I pushed it toward a testing-forward approach seeding it with examples, I asked it to show a real-world **migration** plan for the data-model change rather than just hand-editing the seed, I drove prioritization and triage, and held it to my naming conventions.

**What I chose not to use AI for.** The initial audit pass was deliberately unassisted, and the prioritization/triage calls were mine. I also decided against a git-worktrees multi-agent strategy: given how much of the critical work needs foundational rewrites, parallel agents would mostly conflict and likely wouldn't save much time. I thought giving it seed tests was important to have them be meaningful since given carte blanche AI tends to be shallow in testing.

**How much was AI.** Candidly, most of the writing here, the tickets and this document, was AI-drafted and then given an editorial pass by me; it structures information cleanly and quickly. I also let it do most of the *coding*, though for tests I wrote the example cases myself and had it follow the pattern. In a more established repo I'd hand-build more of the structure to keep it conventional (or build templated agents for commonly changed areas), but given the volume of architectural change I wanted, I leaned on both manual testing and the unit/integration suite to keep its code in check. While spending a decent amount of planning time collaborating with it on the architectural structure.
