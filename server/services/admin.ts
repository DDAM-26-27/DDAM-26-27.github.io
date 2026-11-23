/** Administrator operations. Every function here must only be reachable after `authenticate`. */
import type { Db, Sql, Tx } from '../db';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { randomToken, sha256Hex } from '../crypto';
import {
  dayAvailability,
  isUuid,
  loadActiveCourse,
  loadBooking,
  loadBookings,
  loadCourseBookings,
  loadIntervals,
  loadSession,
  loadSessions,
  localMinutes,
  minutesOf,
  rulesOf,
  type BookingRow,
  type CourseRow,
  type IntervalRow,
  type SessionRow,
} from '../repo';
import { computeSessionSchedule, runMutation, type ChangeSummary } from './schedule';
import { cancelBookingRow, insertBooking, insertMembers, manageUrl, sessionAvailability } from './bookings';
import { buildTimeline, computeStats, validateAvailability } from '../../shared/scheduler';
import { validateRules } from '../../shared/rules';
import { normalizeText, validateGroup, type GroupInput } from '../../shared/validation';
import { formatTime, parseTime } from '../../shared/time';
import { BLOCK_TYPES, BLOCK_TYPE_LABELS, type BlockType, type DurationRules, type PublicScheduleMode } from '../../shared/types';
import { isoWithOffset, toCsv, toIcs } from '../../shared/export';
import { confirmationEmail, deliver, notifyTimeChanges, simpleEmail } from './notify';

const audit = (db: Db, actor: string, action: string, entity: string, id: string | null, details: object = {}) =>
  db`insert into audit_log (actor, action, entity, entity_id, details) values (${actor}, ${action}, ${entity}, ${id}, ${db.json(details as never)})`;

// ---------------------------------------------------------------- DTOs

function adminSession(s: SessionRow) {
  return {
    id: s.id,
    date: s.exam_date,
    startTime: s.start_time.slice(0, 5),
    endTime: s.end_time.slice(0, 5),
    timezone: s.timezone,
    title: s.title,
    location: s.location,
    registrationStatus: s.registration_status,
    scheduleStatus: s.schedule_status,
    scheduleVersion: s.schedule_version,
    scheduleUpdatedAt: s.schedule_updated_at?.toISOString() ?? null,
    finalizedAt: s.finalized_at?.toISOString() ?? null,
  };
}

function adminBooking(
  session: SessionRow | undefined,
  b: BookingRow,
  extra: { placement?: string; gapFill?: boolean; reason?: string } = {},
) {
  const lm = (d: Date | null) => (session ? localMinutes(session, d) : null);
  return {
    id: b.id,
    sessionId: b.session_id,
    date: session?.exam_date ?? null,
    sequence: b.booking_sequence,
    priority: Number(b.priority),
    groupName: b.group_name,
    groupSize: b.group_size,
    members: b.members,
    representativeEmail: b.representative_email,
    notes: b.notes,
    status: b.status,
    durationMinutes: b.duration_minutes,
    start: lm(b.assigned_start),
    end: lm(b.assigned_end),
    confirmedStart: lm(b.confirmed_start),
    confirmedEnd: lm(b.confirmed_end),
    revised: b.confirmed_start !== null && b.assigned_start?.getTime() !== b.confirmed_start.getTime(),
    manualPosition: b.manual_position,
    capacityOverride: b.capacity_override,
    createdBy: b.created_by,
    createdAt: b.created_at.toISOString(),
    updatedAt: b.updated_at.toISOString(),
    cancelledAt: b.cancelled_at?.toISOString() ?? null,
    placement: extra.placement ?? null,
    gapFill: extra.gapFill ?? false,
    unscheduledReason: extra.reason ?? null,
  };
}
export type AdminBookingDTO = ReturnType<typeof adminBooking>;

function intervalDto(i: IntervalRow) {
  return {
    id: i.id,
    kind: i.kind,
    blockType: i.block_type,
    start: i.start_time.slice(0, 5),
    end: i.end_time.slice(0, 5),
    label: i.label,
    description: i.description,
  };
}

function courseDto(c: CourseRow) {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    academicYear: c.academic_year,
    description: c.description,
    institution: c.institution,
    timezone: c.timezone,
    contactEmail: c.contact_email,
    publicScheduleMode: c.public_schedule_mode,
    privacyText: c.privacy_text,
    notifyThresholdMinutes: c.notify_threshold_minutes,
    rules: rulesOf(c),
  };
}

// ---------------------------------------------------------------- reads

