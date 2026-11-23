/** HTTP API (Hono). Runs on Cloudflare Pages Functions and on Node for local development. */
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from './env';
import type { Sql } from './db';
import { ApiError } from './errors';
import { authenticate, localLogin, type AdminIdentity } from './auth';
import { rateLimit } from './services/ratelimit';
import { isUuid, loadActiveCourse, publicCourse } from './repo';
import * as pub from './services/bookings';
import * as admin from './services/admin';

export interface AppDeps {
  env: Env;
  sql: Sql;
}

type Vars = { deps: AppDeps; admin: AdminIdentity };
type C = Context<{ Variables: Vars }>;

function clientIp(c: C): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

async function json<T = Record<string, unknown>>(c: C): Promise<T> {
  try {
    const body = await c.req.json();
    if (body === null || typeof body !== 'object') throw new Error();
    return body as T;
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Invalid JSON body.');
  }
}

const flags = (c: C, body: Record<string, unknown> = {}) => ({
  preview: c.req.query('preview') === '1' || body.preview === true,
  override: body.override === true,
});

function download(c: C, file: { filename: string; body: string }, type: string) {
  return c.body(file.body, 200, {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Disposition': `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
  });
}

/**
 * Creates the app. `getDeps` is called per request (on Workers a new DB client is created per
 * request; on Node a shared pool is reused).
 */
