import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatDateLong, formatRange } from '../../../shared/time';
import { BLOCK_TYPE_LABELS } from '../../../shared/types';
import { Button, Loading } from '../../components/ui';
import type { SessionDetail } from './types';

/** Printable daily plan (use the browser's “Save as PDF”). */
export function PrintPage() {
  const { id = '' } = useParams();
  const { data } = useLoad(() => api.admin.get<SessionDetail>(`/admin/sessions/${id}`), [id]);
  useTitle('Print schedule');
  if (!data) return <Loading />;
  const byId = new Map(data.bookings.map((b) => [b.id, b]));
  const s = data.session;
  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-sm">
      <div className="no-print mb-6 flex gap-2">
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      <h1 className="text-xl font-semibold">
        {data.course.name} — {formatDateLong(s.date)}
      </h1>
      <p className="text-slate-600">
        {s.startTime}–{s.endTime} ({s.timezone}){s.location ? ` · ${s.location}` : ''} ·{' '}
        {s.scheduleStatus === 'finalized' ? 'Finalized (confirmed times)' : 'Tentative schedule'} · version {s.scheduleVersion}
      </p>
      <table className="mt-4 w-full border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-slate-800">
            <th className="py-1 pr-3">Time</th>
            <th className="py-1 pr-3">Activity</th>
            <th className="py-1">Students</th>
          </tr>
        </thead>
        <tbody>
          {data.timeline.map((t, i) => {
            const b = t.bookingId ? byId.get(t.bookingId) : undefined;
            const label = b
              ? b.groupName
              : t.kind === 'blocked'
                ? t.label || BLOCK_TYPE_LABELS[t.blockType ?? 'other']
                : t.kind === 'break'
                  ? 'Recovery break'
                  : t.kind === 'available'
                    ? 'Available'
                    : 'Not available';
            return (
              <tr key={i} className="border-b border-slate-200 align-top">
                <td className="py-1 pr-3 font-mono whitespace-nowrap">{formatRange(t.start, t.end)}</td>
                <td className={`py-1 pr-3 ${b ? 'font-semibold' : 'text-slate-500'}`}>{label}</td>
                <td className="py-1">{b ? b.members.join(', ') : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-slate-500">Generated {new Date().toLocaleString('en-GB', { timeZone: s.timezone })}</p>
    </div>
  );
}
