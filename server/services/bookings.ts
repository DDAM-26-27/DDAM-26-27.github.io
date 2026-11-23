/** Public (student-facing) operations: session listing, schedule, booking and self-management. */
import type { Db, Sql, Tx } from '../db';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { randomToken, sha256Hex } from '../crypto';
import {
  dayAvailability,
  isUuid,
  loadActiveCourse,
  loadBooking,
  loadIntervals,
  loadSession,
  loadSessions,
  localMinutes,
  rulesOf,
  todayIn,
  type BookingRow,
  type CourseRow,
  type SessionRow,
} from '../repo';
import { computeSessionSchedule, runMutation, type ChangeSummary } from './schedule';
import { buildTimeline, maxBookableGroupSize, simulateAdd } from '../../shared/scheduler';
import { examDuration } from '../../shared/rules';
import { validateGroup, type GroupInput } from '../../shared/validation';
import {
  BLOCK_TYPE_LABELS,
  type BookingPreview,
  type EmailStatus,
  type ManagedBooking,
  type PublicSchedule,
  type PublicScheduleEntry,
  type PublicSession,
  type SessionAvailability,
} from '../../shared/types';
import { confirmationEmail, deliver, notifyAdmin, notifyTimeChanges, simpleEmail } from './notify';

// ---------------------------------------------------------------- availability

export function bookingBlocker(session: SessionRow): string | null {
  if (session.registration_status !== 'open') return 'Registration for this date is not open.';
  if (session.schedule_status === 'finalized') return 'The schedule for this date has been finalized.';
  if (session.exam_date < todayIn(session.timezone)) return 'This examination date has passed.';
  return null;
}

export async function sessionAvailability(db: Db, course: CourseRow, session: SessionRow) {
  const { input, result, bookings } = await computeSessionSchedule(db, course, session);
  const rules = rulesOf(course);
  const blocker = bookingBlocker(session);
  const maxSize = maxBookableGroupSize(input, rules);
  const availability: SessionAvailability = {
    groupCount: bookings.length,
    studentCount: bookings.reduce((s, b) => s + b.group_size, 0),
    availableMinutes: result.stats.availableMinutes,
    estimatedEndMinutes: result.stats.estimatedEnd,
    maxBookableGroupSize: maxSize,
    canBook: !blocker && maxSize >= rules.minGroupSize,
    reason:
      blocker ?? (maxSize < rules.minGroupSize ? 'This date is full: there is not enough remaining time for another examination.' : null),
  };
  return { availability, result, bookings, input };
}

export function publicSession(session: SessionRow, availability: SessionAvailability): PublicSession {
  return {
    id: session.id,
    date: session.exam_date,
    title: session.title,
    location: session.location,
    startTime: session.start_time.slice(0, 5),
    endTime: session.end_time.slice(0, 5),
    timezone: session.timezone,
    registrationStatus: session.registration_status,
    scheduleStatus: session.schedule_status,
    scheduleVersion: session.schedule_version,
    scheduleUpdatedAt: session.schedule_updated_at?.toISOString() ?? null,
    availability,
  };
}

export async function listPublicSessions(db: Db): Promise<PublicSession[]> {
  const course = await loadActiveCourse(db);
  const sessions = (await loadSessions(db, course.id)).filter((s) => s.registration_status !== 'draft');
  const out: PublicSession[] = [];
  for (const s of sessions) out.push(publicSession(s, (await sessionAvailability(db, course, s)).availability));
  return out;
}

function isRevised(b: BookingRow): boolean {
  return b.confirmed_start !== null && b.assigned_start?.getTime() !== b.confirmed_start.getTime();
}

export async function publicSchedule(db: Db, sessionId: string): Promise<PublicSchedule> {
  const course = await loadActiveCourse(db);
  const session = await loadSession(db, sessionId);
  if (session.registration_status === 'draft') throw new ApiError(404, 'NOT_FOUND', 'Examination session not found.');
  const { availability, bookings } = await sessionAvailability(db, course, session);
  const mode = course.public_schedule_mode;
  const placed = bookings
    .filter((b) => b.assigned_start && b.assigned_end)
    .map((b) => ({ id: b.id, start: localMinutes(session, b.assigned_start)!, end: localMinutes(session, b.assigned_end)!, b }))
    .sort((a, b) => a.start - b.start);
  const timeline = buildTimeline(dayAvailability(session, await intervalsOf(db, session.id)), placed, course.break_minutes);
  const entries: PublicScheduleEntry[] =
    mode === 'hidden'
      ? []
      : timeline.map((item) => {
          const base = { start: item.start, end: item.end, kind: item.kind };
          if (item.kind === 'exam') {
            const idx = placed.findIndex((p) => p.id === item.bookingId);
            const b = placed[idx].b;
            return { ...base, label: mode === 'names' ? b.group_name : `Group ${idx + 1}`, revised: isRevised(b) };
          }
          if (item.kind === 'blocked')
            return { ...base, label: item.label || BLOCK_TYPE_LABELS[item.blockType ?? 'other'], blockType: item.blockType };
          if (item.kind === 'break') return { ...base, label: 'Recovery break' };
          if (item.kind === 'available') return { ...base, label: 'Available' };
          return { ...base, label: 'Not available' };
        });
  return { session: publicSession(session, availability), mode, entries };
}