async function sessionView(db: Db, course: CourseRow, session: SessionRow) {
  const { availability, result, bookings } = await sessionAvailability(db, course, session);
  const intervals = await loadIntervals(db, [session.id]);
  const day = dayAvailability(session, intervals);
  // The displayed schedule is always the persisted one.
  const placed = bookings
    .filter((b) => b.assigned_start)
    .map((b) => ({ id: b.id, start: localMinutes(session, b.assigned_start)!, end: localMinutes(session, b.assigned_end)! }));
  const timeline = buildTimeline(day, placed, course.break_minutes);
  const stats = computeStats(day, placed, timeline);
  const engine = new Map(result.scheduled.map((s) => [s.id, s]));
  const reasons = new Map(result.unscheduled.map((u) => [u.id, u.reason]));
  const rows = bookings.map((b) =>
    adminBooking(session, b, {
      placement: session.schedule_status === 'finalized' ? 'pinned' : b.manual_position != null ? 'manual' : 'auto',
      gapFill: engine.get(b.id)?.gapFill ?? false,
      reason: b.assigned_start ? undefined : (reasons.get(b.id) ?? 'Not scheduled'),
    }),
  );
  rows.sort((a, b) => (a.start ?? 1e6) - (b.start ?? 1e6) || a.priority - b.priority);
  const attention = rows.filter((r) => r.start == null || r.revised).length;
  return {
    session: adminSession(session),
    intervals: intervals.map(intervalDto),
    bookings: rows,
    timeline,
    stats,
    availability,
    manualOrder: bookings.some((b) => b.manual_position != null),
    attention,
  };
}

export async function overview(db: Db) {
  const course = await loadActiveCourse(db);
  const sessions = await loadSessions(db, course.id);
  const views: Awaited<ReturnType<typeof sessionView>>[] = [];
  for (const s of sessions) views.push(await sessionView(db, course, s));
  const sum = (f: (v: (typeof views)[number]) => number) => views.reduce((acc, v) => acc + f(v), 0);
  return {
    course: courseDto(course),
    sessions: views.map((v) => ({
      ...v.session,
      stats: v.stats,
      availability: v.availability,
      attention: v.attention,
      groupCount: v.bookings.length,
    })),
    totals: {
      sessions: views.length,
      groups: sum((v) => v.bookings.length),
      students: sum((v) => v.bookings.reduce((s, b) => s + b.groupSize, 0)),
      examMinutes: sum((v) => v.stats.examMinutes),
      breakMinutes: sum((v) => v.stats.breakMinutes),
      blockedMinutes: sum((v) => v.stats.blockedMinutes),
      availableMinutes: sum((v) => v.stats.availableMinutes),
      attention: sum((v) => v.attention),
    },
    attention: views.flatMap((v) =>
      v.bookings
        .filter((b) => b.start == null || b.revised)
        .map((b) => ({
          bookingId: b.id,
          sessionId: v.session.id,
          date: v.session.date,
          groupName: b.groupName,
          issue: b.start == null ? (b.unscheduledReason ?? 'Not scheduled') : 'Time differs from the confirmed (finalized) time',
        })),
    ),
  };
}

export async function sessionDetail(db: Db, id: string) {
  const course = await loadActiveCourse(db);
  const session = await loadSession(db, id);
  const view = await sessionView(db, course, session);
  const cancelled = (await loadBookings(db, [id], true)).filter((b) => b.status === 'cancelled').map((b) => adminBooking(session, b));
  const revisions = await db<{ version: number; actor: string; reason: string; schedule_status: string; created_at: Date }[]>`
    select version, actor, reason, schedule_status, created_at from schedule_revisions
    where session_id = ${id} order by version desc limit 50`;
  const otherSessions = (await loadSessions(db, course.id)).map(adminSession);
  return {
    ...view,
    course: courseDto(course),
    cancelled,
    revisions: revisions.map((r) => ({ ...r, createdAt: r.created_at.toISOString(), created_at: undefined })),
    allSessions: otherSessions,
  };
}

export async function notificationsLog(db: Db) {
  const rows = await db`select id, booking_id, kind, to_email, subject, body, status, provider, error, created_at
    from notifications order by created_at desc limit 200`;
  return rows.map((r) => ({
    id: r.id,
    bookingId: r.booking_id,
    kind: r.kind,
    to: r.to_email,
    subject: r.subject,
    body: r.body,
    status: r.status,
    provider: r.provider,
    error: r.error,
    createdAt: (r.created_at as Date).toISOString(),
  }));
}

