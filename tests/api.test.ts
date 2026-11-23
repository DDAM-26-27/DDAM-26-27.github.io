/**
 * Integration tests: the real HTTP API against a real PostgreSQL database.
 * Requires DATABASE_URL_TEST (default: postgres://postgres:postgres@localhost:5432/ddam_test).
 * The test database is wiped and re-migrated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createSql, type Sql } from '../server/db';
import { hashPassword } from '../server/crypto';
import type { Env } from '../server/env';
import { migrate } from '../scripts/migrate';
import { seed } from '../scripts/seed';
import { parseTime as t } from '../shared/time';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/ddam_test';
let sql: Sql;
let app: ReturnType<typeof createApp>;
let available = true;
const env: Env = {
  DATABASE_URL: url,
  SESSION_SECRET: 'test-secret-test-secret-test-secret-123',
  AUTH_MODE: 'local',
  ADMIN_EMAIL: 'lecturer@example.org',
  ADMIN_PASSWORD_HASH: '',
  APP_BASE_URL: 'https://exams.example.org',
  EMAIL_PROVIDER: 'console',
  DISABLE_RATE_LIMIT: '1',
};
let adminToken = '';

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON (exports) */
  }
  return { status: res.status, data, headers: res.headers };
}
const adm = (method: string, path: string, body?: unknown) => call(method, `/admin${path}`, body, adminToken);

const group = (name: string, size: number, extra: Record<string, unknown> = {}) => ({
  groupName: name,
  groupSize: size,
  members: Array.from({ length: size }, (_, i) => `${name} Student ${i + 1}`),
  representativeEmail: `${name.toLowerCase().replace(/\W/g, '')}@example.org`,
  notes: '',
  ...extra,
});

async function newSession(date: string, opts: { start?: string; end?: string; intervals?: unknown[]; status?: string } = {}) {
  const r = await adm('POST', '/sessions', {
    date,
    startTime: opts.start ?? '09:00',
    endTime: opts.end ?? '13:00',
    registrationStatus: opts.status ?? 'open',
    intervals: opts.intervals ?? [],
  });
  expect(r.status).toBe(201);
  return r.data.id as string;
}

async function book(sessionId: string, name: string, size: number, extra: Record<string, unknown> = {}) {
  return call('POST', '/bookings', { sessionId, ...group(name, size), ...extra });
}

beforeAll(async () => {
  try {
    const admin = createSql(url, { max: 1 });
    await admin.unsafe('drop schema public cascade; create schema public;');
    await admin.end();
  } catch (e) {
    available = false;
    console.warn('Skipping API tests: database not reachable', (e as Error).message);
    return;
  }
  await migrate(url, () => {});
  sql = createSql(url, { max: 10 });
  await seed(sql, { open: true });
  env.ADMIN_PASSWORD_HASH = await hashPassword('correct horse battery');
  app = createApp(() => ({ env, sql }));
  const login = await call('POST', '/admin/login', { email: 'lecturer@example.org', password: 'correct horse battery' });
  adminToken = login.data.token;
});

afterAll(async () => {
  await sql?.end();
});

