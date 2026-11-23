import type { Db } from '../db';
import type { Env } from '../env';
import { ApiError } from '../errors';
import { hmac } from '../crypto';

/** Fixed-window rate limiter stored in Postgres (works across serverless isolates). */
export async function rateLimit(db: Db, env: Env, ip: string, bucket: string, limit: number, windowSeconds: number) {
  if (env.DISABLE_RATE_LIMIT === '1') return;
  const key = `${bucket}:${(await hmac(env.SESSION_SECRET, ip)).slice(0, 22)}`;
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db<{ count: number }[]>`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`;
  if (Math.random() < 0.02) await db`delete from rate_limits where window_start < now() - interval '1 day'`;
  if (row.count > limit) {
    throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please wait a few minutes and try again.');
  }
}
