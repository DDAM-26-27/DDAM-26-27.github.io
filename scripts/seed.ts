/**
 * Seeds the DDAM 2026/2027 course and the two initial December sessions (idempotent).
 *   npm run db:seed              → course + sessions (registration: draft)
 *   npm run db:seed -- --open    → sessions open for registration
 *   npm run db:seed -- --demo    → also adds a few demo bookings (development only)
 */
import { loadEnv } from './env';
import { createSql, type Sql } from '../server/db';
import { insertBooking } from '../server/services/bookings';
import { loadActiveCourse } from '../server/repo';
import { persistSchedule } from '../server/services/schedule';

export const DEFAULT_PRIVACY = `This booking tool is an organizational aid for the oral examination of the course. It is not an official University registration system: you must still register for the exam through the official university channels.

Data collected: group name, names of the group members, the email address of the group representative and optional notes. The data is used only to organize the examination schedule and to contact the group representative about it.

The public schedule shows group names (or anonymous labels) and examination times only. Email addresses are visible only to the lecturer.

Data is deleted after the examination session has been completed and recorded. To request correction or deletion, contact the lecturer.`;

export async function seed(sql: Sql, opts: { open?: boolean; demo?: boolean; admin?: string } = {}) {
  const status = opts.open ? 'open' : 'draft';
  if (opts.admin) {
    const email = opts.admin.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('Invalid admin email');
    await sql`insert into admin_users (email) values (${email}) on conflict do nothing`;
  }
  await sql.begin(async (tx) => {
    let [course] = await tx<{ id: string }[]>`select id from courses where slug = 'ddam-2026-2027'`;
    if (!course) {
      await tx`update courses set is_active = false where is_active`;
      [course] = await tx<{ id: string }[]>`
        insert into courses (slug, name, academic_year, description, institution, timezone, is_active, privacy_text)
        values ('ddam-2026-2027', 'Distributed Data Analysis and Mining (DDAM)', '2026/2027',
          'Oral examination: group project presentation (20 minutes) followed by individual questions (10 minutes per student). Choose an examination day; the system assigns your estimated time automatically.',
          'University of Pisa', 'Europe/Rome', true, ${DEFAULT_PRIVACY})
        returning id`;
      await tx`insert into scheduling_configs (course_id) values (${course.id})`;
    }
    const sessions = [
      { date: '2026-12-15', start: '09:00', end: '18:00', title: 'DDAM oral exams — Tuesday' },
      { date: '2026-12-18', start: '09:00', end: '18:00', title: 'DDAM oral exams — Friday' },
    ];
    for (const s of sessions) {
      const exists = await tx`select 1 from exam_sessions where course_id = ${course.id} and exam_date = ${s.date}`;
      if (exists.length) continue;
      const [row] = await tx<{ id: string }[]>`
        insert into exam_sessions (course_id, exam_date, start_time, end_time, title, registration_status)
        values (${course.id}, ${s.date}, ${s.start}, ${s.end}, ${s.title}, ${status}) returning id`;
      await tx`insert into availability_intervals (session_id, kind, block_type, start_time, end_time, label)
        values (${row.id}, 'blocked', 'lunch', '13:00', '14:00', 'Lunch break')`;
    }
  });
  if (opts.demo) {
    await sql.begin(async (tx) => {
      const course = await loadActiveCourse(tx);
      const [session] = await tx<
        { id: string }[]
      >`select id from exam_sessions where course_id = ${course.id} order by exam_date limit 1 for update`;
      const has = await tx`select 1 from bookings where session_id = ${session.id} limit 1`;
      if (has.length) return;
      const demo = [
        { groupName: 'Graph Miners', members: ['Alice Rossi', 'Bruno Bianchi', 'Carla Verdi', 'Dario Neri'] },
        { groupName: 'Spark Squad', members: ['Elena Russo', 'Fabio Gallo', 'Giulia Costa'] },
        { groupName: 'Stream Team', members: ['Hugo Marino', 'Irene Greco', 'Luca Conti', 'Marta Ricci', 'Nico Bruno'] },
      ];
      for (const [i, d] of demo.entries()) {
        await insertBooking(
          tx,
          course,
          session.id,
          { ...d, groupSize: d.members.length, representativeEmail: `group${i + 1}@example.org`, notes: '' },
          'student',
        );
      }
      await persistSchedule(tx, course, session.id, 'seed', 'Demo data');
    });
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  loadEnv();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const sql = createSql(process.env.DATABASE_URL, { max: 1 });
  const adminIdx = process.argv.indexOf('--admin');
  await seed(sql, {
    open: process.argv.includes('--open'),
    demo: process.argv.includes('--demo'),
    admin: adminIdx > 0 ? process.argv[adminIdx + 1] : undefined,
  });
  await sql.end();
  console.log('seed complete');
}
