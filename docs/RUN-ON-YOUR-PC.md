# Run it on your own PC, free and without accounts

This runs everything on your computer: the PostgreSQL database, the server and the website. A free **Cloudflare Quick
Tunnel** gives it a public `https://…trycloudflare.com` link that students can open. You don't need any account or credit card.

## Trade-offs (read first)

- **Your PC must stay on, awake and online** for the whole booking period. When it sleeps or shuts down, the site is offline.
  Turn off sleep while registration is open.
- **The link changes every time you restart the tunnel.** Start it once and leave it running. If it does change, publish the
  new link. Students' private booking links still work: they open the new site, go to **My booking**, and paste their old link.
  The page reads the token from it.
- Quick Tunnels are meant for testing, and Cloudflare gives no uptime guarantee. For a few dozen groups this is usually fine.
- Back up your database (see the end of this guide). If your PC's disk dies, the bookings are gone.

## 1. Install the free software (once)

| Software    | Where                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Node.js 22  | <https://nodejs.org> (LTS installer)                                                                           |
| PostgreSQL  | <https://www.postgresql.org/download/> (Windows/macOS installer; remember the password you set)                |
| cloudflared | <https://developers.cloudflare.com/tunnel/downloads/> (Windows: the `.msi`; macOS: `brew install cloudflared`) |

## 2. Create the database

Open a terminal (Windows: **SQL Shell (psql)** from the Start menu, or PowerShell):

```bash
createdb -U postgres ddam
```

(Or in pgAdmin: right-click _Databases_ → _Create_ → name `ddam`.)

## 3. Configure the app

Unzip the project, open a terminal in its folder, then:

```bash
npm install
cp .env.example .env          # Windows PowerShell: copy .env.example .env
npm run hash-password -- "choose a long admin password"
```

Edit `.env`:

```
DATABASE_URL=postgres://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/ddam
APP_BASE_URL=
SESSION_SECRET=<paste 40+ random characters>
AUTH_MODE=local
ADMIN_EMAIL=your.email@unipi.it
ADMIN_PASSWORD_HASH=<the output of hash-password>
EMAIL_PROVIDER=console
VITE_AUTH_MODE=local
```

Leave `APP_BASE_URL` **empty**. Links then automatically use whatever address students visit (your tunnel link).
To generate the secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## 4. Create the tables, the course and the two December dates

```bash
npm run db:migrate
npm run db:seed               # DDAM 2026/2027, 15 and 18 December 2026 (hidden drafts, lunch 13:00–14:00)
npm run build
```

## 5. Start it

Use two terminals and leave both open:

```bash
npm start                     # terminal 1: the site at http://localhost:8787
npm run share                 # terminal 2: prints https://<four-random-words>.trycloudflare.com
```

1. Open `http://localhost:8787/admin` on your PC and sign in with `ADMIN_EMAIL` and your password.
2. For each date: adjust hours and unavailable intervals, then click **Open registration**.
3. Open the `trycloudflare.com` link on your phone to check it works, then share it with students.

Emails are not sent in this setup. Students see their private link on screen after booking and are told to save it. Every
message the app would have sent is listed under **Dashboard → Notifications**.

## Stopping and restarting

Press `Ctrl+C` in each terminal to stop. To restart: run `npm start`, then `npm run share`. You get a **new** link, so
publish it again. All bookings stay in your database.

## Backups

Before opening registration, before finalizing and after the exams, do both of these:

```bash
pg_dump -U postgres ddam > ddam-backup.sql
```

and use **Export all bookings (CSV)** in the dashboard. To restore: `psql -U postgres ddam < ddam-backup.sql`.