export function createApp(getDeps: (c: Context) => AppDeps | Promise<AppDeps>) {
  const app = new Hono<{ Variables: Vars }>().basePath('/api');

  app.use('*', async (c, next) => {
    c.set('deps', await getDeps(c));
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: () => {
        throw new ApiError(413, 'TOO_LARGE', 'Request body too large.');
      },
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status);
    }
    console.error(err);
    return c.json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred. Please try again.' } }, 500);
  });

  // ------------------------------------------------------------ public
  app.get('/health', async (c) => {
    await c.var.deps.sql`select 1`;
    return c.json({ ok: true });
  });

  app.get('/public/course', async (c) => c.json(publicCourse(await loadActiveCourse(c.var.deps.sql))));
  app.get('/public/sessions', async (c) => c.json(await pub.listPublicSessions(c.var.deps.sql)));
  app.get('/public/sessions/:id/schedule', async (c) => c.json(await pub.publicSchedule(c.var.deps.sql, c.req.param('id'))));

  app.post('/bookings/preview', async (c) => {
    const { sql, env } = c.var.deps;
    await rateLimit(sql, env, clientIp(c), 'preview', 120, 600);
    const body = await json<{ sessionId: string; groupSize: number }>(c);
    if (!isUuid(body.sessionId)) throw new ApiError(404, 'NOT_FOUND', 'Examination session not found.');
    return c.json(await pub.previewBooking(sql, body.sessionId, Number(body.groupSize)));
  });

  app.post('/bookings', async (c) => {
    const { sql, env } = c.var.deps;
    await rateLimit(sql, env, clientIp(c), 'book', 30, 600);
    const body = await json<pub.CreateBookingRequest>(c);
    const expectedVersion = body.expectedVersion === undefined ? undefined : Number(body.expectedVersion);
    return c.json(await pub.createBooking(sql, env, { ...body, expectedVersion }), 201);
  });

  app.post('/manage/booking', async (c) => {
    const { sql, env } = c.var.deps;
    await rateLimit(sql, env, clientIp(c), 'manage', 60, 600);
    const body = await json<{ token: string }>(c);
    return c.json(await pub.viewManagedBooking(sql, body.token));
  });

  app.post('/manage/update', async (c) => {
    const { sql, env } = c.var.deps;
    await rateLimit(sql, env, clientIp(c), 'manage', 60, 600);
    const body = await json<pub.UpdateBookingRequest>(c);
    return c.json(await pub.updateManagedBooking(sql, env, { ...body, preview: body.preview === true }));
  });

  app.post('/manage/cancel', async (c) => {
    const { sql, env } = c.var.deps;
    await rateLimit(sql, env, clientIp(c), 'manage', 60, 600);
    const body = await json<{ token: string; confirmation: string }>(c);
    return c.json(await pub.cancelManagedBooking(sql, env, body.token, body.confirmation));
  });

  // ------------------------------------------------------------ admin auth
  app.get('/admin/config', (c) => c.json({ authMode: c.var.deps.env.AUTH_MODE ?? 'local' }));

  app.post('/admin/login', async (c) => {
    const { sql, env } = c.var.deps;
    await rateLimit(sql, env, clientIp(c), 'login', 10, 900);
    const body = await json<{ email: string; password: string }>(c);
    const token = await localLogin(env, String(body.email ?? ''), String(body.password ?? ''));
    return c.json({ token });
  });

  const adminApi = new Hono<{ Variables: Vars }>();
  adminApi.use('*', async (c, next) => {
    const { sql, env } = c.var.deps;
    c.set('admin', await authenticate(sql, env, c.req.header('Authorization')));
    await next();
  });

  adminApi.get('/me', (c) => c.json(c.var.admin));
  adminApi.get('/overview', async (c) => c.json(await admin.overview(c.var.deps.sql)));
  adminApi.get('/notifications', async (c) => c.json(await admin.notificationsLog(c.var.deps.sql)));

  adminApi.put('/course', async (c) => {
    const body = await json(c);
    return c.json(await admin.updateCourse(c.var.deps.sql, c.var.deps.env, c.var.admin.email, body, flags(c, body)));
  });

  adminApi.post('/sessions', async (c) => c.json(await admin.createSession(c.var.deps.sql, c.var.admin.email, await json(c)), 201));
  adminApi.get('/sessions/:id', async (c) => c.json(await admin.sessionDetail(c.var.deps.sql, c.req.param('id'))));
  adminApi.put('/sessions/:id', async (c) => {
    const body = await json(c);
    return c.json(await admin.updateSession(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), body, flags(c, body)));
  });
  adminApi.delete('/sessions/:id', async (c) => c.json(await admin.deleteSession(c.var.deps.sql, c.var.admin.email, c.req.param('id'))));
  adminApi.put('/sessions/:id/registration', async (c) => {
    const body = await json<{ status: string }>(c);
    return c.json(await admin.setRegistration(c.var.deps.sql, c.var.admin.email, c.req.param('id'), body.status));
  });
  adminApi.put('/sessions/:id/intervals', async (c) => {
    const body = await json<{ intervals: unknown }>(c);
    return c.json(
      await admin.replaceIntervals(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), body.intervals, flags(c, body)),
    );
  });
  adminApi.put('/sessions/:id/order', async (c) => {
    const body = await json<{ bookingIds: unknown }>(c);
    return c.json(
      await admin.setOrder(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), body.bookingIds ?? null, flags(c, body)),
    );
  });
  adminApi.post('/sessions/:id/recalculate', async (c) => {
    const body = await json(c);
    return c.json(await admin.recalculate(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), flags(c, body)));
  });
  adminApi.post('/sessions/:id/finalize', async (c) => {
    const body = await json(c);
    return c.json(await admin.finalize(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), flags(c, body)));
  });
  adminApi.post('/sessions/:id/unfinalize', async (c) => {
    const body = await json(c);
    return c.json(await admin.unfinalize(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), flags(c, body)));
  });
  adminApi.post('/sessions/:id/bookings', async (c) => {
    const body = await json(c);
    return c.json(
      await admin.adminCreateBooking(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), body, flags(c, body)),
    );
  });
  adminApi.put('/bookings/:id', async (c) => {
    const body = await json(c);
    return c.json(
      await admin.adminUpdateBooking(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), body, flags(c, body)),
    );
  });
  adminApi.post('/bookings/:id/cancel', async (c) => {
    const body = await json<{ notify?: boolean }>(c);
    return c.json(
      await admin.adminCancelBooking(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'), {
        ...flags(c, body),
        notify: body.notify,
      }),
    );
  });
  adminApi.post('/bookings/:id/regenerate-link', async (c) =>
    c.json(await admin.regenerateLink(c.var.deps.sql, c.var.deps.env, c.var.admin.email, c.req.param('id'))),
  );

  adminApi.get('/sessions/:id/export.csv', async (c) =>
    download(c, await admin.exportSessionCsv(c.var.deps.sql, c.req.param('id')), 'text/csv'),
  );
  adminApi.get('/sessions/:id/export.ics', async (c) =>
    download(c, await admin.exportSessionIcs(c.var.deps.sql, c.req.param('id')), 'text/calendar'),
  );
  adminApi.get('/export/bookings.csv', async (c) => download(c, await admin.exportBookingsCsv(c.var.deps.sql), 'text/csv'));

  app.route('/admin', adminApi);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404));
  return app;
}
