/**
 * Administrator authentication.
 * - AUTH_MODE=supabase (recommended): the browser signs in with Supabase Auth; the server verifies
 *   the access token with Supabase and checks that the user's email is listed in `admin_users`.
 * - AUTH_MODE=local: a single administrator configured by ADMIN_EMAIL / ADMIN_PASSWORD_HASH;
 *   the server issues a short-lived HMAC-signed session token.
 */
import type { Db } from './db';
import type { Env } from './env';
import { ApiError } from './errors';
import { signToken, timingSafeEqual, verifyPassword, verifyToken } from './crypto';

export interface AdminIdentity {
  email: string;
}

const SESSION_HOURS = 12;

export async function localLogin(env: Env, email: string, password: string): Promise<string> {
  if ((env.AUTH_MODE ?? 'local') !== 'local') throw new ApiError(400, 'WRONG_MODE', 'Local login is disabled.');
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD_HASH) {
    throw new ApiError(503, 'NOT_CONFIGURED', 'No administrator account is configured on the server.');
  }
  const emailOk = timingSafeEqual(email.trim().toLowerCase(), env.ADMIN_EMAIL.trim().toLowerCase());
  const pwOk = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
  if (!emailOk || !pwOk) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  return signToken(env.SESSION_SECRET, {
    sub: env.ADMIN_EMAIL.toLowerCase(),
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600,
  });
}

export async function authenticate(db: Db, env: Env, authorization: string | undefined): Promise<AdminIdentity> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
  if ((env.AUTH_MODE ?? 'local') === 'local') {
    const payload = await verifyToken<{ sub: string; role: string; exp: number }>(env.SESSION_SECRET, token);
    if (!payload || payload.role !== 'admin') throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    return { email: payload.sub };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new ApiError(503, 'NOT_CONFIGURED', 'Supabase Auth is not configured.');
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
  });
  if (!res.ok) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
  const user = (await res.json()) as { email?: string };
  const email = user.email?.toLowerCase();
  if (!email) throw new ApiError(403, 'FORBIDDEN', 'Not authorized.');
  const rows = await db`select 1 from admin_users where email = ${email}`;
  if (rows.length === 0) throw new ApiError(403, 'FORBIDDEN', 'This account is not an administrator.');
  return { email };
}
