import { getAdminToken, clearAdminToken } from './auth';

/** API origin: empty when served by the same server; the Supabase functions URL on GitHub Pages. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: any = null,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, opts: { admin?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.admin) {
    const token = await getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFailure(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && opts.admin) clearAdminToken();
    const err = data?.error ?? {};
    throw new ApiFailure(res.status, err.code ?? 'ERROR', err.message ?? `Request failed (${res.status}).`, err.details ?? null);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  admin: {
    get: <T>(path: string) => request<T>('GET', path, undefined, { admin: true }),
    post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body, { admin: true }),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, body, { admin: true }),
    del: <T>(path: string) => request<T>('DELETE', path, undefined, { admin: true }),
  },
};

/** Downloads an authenticated admin export. */
export async function downloadAdminFile(path: string, fallbackName: string) {
  const token = await getAdminToken();
  const res = await fetch(`${API_BASE}/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiFailure(res.status, 'EXPORT', 'Export failed.');
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  saveBlob(await res.blob(), name);
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
