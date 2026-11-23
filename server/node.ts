/**
 * Node entry point: local development, or self-hosting on your own computer/server.
 * Serves the API under /api and, if `npm run build` has been run, the website from ./dist
 * (so a single process + a free tunnel is enough to put the app online).
 */
import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { createApp } from './app';
import { createSql } from './db';
import type { Env } from './env';
import { loadEnv } from '../scripts/env';

loadEnv();
const env = process.env as unknown as Env;
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set (see .env.example)');
if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

const sql = createSql(env.DATABASE_URL, { max: 10 });

/** Without APP_BASE_URL, links in emails use the address the visitor used (e.g. a tunnel URL). */
function envFor(c: Context): Env {
  if (env.APP_BASE_URL) return env;
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost';
  const proto = c.req.header('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return { ...env, APP_BASE_URL: `${proto}://${host}` };
}

const api = createApp((c) => ({ env: envFor(c), sql }));
const root = new Hono();
root.route('/', api);

const hasSite = existsSync('./dist/index.html');
if (hasSite) {
  root.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });
  root.use('/*', serveStatic({ root: './dist' }));
  const indexHtml = serveStatic({ path: './dist/index.html' });
  // Single-page app fallback (but unknown /api paths stay JSON 404s).
  root.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    return (await indexHtml(c, next)) ?? c.notFound();
  });
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port }, () => {
  console.log(`API listening on http://localhost:${port} (auth: ${env.AUTH_MODE ?? 'local'}, email: ${env.EMAIL_PROVIDER ?? 'console'})`);
  console.log(hasSite ? `Website: http://localhost:${port}` : 'Website not built: run "npm run build" to serve it from this process.');
});
