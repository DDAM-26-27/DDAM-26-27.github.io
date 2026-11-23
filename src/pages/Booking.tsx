import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useCourse } from '../lib/course';
import { useLoad, useTitle } from '../lib/hooks';
import type { PublicSession } from '../../shared/types';
import { formatDateLong, formatDuration, formatTime } from '../../shared/time';
import { examDuration } from '../../shared/rules';
import { Alert, Badge, Card, Loading, PageTitle, RegistrationBadge, ScheduleStatusBadge } from '../components/ui';

export function SessionCard({ s }: { s: PublicSession }) {
  const a = s.availability;
  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{formatDateLong(s.date)}</h2>
          <p className="text-sm text-slate-600">
            {s.startTime}–{s.endTime}
            {s.location ? ` · ${s.location}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <RegistrationBadge status={s.registrationStatus} />
          <ScheduleStatusBadge status={s.scheduleStatus} />
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Groups registered</dt>
          <dd className="font-semibold">{a.groupCount}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Available exam time</dt>
          <dd className="font-semibold">{formatDuration(a.availableMinutes)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Estimated end</dt>
          <dd className="font-semibold">{a.estimatedEndMinutes != null ? formatTime(a.estimatedEndMinutes) : '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Room for</dt>
          <dd className="font-semibold">{a.maxBookableGroupSize > 0 ? `groups up to ${a.maxBookableGroupSize}` : 'no more groups'}</dd>
        </div>
      </dl>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {a.canBook ? (
          <Link to={`/booking/${s.id}`} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">
            Register a group
          </Link>
        ) : (
          <span className="text-sm text-slate-600">{a.reason}</span>
        )}
        <Link to={`/schedule/${s.id}`} className="text-sm font-medium text-blue-700 hover:underline">
          View schedule →
        </Link>
      </div>
    </Card>
  );
}

export function BookingHomePage() {
  useTitle('Exam booking');
  const { course, error: courseError } = useCourse();
  const { data, error, loading } = useLoad(() => api.get<PublicSession[]>('/public/sessions'));
  return (
    <>
      <PageTitle sub={course?.description}>{course ? `${course.name} — oral examination` : 'Oral examination'}</PageTitle>
      {course && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <p className="font-semibold">1. Choose a date</p>
            <p className="text-slate-600">Pick one of the examination days below.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <p className="font-semibold">2. Register your group</p>
            <p className="text-slate-600">
              One student registers the whole group ({course.rules.minGroupSize}–{course.rules.maxGroupSize} students).
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
            <p className="font-semibold">3. Get your time</p>
            <p className="text-slate-600">
              The time is assigned automatically ({course.rules.presentationMinutes} min + {course.rules.questionsPerStudentMinutes} min per
              student, e.g. {examDuration(course.rules, 4)} min for 4).
            </p>
          </div>
        </div>
      )}
      {(courseError || error) && <Alert tone="red">{courseError ?? error?.message}</Alert>}
      {loading && <Loading />}
      {data && data.length === 0 && <Alert tone="neutral">No examination dates have been published yet. Please check back later.</Alert>}
      <div className="grid gap-4">
        {data?.map((s) => (
          <SessionCard key={s.id} s={s} />
        ))}
      </div>
      <p className="mt-6 text-sm text-slate-600">
        Already registered? Use the private link from your confirmation, or go to{' '}
        <Link className="text-blue-700 underline" to="/manage">
          My booking
        </Link>
        . <Badge>Times are estimates until the schedule is finalized</Badge>
      </p>
    </>
  );
}
