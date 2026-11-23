# Architecture

## Overview

```
Browser (React SPA, Vite, Tailwind)
   │  fetch /api/*  (JSON; admin calls carry a Bearer token)
   ▼
Hono API  ── runs as a Cloudflare Pages Function (production) or on Node (local dev)
   │  postgres.js over TCP, one transaction per mutation
   ▼
PostgreSQL (Supabase)  ── RLS enabled on every table, no policies → not reachable via the public REST API
```

| Concern        | Decision                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Frontend       | React 19 + TypeScript + Vite + Tailwind CSS 4, React Router                                                  |
| API            | Hono, in `server/`. Same code on Cloudflare Workers runtime and Node                                         |
| Database       | Supabase PostgreSQL, accessed **only** by the server through a direct connection (`DATABASE_URL`)            |
| Scheduling     | Pure TypeScript module `shared/scheduler/` with no I/O; used by the server (authoritative) and by unit tests |
| Admin auth     | Supabase Auth (recommended) or a single local admin (PBKDF2 hash + HMAC-signed session token)                |
| Student access | No accounts; a 256-bit random management token per booking, stored as a SHA-256 hash                         |
| Email          | Adapter (`server/services/notify.ts`): `console` (log + store only) or `resend`                              |
| Hosting        | Cloudflare Pages (static assets + Pages Functions), free tier                                                |

### Why a direct Postgres connection instead of supabase-js / PostgREST?

Booking must be atomic: lock the day, re-run the scheduler on the current data, insert, persist the new times — all in one
transaction. That is natural with a real SQL connection (`SELECT … FOR UPDATE`) and awkward through PostgREST. It also means the
service-role key is never needed: the API uses the database connection string, which only lives in server-side secrets. The
anon key is only used (optionally) by the browser for Supabase Auth sign-in, and RLS-without-policies blocks it from all data.

## Repository structure

```
shared/                 isomorphic code (browser + server)
  scheduler/            scheduling engine (engine.ts, intervals.ts, timeline.ts)
  rules.ts              duration rules
  validation.ts         group/booking validation (used by the form and the server)
  export.ts             CSV / iCalendar generation
  time.ts               time & time-zone helpers
  types.ts              domain types
server/
  app.ts                HTTP routes
  auth.ts               admin authentication
  repo.ts               SQL loaders and conversions
  services/schedule.ts  authoritative recalculation, change tracking, preview (rolled-back transactions)
  services/bookings.ts  student flows: availability, booking, token-based management
  services/admin.ts     admin flows: sessions, intervals, rules, ordering, finalization, exports
  services/notify.ts    email adapter + notification policy
  services/ratelimit.ts Postgres-backed rate limiting
  node.ts               Node entry (local dev)
functions/api/[[route]].ts   Cloudflare Pages Functions entry
src/                    React app (public pages + /admin dashboard)
supabase/migrations/    SQL migrations
scripts/                migrate, seed, hash-password, e2e server
tests/                  Vitest: scheduler unit/property tests, API integration tests (real Postgres)
e2e/                    Playwright end-to-end tests
```

## Scheduling strategy — "FIFO priority + opportunistic gap filling"

Model:

- **Free time** = availability windows (or the whole session if none) minus unavailable intervals.
- An examination lasts `presentation + questions_per_student × group_size` minutes and must lie **entirely inside one free
  segment** (never split across lunch or a lecture).
- Consecutive examinations must be at least `break` minutes apart. Any time between them counts, so a lunch break of ≥ 10
  minutes already satisfies the recovery requirement: no extra break is added after lunch, and none after the last exam.
- Breaks are shown explicitly in the timeline only when the gap between two exams is plain free time.

Placement order:

1. **Pinned** exams (finalized schedule) keep their exact times. If an admin change makes one invalid it is reported as a
   conflict, never moved silently.
2. Exams with an **administrator-defined position** are placed in that exact relative order.
3. All other exams are processed by **priority** (booking order; the sequence number is the stable tie-breaker) and each is
   placed at the **earliest feasible time anywhere in the day**.

