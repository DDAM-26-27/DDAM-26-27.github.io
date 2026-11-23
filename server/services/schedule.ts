/** Authoritative (server-side) schedule computation, persistence and change tracking. */
import type { Db, Sql, Tx } from '../db';
import { ApiError, PreviewRollback } from '../errors';
import {
  instantOf,
  loadActiveCourse,
  loadBookings,
  loadIntervals,
  localMinutes,
  lockSessions,
  schedulerInput,
  type BookingRow,
  type CourseRow,
  type SessionRow,
} from '../repo';
import { schedule, type ScheduleResult } from '../../shared/scheduler';
import { examDuration } from '../../shared/rules';
import { rulesOf } from '../repo';

export interface BookingState {
  sessionId: string;
  date: string;
  start: number | null;
  end: number | null;
  status: 'active' | 'cancelled';
}

export interface BookingChange {
  bookingId: string;
  groupName: string;
  before: BookingState | null;
  after: BookingState | null;
}

export interface UnscheduledInfo {
  bookingId: string;
  groupName: string;
  sessionId: string;
  date: string;
  reason: string;
}

export interface ChangeSummary {
  changes: BookingChange[];
  unscheduled: UnscheduledInfo[];
  newlyUnscheduled: UnscheduledInfo[];
  sessions: { id: string; date: string; version: number; feasible: boolean }[];
}

export async function computeSessionSchedule(db: Db, course: CourseRow, session: SessionRow) {
  const intervals = await loadIntervals(db, [session.id]);
  const bookings = await loadBookings(db, [session.id]);
  const input = schedulerInput(course, session, intervals, bookings);
  return { intervals, bookings, input, result: schedule(input) };
}

/**
 * Recomputes the schedule of a (locked) session and writes assigned times.
 * Finalized sessions keep pinned times. Bumps the schedule version and records a revision
 * when anything changed.
 */
export async function persistSchedule(
  tx: Tx,
  course: CourseRow,
  sessionId: string,
  actor: string,
  reason: string,
  force = false,
): Promise<{ result: ScheduleResult; version: number }> {
  const [session] = await tx<SessionRow[]>`select * from exam_sessions where id = ${sessionId}`;
  const { bookings, result } = await computeSessionSchedule(tx, course, session);
  const rules = rulesOf(course);
  const placed = new Map(result.scheduled.map((s) => [s.id, s]));
  const updates: { b: BookingRow; start: Date | null; end: Date | null; duration: number }[] = [];
  for (const b of bookings) {
    const p = placed.get(b.id);
    const start = p ? instantOf(session, p.start) : null;
    const end = p ? instantOf(session, p.end) : null;
    const duration = examDuration(rules, b.group_size);
    const same =
      (b.assigned_start?.getTime() ?? null) === (start?.getTime() ?? null) &&
      (b.assigned_end?.getTime() ?? null) === (end?.getTime() ?? null) &&
      b.duration_minutes === duration;
    if (!same) updates.push({ b, start, end, duration });
  }
  let version = session.schedule_version;
  if (updates.length > 0 || force) {
    version += 1;
    for (const u of updates) {
      await tx`
        update bookings set assigned_start = ${u.start}, assigned_end = ${u.end}, duration_minutes = ${u.duration},
          schedule_version = ${version}, updated_at = now()
        where id = ${u.b.id}`;
    }
    await tx`update exam_sessions set schedule_version = ${version}, schedule_updated_at = now(), updated_at = now() where id = ${sessionId}`;
    const snapshot = {
      strategy: result.strategy,
      scheduled: result.scheduled,
      unscheduled: result.unscheduled,
      stats: result.stats,
    };
    await tx`
      insert into schedule_revisions (session_id, version, actor, reason, schedule_status, snapshot)
      values (${sessionId}, ${version}, ${actor}, ${reason}, ${session.schedule_status}, ${tx.json(snapshot as never)})`;
  }
  return { result, version };
}

interface SnapshotRow {
  id: string;
  group_name: string;
  session_id: string;
  status: 'active' | 'cancelled';
  assigned_start: Date | null;
  assigned_end: Date | null;
  exam_date: string;
  timezone: string;
}

async function snapshot(db: Db, sessionIds: string[]): Promise<Map<string, SnapshotRow>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db<SnapshotRow[]>`
    select b.id, b.group_name, b.session_id, b.status, b.assigned_start, b.assigned_end, s.exam_date, s.timezone
    from bookings b join exam_sessions s on s.id = b.session_id
    where b.session_id in ${db(sessionIds)}`;
  return new Map(rows.map((r) => [r.id, r]));
}

function stateOf(r: SnapshotRow | undefined): BookingState | null {
  if (!r) return null;
  const s = { exam_date: r.exam_date, timezone: r.timezone } as SessionRow;
  return {
    sessionId: r.session_id,
    date: r.exam_date,
    start: localMinutes(s, r.assigned_start),
    end: localMinutes(s, r.assigned_end),
    status: r.status,
  };
}

