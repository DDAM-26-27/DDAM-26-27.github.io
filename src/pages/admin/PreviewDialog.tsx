import { useState } from 'react';
import { api, ApiFailure } from '../../lib/api';
import { formatRange } from '../../../shared/time';
import { Alert, Button, Modal } from '../../components/ui';
import type { BookingState, ChangeSummary } from './types';

interface Pending {
  title: string;
  method: 'post' | 'put';
  path: string;
  body: object;
  confirmLabel?: string;
  onDone: (result: any) => void;
  danger?: boolean;
  note?: string;
}

function fmt(s: BookingState | null) {
  if (!s || s.status === 'cancelled') return <span className="text-slate-500">{s ? 'cancelled' : '—'}</span>;
  if (s.start == null || s.end == null) return <span className="font-medium text-red-700">{s.date} · unscheduled</span>;
  return (
    <span>
      {s.date} · <span className="font-mono">{formatRange(s.start, s.end)}</span>
    </span>
  );
}

export function ChangeTable({ summary }: { summary: ChangeSummary }) {
  if (summary.changes.length === 0) return <p className="text-sm text-slate-600">No examination times change.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1 pr-3">Group</th>
            <th className="py-1 pr-3">Before</th>
            <th className="py-1">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {summary.changes.map((c) => (
            <tr key={c.bookingId}>
              <td className="py-1.5 pr-3 font-medium">{c.groupName}</td>
              <td className="py-1.5 pr-3">{fmt(c.before)}</td>
              <td className="py-1.5">{fmt(c.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every schedule-affecting admin action goes through this dialog: it first requests a preview
 * (server-side dry run inside a rolled-back transaction), shows the consequences, then applies.
 */
export function usePreviewedAction() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [summary, setSummary] = useState<ChangeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);

  const call = (p: Pending, preview: boolean, ov: boolean) => {
    const body = { ...p.body, preview, override: ov };
    return p.method === 'post' ? api.admin.post<any>(p.path, body) : api.admin.put<any>(p.path, body);
  };

  const run = async (p: Pending) => {
    setPending(p);
    setSummary(null);
    setError(null);
    setOverride(false);
    setBusy(true);
    try {
      const r = await call(p, true, false);
      setSummary(r.summary);
    } catch (e) {
      setError((e as ApiFailure).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call(pending, false, override);
      pending.onDone(r);
      setPending(null);
    } catch (e) {
      const f = e as ApiFailure;
      if (f.code === 'INFEASIBLE' && f.details?.changes) setSummary(f.details);
      setError(f.message);
    } finally {
      setBusy(false);
    }
  };

  const needsOverride = (summary?.newlyUnscheduled.length ?? 0) > 0;
  const dialog = (
    <Modal
      open={!!pending}
      wide
      title={pending ? `Preview: ${pending.title}` : ''}
      onClose={() => !busy && setPending(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={pending?.danger || needsOverride ? 'danger' : 'primary'}
            onClick={apply}
            loading={busy}
            disabled={!summary || (needsOverride && !override)}
          >
            {needsOverride ? 'Apply with override' : (pending?.confirmLabel ?? 'Apply change')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {pending?.note && <p className="text-sm text-slate-700">{pending.note}</p>}
        {busy && !summary && <p className="text-sm text-slate-500">Calculating consequences…</p>}
        {error && <Alert tone="red">{error}</Alert>}
        {summary && (
          <>
            <ChangeTable summary={summary} />
            {needsOverride && (
              <Alert tone="red" title="Some groups would be left without an examination time">
                <ul className="list-disc pl-5">
                  {summary.newlyUnscheduled.map((u) => (
                    <li key={u.bookingId}>
                      {u.groupName} ({u.date}): {u.reason}
                    </li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />I understand. Apply anyway and
                  resolve these groups manually (capacity override).
                </label>
              </Alert>
            )}
            {!needsOverride && summary.unscheduled.length > 0 && (
              <Alert tone="amber">Groups already unscheduled: {summary.unscheduled.map((u) => u.groupName).join(', ')}.</Alert>
            )}
          </>
        )}
      </div>
    </Modal>
  );
  return { run, dialog };
}
