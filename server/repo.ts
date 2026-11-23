/** Data access: row types, loaders and conversion into scheduler inputs and DTOs. */
import type { Db } from './db';
import { ApiError } from './errors';
import { examDuration } from '../shared/rules';
import { localToUtc, parseTime, utcToLocalMinutes } from '../shared/time';
import type {
  BlockType,
  BookingStatus,
  DurationRules,
  IntervalKind,
  PublicCourse,
  PublicScheduleMode,
  RegistrationStatus,
  ScheduleStatus,
} from '../shared/types';
import type { SchedulerExam, SchedulerInput } from '../shared/scheduler';

export interface CourseRow {
  id: string;
  slug: string;
  name: string;
  academic_year: string;
  description: string;
  institution: string;
  timezone: string;
  contact_email: string | null;
  public_schedule_mode: PublicScheduleMode;
  privacy_text: string;
  notify_threshold_minutes: number;
  presentation_minutes: number;
  questions_per_student_minutes: number;
  break_minutes: number;
  min_group_size: number;
  max_group_size: number;
}

export interface SessionRow {
  id: string;
  course_id: string;
  exam_date: string;
  start_time: string;
  end_time: string;
  timezone: string;
  title: string | null;
  location: string | null;
  registration_status: RegistrationStatus;
  schedule_status: ScheduleStatus;
  schedule_version: number;
  schedule_updated_at: Date | null;
  finalized_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IntervalRow {
  id: string;
  session_id: string;
  kind: IntervalKind;
  block_type: BlockType | null;
  start_time: string;
  end_time: string;
  label: string | null;
  description: string | null;
}

export interface BookingRow {
  id: string;
  course_id: string;
  session_id: string;
  booking_sequence: number;
  priority: string; // bigint
  group_name: string;
  group_size: number;
  representative_email: string;
  notes: string;
  status: BookingStatus;
  duration_minutes: number;
  assigned_start: Date | null;
  assigned_end: Date | null;
  schedule_version: number;
  manual_position: number | null;
  confirmed_start: Date | null;
  confirmed_end: Date | null;
  notified_start: Date | null;
  notified_session_id: string | null;
  capacity_override: boolean;
  created_by: 'student' | 'admin';
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  members: string[];
}

export function rulesOf(c: CourseRow): DurationRules {
  return {
    presentationMinutes: c.presentation_minutes,
    questionsPerStudentMinutes: c.questions_per_student_minutes,
    breakMinutes: c.break_minutes,
    minGroupSize: c.min_group_size,
    maxGroupSize: c.max_group_size,
  };
}

export function publicCourse(c: CourseRow): PublicCourse {
  return {
    id: c.id,
    name: c.name,
    academicYear: c.academic_year,
    description: c.description,
    institution: c.institution,
    timezone: c.timezone,
    contactEmail: c.contact_email,
    privacyText: c.privacy_text,
    publicScheduleMode: c.public_schedule_mode,
    rules: rulesOf(c),
  };
}

export async function loadActiveCourse(db: Db): Promise<CourseRow> {
  const rows = await db<CourseRow[]>`
    select c.*, s.presentation_minutes, s.questions_per_student_minutes, s.break_minutes,
           s.min_group_size, s.max_group_size
    from courses c join scheduling_configs s on s.course_id = c.id
    where c.is_active
    limit 1`;
  if (!rows[0]) throw new ApiError(503, 'NO_COURSE', 'No active course is configured yet.');
  return rows[0];
}

export async function loadSessions(db: Db, courseId: string): Promise<SessionRow[]> {
  return db<SessionRow[]>`select * from exam_sessions where course_id = ${courseId} order by exam_date, start_time`;
}

export async function loadSession(db: Db, id: string, lock = false): Promise<SessionRow> {
  if (!isUuid(id)) throw new ApiError(404, 'NOT_FOUND', 'Examination session not found.');
  const rows = lock
    ? await db<SessionRow[]>`select * from exam_sessions where id = ${id} for update`
    : await db<SessionRow[]>`select * from exam_sessions where id = ${id}`;
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Examination session not found.');
  return rows[0];
}

/** Locks several sessions in a stable order (prevents deadlocks). */
export async function lockSessions(db: Db, ids: string[]): Promise<SessionRow[]> {
  const unique = [...new Set(ids)].sort();
  const out: SessionRow[] = [];
  for (const id of unique) out.push(await loadSession(db, id, true));
  return out;
}

export async function loadIntervals(db: Db, sessionIds: string[]): Promise<IntervalRow[]> {
  if (sessionIds.length === 0) return [];
  return db<IntervalRow[]>`
    select * from availability_intervals where session_id in ${db(sessionIds)} order by start_time`;
}

const bookingSelect = (db: Db) => db`
  select b.*, coalesce(
    (select array_agg(m.name order by m.position) from group_members m where m.booking_id = b.id), '{}'
  ) as members
  from bookings b`;

export async function loadBookings(db: Db, sessionIds: string[], includeCancelled = false): Promise<BookingRow[]> {
  if (sessionIds.length === 0) return [];
  return db<BookingRow[]>`
    ${bookingSelect(db)}
    where b.session_id in ${db(sessionIds)} ${includeCancelled ? db`` : db`and b.status = 'active'`}
    order by b.priority, b.booking_sequence`;
}

export async function loadCourseBookings(db: Db, courseId: string): Promise<BookingRow[]> {
  return db<BookingRow[]>`${bookingSelect(db)} where b.course_id = ${courseId} order by b.booking_sequence`;
}

export async function loadBooking(db: Db, id: string, lock = false): Promise<BookingRow> {
  if (!isUuid(id)) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
  if (lock) await db`select id from bookings where id = ${id} for update`;
  const rows = await db<BookingRow[]>`${bookingSelect(db)} where b.id = ${id}`;
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Booking not found.');
  return rows[0];
}

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// ---------------------------------------------------------------- conversions

export const minutesOf = (time: string) => parseTime(time.slice(0, 5));

export function localMinutes(session: SessionRow, instant: Date | null): number | null {
  return instant ? utcToLocalMinutes(instant, session.exam_date, session.timezone) : null;
}

export function instantOf(session: SessionRow, minutes: number): Date {
  return localToUtc(session.exam_date, minutes, session.timezone);
}

export function dayAvailability(session: SessionRow, intervals: IntervalRow[]) {
  const mine = intervals.filter((i) => i.session_id === session.id);
  return {
    dayStart: minutesOf(session.start_time),
    dayEnd: minutesOf(session.end_time),
    windows: mine.filter((i) => i.kind === 'window').map((i) => ({ start: minutesOf(i.start_time), end: minutesOf(i.end_time) })),
    blocks: mine
      .filter((i) => i.kind === 'blocked')
      .map((i) => ({
        id: i.id,
        start: minutesOf(i.start_time),
        end: minutesOf(i.end_time),
        type: (i.block_type ?? 'other') as BlockType,
        label: i.label,
      })),
  };
}

/** Converts stored state into a scheduler input. Finalized sessions pin assigned times. */
export function schedulerInput(
  course: CourseRow,
  session: SessionRow,
  intervals: IntervalRow[],
  bookings: BookingRow[],
  extra: SchedulerExam[] = [],
): SchedulerInput {
  const rules = rulesOf(course);
  const finalized = session.schedule_status === 'finalized';
  const exams: SchedulerExam[] = bookings
    .filter((b) => b.status === 'active' && b.session_id === session.id)
    .map((b) => ({
      id: b.id,
      sequence: Number(b.priority),
      durationMinutes: examDuration(rules, b.group_size),
      manualPosition: b.manual_position,
      pinnedStart: finalized && b.assigned_start ? localMinutes(session, b.assigned_start) : null,
    }));
  return { ...dayAvailability(session, intervals), breakMinutes: rules.breakMinutes, exams: [...exams, ...extra] };
}

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
