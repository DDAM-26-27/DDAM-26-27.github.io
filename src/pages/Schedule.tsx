import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLoad, useTitle } from '../lib/hooks';
import type { PublicSchedule } from '../../shared/types';
import { formatDateLong, parseTime } from '../../shared/time';
import { Alert, Button, Card, Loading, PageTitle, RegistrationBadge, ScheduleStatusBadge } from '../components/ui';
import { TimelineBar, TimelineLegend, TimelineList } from '../components/Timeline';
import { useCourse } from '../lib/course';

export function SchedulePage() {
  const { sessionId = '' } = useParams();
  const { course } = useCourse();
  const { data, error, loading, reload } = useLoad(() => api.get<PublicSchedule>(`/public/sessions/${sessionId}/schedule`), [sessionId]);
  useTitle('Schedule');
  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="red">{error.message}</Alert>;
  if (!data) return null;
  const s = data.session;
  const finalized = s.scheduleStatus === 'finalized';
  return (
    <>
      <PageTitle
        sub={
          <>
            {s.startTime}–{s.endTime} · {s.timezone}
            {s.location ? ` · ${s.location}` : ''}
          </>
        }
      >
        {course ? `${course.name.replace(/.*\((.*)\).*/, '$1')} — ` : ''}
        {formatDateLong(s.date)}
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ScheduleStatusBadge status={s.scheduleStatus} />
        <RegistrationBadge status={s.registrationStatus} />
        <span className="text-sm text-slate-500">
          Last updated: {s.scheduleUpdatedAt ? new Date(s.scheduleUpdatedAt).toLocaleString('en-GB', { timeZone: s.timezone }) : 'never'}
        </span>
        <Button size="sm" variant="ghost" className="no-print" onClick={reload}>
          Refresh
        </Button>
      </div>
      <div className="mb-4">
        {finalized ? (
          <Alert tone="green">The lecturer has finalized this schedule. The times shown are confirmed.</Alert>
        ) : (
          <Alert tone="amber">This schedule is tentative. Times are estimates and may change until the lecturer finalizes it.</Alert>
        )}
      </div>
      {data.mode === 'hidden' ? (
        <Alert tone="neutral">The detailed schedule is not public. Use your private booking link to see your own examination time.</Alert>
      ) : (
        <Card>
          <div className="space-y-4">
            <TimelineBar entries={data.entries} dayStart={parseTime(s.startTime)} dayEnd={parseTime(s.endTime)} />
            <TimelineLegend />
            <TimelineList entries={data.entries} />
          </div>
        </Card>
      )}
      <div className="no-print mt-6 flex gap-4 text-sm">
        <Link to="/booking" className="text-blue-700 hover:underline">
          ← All exam dates
        </Link>
        {s.availability.canBook && (
          <Link to={`/booking/${s.id}`} className="text-blue-700 hover:underline">
            Register a group for this date
          </Link>
        )}
      </div>
    </>
  );
}