async function intervalsOf(db: Db, sessionId: string) {
  return loadIntervals(db, [sessionId]);
}

// ---------------------------------------------------------------- booking

export async function previewBooking(db: Db, sessionId: string, groupSize: number): Promise<BookingPreview> {
  const course = await loadActiveCourse(db);
  const session = await loadSession(db, sessionId);
  return computePreview(db, course, session, groupSize);
}

async function computePreview(db: Db, course: CourseRow, session: SessionRow, groupSize: number, excludeId?: string) {
  const rules = rulesOf(course);
  if (!Number.isInteger(groupSize) || groupSize < rules.minGroupSize || groupSize > rules.maxGroupSize)
    throw new ApiError(422, 'VALIDATION', `Groups must have between ${rules.minGroupSize} and ${rules.maxGroupSize} students.`);
  const blocker = bookingBlocker(session);
  if (blocker) throw new ApiError(409, 'NOT_BOOKABLE', blocker);
  const { input } = await computeSessionSchedule(db, course, session);
  const duration = examDuration(rules, groupSize);
  const base = { ...input, exams: input.exams.filter((e) => e.id !== excludeId) };
  const sim = simulateAdd(base, { id: '__new__', sequence: Number.MAX_SAFE_INTEGER, durationMinutes: duration });
  if (!sim.feasible || !sim.placed) throw capacityError(session);
  return {
    sessionId: session.id,
    date: session.exam_date,
    durationMinutes: duration,
    start: sim.placed.start,
    end: sim.placed.end,
    scheduleVersion: session.schedule_version,
    scheduleStatus: session.schedule_status,
  };
}

function capacityError(session: SessionRow) {
  return new ApiError(
    409,
    'CAPACITY',
    `There is not enough remaining examination time on ${session.exam_date} for a group of this size. Please choose another date.`,
  );
}

export function managedBooking(session: SessionRow, b: BookingRow): ManagedBooking {
  return {
    id: b.id,
    sequence: b.booking_sequence,
    sessionId: b.session_id,
    date: session.exam_date,
    timezone: session.timezone,
    groupName: b.group_name,
    groupSize: b.group_size,
    members: b.members,
    representativeEmail: b.representative_email,
    notes: b.notes,
    status: b.status,
    durationMinutes: b.duration_minutes,
    start: localMinutes(session, b.assigned_start),
    end: localMinutes(session, b.assigned_end),
    scheduleStatus: session.schedule_status,
    revised: isRevised(b),
    createdAt: b.created_at.toISOString(),
    updatedAt: b.updated_at.toISOString(),
  };
}

export function manageUrl(env: Env, token: string) {
  return `${(env.APP_BASE_URL ?? '').replace(/\/$/, '')}/manage#t=${token}`;
}

async function assertUnique(tx: Tx, course: CourseRow, g: GroupInput, exceptId: string | null) {
  const dup = await tx`
    select 1 from bookings where course_id = ${course.id} and status = 'active'
      and lower(group_name) = lower(${g.groupName}) and id is distinct from ${exceptId}`;
  if (dup.length)
    throw new ApiError(409, 'DUPLICATE', 'A group with this name is already registered. Please use a different name.', {
      field: 'groupName',
    });
}

export async function insertBooking(
  tx: Tx,
  course: CourseRow,
  sessionId: string,
  g: GroupInput,
  createdBy: 'student' | 'admin',
): Promise<{ id: string; token: string }> {
  const rules = rulesOf(course);
  const [row] = await tx<{ id: string }[]>`
    insert into bookings (course_id, session_id, group_name, group_size, representative_email, notes, duration_minutes, created_by)
    values (${course.id}, ${sessionId}, ${g.groupName}, ${g.groupSize}, ${g.representativeEmail}, ${g.notes ?? ''},
            ${examDuration(rules, g.groupSize)}, ${createdBy})
    returning id`;
  await insertMembers(tx, row.id, g.members);
  const token = randomToken();
  await tx`insert into booking_credentials (booking_id, token_hash) values (${row.id}, ${await sha256Hex(token)})`;
  return { id: row.id, token };
}

