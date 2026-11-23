# Deployment guide

Target: **Supabase (free tier) for PostgreSQL + Auth** and **Cloudflare Pages (free tier)** for the site and API. No servers
to maintain. Estimated setup time: about 45 minutes.

> The application has not been deployed by the author of this repository. Follow these steps and verify each one.

## 1. Create the Supabase project

1. Create a project at <https://supabase.com> (region close to Italy, e.g. `eu-central-1`). Save the database password.
2. **Project Settings → Database → Connection string**:
   - _Transaction pooler_ URI (port **6543**) → used by the deployed API (`DATABASE_URL`).
   - _Session pooler_ or direct URI (port **5432**) → used once from your laptop for migrations.
   - Append `?sslmode=require` to both.
3. **Project Settings → API**: copy the _Project URL_ and the _anon public_ key. **Never** use the `service_role` key anywhere in
   this project — it is not needed.

## 2. Create the schema and the course

From your laptop (Node 20+):

```bash
npm ci
DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require' npm run db:migrate
DATABASE_URL='…same…' npm run db:seed        # DDAM 2026/2027 + 15 and 18 December 2026 sessions, in DRAFT
```

Alternative without Node: paste `supabase/migrations/20261121000001_init.sql` into **SQL Editor** and run it, then create the
course with the SQL in [Reusing for another course/year](#reusing-for-another-course-or-year).

## 3. Create the first administrator (Supabase Auth)

1. **Authentication → Providers → Email**: keep Email enabled and **disable "Allow new users to sign up"**.
2. **Authentication → Users → Add user → Create new user**: your email + a strong password, tick _Auto confirm_.
3. **SQL Editor**:
   ```sql
   insert into admin_users (email) values ('your.name@unipi.it');
   ```
   Only emails in `admin_users` can use the dashboard, even if someone else obtains a Supabase account.

(Alternative: `AUTH_MODE=local` with a single admin. Generate the hash with `npm run hash-password -- 'a long passphrase'` and
set `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`. Supabase Auth is recommended because it supports password reset and multiple
admins.)

## 4. Deploy to Cloudflare Pages

1. Push this repository to GitHub (private is fine).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → select the repository.
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable (build): `NODE_VERSION=22`
3. **Settings → Variables and Secrets** (Production). Mark secrets as _Encrypted_:

| Variable                   | Example / notes                                                                                    | Secret |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| `DATABASE_URL`             | transaction pooler URI, port 6543, `?sslmode=require`                                              | yes    |
| `SESSION_SECRET`           | 32+ random chars: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` | yes    |
| `APP_BASE_URL`             | `https://ddam-exams.pages.dev` (or your custom domain)                                             | no     |
| `AUTH_MODE`                | `supabase`                                                                                         | no     |
| `SUPABASE_URL`             | `https://<ref>.supabase.co`                                                                        | no     |
| `SUPABASE_ANON_KEY`        | anon public key                                                                                    | no     |
| `VITE_AUTH_MODE`           | `supabase` (build-time)                                                                            | no     |
| `VITE_SUPABASE_URL`        | same as `SUPABASE_URL` (build-time)                                                                | no     |
| `VITE_SUPABASE_ANON_KEY`   | same as `SUPABASE_ANON_KEY` (build-time)                                                           | no     |
| `EMAIL_PROVIDER`           | `console` (default) or `resend`                                                                    | no     |
| `RESEND_API_KEY`           | only with Resend                                                                                   | yes    |
| `EMAIL_FROM`               | `DDAM Exams <exams@your-domain>` (must be a verified Resend domain)                                | no     |
| `ADMIN_NOTIFICATION_EMAIL` | optional: receives booking activity summaries                                                      | no     |

4. **Settings → Runtime → Compatibility flags**: add `nodejs_compat` (also declared in `wrangler.toml`). Compatibility date
   `2026-11-01` or later.
5. Trigger a deploy (Deployments → Retry). HTTPS is automatic on `*.pages.dev` and custom domains.
6. Verify: `https://<site>/api/health` → `{"ok":true}`; open `/admin`, sign in, check the overview.

CLI alternative: `npx wrangler pages deploy dist` after `npm run build` (secrets via `npx wrangler pages secret put NAME`).

## 5. Email (optional)

Without configuration the app works fully: emails are recorded in **Dashboard → Notifications** with status "logged (not
sent)", and students are told to copy their management link. The UI never claims an email was sent unless the provider
accepted it.