// ---------------------------------------------------------------- validation helpers

interface SessionInput {
  date: string;
  startTime: string;
  endTime: string;
  title?: string | null;
  location?: string | null;
  registrationStatus?: 'draft' | 'open' | 'closed';
}

function parseSessionInput(raw: Partial<SessionInput>): SessionInput {
  const date = String(raw.date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
    throw new ApiError(422, 'VALIDATION', 'Please provide a valid date.');
  let start: number;
  let end: number;
  try {
    start = parseTime(String(raw.startTime));
    end = parseTime(String(raw.endTime));
  } catch {
    throw new ApiError(422, 'VALIDATION', 'Please provide valid start and end times (HH:MM).');
  }
  if (end <= start) throw new ApiError(422, 'VALIDATION', 'The end time must be after the start time.');
  const status = raw.registrationStatus ?? 'draft';
  if (!['draft', 'open', 'closed'].includes(status)) throw new ApiError(422, 'VALIDATION', 'Invalid registration status.');
  const title = normalizeText(raw.title) || null;
  const location = normalizeText(raw.location) || null;
  if ((title?.length ?? 0) > 200 || (location?.length ?? 0) > 200)
    throw new ApiError(422, 'VALIDATION', 'Title and location must be at most 200 characters.');
  return { date, startTime: formatTime(start), endTime: formatTime(end), title, location, registrationStatus: status };
}

export interface IntervalInput {
  kind: 'window' | 'blocked';
  blockType?: BlockType | null;
  start: string;
  end: string;
  label?: string | null;
  description?: string | null;
}

function parseIntervals(raw: unknown): IntervalInput[] {
  if (!Array.isArray(raw) || raw.length > 50) throw new ApiError(422, 'VALIDATION', 'Invalid list of intervals.');
  return raw.map((r: Partial<IntervalInput>) => {
    const kind = r.kind === 'window' ? 'window' : r.kind === 'blocked' ? 'blocked' : null;
    if (!kind) throw new ApiError(422, 'VALIDATION', 'Invalid interval kind.');
    const blockType = kind === 'blocked' ? (BLOCK_TYPES.includes(r.blockType as BlockType) ? (r.blockType as BlockType) : 'other') : null;
    let s: number, e: number;
    try {
      s = parseTime(String(r.start));
      e = parseTime(String(r.end));
    } catch {
      throw new ApiError(422, 'VALIDATION', 'Interval times must use the HH:MM format.');
    }
    const label = normalizeText(r.label).slice(0, 100) || null;
    const description = normalizeText(r.description).slice(0, 500) || null;
    return { kind, blockType, start: formatTime(s), end: formatTime(e), label, description };
  });
}

function checkAvailability(start: string, end: string, intervals: IntervalInput[]) {
  const errors = validateAvailability({
    dayStart: parseTime(start),
    dayEnd: parseTime(end),
    windows: intervals.filter((i) => i.kind === 'window').map((i) => ({ start: parseTime(i.start), end: parseTime(i.end) })),
    blocks: intervals
      .filter((i) => i.kind === 'blocked')
      .map((i) => ({ start: parseTime(i.start), end: parseTime(i.end), type: i.blockType ?? 'other' })),
  });
  if (errors.length) throw new ApiError(422, 'INVALID_INTERVALS', errors.join(' '), { errors });
}

async function writeIntervals(tx: Tx, sessionId: string, intervals: IntervalInput[]) {
  await tx`delete from availability_intervals where session_id = ${sessionId}`;
  for (const i of intervals) {
    await tx`
      insert into availability_intervals (session_id, kind, block_type, start_time, end_time, label, description)
      values (${sessionId}, ${i.kind}, ${i.blockType ?? null}, ${i.start}, ${i.end}, ${i.label ?? null}, ${i.description ?? null})`;
  }
}

export interface MutationFlags {
  preview?: boolean;
  override?: boolean;
}

function done<T>(m: { summary: ChangeSummary; value: T }, flags: MutationFlags) {
  return { preview: !!flags.preview, summary: m.summary, value: m.value };
}

async function afterAdminChange(sql: Sql, env: Env, course: CourseRow, summary: ChangeSummary, skip: string[] = []) {
  await notifyTimeChanges(
    sql,
    env,
    course,
    summary.changes.filter((c) => c.after?.status === 'active').map((c) => c.bookingId),
    skip,
  );
}

// ---------------------------------------------------------------- sessions

export async function createSession(sql: Sql, actor: string, raw: Partial<SessionInput> & { intervals?: unknown }) {
  const input = parseSessionInput(raw);
  const intervals = parseIntervals(raw.intervals ?? []);
  checkAvailability(input.startTime, input.endTime, intervals);
  return sql.begin(async (tx) => {
    const course = await loadActiveCourse(tx);
    const exists = await tx`select 1 from exam_sessions where course_id = ${course.id} and exam_date = ${input.date}`;
    if (exists.length)
      throw new ApiError(
        409,
        'DUPLICATE',
        'An examination session already exists on this date. Edit it or add availability windows instead.',
      );
    const [row] = await tx<{ id: string }[]>`
      insert into exam_sessions (course_id, exam_date, start_time, end_time, timezone, title, location, registration_status)
      values (${course.id}, ${input.date}, ${input.startTime}, ${input.endTime}, ${course.timezone}, ${input.title ?? null},
              ${input.location ?? null}, ${input.registrationStatus ?? 'draft'})
      returning id`;
    await writeIntervals(tx, row.id, intervals);
    await audit(tx, actor, 'create', 'session', row.id, input);
    return { id: row.id };
  });
}

export async function updateSession(sql: Sql, env: Env, actor: string, id: string, raw: Partial<SessionInput>, flags: MutationFlags) {
  const input = parseSessionInput(raw);
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Session settings changed', sessionIds: [id], ...flags },
    async (tx, course) => {
      const current = await loadIntervals(tx, [id]);
      checkAvailability(
        input.startTime,
        input.endTime,
        current.map((i) => ({ kind: i.kind, blockType: i.block_type, start: i.start_time.slice(0, 5), end: i.end_time.slice(0, 5) })),
      );
      const dup = await tx`select 1 from exam_sessions where course_id = ${course.id} and exam_date = ${input.date} and id <> ${id}`;
      if (dup.length) throw new ApiError(409, 'DUPLICATE', 'Another session already exists on this date.');
      await tx`
      update exam_sessions set exam_date = ${input.date}, start_time = ${input.startTime}, end_time = ${input.endTime},
        title = ${input.title ?? null}, location = ${input.location ?? null},
        registration_status = ${input.registrationStatus ?? 'draft'}, updated_at = now()
      where id = ${id}`;
      await audit(tx, actor, 'update', 'session', id, input);
      return { value: null };
    },
  );
  if (!flags.preview) await afterAdminChange(sql, env, m.course, m.summary);
  return done(m, flags);
}

