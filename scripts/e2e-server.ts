/** Starts a fresh API instance for end-to-end tests (resets the e2e database). */
import { serve } from '@hono/node-server';
import { createApp } from '../server/app';
import { createSql } from '../server/db';
import { hashPassword } from '../server/crypto';
import type { Env } from '../server/env';
import { migrate } from './migrate';
import { seed } from './seed';

const url = process.env.DATABASE_URL_E2E ?? 'postgres://postgres:postgres@localhost:5432/ddam_e2e';
const reset = createSql(url, { max: 1 });
await reset.unsafe('drop schema public cascade; create schema public;');
await reset.end();
await migrate(url, () => {});
const sql = createSql(url, { max: 10 });
await seed(sql, { open: true });
const env: Env = {
  DATABASE_URL: url,
  SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
  AUTH_MODE: 'local',
  ADMIN_EMAIL: 'lecturer@example.org',
  ADMIN_PASSWORD_HASH: await hashPassword('e2e-password-123'),
  APP_BASE_URL: 'http://localhost:5174',
  EMAIL_PROVIDER: 'console',
  DISABLE_RATE_LIMIT: '1',
};
const app = createApp(() => ({ env, sql }));
serve({ fetch: app.fetch, port: 8788 }, () => console.log('e2e API on 8788'));