export async function insertMembers(tx: Tx, bookingId: string, members: string[]) {
  await tx`delete from group_members where booking_id = ${bookingId}`;
  for (const [i, name] of members.entries()) {
    await tx`insert into group_members (booking_id, position, name) values (${bookingId}, ${i + 1}, ${name})`;
  }
}

function asStudentError(e: unknown, session?: SessionRow): unknown {
  if (e instanceof ApiError && e.code === 'INFEASIBLE' && session) return capacityError(session);
  if (e instanceof Error && 'code' in e && (e as { code: string }).code === '23505')
    return new ApiError(409, 'DUPLICATE', 'A group with this name is already registered. Please use a different name.', {
      field: 'groupName',
    });
  return e;
}

export interface CreateBookingRequest extends GroupInput {
  sessionId: string;
  expectedVersion?: number;
}

export async function createBooking(sql: Sql, env: Env, req: CreateBookingRequest) {
  if (!isUuid(req.sessionId)) throw new ApiError(404, 'NOT_FOUND', 'Examination session not found.');
  let lockedSession: SessionRow | undefined;
  let created: { id: string; token: string } | undefined;
  try {
    const m = await runMutation(
      sql,
      { actor: 'student', reason: 'Booking created', sessionIds: [req.sessionId] },
      async (tx, course, [session]) => {
        lockedSession = session;
        const blocker = bookingBlocker(session);
        if (blocker) throw new ApiError(409, 'NOT_BOOKABLE', blocker);
        const { value: g, errors } = validateGroup(req, rulesOf(course));
        if (Object.keys(errors).length) throw new ApiError(422, 'VALIDATION', 'Please correct the highlighted fields.', { fields: errors });
        // Never trust a previously displayed estimate: if the schedule changed since the preview, re-preview.
        if (req.expectedVersion !== undefined && req.expectedVersion !== session.schedule_version) {
          const fresh = await computePreview(tx, course, session, g.groupSize);
          throw new ApiError(
            409,
            'STALE_PREVIEW',
            'The schedule changed while you were filling in the form. Please review your updated estimated time and confirm again.',
            { preview: fresh },
          );
        }
        await assertUnique(tx, course, g, null);
        created = await insertBooking(tx, course, session.id, g, 'student');
        return { value: created };
      },
    );
    const session = await loadSession(sql, req.sessionId);
    const booking = await loadBooking(sql, created!.id);
    const url = manageUrl(env, created!.token);
    const emailStatus: EmailStatus = await deliver(
      sql,
      env,
      'confirmation',
      confirmationEmail(m.course, session, booking, url),
      booking.id,
    );
    await sql`update bookings set notified_start = assigned_start, notified_session_id = session_id where id = ${booking.id}`;
    await afterChange(sql, env, m.course, m.summary, [booking.id]);
    await notifyAdmin(
      sql,
      env,
      m.course,
      `New booking: ${booking.group_name}`,
      `${booking.group_name} (${booking.group_size} students) booked ${session.exam_date}.`,
    );
    return { booking: managedBooking(session, booking), managementToken: created!.token, managementUrl: url, emailStatus };
  } catch (e) {
    throw asStudentError(e, lockedSession);
  }
}

async function afterChange(sql: Sql, env: Env, course: CourseRow, summary: ChangeSummary, skip: string[]) {
  const ids = summary.changes.filter((c) => c.after?.status === 'active').map((c) => c.bookingId);
  await notifyTimeChanges(sql, env, course, ids, skip);
}

// ---------------------------------------------------------------- self-management (token)

export async function bookingIdForToken(db: Db, token: unknown): Promise<string> {
  const invalid = new ApiError(
    404,
    'INVALID_LINK',
    'This booking link is invalid or has expired. Please contact the lecturer if you need help.',
  );
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw invalid;
  const rows = await db<{ booking_id: string }[]>`
    select booking_id from booking_credentials
    where token_hash = ${await sha256Hex(token)} and revoked_at is null and (expires_at is null or expires_at > now())`;
  if (!rows[0]) throw invalid;
  return rows[0].booking_id;
}

export async function viewManagedBooking(db: Db, token: unknown) {
  const id = await bookingIdForToken(db, token);
  const booking = await loadBooking(db, id);
  const session = await loadSession(db, booking.session_id);
  return { booking: managedBooking(session, booking), sessions: await listPublicSessions(db) };
}

export interface UpdateBookingRequest extends GroupInput {
  token: string;
  sessionId: string;
  preview?: boolean;
}