export async function setRegistration(sql: Sql, actor: string, id: string, status: unknown) {
  if (status !== 'draft' && status !== 'open' && status !== 'closed') throw new ApiError(422, 'VALIDATION', 'Invalid registration status.');
  const s = await loadSession(sql, id);
  if (status === 'open' && s.schedule_status === 'finalized')
    throw new ApiError(409, 'FINALIZED', 'Unlock the schedule before reopening registration.');
  await sql`update exam_sessions set registration_status = ${status}, updated_at = now() where id = ${id}`;
  await audit(sql, actor, 'registration', 'session', id, { status });
  return { ok: true };
}

export async function deleteSession(sql: Sql, actor: string, id: string) {
  return sql.begin(async (tx) => {
    await loadSession(tx, id, true);
    const active = await tx`select 1 from bookings where session_id = ${id} and status = 'active' limit 1`;
    if (active.length) throw new ApiError(409, 'HAS_BOOKINGS', 'This session still has active bookings. Move or cancel them first.');
    await tx`delete from bookings where session_id = ${id} and status = 'cancelled'`;
    await tx`delete from exam_sessions where id = ${id}`;
    await audit(tx, actor, 'delete', 'session', id);
    return { ok: true };
  });
}

export async function replaceIntervals(sql: Sql, env: Env, actor: string, id: string, raw: unknown, flags: MutationFlags) {
  const intervals = parseIntervals(raw);
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Availability changed', sessionIds: [id], ...flags },
    async (tx, _c, [s]) => {
      checkAvailability(s.start_time.slice(0, 5), s.end_time.slice(0, 5), intervals);
      await writeIntervals(tx, id, intervals);
      await audit(tx, actor, 'intervals', 'session', id, { intervals });
      return { value: null };
    },
  );
  if (!flags.preview) await afterAdminChange(sql, env, m.course, m.summary);
  return done(m, flags);
}

// ---------------------------------------------------------------- course & rules

interface CourseInput {
  name: string;
  academicYear: string;
  description: string;
  institution: string;
  contactEmail: string | null;
  publicScheduleMode: PublicScheduleMode;
  privacyText: string;
  notifyThresholdMinutes: number;
  rules: DurationRules;
}