export interface MutationOptions {
  actor: string;
  reason: string;
  /** Sessions to lock and recalculate. The callback may return more. */
  sessionIds: string[];
  preview?: boolean;
  /** Allow changes that leave groups unscheduled (administrator override). */
  override?: boolean;
  /** Force recalculation of every session of the course (e.g. rule changes). */
  allSessions?: boolean;
}

export interface MutationResult<T> {
  summary: ChangeSummary;
  value: T;
  course: CourseRow;
}

/**
 * Runs a schedule-affecting mutation atomically:
 * lock sessions → snapshot → mutate → recalculate → diff → (rollback if preview).
 * Rejects changes that would leave additional groups unscheduled unless `override` is set.
 */
export async function runMutation<T>(
  sql: Sql,
  opts: MutationOptions,
  fn: (tx: Tx, course: CourseRow, sessions: SessionRow[]) => Promise<{ value: T; extraSessionIds?: string[] }>,
): Promise<MutationResult<T>> {
  try {
    return (await sql.begin(async (tx) => {
      const course = await loadActiveCourse(tx);
      let ids = opts.sessionIds;
      if (opts.allSessions) {
        const all = await tx<{ id: string }[]>`select id from exam_sessions where course_id = ${course.id}`;
        ids = [...ids, ...all.map((r) => r.id)];
      }
      const sessions = await lockSessions(tx, ids);
      const lockedIds = sessions.map((s) => s.id);
      const before = await snapshot(tx, lockedIds);

      const { value, extraSessionIds = [] } = await fn(tx, course, sessions);
      const extra = extraSessionIds.filter((id) => !lockedIds.includes(id));
      if (extra.length) await lockSessions(tx, extra);
      const affected = [...lockedIds, ...extra];

      // Rules may have been changed by `fn`.
      const freshCourse = await loadActiveCourse(tx);
      const results = new Map<string, { result: ScheduleResult; version: number }>();
      for (const id of affected) results.set(id, await persistSchedule(tx, freshCourse, id, opts.actor, opts.reason));

      const after = await snapshot(tx, affected);
      const dateRows = await tx<{ id: string; exam_date: string }[]>`
        select id, exam_date from exam_sessions where id in ${tx(affected)}`;
      const summary = summarize(before, after, results, new Map(dateRows.map((r) => [r.id, r.exam_date])));

      // Previews always return the consequences, including groups that would become unscheduled.
      if (opts.preview) throw new PreviewRollback({ summary, value, course: freshCourse });
      if (summary.newlyUnscheduled.length > 0 && !opts.override) {
        throw new ApiError(
          409,
          'INFEASIBLE',
          'This change would leave some groups without an examination time. Review the preview and confirm with an explicit override, or adjust the change.',
          summary,
        );
      }
      if (opts.override && summary.newlyUnscheduled.length > 0) {
        await tx`update bookings set capacity_override = true where id in ${tx(summary.newlyUnscheduled.map((u) => u.bookingId))}`;
      }
      return { summary, value, course: freshCourse };
    })) as MutationResult<T>;
  } catch (e) {
    if (e instanceof PreviewRollback) return e.result as MutationResult<T>;
    throw e;
  }
}

function summarize(
  before: Map<string, SnapshotRow>,
  after: Map<string, SnapshotRow>,
  results: Map<string, { result: ScheduleResult; version: number }>,
  dates: Map<string, string>,
): ChangeSummary {
  const changes: BookingChange[] = [];
  const ids = new Set([...before.keys(), ...after.keys()]);
  for (const id of ids) {
    const b = stateOf(before.get(id));
    const a = stateOf(after.get(id));
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push({ bookingId: id, groupName: (after.get(id) ?? before.get(id))!.group_name, before: b, after: a });
    }
  }
  const unscheduled: UnscheduledInfo[] = [];
  for (const [sessionId, { result }] of results) {
    for (const u of result.unscheduled) {
      const row = after.get(u.id);
      if (!row) continue;
      unscheduled.push({ bookingId: u.id, groupName: row.group_name, sessionId, date: row.exam_date, reason: u.reason });
    }
  }
  const wasUnscheduled = (id: string) => {
    const r = before.get(id);
    return r !== undefined && r.status === 'active' && r.assigned_start === null;
  };
  const sessions = [...results].map(([id, { result, version }]) => ({
    id,
    date: dates.get(id) ?? '',
    version,
    feasible: result.feasible,
  }));
  changes.sort((x, y) => (x.after?.start ?? 9999) - (y.after?.start ?? 9999));
  return {
    changes,
    unscheduled,
    newlyUnscheduled: unscheduled.filter((u) => !wasUnscheduled(u.bookingId)),
    sessions,
  };
}
