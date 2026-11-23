import { useCourse } from '../lib/course';
import { useTitle } from '../lib/hooks';
import { Card, Loading, PageTitle } from '../components/ui';

export function PrivacyPage() {
  useTitle('Privacy');
  const { course } = useCourse();
  if (!course) return <Loading />;
  return (
    <>
      <PageTitle sub={`${course.name} · ${course.academicYear}`}>Privacy information</PageTitle>
      <Card>
        <div className="max-w-prose space-y-3 text-sm leading-relaxed text-slate-700">
          {(course.privacyText || 'No privacy information has been provided yet.').split(/\n{2,}/).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
          {course.contactEmail && (
            <p>
              Contact:{' '}
              <a className="text-blue-700 underline" href={`mailto:${course.contactEmail}`}>
                {course.contactEmail}
              </a>
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