export async function updateCourse(sql: Sql, env: Env, actor: string, raw: Partial<CourseInput>, flags: MutationFlags) {
  const rules = raw.rules as DurationRules;
  const ruleErrors = rules ? validateRules(rules) : ['Missing rules.'];
  if (ruleErrors.length) throw new ApiError(422, 'VALIDATION', ruleErrors.join(' '));
  const name = normalizeText(raw.name);
  const academicYear = normalizeText(raw.academicYear);
  if (name.length < 2 || academicYear.length < 4) throw new ApiError(422, 'VALIDATION', 'Course name and academic year are required.');
  const mode = raw.publicScheduleMode ?? 'names';
  if (!['names', 'anonymous', 'hidden'].includes(mode)) throw new ApiError(422, 'VALIDATION', 'Invalid schedule visibility.');
  const threshold = Number(raw.notifyThresholdMinutes ?? 30);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 600)
    throw new ApiError(422, 'VALIDATION', 'Invalid notification threshold.');
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Course rules changed', sessionIds: [], allSessions: true, ...flags },
    async (tx, course) => {
      await tx`
      update courses set name = ${name}, academic_year = ${academicYear}, description = ${String(raw.description ?? '').slice(0, 5000)},
        institution = ${normalizeText(raw.institution).slice(0, 200)}, contact_email = ${normalizeText(raw.contactEmail) || null},
        public_schedule_mode = ${mode}, privacy_text = ${String(raw.privacyText ?? '').slice(0, 20000)},
        notify_threshold_minutes = ${threshold}, updated_at = now()
      where id = ${course.id}`;
      await tx`
      update scheduling_configs set presentation_minutes = ${rules.presentationMinutes},
        questions_per_student_minutes = ${rules.questionsPerStudentMinutes}, break_minutes = ${rules.breakMinutes},
        min_group_size = ${rules.minGroupSize}, max_group_size = ${rules.maxGroupSize}, updated_at = now()
      where course_id = ${course.id}`;
      await audit(tx, actor, 'update', 'course', course.id, { rules });
      return { value: null };
    },
  );
  if (!flags.preview) await afterAdminChange(sql, env, m.course, m.summary);
  return done(m, flags);
}

// ---------------------------------------------------------------- bookings

export async function adminCreateBooking(
  sql: Sql,
  env: Env,
  actor: string,
  sessionId: string,
  raw: Partial<GroupInput> & { sendEmail?: boolean },
  flags: MutationFlags,
) {
  let created: { id: string; token: string } | undefined;
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Group added by administrator', sessionIds: [sessionId], ...flags },
    async (tx, course) => {
      const { value: g, errors } = validateGroup(raw, { ...rulesOf(course), maxGroupSize: 20, minGroupSize: 1 });
      if (Object.keys(errors).length) throw new ApiError(422, 'VALIDATION', 'Please correct the highlighted fields.', { fields: errors });
      const dup =
        await tx`select 1 from bookings where course_id = ${course.id} and status = 'active' and lower(group_name) = lower(${g.groupName})`;
      if (dup.length) throw new ApiError(409, 'DUPLICATE', 'A group with this name is already registered.');
      created = await insertBooking(tx, course, sessionId, g, 'admin');
      await audit(tx, actor, 'create', 'booking', created.id, { sessionId, group: g.groupName });
      return { value: created };
    },
  );
  if (flags.preview || !created) return done({ summary: m.summary, value: null }, flags);
  const booking = await loadBooking(sql, created.id);
  const session = await loadSession(sql, sessionId);
  const url = manageUrl(env, created.token);
  let emailStatus = 'skipped';
  if (raw.sendEmail) {
    emailStatus = await deliver(sql, env, 'confirmation', confirmationEmail(m.course, session, booking, url), booking.id);
    await sql`update bookings set notified_start = assigned_start, notified_session_id = session_id where id = ${booking.id}`;
  }
  await afterAdminChange(sql, env, m.course, m.summary, [booking.id]);
  return { preview: false, summary: m.summary, value: { id: booking.id, managementUrl: url, emailStatus } };
}

