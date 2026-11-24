/**
 * Notifications. Providers are pluggable (adapter pattern); the default "console" provider only
 * logs and stores the message, so the app works without any email service. A message is only
 * reported as "sent" when the provider accepted it.
 */
import type { Db } from '../db';
import type { Env } from '../env';
import type { EmailStatus } from '../../shared/types';
import { formatDateLong, formatRange } from '../../shared/time';
import { GRADING_WORKING_DAYS, submissionDeadline } from '../../shared/rules';
import { localMinutes, type BookingRow, type CourseRow, type SessionRow } from '../repo';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Where replies go (the course contact email), so students can answer the lecturer directly. */
  replyTo?: string | null;
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
        body: JSON.stringify({
          from: this.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { accepted: false, error: body.message ?? `HTTP ${res.status}` };
      return { accepted: true, id: body.id };
    } catch (e) {
      return { accepted: false, error: (e as Error).message };
    }
  }
}

/**
 * Brevo (brevo.com): free plan, 300 emails/day. Unlike Resend it does not require owning a domain:
 * a single sender address verified in the Brevo dashboard is enough.
 */
export class BrevoEmailProvider implements EmailProvider {
  name = 'brevo';
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: EmailMessage) {
    // EMAIL_FROM may be "Name <address>" or just "address".
    const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(this.from);
    const sender = m ? { name: m[1] || undefined, email: m[2] } : { email: this.from.trim() };
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender,
          to: [{ email: msg.to }],
          subject: msg.subject,
          textContent: msg.text,
          ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
      if (!res.ok) return { accepted: false, error: body.message ?? `HTTP ${res.status}` };
      return { accepted: true, id: body.messageId };
    } catch (e) {
      return { accepted: false, error: (e as Error).message };
    }
  }
}

export function emailProvider(env: Env): EmailProvider {
  if (env.EMAIL_PROVIDER === 'brevo' && env.BREVO_API_KEY && env.EMAIL_FROM)
    return new BrevoEmailProvider(env.BREVO_API_KEY, env.EMAIL_FROM);
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

const materialDeadline = (session: SessionRow) => `${formatDateLong(submissionDeadline(session.exam_date))}, 23:59`;

/** What to send before the exam, and by when (also shown on the website). */
function submissionInstructions(course: CourseRow, session: SessionRow): string {
  const to = course.contact_email ?? 'the lecturer';
  return [
    `IMPORTANT — by ${materialDeadline(session)} (${GRADING_WORKING_DAYS} working days before your exam), send ONE email per group to ${to} with:`,
    '  1. the link to your code repository (give the lecturer at least read access);',
    '  2. your report as a PDF;',
    '  3. a sentence confirming that your group will come to the exam.',
    'You may add other material, but only the repository and the report will be evaluated.',
    'If nothing arrives by the deadline, the lecturer will cancel your booking. Material sent later counts as late.',
  ].join('\n');
}

export function bookingSummary(session: SessionRow, b: BookingRow): string {
  return [
    `Group: ${b.group_name}`,
    `Students (${b.group_size}): ${b.members.join(', ')}`,
    `Examination: ${timeLine(session, b)}`,
    `Duration: ${b.duration_minutes} minutes`,
    session.location ? `Location: ${session.location}` : null,
    `Code + report due by: ${materialDeadline(session)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function confirmationEmail(course: CourseRow, session: SessionRow, b: BookingRow, manageUrl: string): EmailMessage {
  return {
    to: b.representative_email,
    replyTo: course.contact_email,
    subject: `[${course.name}] Booking confirmed — ${b.group_name}`,
    text:
      `Your group has been registered for the ${course.name} oral examination.\n\n${bookingSummary(session, b)}\n\n` +
      `${submissionInstructions(course, session)}\n\n` +
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
    unfinalized: 'Examination schedule reopened',
  };
  const intro: Record<string, string> = {
    modification: 'Your booking has been updated.',
    cancellation: 'Your booking has been cancelled. If this was a mistake, please register again.',
    time_change: 'The examination schedule changed and your examination time is different now.',
    finalized: 'The lecturer has finalized the examination schedule. Your examination time is now confirmed.',
    admin_change: 'The lecturer updated your booking.',
    unfinalized:
      'The lecturer reopened the examination schedule for changes. Your time below is an estimate again until the schedule is finalized.',
  };
  return {
    to: b.representative_email,
    replyTo: course.contact_email,
    subject: `[${course.name}] ${subjects[kind] ?? 'Booking update'} — ${b.group_name}`,
    text: `${intro[kind] ?? ''}\n\n${bookingSummary(session, b)}` + footer(course),
  };
}

/** Sent to every group of a session when the lecturer changes its date, hours, location or title. */
export function sessionUpdateEmail(course: CourseRow, session: SessionRow, b: BookingRow, changes: string[]): EmailMessage {
  return {
    to: b.representative_email,
    replyTo: course.contact_email,
    subject: `[${course.name}] Examination details updated — ${b.group_name}`,
    text:
      `The lecturer updated the details of your examination day:\n\n${changes.map((c) => `• ${c}`).join('\n')}\n\n` +
      `Your booking now:\n${bookingSummary(session, b)}` +
      footer(course),
  };
}

/** A free-text message from the lecturer to every group of a session. */
export function announcementEmail(course: CourseRow, session: SessionRow, b: BookingRow, subject: string, message: string): EmailMessage {
  return {
    to: b.representative_email,
    replyTo: course.contact_email,
    subject: `[${course.name}] ${subject}`,
    text: `${message}\n\nYour booking:\n${bookingSummary(session, b)}` + footer(course),
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
  /** Lecturer-made changes: notify every time change, ignoring the course's minimum-change threshold. */
  anyChange = false,
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
    const significant = dayChanged || (anyChange ? delta > 0 : delta >= course.notify_threshold_minutes) || (confirmedChanged && delta > 0);
    if (!significant) continue;
    await deliver(db, env, kind, simpleEmail(course, session, b, kind), b.id);
    await db`update bookings set notified_start = ${now}, notified_session_id = ${b.session_id} where id = ${b.id}`;
  }
}
