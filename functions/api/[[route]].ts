/** Cloudflare Pages Functions entry point: every /api/* request is handled by the Hono app. */
import { createApp } from '../../server/app';
import { createSql, type Sql } from '../../server/db';
import type { Env } from '../../server/env';

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil(p: Promise<unknown>): void;
}

export const onRequest = async (ctx: PagesContext): Promise<Response> => {
  if (!ctx.env.DATABASE_URL || !ctx.env.SESSION_SECRET) {
    return Response.json({ error: { code: 'NOT_CONFIGURED', message: 'Server is not configured.' } }, { status: 503 });
  }
  // Workers cannot share sockets across requests: use one short-lived connection per request.
  const sql: Sql = createSql(ctx.env.DATABASE_URL, { max: 1 });
  const app = createApp(() => ({ env: ctx.env, sql }));
  try {
    return await app.fetch(ctx.request);
  } finally {
    ctx.waitUntil(sql.end({ timeout: 5 }));
  }
};