export async function adminUpdateBooking(
  sql: Sql,
  env: Env,
  actor: string,
  id: string,
  raw: Partial<GroupInput> & { sessionId?: string; notify?: boolean },
  flags: MutationFlags,
) {
  const current = await loadBooking(sql, id);
  if (current.status !== 'active') throw new ApiError(409, 'CANCELLED', 'This booking is cancelled.');
  const target = raw.sessionId && isUuid(raw.sessionId) ? raw.sessionId : current.session_id;
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Booking edited by administrator', sessionIds: [current.session_id, target], ...flags },
    async (tx, course) => {
      const b = await loadBooking(tx, id, true);
      const { value: g, errors } = validateGroup(raw, { ...rulesOf(course), maxGroupSize: 20, minGroupSize: 1 });
      if (Object.keys(errors).length) throw new ApiError(422, 'VALIDATION', 'Please correct the highlighted fields.', { fields: errors });
      const dup =
        await tx`select 1 from bookings where course_id = ${course.id} and status = 'active' and lower(group_name) = lower(${g.groupName}) and id <> ${id}`;
      if (dup.length) throw new ApiError(409, 'DUPLICATE', 'A group with this name is already registered.');
      const moving = target !== b.session_id;
      await tx`
      update bookings set group_name = ${g.groupName}, group_size = ${g.groupSize}, representative_email = ${g.representativeEmail},
        notes = ${g.notes ?? ''}, session_id = ${target}, updated_at = now(),
        priority = ${moving ? tx`nextval('booking_priority_seq')` : tx`priority`},
        manual_position = ${moving ? null : b.manual_position},
        assigned_start = ${moving ? null : b.assigned_start}, assigned_end = ${moving ? null : b.assigned_end},
        confirmed_start = ${moving ? null : b.confirmed_start}, confirmed_end = ${moving ? null : b.confirmed_end}
      where id = ${id}`;
      await insertMembers(tx, id, g.members);
      await audit(tx, actor, moving ? 'move' : 'update', 'booking', id, { from: b.session_id, to: target });
      return { value: null };
    },
  );
  if (flags.preview) return done(m, flags);
  const booking = await loadBooking(sql, id);
  const session = await loadSession(sql, booking.session_id);
  if (raw.notify !== false) {
    await deliver(sql, env, 'admin_change', simpleEmail(m.course, session, booking, 'admin_change'), id);
    await sql`update bookings set notified_start = assigned_start, notified_session_id = session_id where id = ${id}`;
  }
  await afterAdminChange(sql, env, m.course, m.summary, [id]);
  return done(m, flags);
}

export async function adminCancelBooking(sql: Sql, env: Env, actor: string, id: string, flags: MutationFlags & { notify?: boolean }) {
  const current = await loadBooking(sql, id);
  if (current.status !== 'active') throw new ApiError(409, 'CANCELLED', 'This booking is already cancelled.');
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Booking cancelled by administrator', sessionIds: [current.session_id], ...flags },
    async (tx) => {
      await cancelBookingRow(tx, id);
      await audit(tx, actor, 'cancel', 'booking', id);
      return { value: null };
    },
  );
  if (flags.preview) return done(m, flags);
  if (flags.notify !== false) {
    const booking = await loadBooking(sql, id);
    const session = await loadSession(sql, booking.session_id);
    await deliver(sql, env, 'cancellation', simpleEmail(m.course, session, booking, 'cancellation'), id);
  }
  await afterAdminChange(sql, env, m.course, m.summary, [id]);
  return done(m, flags);
}

export async function regenerateLink(sql: Sql, env: Env, actor: string, id: string) {
  await loadBooking(sql, id);
  const token = randomToken();
  await sql.begin(async (tx) => {
    await tx`update booking_credentials set revoked_at = now() where booking_id = ${id} and revoked_at is null`;
    await tx`insert into booking_credentials (booking_id, token_hash) values (${id}, ${await sha256Hex(token)})`;
    await audit(tx, actor, 'regenerate_link', 'booking', id);
  });
  return { managementUrl: manageUrl(env, token) };
}

// ---------------------------------------------------------------- ordering & finalization

