import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiFailure } from '../lib/api';
import { useCourse } from '../lib/course';
import { useTitle } from '../lib/hooks';
import type { ManagedBooking, PublicSession } from '../../shared/types';
import { validateGroup, type FieldErrors, type GroupInput } from '../../shared/validation';
import { formatDateLong, formatRange } from '../../shared/time';
import { GroupForm } from '../components/GroupForm';
import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, PageTitle, ScheduleStatusBadge, Select } from '../components/ui';
import { downloadBookingIcs } from './Book';
import { SubmissionNotice } from '../components/SubmissionNotice';
import { CANCEL_CUTOFF_HOURS } from '../../shared/rules';

/** e.g. "Mon 14 Dec 2026, 10:30" in the session's time zone. */
function formatInstant(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function readToken(): string {
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('t');
  if (fromHash) {
    try {
      sessionStorage.setItem('ddam_manage_token', fromHash);
    } catch {
      /* storage unavailable */
    }
    // Remove the token from the address bar (and browser history).
    history.replaceState(null, '', window.location.pathname);
    return fromHash;
  }
  try {
    return sessionStorage.getItem('ddam_manage_token') ?? '';
  } catch {
    return '';
  }
}

export function ManagePage() {
  useTitle('My booking');
  const { course } = useCourse();
  const [token, setToken] = useState<string>(() => readToken());
  const [manualLink, setManualLink] = useState('');
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [sessions, setSessions] = useState<PublicSession[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<GroupInput & { sessionId: string }>({
    groupName: '',
    groupSize: 1,
    members: [''],
    representativeEmail: '',
    notes: '',
    sessionId: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<{ after: { date: string; start: number | null; end: number | null } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const load = async (t = token) => {
    if (!t) return;
    setLoading(true);
    setFailure(null);
    try {
      const r = await api.post<{ booking: ManagedBooking; sessions: PublicSession[] }>('/manage/booking', { token: t });
      setBooking(r.booking);
      setSessions(r.sessions);
    } catch (e) {
      setFailure(e as ApiFailure);
      setBooking(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token || (failure && failure.code === 'INVALID_LINK')) {
    return (
      <>
        <PageTitle>My booking</PageTitle>
        {failure && (
          <div className="mb-4">
            <Alert tone="red">{failure.message}</Alert>
          </div>
        )}
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = /[#&]t=([A-Za-z0-9_-]+)/.exec(manualLink)?.[1] ?? manualLink.trim();
              setFailure(null);
              setToken(t);
            }}
          >
            <Field
              label="Paste your private booking link"
              htmlFor="link"
              hint="You received it when you registered (and by email, if email delivery is configured)."
            >
              <Input id="link" value={manualLink} onChange={(e) => setManualLink(e.target.value)} placeholder="https://…/manage#t=…" />
            </Field>
            <Button type="submit" className="mt-4">
              Open booking
            </Button>
          </form>
          <p className="mt-4 text-sm text-slate-600">Lost your link? Contact the lecturer: they can issue a new one.</p>
        </Card>
      </>
    );
  }
  if (loading && !booking) return <Loading />;
  if (failure && !booking) return <Alert tone="red">{failure.message}</Alert>;
  if (!booking || !course) return <Loading />;

  const session = sessions.find((s) => s.id === booking.sessionId);
  const finalized = booking.scheduleStatus === 'finalized';
  const active = booking.status === 'active';
  const moveTargets = sessions.filter(
    (s) => s.id === booking.sessionId || (s.availability.canBook && s.availability.maxBookableGroupSize >= form.groupSize),
  );

  const startEdit = () => {
    setForm({
      groupName: booking.groupName,
      groupSize: booking.groupSize,
      members: [...booking.members],
      representativeEmail: booking.representativeEmail,
      notes: booking.notes,
      sessionId: booking.sessionId,
    });
    setErrors({});
    setPreview(null);
    setMessage(null);
    setEditing(true);
  };

  const submit = async (doPreview: boolean) => {
    const { errors: errs } = validateGroup(form, course.rules);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setFailure(null);
    try {
      const r = await api.post<any>('/manage/update', { token, ...form, preview: doPreview });
      if (doPreview) setPreview(r);
      else {
        setBooking(r.booking);
        setEditing(false);
        setPreview(null);
        setMessage('Your booking has been updated.');
        void load();
      }
    } catch (e) {
      const f = e as ApiFailure;
      if (f.details?.fields) setErrors(f.details.fields);
      else if (f.code === 'DUPLICATE') setErrors({ groupName: f.message });
      setFailure(f);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ booking: ManagedBooking }>('/manage/cancel', { token, confirmation: confirmText });
      setBooking(r.booking);
      setCancelOpen(false);
      setMessage('Your booking has been cancelled.');
    } catch (e) {
      setFailure(e as ApiFailure);
      setCancelOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle sub={`Booking #${booking.sequence}`}>{booking.groupName}</PageTitle>
      {message && (
        <div className="mb-4">
          <Alert tone="green">{message}</Alert>
        </div>
      )}
      {failure && (
        <div className="mb-4">
          <Alert tone="red">{failure.message}</Alert>
        </div>
      )}

      {!editing && (
        <Card
          title="Booking details"
          actions={active ? <ScheduleStatusBadge status={booking.scheduleStatus} /> : <Badge tone="red">Cancelled</Badge>}
        >
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Examination date</dt>
              <dd className="font-semibold">{formatDateLong(booking.date)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{finalized ? 'Confirmed time' : 'Estimated time'}</dt>
              <dd className="text-xl font-semibold text-blue-800">
                {active
                  ? booking.start != null && booking.end != null
                    ? formatRange(booking.start, booking.end)
                    : 'To be assigned by the lecturer'
                  : '—'}
                {booking.revised && <Badge tone="amber">Revised</Badge>}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Duration</dt>
              <dd>{booking.durationMinutes} minutes</dd>
            </div>
            <div>
              <dt className="text-slate-500">Representative</dt>
              <dd>{booking.representativeEmail}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Students ({booking.groupSize})</dt>
              <dd>{booking.members.join(', ')}</dd>
            </div>
            {booking.notes && (
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Notes</dt>
                <dd className="whitespace-pre-wrap">{booking.notes}</dd>
              </div>
            )}
          </dl>
          {active && (
            <div className="mt-4">
              <SubmissionNotice examDate={booking.date} contactEmail={course.contactEmail} timezone={booking.timezone} />
            </div>
          )}
          {active && !finalized && (
            <div className="mt-4">
              <Alert tone="amber">
                This time is an estimate. It may change when other groups book, modify or cancel, until the lecturer finalizes the schedule.
              </Alert>
            </div>
          )}
          {active && finalized && (
            <div className="mt-4">
              <Alert tone="green">
                The schedule is finalized: this time is confirmed. To change the date or group size, contact the lecturer.
              </Alert>
            </div>
          )}
          {active && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={startEdit}>Modify booking</Button>
              <Button
                variant="secondary"
                onClick={() => downloadBookingIcs(booking, course.name, session?.location)}
                disabled={booking.start == null}
              >
                Add to calendar (.ics)
              </Button>
              <Link to={`/schedule/${booking.sessionId}`} className="self-center text-sm font-medium text-blue-700 hover:underline">
                View the day&apos;s schedule
              </Link>
              {booking.canCancel && (
                <Button
                  variant="ghost"
                  className="ml-auto text-red-700"
                  onClick={() => {
                    setConfirmText('');
                    setCancelOpen(true);
                  }}
                >
                  Cancel booking
                </Button>
              )}
            </div>
          )}
          {active && (
            <div className="mt-4">
              {booking.canCancel ? (
                <p className="text-sm text-slate-600">
                  You can cancel online until <strong>{formatInstant(booking.cancelDeadline, booking.timezone)}</strong> (
                  {CANCEL_CUTOFF_HOURS} hours before your examination).
                </p>
              ) : (
                <Alert tone="amber" title="Online cancellation is closed">
                  Your examination is less than {CANCEL_CUTOFF_HOURS} hours away. To cancel, email the lecturer privately
                  {course.contactEmail ? (
                    <>
                      {' '}
                      at{' '}
                      <a
                        className="underline"
                        href={`mailto:${course.contactEmail}?subject=${encodeURIComponent(`Cancel booking: ${booking.groupName}`)}`}
                      >
                        {course.contactEmail}
                      </a>
                    </>
                  ) : null}
                  .
                </Alert>
              )}
            </div>
          )}
          {!active && (
            <p className="mt-4 text-sm text-slate-600">
              This booking was cancelled. To take the exam,{' '}
              <Link className="text-blue-700 underline" to="/booking">
                register again
              </Link>
              .
            </p>
          )}
        </Card>
      )}

      {editing && (
        <Card title="Modify booking">
          <div className="space-y-5">
            <Field
              label="Examination date"
              htmlFor="move"
              hint={
                finalized
                  ? 'The schedule is finalized; the date cannot be changed.'
                  : !booking.canCancel
                    ? `Your examination is less than ${CANCEL_CUTOFF_HOURS} hours away, so the date can no longer be changed online. Email the lecturer.`
                    : 'Only dates that can accommodate your group are listed. Moving puts your group at the end of the queue for the new date.'
              }
            >
              <Select
                id="move"
                value={form.sessionId}
                disabled={finalized || !booking.canCancel}
                onChange={(e) => {
                  setForm({ ...form, sessionId: e.target.value });
                  setPreview(null);
                }}
              >
                {moveTargets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateLong(s.date)}
                    {s.id === booking.sessionId ? ' (current)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <GroupForm
              value={form}
              onChange={(g) => {
                setForm({ ...form, ...g });
                setPreview(null);
              }}
              rules={course.rules}
              errors={errors}
              sizeLocked={finalized}
            />
            {preview && (
              <Alert tone="blue" title="Result of this change">
                {preview.after?.start != null && preview.after.end != null
                  ? `${formatDateLong(preview.after.date)}, estimated ${formatRange(preview.after.start, preview.after.end)}.`
                  : 'No time could be assigned.'}{' '}
                Confirm to apply.
              </Alert>
            )}
            <div className="flex flex-wrap gap-3">
              {preview ? (
                <Button onClick={() => submit(false)} loading={busy}>
                  Confirm changes
                </Button>
              ) : (
                <Button onClick={() => submit(true)} loading={busy}>
                  Check new time
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>
                Back
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={cancelOpen}
        title="Cancel this booking?"
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Keep booking
            </Button>
            <Button
              variant="danger"
              onClick={doCancel}
              loading={busy}
              disabled={confirmText.trim().toLowerCase() !== booking.groupName.toLowerCase()}
            >
              Cancel booking
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Your group will lose its place in the schedule. This cannot be undone. Type the group name <strong>{booking.groupName}</strong> to
          confirm.
        </p>
        <Input
          className="mt-3"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          aria-label="Type the group name to confirm"
        />
      </Modal>
    </>
  );
}
