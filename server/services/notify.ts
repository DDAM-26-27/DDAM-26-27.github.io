/**
 * Notifications. Providers are pluggable (adapter pattern); the default "console" provider only
 * logs and stores the message, so the app works without any email service. A message is only
 * reported as "sent" when the provider accepted it.
 */
import type { Db } from '../db';
import type { Env } from '../env';
import type { EmailStatus } from '../../shared/types';
import { formatDateLong, formatRange } from '../../shared/time';
import { localMinutes, type BookingRow, type CourseRow, type SessionRow } from '../repo';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<{ accepted: boolean; id?: string; error?: string }>;
}

export class ConsoleEmailProvider implements EmailProvider {
  name = 'console';
  async send(msg: EmailMessage) {
    console.log(`[email:console] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    return { accepted: false };
  }
}

export class ResendEmailProvider implements EmailProvider {
  name = 'resend';
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: EmailMessage) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { accepted: false, error: body.message ?? `HTTP ${res.status}` };
      return { accepted: true, id: body.id };
    } catch (e) {
      return { accepted: false, error: (e as Error).message };
    }
  }
}

export function emailProvider(env: Env): EmailProvider {
  if (env.EMAIL_PROVIDER === 'resend' && env.RESEND_API_KEY && env.EMAIL_FROM)
    return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  return new ConsoleEmailProvider();
}

/** Sends and records a message; never throws. */
export async function deliver(db: Db, env: Env, kind: string, msg: EmailMessage, bookingId: string | null): Promise<EmailStatus> {
  const provider = emailProvider(env);
  const r = await provider.send(msg);
  const status = r.accepted ? 'sent' : provider.name === 'console' ? 'logged' : 'failed';
  try {
    await db`
      insert into notifications (booking_id, kind, to_email, subject, body, status, provider, provider_message_id, error)
      values (${bookingId}, ${kind}, ${msg.to}, ${msg.subject}, ${msg.text}, ${status}, ${provider.name}, ${r.id ?? null}, ${r.error ?? null})`;
  } catch (e) {
    console.error('failed to record notification', e);
  }
  return r.accepted ? 'sent' : provider.name === 'console' ? 'not_configured' : 'failed';
}

// ---------------------------------------------------------------- templates

function timeLine(session: SessionRow, b: BookingRow): string {
  const start = localMinutes(session, b.assigned_start);
  const end = localMinutes(session, b.assigned_end);
  const date = formatDateLong(session.exam_date);
  if (start == null || end == null) return `${date} — time to be assigned by the lecturer`;
  const label = session.schedule_status === 'finalized' ? 'confirmed' : 'estimated, may change until the schedule is finalized';
  return `${date}, ${formatRange(start, end)} (${session.timezone}; ${label})`;
}

const footer = (course: CourseRow) =>
  `\n\n—\n${course.name} (${course.academic_year}) exam booking.\nThis is an organizational tool and not an official university registration system.`;

export function bookingSummary(session: SessionRow, b: BookingRow): string {
  return [
    `Group: ${b.group_name}`,
    `Students (${b.group_size}): ${b.members.join(', ')}`,
    `Examination: ${timeLine(session, b)}`,
    `Duration: ${b.duration_minutes} minutes`,
    session.location ? `Location: ${session.location}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function confirmationEmail(course: CourseRow, session: SessionRow, b: BookingRow, manageUrl: string): EmailMessage {
  return {
    to: b.representative_email,
    subject: `[${course.name}] Booking confirmed — ${b.group_name}`,
    text:
      `Your group has been registered for the ${course.name} oral examination.\n\n${bookingSummary(session, b)}\n\n` +
      `Manage or cancel your booking (keep this link private):\n${manageUrl}` +
      footer(course),
  };
}

export function simpleEmail(course: CourseRow, session: SessionRow, b: BookingRow, kind: string): EmailMessage {
  const subjects: Record<string, string> = {
    modification: 'Booking updated',
    cancellation: 'Booking cancelled',
    time_change: 'Your examination time has changed',
    finalized: 'Examination schedule finalized',
    admin_change: 'Your booking was updated by the lecturer',
  };
  const intro: Record<string, string> = {
    modification: 'Your booking has been updated.',
    cancellation: 'Your booking has been cancelled. If this was a mistake, please register again.',
    time_change: 'The examination schedule changed and your examination time is different now.',
    finalized: 'The lecturer has finalized the examination schedule. Your examination time is now confirmed.',
    admin_change: 'The lecturer updated your booking.',
  };
  return {
    to: b.representative_email,
    subject: `[${course.name}] ${subjects[kind] ?? 'Booking update'} — ${b.group_name}`,
    text: `${intro[kind] ?? ''}\n\n${bookingSummary(session, b)}` + footer(course),
  };
}

export async function notifyAdmin(db: Db, env: Env, course: CourseRow, subject: string, text: string) {
  if (!env.ADMIN_NOTIFICATION_EMAIL) return;
  await deliver(db, env, 'admin_summary', { to: env.ADMIN_NOTIFICATION_EMAIL, subject: `[${course.name}] ${subject}`, text }, null);
}

/**
 * After schedule changes, notify representatives whose time changed significantly
 * (≥ threshold minutes or a different day), and always when a confirmed time changed.
 */
export async function notifyTimeChanges(
  db: Db,
  env: Env,
  course: CourseRow,
  bookingIds: string[],
  skip: string[] = [],
  kind = 'time_change',
) {
  const ids = bookingIds.filter((id) => !skip.includes(id));
  if (ids.length === 0) return;
  const rows = await db<(BookingRow & { s: SessionRow })[]>`
    select b.*, coalesce((select array_agg(m.name order by m.position) from group_members m where m.booking_id = b.id), '{}') as members,
           to_jsonb(s.*) as s
    from bookings b join exam_sessions s on s.id = b.session_id
    where b.id in ${db(ids)} and b.status = 'active' and b.assigned_start is not null`;
  for (const b of rows) {
    const session = { ...b.s, schedule_updated_at: null, finalized_at: null } as SessionRow;
    const prev = b.notified_start;
    const now = b.assigned_start!;
    const dayChanged = b.notified_session_id !== null && b.notified_session_id !== b.session_id;
    const delta = prev ? Math.abs(now.getTime() - new Date(prev).getTime()) / 60000 : Infinity;
    const confirmedChanged = b.confirmed_start !== null && new Date(b.confirmed_start).getTime() !== now.getTime();
    const significant = dayChanged || delta >= course.notify_threshold_minutes || (confirmedChanged && delta > 0);
    if (!significant) continue;
    await deliver(db, env, kind, simpleEmail(course, session, b, kind), b.id);
    await db`update bookings set notified_start = ${now}, notified_session_id = ${b.session_id} where id = ${b.id}`;
  }
}