describe.runIf(() => available)('API', () => {
  it('administrator authentication', async () => {
    expect((await call('GET', '/admin/overview')).status).toBe(401);
    expect((await call('GET', '/admin/overview', undefined, 'forged.token')).status).toBe(401);
    expect((await call('POST', '/admin/login', { email: 'lecturer@example.org', password: 'wrong' })).status).toBe(401);
    expect((await call('POST', '/admin/login', { email: 'other@example.org', password: 'correct horse battery' })).status).toBe(401);
    expect(adminToken).toBeTruthy();
    const me = await adm('GET', '/me');
    expect(me.data.email).toBe('lecturer@example.org');
  });

  it('authorization of administrative operations', async () => {
    const sessions = await call('GET', '/public/sessions');
    const id = sessions.data[0].id;
    for (const [m, p] of [
      ['POST', '/admin/sessions'],
      ['PUT', `/admin/sessions/${id}/intervals`],
      ['POST', `/admin/sessions/${id}/finalize`],
      ['GET', `/admin/sessions/${id}/export.csv`],
      ['DELETE', `/admin/sessions/${id}`],
    ]) {
      expect((await call(m, p, m === 'GET' ? undefined : {})).status).toBe(401);
    }
  });

  it('lists the seeded December sessions publicly', async () => {
    const r = await call('GET', '/public/sessions');
    expect(r.data.map((s: any) => s.date)).toEqual(['2026-12-15', '2026-12-18']);
    expect(r.data[0].availability.canBook).toBe(true);
    const course = await call('GET', '/public/course');
    expect(course.data.rules).toMatchObject({ presentationMinutes: 20, questionsPerStudentMinutes: 10, breakMinutes: 10 });
  });

  it('booking form validation', async () => {
    const id = await newSession('2099-01-05');
    const bad = await call('POST', '/bookings', { sessionId: id, ...group('X', 3), members: ['Only One'] });
    expect(bad.status).toBe(422);
    expect(bad.data.error.details.fields.members).toMatch(/exactly 3/);
    const badEmail = await call('POST', '/bookings', { sessionId: id, ...group('Valid Name', 2), representativeEmail: 'nope' });
    expect(badEmail.data.error.details.fields.representativeEmail).toBeTruthy();
    const tooBig = await call('POST', '/bookings', { sessionId: id, ...group('Big Group', 6) });
    expect(tooBig.status).toBe(422);
    const draft = await newSession('2099-01-06', { status: 'draft' });
    expect((await book(draft, 'Draft Group', 2)).status).toBe(409);
  });

  it('creates a booking with an automatically assigned time, persists it and hides private data publicly', async () => {
    const id = await newSession('2099-02-01', {
      end: '18:00',
      intervals: [{ kind: 'blocked', blockType: 'lunch', start: '13:00', end: '14:00', label: 'Lunch' }],
    });
    const preview = await call('POST', '/bookings/preview', { sessionId: id, groupSize: 4 });
    expect(preview.data).toMatchObject({ durationMinutes: 60, start: t('09:00'), end: t('10:00') });
    const r = await book(id, 'Alpha', 4, { expectedVersion: preview.data.scheduleVersion, start: t('15:00') /* ignored */ });
    expect(r.status).toBe(201);
    expect(r.data.booking).toMatchObject({ start: t('09:00'), end: t('10:00'), durationMinutes: 60, scheduleStatus: 'tentative' });
    expect(r.data.managementUrl).toMatch(/^https:\/\/exams\.example\.org\/manage#t=/);
    expect(r.data.emailStatus).toBe('not_configured'); // never claims an email was sent

    // Persistence: token stored hashed only.
    const creds = await sql`select token_hash from booking_credentials where booking_id = ${r.data.booking.id}`;
    expect(creds[0].token_hash).not.toBe(r.data.managementToken);
    expect(creds[0].token_hash).toHaveLength(64);

    const b2 = await book(id, 'Beta', 3);
    expect(b2.data.booking).toMatchObject({ start: t('10:10'), end: t('11:00') });

    const sched = await call('GET', `/public/sessions/${id}/schedule`);
    const raw = JSON.stringify(sched.data);
    expect(raw).not.toContain('@example.org');
    expect(raw).not.toContain(r.data.managementToken);
    expect(sched.data.entries.map((e: any) => `${e.kind}:${e.label}`).slice(0, 4)).toEqual([
      'exam:Alpha',
      'break:Recovery break',
      'exam:Beta',
      'available:Available',
    ]);
    expect(sched.data.entries.some((e: any) => e.kind === 'blocked' && e.label === 'Lunch')).toBe(true);
  });

  it('rejects duplicate group names', async () => {
    const id = await newSession('2099-02-02', { end: '18:00' });
    expect((await book(id, 'Dup Group', 2)).status).toBe(201);
    const again = await book(id, 'dup group', 2);
    expect(again.status).toBe(409);
    expect(again.data.error.code).toBe('DUPLICATE');
  });

  it('rejects stale booking previews', async () => {
    const id = await newSession('2099-02-03');
    const preview = await call('POST', '/bookings/preview', { sessionId: id, groupSize: 2 });
    await book(id, 'Sneaky', 3);
    const r = await book(id, 'Late', 2, { expectedVersion: preview.data.scheduleVersion });
    expect(r.status).toBe(409);
    expect(r.data.error.code).toBe('STALE_PREVIEW');
    expect(r.data.error.details.preview.start).toBe(t('10:00'));
    const retry = await book(id, 'Late', 2, { expectedVersion: r.data.error.details.preview.scheduleVersion });
    expect(retry.status).toBe(201);
  });

  it('enforces capacity in time, not in number of groups', async () => {
    const id = await newSession('2099-02-04', { end: '11:00' }); // 120 minutes
    expect((await book(id, 'Cap A', 4)).status).toBe(201); // 09:00–10:00
    const full = await book(id, 'Cap B', 4); // needs 60, only 50 left after break
    expect(full.status).toBe(409);
    expect(full.data.error.code).toBe('CAPACITY');
    const s = (await call('GET', '/public/sessions')).data.find((x: any) => x.id === id);
    expect(s.availability.maxBookableGroupSize).toBe(3);
    expect((await book(id, 'Cap C', 3)).status).toBe(201);
    const s2 = (await call('GET', '/public/sessions')).data.find((x: any) => x.id === id);
    expect(s2.availability.canBook).toBe(false);
    expect(s2.availability.reason).toMatch(/full/);
  });

  it('two concurrent bookings competing for the final available time: only one succeeds', async () => {
    const id = await newSession('2099-02-05', { end: '11:10' });
    expect((await book(id, 'First', 4)).status).toBe(201); // 09:00–10:00, then 60 min left after break
    const results = await Promise.all([book(id, 'Racer One', 4), book(id, 'Racer Two', 4), book(id, 'Racer Three', 4)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.data.error.code === 'CAPACITY')).toBe(true);
    const rows = await sql`select assigned_start from bookings where session_id = ${id} and status = 'active'`;
    expect(rows).toHaveLength(2);
  });

  it('gap filling through the API: a later small group uses the time before lunch', async () => {
    const id = await newSession('2099-02-06', {
      end: '16:00',
      intervals: [{ kind: 'blocked', blockType: 'lunch', start: '13:00', end: '14:00' }],
    });
    await book(id, 'G1', 4); // 09:00–10:00
    await book(id, 'G2', 4); // 10:10–11:10
    await book(id, 'G3', 2); // 11:20–12:00
    const big = await book(id, 'G4 Big', 5); // 70 min: does not fit 12:10–13:00
    expect(big.data.booking.start).toBe(t('14:00'));
    const small = await book(id, 'G5 Small', 2);
    expect(small.data.booking).toMatchObject({ start: t('12:10'), end: t('12:50') });
  });

  it('booking management: view, modify with validation, move date and cancel; invalid links are rejected', async () => {
    const id = await newSession('2099-03-01', { end: '18:00' });
    const other = await newSession('2099-03-02', { end: '18:00' });
    const r = await book(id, 'Managed', 2);
    const token = r.data.managementToken;
    expect((await call('POST', '/manage/booking', { token: 'x'.repeat(43) })).status).toBe(404);
    const view = await call('POST', '/manage/booking', { token });
    expect(view.data.booking.groupName).toBe('Managed');

    const bad = await call('POST', '/manage/update', { token, sessionId: id, ...group('Managed', 3), members: ['A B', 'C D'] });
    expect(bad.status).toBe(422);

    const preview = await call('POST', '/manage/update', { token, sessionId: id, ...group('Managed', 4), preview: true });
    expect(preview.data.preview).toBe(true);
    expect(preview.data.after).toMatchObject({ start: t('09:00'), end: t('10:00') });
    expect((await call('POST', '/manage/booking', { token })).data.booking.groupSize).toBe(2); // preview did not persist

    const upd = await call('POST', '/manage/update', { token, sessionId: id, ...group('Managed', 4) });
    expect(upd.data.booking).toMatchObject({ groupSize: 4, end: t('10:00'), durationMinutes: 60 });

    await book(other, 'Already There', 3);
    const moved = await call('POST', '/manage/update', { token, sessionId: other, ...group('Managed', 4) });
    expect(moved.data.booking).toMatchObject({ date: '2099-03-02', start: t('10:00') });

    const wrong = await call('POST', '/manage/cancel', { token, confirmation: 'nope' });
    expect(wrong.status).toBe(422);
    const cancel = await call('POST', '/manage/cancel', { token, confirmation: 'managed' });
    expect(cancel.data.booking.status).toBe('cancelled');
    expect((await call('POST', '/manage/update', { token, sessionId: other, ...group('Managed', 4) })).status).toBe(409);
  });

  it('cancellation triggers recalculation of later groups', async () => {
    const id = await newSession('2099-03-03', { end: '18:00' });
    const a = await book(id, 'C1', 4);
    await book(id, 'C2', 4);
    await book(id, 'C3', 4);
    await call('POST', '/manage/cancel', { token: a.data.managementToken, confirmation: 'C1' });
    const d = await adm('GET', `/sessions/${id}`);
    expect(d.data.bookings.map((b: any) => [b.groupName, b.start])).toEqual([
      ['C2', t('09:00')],
      ['C3', t('10:10')],
    ]);
  });

  it('admin previews do not persist; infeasible changes require an explicit override', async () => {
    const id = await newSession('2099-04-01', { end: '12:00' });
    await book(id, 'P1', 4);
    await book(id, 'P2', 4); // 10:10–11:10
    const blocks = [{ kind: 'blocked', blockType: 'meeting', start: '10:00', end: '11:30', label: 'Meeting' }];
    const prev = await adm('PUT', `/sessions/${id}/intervals?preview=1`, { intervals: blocks });
    expect(prev.status).toBe(200);
    expect(prev.data.preview).toBe(true);
    expect(prev.data.summary.newlyUnscheduled.map((u: any) => u.groupName)).toEqual(['P2']);
    expect((await adm('GET', `/sessions/${id}`)).data.intervals).toHaveLength(0);

    const rejected = await adm('PUT', `/sessions/${id}/intervals`, { intervals: blocks });
    expect(rejected.status).toBe(409);
    expect(rejected.data.error.code).toBe('INFEASIBLE');

    const forced = await adm('PUT', `/sessions/${id}/intervals`, { intervals: blocks, override: true });
    expect(forced.status).toBe(200);
    const d = await adm('GET', `/sessions/${id}`);
    const p2 = d.data.bookings.find((b: any) => b.groupName === 'P2');
    expect(p2.start).toBeNull();
    expect(p2.capacityOverride).toBe(true);
    expect(d.data.attention).toBe(1);
    const ov = await adm('GET', '/overview');
    expect(ov.data.attention.some((a: any) => a.groupName === 'P2')).toBe(true);

    const invalid = await adm('PUT', `/sessions/${id}/intervals`, {
      intervals: [
        { kind: 'blocked', start: '10:00', end: '11:00' },
        { kind: 'blocked', start: '10:30', end: '11:30' },
      ],
    });
    expect(invalid.status).toBe(422);
  });

  it('manual ordering is persisted and respected', async () => {
    const id = await newSession('2099-04-02', { end: '18:00' });
    const ids = [];
    for (const n of ['M1', 'M2', 'M3']) ids.push((await book(id, n, 2)).data.booking.id);
    const r = await adm('PUT', `/sessions/${id}/order`, { bookingIds: [ids[2], ids[0], ids[1]] });
    expect(r.status).toBe(200);
    const d = await adm('GET', `/sessions/${id}`);
    expect(d.data.bookings.map((b: any) => b.groupName)).toEqual(['M3', 'M1', 'M2']);
    expect(d.data.manualOrder).toBe(true);
    expect(d.data.bookings.every((b: any) => b.placement === 'manual')).toBe(true);
    // A new booking does not override the administrator's order.
    await book(id, 'M4', 2);
    const d2 = await adm('GET', `/sessions/${id}`);
    expect(d2.data.bookings.map((b: any) => b.groupName)).toEqual(['M3', 'M1', 'M2', 'M4']);
    await adm('PUT', `/sessions/${id}/order`, { bookingIds: null });
    const d3 = await adm('GET', `/sessions/${id}`);
    expect(d3.data.bookings.map((b: any) => b.groupName)).toEqual(['M1', 'M2', 'M3', 'M4']);
  });

  it('schedule publication: finalize freezes times, labels them confirmed and closes registration', async () => {
    const id = await newSession('2099-05-01', { end: '18:00' });
    const a = await book(id, 'F1', 4);
    const b = await book(id, 'F2', 3);
    const fin = await adm('POST', `/sessions/${id}/finalize`, {});
    expect(fin.status).toBe(200);
    const pubS = await call('GET', `/public/sessions/${id}/schedule`);
    expect(pubS.data.session.scheduleStatus).toBe('finalized');
    expect((await book(id, 'F3', 2)).status).toBe(409);
    // Students cannot change the size of a finalized booking…
    const resize = await call('POST', '/manage/update', { token: b.data.managementToken, sessionId: id, ...group('F2', 4) });
    expect(resize.data.error.code).toBe('FINALIZED');
    // …and cancellations do not move the remaining confirmed times.
    await call('POST', '/manage/cancel', { token: a.data.managementToken, confirmation: 'F1' });
    const view = await call('POST', '/manage/booking', { token: b.data.managementToken });
    expect(view.data.booking).toMatchObject({ start: t('10:10'), scheduleStatus: 'finalized', revised: false });
    // Admin adds a group around the frozen times.
    const added = await adm('POST', `/sessions/${id}/bookings`, group('F4', 2));
    expect(added.status).toBe(200);
    const d = await adm('GET', `/sessions/${id}`);
    expect(d.data.bookings.find((x: any) => x.groupName === 'F2').start).toBe(t('10:10'));
    // Unlocking keeps the confirmed relative order; a revision is clearly flagged.
    const unl = await adm('POST', `/sessions/${id}/unfinalize`, {});
    expect(unl.status).toBe(200);
    const d2 = await adm('GET', `/sessions/${id}`);
    const f2 = d2.data.bookings.find((x: any) => x.groupName === 'F2');
    expect(d2.data.session.scheduleStatus).toBe('tentative');
    expect(f2.revised).toBe(f2.start !== t('10:10'));
    // Notifications were recorded (console provider → "logged").
    const notes = await adm('GET', '/notifications');
    expect(notes.data.some((n: any) => n.kind === 'finalized' && n.status === 'logged')).toBe(true);
  });

  it('exports CSV and ICS with correct time zone offsets', async () => {
    const id = await newSession('2099-06-15', { end: '18:00' });
    await book(id, 'Export Group', 2);
    const csv = await adm('GET', `/sessions/${id}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.data).toContain('2099-06-15T09:00:00+02:00'); // CEST in June
    expect(csv.data).toContain('Export Group');
    const ics = await adm('GET', `/sessions/${id}/export.ics`);
    expect(ics.data).toContain('DTSTART:20990615T070000Z');
    const all = await adm('GET', '/export/bookings.csv');
    expect(all.data.split('\r\n')[0]).toContain('representative_email');
  });

  it('changing duration rules previews and recalculates every session', async () => {
    const ov = await adm('GET', '/overview');
    const course = ov.data.course;
    const prev = await adm('PUT', '/course?preview=1', { ...course, rules: { ...course.rules, breakMinutes: 15 } });
    expect(prev.status).toBe(200);
    expect(prev.data.summary.changes.length).toBeGreaterThan(0);
    const after = await adm('GET', '/overview');
    expect(after.data.course.rules.breakMinutes).toBe(10);
  });

  it('cannot delete a session with active bookings', async () => {
    const id = await newSession('2099-07-01');
    await book(id, 'Blocker', 2);
    expect((await adm('DELETE', `/sessions/${id}`)).status).toBe(409);
    const empty = await newSession('2099-07-02');
    expect((await adm('DELETE', `/sessions/${empty}`)).status).toBe(200);
  });

  it('public REST roles cannot read tables (RLS enabled on all tables)', async () => {
    const rows =
      await sql`select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and not relrowsecurity and relname <> 'schema_migrations'`;
    expect(rows).toEqual([]);
  });
});
