import { api } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { Alert, Badge, Card, Loading, PageTitle } from '../../components/ui';

interface Note {
  id: string;
  kind: string;
  to: string;
  subject: string;
  body: string;
  status: 'sent' | 'logged' | 'failed';
  provider: string;
  error: string | null;
  createdAt: string;
}

export function NotificationsPage() {
  useTitle('Notifications');
  const { data, error, loading } = useLoad(() => api.admin.get<Note[]>('/admin/notifications'));
  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="red">{error.message}</Alert>;
  return (
    <>
      <PageTitle sub="Every notification is recorded here. With the console provider (no email service configured) messages are only logged — nothing is sent.">
        Notifications
      </PageTitle>
      {data?.length === 0 && <Alert tone="neutral">No notifications yet.</Alert>}
      <div className="space-y-2">
        {data?.map((n) => (
          <Card key={n.id}>
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <Badge tone={n.status === 'sent' ? 'green' : n.status === 'failed' ? 'red' : 'neutral'}>
                  {n.status === 'logged' ? 'logged (not sent)' : n.status}
                </Badge>
                <span className="font-medium">{n.subject}</span>
                <span className="text-slate-500">→ {n.to}</span>
                <span className="ml-auto text-xs text-slate-500">{new Date(n.createdAt).toLocaleString('en-GB')}</span>
              </summary>
              {n.error && <p className="mt-2 text-sm text-red-700">Error: {n.error}</p>}
              <pre className="mt-3 whitespace-pre-wrap rounded bg-slate-50 p-3 text-xs text-slate-700">{n.body}</pre>
            </details>
          </Card>
        ))}
      </div>
    </>
  );
}
