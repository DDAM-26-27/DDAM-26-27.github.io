# DDAM course website & exam booking

Live site (once deployed): <https://ddam-26-27.github.io>. Setup: **[docs/GITHUB-PAGES.md](docs/GITHUB-PAGES.md)**.

The site has a home page, materials, news and past projects (all edited as Markdown files in `content/`), plus the exam
booking system described below.

Web application for booking group oral examinations, built for _Distributed Data Analysis and Mining (DDAM)_, academic year
2026/2027, University of Pisa. It is reusable for other courses and years.

> This is an organizational tool, **not** an official University of Pisa examination registration system.

- **Students** (no account) pick an examination day and register their group. The examination time is **assigned
  automatically**: 20 min presentation + 10 min per student, a 10-min recovery break between exams, around the lecturer's
  availability. They receive a private link to view, modify, move or cancel the booking, plus an `.ics` calendar file.
- **The lecturer** configures days, availability windows and unavailable intervals (lunch, lectures, meetings), the duration
  rules and privacy settings. The dashboard shows the daily timeline, lets the lecturer add, edit, move, cancel and reorder
  groups, **previews every change before applying it**, and finalizes (freezes) or unlocks schedules. Exports: CSV, `.ics`,
  and a print/PDF view.

Docs: [GitHub Pages + Supabase setup](docs/GITHUB-PAGES.md) · [Architecture & scheduling strategy](docs/ARCHITECTURE.md) · [Deployment guide (free hosted)](docs/DEPLOYMENT.md) ·
[Run it on your own PC (free, no accounts)](docs/RUN-ON-YOUR-PC.md)

## Stack

React 19 · TypeScript · Vite · Tailwind CSS 4 · Hono (API) · PostgreSQL via Supabase · Supabase Auth (or local admin) ·
Cloudflare Pages + Pages Functions · Vitest · Playwright.

**Change from the suggested stack:** the browser does not talk to Supabase's REST API. All data goes through a small Hono API
that holds a direct Postgres connection, so bookings can be validated and scheduled inside one locked transaction. No
service-role key is needed. Supabase is used for Postgres and, optionally, Auth.

## Run locally

Requirements: Node 20+ (22 recommended) and PostgreSQL 14+ (local install, Docker, or a Supabase project).

```bash
npm install
cp .env.example .env                       # set DATABASE_URL and SESSION_SECRET
npm run hash-password -- 'dev-password-123' # put the output in ADMIN_PASSWORD_HASH (AUTH_MODE=local)
npm run db:migrate
npm run db:seed -- --open --demo           # DDAM course, 15 & 18 Dec 2026 sessions (open), 3 demo groups
npm run dev                                # API on :8787, web on http://localhost:5173
```

- Student site: <http://localhost:5173>
- Dashboard: <http://localhost:5173/admin> (the `ADMIN_EMAIL` from `.env` and your password)
- Emails are printed to the API console and listed under **Dashboard → Notifications** (nothing is sent).

To try the real Cloudflare runtime locally: `npm run build && npx wrangler pages dev dist` with the same variables in
`.dev.vars`.

## Scripts

| Command                        | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `npm run dev`                  | API (tsx watch) + Vite dev server                                 |
| `npm run build`                | Type-check and build the SPA into `dist/`                         |
| `npm test`                     | Vitest: scheduler unit/property tests + API integration tests     |
| `npm run test:e2e`             | Playwright end-to-end tests (desktop + mobile)                    |
| `npm run lint` / `format`      | ESLint / Prettier                                                 |
| `npm run db:migrate`           | Apply SQL migrations (`DATABASE_URL`)                             |
| `npm run db:seed`              | Create the DDAM course and the two December sessions (idempotent) |
| `npm run hash-password -- '…'` | Password hash for `AUTH_MODE=local`                               |

API integration tests use `DATABASE_URL_TEST` (default `postgres://postgres:postgres@localhost:5432/ddam_test`). **That
database is wiped.** E2E tests use `DATABASE_URL_E2E` (default `…/ddam_e2e`), also wiped.

## Environment variables

See [`.env.example`](.env.example) and the table in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#4-deploy-to-cloudflare-pages).
Server-only: `DATABASE_URL`, `SESSION_SECRET`, `AUTH_MODE`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFICATION_EMAIL`, `APP_BASE_URL`. Public
(build-time): `VITE_AUTH_MODE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## API summary

Public: `GET /api/public/course`, `GET /api/public/sessions`, `GET /api/public/sessions/:id/schedule`,
`POST /api/bookings/preview`, `POST /api/bookings`, `POST /api/manage/booking|update|cancel` (token in body).

Admin (Bearer token): `GET /api/admin/overview`, `PUT /api/admin/course`, `POST/GET/PUT/DELETE /api/admin/sessions[/:id]`,
`PUT …/:id/registration|intervals|order`, `POST …/:id/recalculate|finalize|unfinalize|bookings`,
`PUT /api/admin/bookings/:id`, `POST /api/admin/bookings/:id/cancel|regenerate-link`, exports
`GET …/:id/export.csv|export.ics`, `GET /api/admin/export/bookings.csv`. Schedule-affecting calls accept `preview: true`
(dry run in a rolled-back transaction) and `override: true` (allow unscheduled groups explicitly).

## Known limitations

- PDF export uses the browser's print dialog ("Save as PDF") from the print view rather than a server-generated PDF.
- Rate limiting is per IP; students behind one university NAT share a budget (limits are set generously).
- Emails need a verified sending domain with Resend (or another provider via the adapter).
- One course is active at a time (switching is a one-line SQL change, see the deployment guide).
