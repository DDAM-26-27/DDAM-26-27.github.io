import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiFailure, saveBlob } from '../lib/api';
import { useCourse } from '../lib/course';
import { useLoad, useTitle } from '../lib/hooks';
import type { BookingPreview, EmailStatus, ManagedBooking, PublicSession } from '../../shared/types';
import { validateGroup, type FieldErrors, type GroupInput } from '../../shared/validation';
import { formatDateLong, formatRange } from '../../shared/time';
import { toIcs } from '../../shared/export';
import { emptyGroup, GroupForm } from '../components/GroupForm';
import { Alert, Button, Card, Loading, PageTitle } from '../components/ui';
import { deadlineLabel, SubmissionNotice } from '../components/SubmissionNotice';

type Step = 'details' | 'preview' | 'done';

interface CreateResult {
  booking: ManagedBooking;
  managementUrl: string;
  managementToken: string;
  emailStatus: EmailStatus;
}

export function downloadBookingIcs(b: ManagedBooking, courseName: string, location?: string | null) {
  if (b.start == null || b.end == null) return;
  const ics = toIcs(
    [
      {
        uid: `${b.id}@ddam-exam-booking`,
        date: b.date,
        start: b.start,
        end: b.end,
        timeZone: b.timezone,
        summary: `${courseName} oral exam — ${b.groupName}`,
        description: `Group: ${b.groupName}\nStudents: ${b.members.join(', ')}\n${b.scheduleStatus === 'finalized' ? 'Confirmed time.' : 'Estimated time: it may change until the schedule is finalized.'}`,
        location,
      },
    ],
    courseName,
  );
  saveBlob(new Blob([ics], { type: 'text/calendar' }), `exam-${b.date}.ics`);
}