export async function updateManagedBooking(sql: Sql, env: Env, req: UpdateBookingRequest) {
  const id = await bookingIdForToken(sql, req.token);
  const current = await loadBooking(sql, id);
  const targetId = isUuid(req.sessionId) ? req.sessionId : current.session_id;
  let targetSession: SessionRow | undefined;
  try {
    const m = await runMutation(
      sql,
      { actor: 'student', reason: 'Booking modified by student', sessionIds: [current.session_id, targetId], preview: req.preview },
      async (tx, course, sessions) => {
        const b = await loadBooking(tx, id, true);
        if (b.status !== 'active') throw new ApiError(409, 'CANCELLED', 'This booking has been cancelled.');
        const from = sessions.find((s) => s.id === b.session_id)!;
        const to = sessions.find((s) => s.id === targetId)!;
        targetSession = to;
        const { value: g, errors } = validateGroup(req, rulesOf(course));
        if (Object.keys(errors).length) throw new ApiError(422, 'VALIDATION', 'Please correct the highlighted fields.', { fields: errors });
        const moving = to.id !== from.id;
        const resizing = g.groupSize !== b.group_size;
        if ((moving || resizing) && from.schedule_status === 'finalized')
          throw new ApiError(
            409,
            'FINALIZED',
            'The schedule for your date is finalized. Please contact the lecturer to change the date or group size.',
          );
        if (resizing && !moving && from.registration_status !== 'open')
          throw new ApiError(
            409,
            'NOT_BOOKABLE',
            'Registration for your date is closed, so the group size can no longer be changed. Please contact the lecturer.',
          );
        if (moving) {
          const blocker = bookingBlocker(to);
          if (blocker) throw new ApiError(409, 'NOT_BOOKABLE', blocker);
        }
        await assertUnique(tx, course, g, b.id);
        await tx`
          update bookings set group_name = ${g.groupName}, group_size = ${g.groupSize}, representative_email = ${g.representativeEmail},
            notes = ${g.notes ?? ''}, updated_at = now(),
            session_id = ${to.id},
            priority = ${moving ? tx`nextval('booking_priority_seq')` : tx`priority`},
            manual_position = ${moving ? null : b.manual_position},
            assigned_start = ${moving ? null : b.assigned_start}, assigned_end = ${moving ? null : b.assigned_end}
          where id = ${b.id}`;
        await insertMembers(tx, b.id, g.members);
        return { value: null };
      },
    );
    const booking = await loadBooking(sql, id);
    const session = await loadSession(sql, booking.session_id);
    if (req.preview) {
      // The transaction was rolled back: read the simulated values from the change summary.
      const change = m.summary.changes.find((c) => c.bookingId === id);
      const after = change
        ? change.after
        : {
            sessionId: session.id,
            date: session.exam_date,
            start: localMinutes(session, booking.assigned_start),
            end: localMinutes(session, booking.assigned_end),
          };
      return { preview: true as const, after, summary: m.summary };
    }
    await deliver(sql, env, 'modification', simpleEmail(m.course, session, booking, 'modification'), booking.id);
    await sql`update bookings set notified_start = assigned_start, notified_session_id = session_id where id = ${booking.id}`;
    await afterChange(sql, env, m.course, m.summary, [booking.id]);
    await notifyAdmin(
      sql,
      env,
      m.course,
      `Booking modified: ${booking.group_name}`,
      `${booking.group_name} updated their booking (${session.exam_date}, ${booking.group_size} students).`,
    );
    return { preview: false, booking: managedBooking(session, booking) };
  } catch (e) {
    throw asStudentError(e, targetSession);
  }
}

export async function cancelManagedBooking(sql: Sql, env: Env, token: unknown, confirmation: unknown) {
  const id = await bookingIdForToken(sql, token);
  const current = await loadBooking(sql, id);
  if (current.status !== 'active') throw new ApiError(409, 'CANCELLED', 'This booking has already been cancelled.');
  if (typeof confirmation !== 'string' || confirmation.trim().toLowerCase() !== current.group_name.toLowerCase())
    throw new ApiError(422, 'CONFIRMATION', 'Please type the group name exactly to confirm the cancellation.');
  const m = await runMutation(
    sql,
    { actor: 'student', reason: 'Booking cancelled by student', sessionIds: [current.session_id] },
    async (tx) => {
      await cancelBookingRow(tx, id);
      return { value: null };
    },
  );
  const booking = await loadBooking(sql, id);
  const session = await loadSession(sql, booking.session_id);
  await deliver(sql, env, 'cancellation', simpleEmail(m.course, session, booking, 'cancellation'), booking.id);
  await afterChange(sql, env, m.course, m.summary, [id]);
  await notifyAdmin(
    sql,
    env,
    m.course,
    `Booking cancelled: ${booking.group_name}`,
    `${booking.group_name} cancelled their booking for ${session.exam_date}.`,
  );
  return { booking: managedBooking(session, booking) };
}

export async function cancelBookingRow(tx: Tx, id: string) {
  await tx`
    update bookings set status = 'cancelled', cancelled_at = now(), updated_at = now(),
      assigned_start = null, assigned_end = null, manual_position = null
    where id = ${id}`;
}