export async function setOrder(sql: Sql, env: Env, actor: string, sessionId: string, bookingIds: unknown, flags: MutationFlags) {
  const m = await runMutation(
    sql,
    {
      actor: `admin:${actor}`,
      reason: bookingIds ? 'Manual order changed' : 'Manual order reset to automatic',
      sessionIds: [sessionId],
      ...flags,
    },
    async (tx, _c, [s]) => {
      if (s.schedule_status === 'finalized') throw new ApiError(409, 'FINALIZED', 'Unlock the schedule before changing the order.');
      const active = await tx<{ id: string }[]>`select id from bookings where session_id = ${sessionId} and status = 'active'`;
      if (bookingIds === null) {
        await tx`update bookings set manual_position = null where session_id = ${sessionId}`;
      } else {
        if (!Array.isArray(bookingIds)) throw new ApiError(422, 'VALIDATION', 'Invalid order.');
        const set = new Set(active.map((r) => r.id));
        if (bookingIds.length !== set.size || !bookingIds.every((x) => set.has(x)) || new Set(bookingIds).size !== bookingIds.length)
          throw new ApiError(
            422,
            'VALIDATION',
            'The order must list every active group of this session exactly once. Reload and try again.',
          );
        for (const [i, bid] of (bookingIds as string[]).entries())
          await tx`update bookings set manual_position = ${i + 1} where id = ${bid}`;
      }
      await audit(tx, actor, 'order', 'session', sessionId, { bookingIds });
      return { value: null };
    },
  );
  if (!flags.preview) await afterAdminChange(sql, env, m.course, m.summary);
  return done(m, flags);
}

export async function recalculate(sql: Sql, env: Env, actor: string, sessionId: string, flags: MutationFlags) {
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Manual recalculation', sessionIds: [sessionId], ...flags },
    async () => ({ value: null }),
  );
  if (!flags.preview) await afterAdminChange(sql, env, m.course, m.summary);
  return done(m, flags);
}

export async function finalize(sql: Sql, env: Env, actor: string, sessionId: string, flags: MutationFlags) {
  let toNotify: string[] = [];
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Schedule finalized', sessionIds: [sessionId], preview: flags.preview },
    async (tx, course, [s]) => {
      if (s.schedule_status === 'finalized') throw new ApiError(409, 'FINALIZED', 'This schedule is already finalized.');
      const { result } = await computeSessionSchedule(tx, course, s);
      if (!result.feasible) throw new ApiError(409, 'INFEASIBLE', 'Some groups have no examination time. Resolve them before finalizing.');
      const rows = await tx<{ id: string }[]>`
      select id from bookings where session_id = ${sessionId} and status = 'active' and confirmed_start is distinct from assigned_start`;
      toNotify = rows.map((r) => r.id);
      await tx`update exam_sessions set schedule_status = 'finalized', finalized_at = now(), registration_status = 'closed',
      schedule_version = schedule_version + 1, schedule_updated_at = now(), updated_at = now() where id = ${sessionId}`;
      await tx`update bookings set confirmed_start = assigned_start, confirmed_end = assigned_end where session_id = ${sessionId} and status = 'active'`;
      await tx`insert into schedule_revisions (session_id, version, actor, reason, schedule_status, snapshot)
      select id, schedule_version, ${`admin:${actor}`}, 'Schedule finalized', 'finalized', ${tx.json({ finalized: true } as never)} from exam_sessions where id = ${sessionId}`;
      await audit(tx, actor, 'finalize', 'session', sessionId);
      return { value: null };
    },
  );
  if (flags.preview) return done(m, flags);
  const course = await loadActiveCourse(sql);
  const session = await loadSession(sql, sessionId);
  for (const id of toNotify) {
    const b = await loadBooking(sql, id);
    await deliver(sql, env, 'finalized', simpleEmail(course, session, b, 'finalized'), id);
    await sql`update bookings set notified_start = assigned_start, notified_session_id = session_id where id = ${id}`;
  }
  return { ...done(m, flags), notified: toNotify.length };
}

export async function unfinalize(sql: Sql, env: Env, actor: string, sessionId: string, flags: MutationFlags) {
  const m = await runMutation(
    sql,
    { actor: `admin:${actor}`, reason: 'Schedule unlocked', sessionIds: [sessionId], ...flags },
    async (tx, _c, [s]) => {
      if (s.schedule_status !== 'finalized') throw new ApiError(409, 'NOT_FINALIZED', 'This schedule is not finalized.');
      await tx`update exam_sessions set schedule_status = 'tentative', finalized_at = null, updated_at = now() where id = ${sessionId}`;
      // Keep the confirmed relative order as an explicit manual order so unlocking never reshuffles groups silently.
      const hasManual =
        await tx`select 1 from bookings where session_id = ${sessionId} and status = 'active' and manual_position is not null limit 1`;
      if (!hasManual.length) {
        const rows = await tx<{ id: string }[]>`
        select id from bookings where session_id = ${sessionId} and status = 'active' and assigned_start is not null order by assigned_start`;
        for (const [i, r] of rows.entries()) await tx`update bookings set manual_position = ${i + 1} where id = ${r.id}`;
      }
      await audit(tx, actor, 'unfinalize', 'session', sessionId);
      return { value: null };
    },
  );
  if (!flags.preview) await afterAdminChange(sql, env, m.course, m.summary);
  return done(m, flags);
}

