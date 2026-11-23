import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiFailure } from '../../lib/api';
import { authMode, getAdminToken, signIn, signOut } from '../../lib/auth';
import { useTitle } from '../../lib/hooks';
import { Alert, Button, Card, cx, Field, Input, Loading } from '../../components/ui';
import { OverviewPage } from './Overview';
import { SessionPage } from './SessionPage';
import { SettingsPage } from './Settings';
import { NotificationsPage } from './Notifications';
import { PrintPage } from './Print';

function Login({ onSignedIn }: { onSignedIn: () => void }) {
  useTitle('Administrator sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-4 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <h1 className="text-lg font-semibold">Lecturer dashboard</h1>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert tone="red">{error}</Alert>}
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" loading={busy} className="w-full">
              Sign in
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">
          {authMode === 'supabase' ? 'Signed in with Supabase Auth.' : 'Local administrator account.'}{' '}
          <Link to="/" className="underline">
            Public site
          </Link>
        </p>
      </div>
    </div>
  );
}

export function AdminApp() {
  const [state, setState] = useState<'checking' | 'out' | 'in'>('checking');
  const [email, setEmail] = useState('');
  const loc = useLocation();

  const check = useCallback(async () => {
    if (!(await getAdminToken())) return setState('out');
    try {
      const me = await api.admin.get<{ email: string }>('/admin/me');
      setEmail(me.email);
      setState('in');
    } catch (e) {
      setState('out');
      if (!(e instanceof ApiFailure)) throw e;
    }
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  if (state === 'checking')
    return (
      <div className="mx-auto max-w-6xl px-4">
        <Loading />
      </div>
    );
  if (state === 'out') return <Login onSignedIn={check} />;
  if (loc.pathname.endsWith('/print'))
    return (
      <Routes>
        <Route path="/admin/sessions/:id/print" element={<PrintPage />} />
      </Routes>
    );

  return (
    <div className="min-h-screen">
      <header className="no-print win-raised">
        <div className="win-titlebar px-3 py-1 text-sm font-bold">▣ Lecturer dashboard — {email}</div>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-4">
            <Link to="/admin" className="flex items-center gap-2 font-bold text-unipi">
              <img src="/favicon.svg" alt="" className="h-7 w-7" /> Lecturer dashboard
            </Link>
            <nav className="flex gap-1 text-sm">
              {[
                ['/admin', 'Overview'],
                ['/admin/settings', 'Course & rules'],
                ['/admin/notifications', 'Notifications'],
              ].map(([to, label]) => (
                <NavLink key={to} to={to} end className={({ isActive }) => cx('btn98 px-3 py-1', isActive && 'bg-white! font-bold')}>
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a href="/" target="_blank" rel="noreferrer" className="text-[#0000ee] underline">
              Public site ↗
            </a>
            <span className="hidden sm:inline">{email}</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await signOut();
                setState('out');
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Routes>
          <Route path="/admin" element={<OverviewPage />} />
          <Route path="/admin/sessions/:id" element={<SessionPage />} />
          <Route path="/admin/settings" element={<SettingsPage />} />
          <Route path="/admin/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<p>Not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
