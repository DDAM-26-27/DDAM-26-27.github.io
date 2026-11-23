# Course website on GitHub Pages + booking server on Supabase (all free)

```
https://ddam-26-27.github.io              ← GitHub Pages (static site: home, materials, news, past projects, booking pages)
        │  booking requests (HTTPS, CORS limited to the site above)
        ▼
https://<ref>.supabase.co/functions/v1/api ← Supabase Edge Function (booking server)
        ▼
Supabase PostgreSQL                         ← bookings, sessions (not publicly readable)
```

GitHub Pages can only serve static files. Saving bookings safely needs a server and a private database. The free Supabase
plan provides both, and you don't need a credit card. Everything is deployed by GitHub Actions on each push.

## What the GitHub Actions do

| Workflow           | When                                    | What                                                                   |
| ------------------ | --------------------------------------- | ---------------------------------------------------------------------- |
| **Website**        | every push to `main`                    | builds the site and publishes it on GitHub Pages                       |
| **Booking server** | pushes touching server code, or by hand | database migrations, optional seed, deploys the Supabase Edge Function |
| **CI**             | every push / pull request               | formatting, lint, build, all tests                                     |
| **Keep-alive**     | daily                                   | pings the server so the free Supabase project is not paused            |

## Part 1: Supabase (you, about 10 minutes)

1. Sign up at <https://supabase.com> (free) and create a project, region `eu-central-1`. Save the database password.
2. **Authentication → Sign In / Providers → Email**: keep Email on and turn **off** "Allow new users to sign up".
3. **Authentication → Users → Add user**: your email and a strong password, with _Auto Confirm User_ ticked. This is your
   dashboard login.
4. Collect the following:
   - **Project ref**: the `<ref>` in `https://<ref>.supabase.co` (Project Settings → General).
   - **Project URL** and **anon / publishable key** (Project Settings → API). These are public by design.
   - **Session pooler connection string** (click **Connect** → _Session pooler_), with your password inserted and
     `?sslmode=require` appended. **Secret.**
   - **Access token**: <https://supabase.com/dashboard/account/tokens> → _Generate new token_. **Secret.**

## Part 2: GitHub settings

In the repository `DDAM-26-27/DDAM-26-27.github.io` → **Settings → Secrets and variables → Actions**:

| Type     | Name                    | Value                                                                |
| -------- | ----------------------- | -------------------------------------------------------------------- |
| Secret   | `DATABASE_URL`          | session pooler connection string                                     |
| Secret   | `SUPABASE_ACCESS_TOKEN` | Supabase access token                                                |
| Secret   | `SESSION_SECRET`        | 32+ random characters (already set if Claude created the repository) |
| Variable | `SUPABASE_PROJECT_REF`  | project ref                                                          |
| Variable | `SUPABASE_URL`          | `https://<ref>.supabase.co`                                          |
| Variable | `SUPABASE_ANON_KEY`     | anon / publishable key                                               |

Enter the secrets yourself in GitHub. Don't paste them into a chat.

**Settings → Pages → Build and deployment → Source: GitHub Actions** (already set if Claude created the repository).

## Part 3: First deployment

1. **Actions → Booking server → Run workflow**: tick _seed_ and enter your email as _admin_email_ (the same email as the
   Supabase user). This creates the tables, the DDAM 2026/2027 course, the two December sessions (hidden drafts) and gives
   your email dashboard access.
2. **Actions → Website → Run workflow** (so the site picks up the Supabase variables).
3. Open <https://ddam-26-27.github.io/admin>, sign in, and for each December date: set the real hours, add unavailable
   intervals, then click **Open registration**.

## Editing the website (no coding needed)

All page text lives in Markdown files in the `content/` folder. Edit them on github.com (pencil icon), commit, and the site
updates in about a minute.

| Page           | File(s)                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Home           | `content/home.md`                                                                                    |
| Materials      | `content/materials.md`: paste your Google Drive links (share them as "Anyone with the link: Viewer") |
| News           | one file per post in `content/news/`, e.g. `2026-12-01-booking-open.md` with `title:` and `date:`    |
| Past projects  | one file per project in `content/projects/`, copied from `_TEMPLATE.md`                              |
| Privacy, rules | in the dashboard: **Course & rules**                                                                 |

**Student project submissions.** On the Past projects page, students use the "Publish my project" form. It creates a GitHub
issue that includes a consent checkbox for the whole team. To publish one, copy their text into a new file in
`content/projects/` (or merge their pull request). To remove a project, delete its file.

## Next academic year

Content and code carry over. Either keep this organization and update `content/` plus the course year in **Course & rules**,
or create a new organization (e.g. `DDAM-27-28`), copy the repository, and reuse the same Supabase project. To start fresh,
create a new course (see `docs/DEPLOYMENT.md`, "Reusing for another course or year").

## Emails to students (optional, free)

Without an email provider, emails are only listed under **Dashboard → Notifications** and nothing is sent. To send them
for real with [Brevo](https://www.brevo.com) (free, 300 emails/day, no domain needed):

1. Sign up at Brevo. Under **Senders, Domains & Dedicated IPs → Senders**, add and verify the address the emails will
   come from.
2. Under **SMTP & API → API Keys**, create an API key.
3. In GitHub → **Settings → Secrets and variables → Actions**, add:
   - Secret `BREVO_API_KEY`: the API key.
   - Variable `EMAIL_FROM`: e.g. `DDAM Exams <your-verified-address@example.org>`.
   - Optional variable `ADMIN_NOTIFICATION_EMAIL`: where you want a short notice of each new, changed or cancelled booking.
4. **Actions → Booking server → Run workflow** (no need to tick _seed_). The log line "Email provider: brevo" confirms it.

Replies to student emails go to the **Contact email** set in the dashboard (**Course & rules**).

What students receive: confirmation when they book; a notice when they modify or cancel; an email whenever you change
their examination time, or the date, location or title of their day; when you finalize or unlock the schedule; and any
message you send with **Email all groups** on a session page. Students can cancel online until 24 hours before their
examination; after that, the booking page asks them to email you.

## Limits worth knowing

- The repository must be **public** for free GitHub Pages in an organization. It contains no secrets and no student data.
- Free Supabase projects pause after about a week without database activity. The Keep-alive workflow prevents this; if it
  happens anyway, click _Restore_ in the Supabase dashboard.
- No emails are sent until an email provider is configured. Students see and save their private booking link on screen.
