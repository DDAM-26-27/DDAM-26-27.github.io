export interface Env {
  DATABASE_URL: string;
  APP_BASE_URL?: string;
  SESSION_SECRET: string;
  AUTH_MODE?: 'local' | 'supabase';
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD_HASH?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  EMAIL_PROVIDER?: 'console' | 'resend' | 'brevo';
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  ADMIN_NOTIFICATION_EMAIL?: string;
  /** Set to "1" to disable rate limiting (tests only). */
  DISABLE_RATE_LIMIT?: string;
}