export function BookPage() {
  const { sessionId = '' } = useParams();
  const { course } = useCourse();
  const sessions = useLoad(() => api.get<PublicSession[]>('/public/sessions'));
  const session = sessions.data?.find((s) => s.id === sessionId);
  useTitle('Register a group');

  const [step, setStep] = useState<Step>('details');
  const [group, setGroup] = useState<GroupInput>(emptyGroup(3));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<BookingPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [understood, setUnderstood] = useState(false);

  if (!course || sessions.loading) return <Loading />;
  if (!session)
    return (
      <Alert tone="red" title="Examination date not found">
        <Link to="/booking" className="underline">
          Back to exam dates
        </Link>
      </Alert>
    );

  const toPreview = async () => {
    const { errors: errs } = validateGroup(group, course.rules);
    setErrors(errs);
    setFailure(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      setPreview(await api.post<BookingPreview>('/bookings/preview', { sessionId, groupSize: group.groupSize }));
      setStep('preview');
      window.scrollTo({ top: 0 });
    } catch (e) {
      setFailure(e as ApiFailure);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      const r = await api.post<CreateResult>('/bookings', { sessionId, ...group, expectedVersion: preview?.scheduleVersion });
      setResult(r);
      setStep('done');
      window.scrollTo({ top: 0 });
    } catch (e) {
      const f = e as ApiFailure;
      if (f.code === 'STALE_PREVIEW' && f.details?.preview) {
        setPreview(f.details.preview);
        setNotice('The schedule changed while you were completing the form. Please check your updated estimated time and confirm again.');
      } else if (f.code === 'VALIDATION' && f.details?.fields) {
        setErrors(f.details.fields);
        setStep('details');
      } else if (f.code === 'DUPLICATE') {
        setErrors({ groupName: f.message });
        setStep('details');
      } else setFailure(f);
    } finally {
      setBusy(false);
    }
  };

  const steps: [Step, string][] = [
    ['details', 'Group information'],
    ['preview', 'Review'],
    ['done', 'Confirmation'],
  ];

  return (
    <>
      <PageTitle
        sub={
          <>
            Examination date: <strong>{formatDateLong(session.date)}</strong>
          </>
        }
      >
        Register your group
      </PageTitle>
      <ol className="mb-6 flex gap-2 text-sm" aria-label="Progress">
        {steps.map(([key, label], i) => (
          <li
            key={key}
            aria-current={step === key ? 'step' : undefined}
            className={`flex-1 border-2 px-3 py-2 ${step === key ? 'win-titlebar border-black font-bold' : 'border-slate-400 bg-win text-slate-600'}`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {failure && (
        <div className="mb-4">
          <Alert tone="red" title={failure.code === 'CAPACITY' ? 'This date cannot accommodate your group' : 'Something went wrong'}>
            {failure.message}{' '}
            {(failure.code === 'CAPACITY' || failure.code === 'NOT_BOOKABLE') && (
              <Link to="/booking" className="font-medium underline">
                Choose another date
              </Link>
            )}
          </Alert>
        </div>
      )}

      {step === 'details' && (
        <Card>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void toPreview();
            }}
          >
            <GroupForm value={group} onChange={setGroup} rules={course.rules} errors={errors} />
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="submit" loading={busy}>
                Continue to review
              </Button>
              <Link to="/booking" className="btn98 px-4 py-1.5 text-sm">
                Cancel
              </Link>
            </div>
          </form>
        </Card>
      )}

      {step === 'preview' && preview && (
        <Card>
          {notice && (
            <div className="mb-4">
              <Alert tone="amber">{notice}</Alert>
            </div>
          )}
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Examination date</dt>
              <dd className="font-semibold">{formatDateLong(preview.date)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Group</dt>
              <dd className="font-semibold">{group.groupName}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Students ({group.groupSize})</dt>
              <dd>{group.members.join(', ')}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Expected examination duration</dt>
              <dd className="font-semibold">{preview.durationMinutes} minutes</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Tentative time</dt>
              <dd className="text-2xl font-semibold text-blue-800">{formatRange(preview.start, preview.end)}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <Alert tone="amber" title="About your examination time">
              Times are assigned automatically from group sizes, booking order and the lecturer&apos;s availability; you cannot choose a
              time. This is an estimate and may change until the lecturer finalizes the schedule.
            </Alert>
          </div>
          <div className="mt-4">
            <SubmissionNotice examDate={preview.date} contactEmail={course.contactEmail} timezone={course.timezone} />
          </div>
          <label className="win-sunken mt-4 flex cursor-pointer items-start gap-3 bg-white p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-blue-700"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <span>
              <strong>I have read the box above.</strong> Our group will email the repository link and the PDF report by{' '}
              <strong>{deadlineLabel(preview.date)}</strong>, confirming that we will come; otherwise the booking will be cancelled.
            </span>
          </label>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button onClick={confirm} loading={busy} disabled={!understood}>
              Confirm booking
            </Button>
            <Button variant="secondary" onClick={() => setStep('details')} disabled={busy}>
              Back
            </Button>
          </div>
        </Card>
      )}

      {step === 'done' && result && (
        <Card>
          <Alert tone="green" title="Your group is registered">
            {result.booking.groupName} · {formatDateLong(result.booking.date)}
            {result.booking.start != null && result.booking.end != null && (
              <> · estimated time {formatRange(result.booking.start, result.booking.end)}</>
            )}
          </Alert>
          <div className="mt-4">
            <SubmissionNotice examDate={result.booking.date} contactEmail={course.contactEmail} timezone={course.timezone} />
          </div>
          <div className="mt-5 space-y-2">
            <h2 className="font-semibold">Your private booking link</h2>
            <p className="text-sm text-slate-600">
              Use this link to view, modify or cancel the booking. Anyone with the link can manage the booking, so keep it private.{' '}
              <strong>Save it now</strong>: it cannot be shown again.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={result.managementUrl}
                aria-label="Booking management link"
                className="win-sunken flex-1 bg-tooltip px-3 py-2 font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(result.managementUrl);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied ✓' : 'Copy link'}
              </Button>
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-600">
            {result.emailStatus === 'sent'
              ? `A confirmation email with this link was sent to ${result.booking.representativeEmail}.`
              : 'No confirmation email could be sent, so please copy the link above now.'}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => downloadBookingIcs(result.booking, course.name, session.location)}>
              Add to calendar (.ics)
            </Button>
            <a className="btn98 px-4 py-2 text-sm font-bold" href={result.managementUrl}>
              Open my booking
            </a>
            <Link className="btn98 px-4 py-2 text-sm" to={`/schedule/${session.id}`}>
              View the day&apos;s schedule
            </Link>
          </div>
        </Card>
      )}
    </>
  );
}
