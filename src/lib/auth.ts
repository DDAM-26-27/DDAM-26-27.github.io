/**
 * Admin session handling. In "supabase" mode the Supabase JS client manages the session; in
 * "local" mode a short-lived signed token from /api/admin/login is kept in sessionStorage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const KEY = 'ddam_admin_token';
export const authMode: 'local' | 'supabase' = import.meta.env.VITE_AUTH_MODE === 'supabase' ? 'supabase' : 'local';

let client: SupabaseClient | null = null;
async function supabase(): Promise<SupabaseClient> {
  if (!client) {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
  }
  return client;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export async function getAdminToken(): Promise<string | null> {
  if (authMode === 'supabase') {
    const { data } = await (await supabase()).auth.getSession();
    return data.session?.access_token ?? null;
  }
  return store()?.getItem(KEY) ?? null;
}

export function clearAdminToken() {
  if (authMode === 'local') store()?.removeItem(KEY);
}

export async function signIn(email: string, password: string): Promise<void> {
  if (authMode === 'supabase') {
    const { error } = await (await supabase()).auth.signInWithPassword({ email, password });
    if (error) throw new Error('Invalid email or password.');
    return;
  }
  const res = await fetch(`${(import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? 'Sign-in failed.');
  store()?.setItem(KEY, data.token);
}

export async function signOut() {
  if (authMode === 'supabase') await (await supabase()).auth.signOut();
  clearAdminToken();
}