To send real emails with [Resend](https://resend.com) (free tier at the time of writing; check current limits):

1. Add and verify a domain you control (DNS records for SPF/DKIM). University domains usually require IT approval — a personal
   domain or subdomain is simpler.
2. Create an API key; set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` in Cloudflare; redeploy.
3. Make a test booking and check the Notifications page shows `sent`.

Another provider: implement `EmailProvider` in `server/services/notify.ts` (one `send()` method) and select it in
`emailProvider()`.

## 6. Keep the free Supabase project awake

Free Supabase projects are paused after a period of inactivity (about one week at the time of writing). During the booking
period traffic normally keeps it active. To be safe, the repository contains `.github/workflows/keepalive.yml`, which calls
`/api/health` daily: set the repository variable `APP_URL` (e.g. `https://ddam-exams.pages.dev`). If the project is paused,
restore it from the Supabase dashboard.

## 7. Security checklist

- [ ] Public sign-ups disabled in Supabase Auth; only your email in `admin_users`.
- [ ] No `service_role` key anywhere; `DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY` stored as encrypted secrets.
- [ ] `.env` / `.dev.vars` never committed (already in `.gitignore`).
- [ ] RLS is enabled on all tables (the migration does this; there is an automated test).
- [ ] Privacy page text reviewed in **Course & rules** and reflects your actual practice.
- [ ] After the exams: export the bookings, then delete personal data (cancel/delete sessions or truncate `bookings`).

## 8. Backups

- Supabase free tier has limited/no point-in-time recovery. Before and after key moments (opening registration, finalizing),
  download **Export all bookings (CSV)** and each day's **Export CSV** from the dashboard.
- For a full logical backup: `pg_dump "$DIRECT_DATABASE_URL" --no-owner --schema=public > ddam-backup-$(date +%F).sql`.
- Restore: `psql "$DATABASE_URL" < ddam-backup.sql` into a fresh project.

## 9. Creating and publishing the two December 2026 sessions

If you ran `npm run db:seed`, both sessions already exist **in draft** (hidden), 09:00–18:00, with a 13:00–14:00 lunch break.
Otherwise create them with **Overview → Add examination date**.

For each date (Tuesday 15 December 2026, Friday 18 December 2026):

1. Dashboard → open the session.
2. **Edit date & hours**: set the real start/end of your day and the location; preview → apply.
3. **Availability**: adjust the lunch break, add lectures/meetings as _Unavailable intervals_, or split the day with several
   _Availability windows_. Preview & save.
4. Check **Course & rules** (20 min presentation, 10 min per student, 10 min break, groups of 1–5) and the public schedule
   visibility.
5. Click **Open registration**. The date now appears on the home page with its remaining capacity.
6. Share the site URL with students.
7. When registration ends: **Close registration**, review the timeline, reorder if needed (↑/↓ or drag & drop → _Preview &
   save order_), then **Finalize schedule**. Students see "Finalized · times confirmed" and representatives are notified.

## Reusing for another course or year

Course data, rules and sessions are all in the database; nothing is hard-coded. Either edit the course in **Course & rules**
and create new sessions, or create a new course and make it the active one:

```sql
begin;
update courses set is_active = false where is_active;
insert into courses (slug, name, academic_year, institution, is_active, timezone)
values ('ddam-2027-2028', 'Distributed Data Analysis and Mining (DDAM)', '2027/2028', 'University of Pisa', true, 'Europe/Rome')
returning id;
-- use the returned id:
insert into scheduling_configs (course_id) values ('<id>');
commit;
```
