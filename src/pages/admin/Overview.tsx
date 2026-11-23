import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiFailure, downloadAdminFile } from '../../lib/api';
import { useLoad, useTitle } from '../../lib/hooks';
import { formatDateLong, formatDuration, formatTime, parseTime } from '../../../shared/time';
import { BLOCK_TYPE_LABELS } from '../../../shared/types';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Loading,
  Modal,
  PageTitle,
  RegistrationBadge,
  ScheduleStatusBadge,
  Select,
  Stat,
} from '../../components/ui';
import { TimelineBar, type TimelineEntry } from '../../components/Timeline';
import type { Overview } from './types';

function NewSessionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [form, setForm] = useState({
    date: '',
    startTime: '09:00',
    endTime: '18:00',
    title: '',
    location: '',
    registrationStatus: 'draft',
    lunch: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const intervals = form.lunch ? [{ kind: 'blocked', blockType: 'lunch', start: '13:00', end: '14:00', label: 'Lunch break' }] : [];
      const r = await api.admin.post<{ id: string }>('/admin/sessions', { ...form, intervals });
      onClose();
      nav(`/admin/sessions/${r.id}`);
    } catch (e) {
      setError((e as ApiFailure).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      title="Add examination date"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Create session
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="red">{error}</Alert>
          </div>
        )}
        <Field label="Date" htmlFor="ns-date">
          <Input id="ns-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </Field>
        <Field label="Registration" htmlFor="ns-reg">
          <Select id="ns-reg" value={form.registrationStatus} onChange={(e) => setForm({ ...form, registrationStatus: e.target.value })}>
            <option value="draft">Draft (hidden from students)</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </Select>
        </Field>
        <Field label="Day starts" htmlFor="ns-start">
          <Input id="ns-start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
        </Field>
        <Field label="Day ends" htmlFor="ns-end">
          <Input id="ns-end" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
        </Field>
        <Field label="Title (optional)" htmlFor="ns-title">
          <Input id="ns-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Location (optional)" htmlFor="ns-loc">
          <Input id="ns-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.lunch} onChange={(e) => setForm({ ...form, lunch: e.target.checked })} /> Add a lunch break
          13:00–14:00 (editable later)
        </label>
      </div>
    </Modal>
  );
}

export function OverviewPage() {
  useTitle('Dashboard');
  const { data, error, loading } = useLoad(() => api.admin.get<Overview>('/admin/overview'));
  const [newOpen, setNewOpen] = useState(false);
  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="red">{error.message}</Alert>;
  if (!data) return null;
  const t = data.totals;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle sub={`${data.course.academicYear} · ${data.course.institution}`}>{data.course.name}</PageTitle>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => downloadAdminFile('/admin/export/bookings.csv', 'bookings.csv')}>
            Export all bookings (CSV)
          </Button>
          <Button onClick={() => setNewOpen(true)}>Add examination date</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <Stat label="Sessions" value={t.sessions} />
        <Stat label="Groups" value={t.groups} />
        <Stat label="Students" value={t.students} />
        <Stat label="Exam time" value={formatDuration(t.examMinutes)} />
        <Stat label="Recovery breaks" value={formatDuration(t.breakMinutes)} />
        <Stat label="Blocked time" value={formatDuration(t.blockedMinutes)} />
        <Stat label="Unused time" value={formatDuration(t.availableMinutes)} />
        <Stat label="Need attention" value={<span className={t.attention ? 'text-red-700' : ''}>{t.attention}</span>} />
      </div>

      {data.attention.length > 0 && (
        <div className="mt-6">
          <Alert tone="red" title="Groups requiring attention">
            <ul className="list-disc pl-5">
              {data.attention.map((a) => (
                <li key={a.bookingId}>
                  <Link className="underline" to={`/admin/sessions/${a.sessionId}`}>
                    {a.groupName} ({a.date})
                  </Link>
                  : {a.issue}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <div className="mt-6 grid gap-4">
        {data.sessions.length === 0 && <Alert tone="neutral">No examination sessions yet. Use “Add examination date”.</Alert>}
        {data.sessions.map((s) => {
          return (
            <Card
              key={s.id}
              title={
                <Link to={`/admin/sessions/${s.id}`} className="hover:underline">
                  {formatDateLong(s.date)}{' '}
                  <span className="font-normal text-slate-500">
                    · {s.startTime}–{s.endTime}
                  </span>
                </Link>
              }
              actions={
                <>
                  <RegistrationBadge status={s.registrationStatus} />
                  <ScheduleStatusBadge status={s.scheduleStatus} />
                </>
              }
            >
              <SessionMiniTimeline id={s.id} dayStart={parseTime(s.startTime)} dayEnd={parseTime(s.endTime)} />
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
                <div>
                  <dt className="text-slate-500">Groups</dt>
                  <dd className="font-medium">{s.groupCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Students</dt>
                  <dd className="font-medium">{s.availability.studentCount}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Exam time</dt>
                  <dd className="font-medium">{formatDuration(s.stats.examMinutes)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Unused</dt>
                  <dd className="font-medium">{formatDuration(s.stats.availableMinutes)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Estimated end</dt>
                  <dd className="font-medium">{s.stats.estimatedEnd != null ? formatTime(s.stats.estimatedEnd) : '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Attention</dt>
                  <dd className={s.attention ? 'font-medium text-red-700' : 'font-medium'}>{s.attention}</dd>
                </div>
              </dl>
              <div className="mt-3">
                <Link to={`/admin/sessions/${s.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                  Manage session →
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
      <NewSessionModal open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}

function SessionMiniTimeline({ id, dayStart, dayEnd }: { id: string; dayStart: number; dayEnd: number }) {
  const { data } = useLoad(() => api.admin.get<{ timeline: any[]; bookings: any[] }>(`/admin/sessions/${id}`), [id]);
  if (!data) return <div className="h-12 animate-pulse rounded-md bg-slate-100" />;
  const names = new Map(data.bookings.map((b) => [b.id, b.groupName]));
  const entries: TimelineEntry[] = data.timeline.map((i) => ({
    start: i.start,
    end: i.end,
    kind: i.kind,
    label:
      i.kind === 'exam'
        ? (names.get(i.bookingId) ?? 'Exam')
        : i.kind === 'blocked'
          ? i.label || BLOCK_TYPE_LABELS[i.blockType as keyof typeof BLOCK_TYPE_LABELS]
          : i.kind,
  }));
  return <TimelineBar entries={entries} dayStart={dayStart} dayEnd={dayEnd} />;
}
