/**
 * Supabase Edge Function entry point (Deno). Bundled by `npm run build:edge` into
 * supabase/functions/api/index.js. The function is named "api", so request paths arrive as
 * /api/... and match the Hono app's base path.
 */
import { createApp } from './app';
import { createSql, type Sql } from './db';
import type { Env } from './env';

declare const Deno: { env: { toObject(): Record<string, string> }; serve(handler: (req: Request) => Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Disposition',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function handle(req: Request, raw: Record<string, string>): Promise<Response> {
  const env: Env = {
    ...(raw as unknown as Env),
    DATABASE_URL: raw.DATABASE_URL || raw.SUPABASE_DB_URL,
    AUTH_MODE: (raw.AUTH_MODE as Env['AUTH_MODE']) || 'supabase',
    SUPABASE_ANON_KEY: raw.SUPABASE_ANON_KEY || raw.SUPABASE_PUBLISHABLE_KEY,
  };
  const allowed = (raw.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const cors = corsHeaders(req.headers.get('Origin'), allowed);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!env.DATABASE_URL || !env.SESSION_SECRET) {
    return Response.json({ error: { code: 'NOT_CONFIGURED', message: 'Server is not configured.' } }, { status: 503, headers: cors });
  }
  const sql: Sql = createSql(env.DATABASE_URL, { max: 1 });
  const app = createApp(() => ({ env, sql }));
  try {
    const res = await app.fetch(req);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  } finally {
    const closing = sql.end({ timeout: 5 });
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(closing);
    else await closing;
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    try {
      return await handle(req, Deno.env.toObject());
    } catch (err) {
      // Errors outside Hono's handler would otherwise surface only as a bare "Internal Server Error".
      console.error('edge handler crashed', err);
      const isHealth = new URL(req.url).pathname.endsWith('/health');
      const detail = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
      return Response.json({ error: { code: 'CRASH', message: 'Server error.', ...(isHealth ? { detail } : {}) } }, { status: 500 });
    }
  });
}