// ---------------------------------------------------------------- exports

export async function exportSessionCsv(db: Db, sessionId: string) {
  const course = await loadActiveCourse(db);
  const session = await loadSession(db, sessionId);
  const view = await sessionView(db, course, session);
  const byId = new Map(view.bookings.map((b) => [b.id, b]));
  const status = session.schedule_status === 'finalized' ? 'confirmed' : 'tentative';
  const rows = view.timeline.map((t) => {
    const b = t.bookingId ? byId.get(t.bookingId) : undefined;
    const activity =
      t.kind === 'exam'
        ? 'Examination'
        : t.kind === 'break'
          ? 'Recovery break'
          : t.kind === 'blocked'
            ? t.label || BLOCK_TYPE_LABELS[t.blockType ?? 'other']
            : t.kind === 'available'
              ? 'Available'
              : 'Not available';
    return [
      session.exam_date,
      formatTime(t.start),
      formatTime(t.end),
      isoWithOffset(session.exam_date, t.start, session.timezone),
      isoWithOffset(session.exam_date, t.end, session.timezone),
      session.timezone,
      t.kind,
      activity,
      b?.groupName ?? '',
      b?.groupSize ?? '',
      b?.members.join('; ') ?? '',
      b?.representativeEmail ?? '',
      b ? status : '',
    ];
  });
  for (const b of view.bookings.filter((x) => x.start == null)) {
    rows.push([
      session.exam_date,
      '',
      '',
      '',
      '',
      session.timezone,
      'unscheduled',
      'Unscheduled',
      b.groupName,
      b.groupSize,
      b.members.join('; '),
      b.representativeEmail,
      'unscheduled',
    ]);
  }
  return {
    filename: `${course.slug}-${session.exam_date}-schedule.csv`,
    body: toCsv(
      [
        'date',
        'start_local',
        'end_local',
        'start_iso',
        'end_iso',
        'timezone',
        'type',
        'activity',
        'group',
        'group_size',
        'members',
        'representative_email',
        'status',
      ],
      rows,
    ),
  };
}

export async function exportSessionIcs(db: Db, sessionId: string) {
  const course = await loadActiveCourse(db);
  const session = await loadSession(db, sessionId);
  const view = await sessionView(db, course, session);
  const events = view.bookings
    .filter((b) => b.start != null)
    .map((b) => ({
      uid: `${b.id}@ddam-exam-booking`,
      date: session.exam_date,
      start: b.start!,
      end: b.end!,
      timeZone: session.timezone,
      summary: `${course.name} exam — ${b.groupName}`,
      description: `Students: ${b.members.join(', ')}\nStatus: ${session.schedule_status === 'finalized' ? 'confirmed' : 'tentative'}`,
      location: session.location,
    }));
  return { filename: `${course.slug}-${session.exam_date}.ics`, body: toIcs(events, `${course.name} ${session.exam_date}`) };
}

export async function exportBookingsCsv(db: Db) {
  const course = await loadActiveCourse(db);
  const sessions = new Map((await loadSessions(db, course.id)).map((s) => [s.id, s]));
  const bookings = await loadCourseBookings(db, course.id);
  const rows = bookings.map((b) => {
    const s = sessions.get(b.session_id);
    const start = s ? localMinutes(s, b.assigned_start) : null;
    const end = s ? localMinutes(s, b.assigned_end) : null;
    return [
      b.booking_sequence,
      b.status,
      s?.exam_date ?? '',
      start != null ? formatTime(start) : '',
      end != null ? formatTime(end) : '',
      s && start != null ? isoWithOffset(s.exam_date, start, s.timezone) : '',
      s?.timezone ?? '',
      s?.schedule_status === 'finalized' ? 'confirmed' : 'tentative',
      b.group_name,
      b.group_size,
      b.members.join('; '),
      b.representative_email,
      b.duration_minutes,
      b.notes,
      b.created_by,
      b.created_at.toISOString(),
    ];
  });
  return {
    filename: `${course.slug}-bookings.csv`,
    body: toCsv(
      [
        'sequence',
        'status',
        'date',
        'start_local',
        'end_local',
        'start_iso',
        'timezone',
        'schedule_status',
        'group',
        'group_size',
        'members',
        'representative_email',
        'duration_minutes',
        'notes',
        'created_by',
        'created_at',
      ],
      rows,
    ),
  };
}

export { minutesOf };
