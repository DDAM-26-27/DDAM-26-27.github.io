import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useCourse } from '../lib/course';
import { useLoad, useTitle } from '../lib/hooks';
import type { PublicSession } from '../../shared/types';
import { formatDateLong, formatDuration, formatTime } from '../../shared/time';
import { CANCEL_CUTOFF_HOURS, examDuration } from '../../shared/rules';
import { Alert, Card, Loading, PageTitle, RegistrationBadge, ScheduleStatusBadge } from '../components/ui';

export function SessionCard({ s }: { s: PublicSession }) {
  const a = s.availability;
  return (
    <Card className="flex flex-col" title={`📅 ${s.title || 'Examination day'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xl font-bold text-blue-700">{formatDateLong(s.date)}</p>
          <p className="text-sm">
            🕘 {s.startTime}–{s.endTime}
            {s.location ? (
              <>
                {' '}
                · 📍 <strong>{s.location}</strong>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <RegistrationBadge status={s.registrationStatus} />
          <ScheduleStatusBadge status={s.scheduleStatus} />
        </div>
      </div>
      <dl className="win-sunken mt-4 grid grid-cols-2 gap-x-4 gap-y-2 bg-slate-50 p-3 text-sm sm:grid-cols-4">
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
          <Link to={`/booking/${s.id}`} className="btn98 btn98-primary px-5 py-2 text-base font-bold">
            ➜ Register my group for this date
          </Link>
        ) : (
          <span className="win-sunken bg-tooltip px-2 py-1 text-sm font-bold">⛔ {a.reason}</span>
        )}
        <Link to={`/schedule/${s.id}`} className="btn98 px-4 py-2 text-sm">
          See the timetable of this day
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
        <Card className="mb-5" title="How it works — read this first">
          <ol className="grid gap-3 sm:grid-cols-3">
            {[
              ['Choose a date', 'Pick one of the examination days below and click the blue button.'],
              [
                'Register the group',
                `ONE student registers the whole group (${course.rules.minGroupSize}–${course.rules.maxGroupSize} students), with everybody's names.`,
              ],
              [
                'Get your time',
                `The time is assigned automatically: ${course.rules.presentationMinutes} min + ${course.rules.questionsPerStudentMinutes} min per student (e.g. ${examDuration(course.rules, 4)} min for 4 students). You cannot choose it.`,
              ],
            ].map(([title, text], i) => (
              <li key={title} className="flex gap-3">
                <span className="win-raised flex h-12 w-12 shrink-0 items-center justify-center text-2xl font-bold text-blue-700">
                  {i + 1}
                </span>
                <span className="text-sm">
                  <strong className="block text-base">{title}</strong>
                  {text}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 space-y-2">
            <Alert tone="amber" title="Only ONE booking per group">
              Do not let every member of the group register: one person books for everyone. If your group is already registered, do not
              register it again.
            </Alert>
            <Alert tone="blue" title="Keep your private link">
              After booking you get a private link (on screen and by email). You need it to check, change or cancel your booking. You can
              cancel online until {CANCEL_CUTOFF_HOURS} hours before your exam; after that, email the lecturer.
            </Alert>
          </div>
        </Card>
      )}
      {(courseError || error) && <Alert tone="red">{courseError ?? error?.message}</Alert>}
      {loading && <Loading />}
      {data && data.length === 0 && <Alert tone="neutral">No examination dates have been published yet. Please check back later.</Alert>}
      <div className="grid gap-4">
        {data?.map((s) => (
          <SessionCard key={s.id} s={s} />
        ))}
      </div>
      <div className="mt-5">
        <Alert tone="neutral" title="Already registered?">
          Open the private link from your confirmation email, or go to{' '}
          <Link className="font-bold text-[#0000ee] underline" to="/manage">
            🔑 My booking
          </Link>
          . Times are <strong>provisional</strong> until the lecturer finalizes the schedule.
        </Alert>
      </div>
    </>
  );
}