Because earlier bookings are placed first and later bookings can only use left-over time, a later group never delays an
earlier one (this "prefix stability" is property-tested). When the next group does not fit before lunch it goes after lunch,
and a later, smaller group can fill the gap before lunch — exactly the behaviour required.

4. **Exact fallback.** If the greedy pass leaves someone unscheduled, a depth-first search over time-ordered sequences
   (explored in priority order, memoised on _remaining set × end of last exam_, capped at 18 exams / 200k nodes) looks for a
   schedule that fits everyone. Placing each exam of a sequence at its earliest feasible start is optimal for that sequence,
   so the search is complete within its cap. This prevents rejecting a booking only because of the greedy order.

The engine is deterministic: the same input (in any order) yields the same output.

Capacity is time-based. Before a booking is accepted the server simulates the day with the new group and accepts only if every
group still has a time. The public "room for groups up to N students" value is computed the same way.

## Consistency and concurrency

Every schedule-affecting operation runs inside `runMutation` (`server/services/schedule.ts`):

1. `SELECT … FOR UPDATE` on the affected session rows (sorted by id to avoid deadlocks) — concurrent bookings for the same day
   are serialised.
2. Snapshot booking times → apply the change → recompute and persist the schedule → diff.
3. If additional groups would become unscheduled, reject (409 `INFEASIBLE`/`CAPACITY`) unless an administrator explicitly
   passes `override`. Overridden bookings are flagged and listed under "requires attention".
4. **Preview** = the same code path, but the transaction is rolled back and the diff returned. The admin UI always shows this
   preview before applying.

Each recalculation that changes anything bumps `exam_sessions.schedule_version` and writes a `schedule_revisions` row with a
snapshot. The student booking preview returns the version; confirmation sends it back and is rejected as `STALE_PREVIEW` (with
a fresh estimate) if the schedule changed in the meantime. Capacity is always revalidated server-side regardless.

Finalization copies assigned times into `confirmed_start/end` and pins them. Unlocking keeps the confirmed order as a manual
order; any later difference from the confirmed time is flagged as **Revised** in all views and always notified.

## Data model

`courses` · `scheduling_configs` (1:1 with course) · `exam_sessions` · `availability_intervals` (kind `window`/`blocked`,
exclusion constraint against overlaps) · `bookings` · `group_members` · `booking_credentials` (token hashes, revocable) ·
`schedule_revisions` · `audit_log` · `notifications` · `rate_limits` · `admin_users`. See
`supabase/migrations/20261121000001_init.sql` for all constraints and indexes. Notable details:

- `bookings.booking_sequence` is an identity column (stable order of submission); `priority` drives FIFO and is re-assigned
  when a group moves to another day (it joins that day's queue at the end).
- Partial unique index on `(course_id, lower(group_name)) where status = 'active'` prevents obvious duplicates.
- Assigned times are `timestamptz`; the session has a `timezone` (default `Europe/Rome`). Exports include ISO timestamps with
  the correct offset.

## Security and privacy

- Admin endpoints require a verified token (Supabase Auth + `admin_users` allow-list, or the signed local session); every
  admin operation is authorised server-side.
- Management tokens: 32 random bytes, base64url, sent as a URL **fragment** (`/manage#t=…`, never reaches server logs or
  `Referer`), removed from the address bar after load, stored only as SHA-256. Admins can revoke and reissue links.
- Public endpoints never return emails, member names, notes or tokens; the public schedule can show group names, anonymous
  labels, or nothing (course setting).
- Input validation shared by client and server; DB `CHECK` constraints as a second line; 64 KB request body limit.
- Postgres-backed rate limiting for previews, bookings, management and login (keyed by an HMAC of the client IP).
- CSV exports neutralise formula injection; strict security headers and CSP for static assets (`public/_headers`).
- Cancellation requires typing the group name.
