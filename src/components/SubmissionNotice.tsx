import { GRADING_WORKING_DAYS, submissionDeadline } from '../../shared/rules';
import { formatDateLong, localToUtc } from '../../shared/time';
import { Alert } from './ui';

/** "Thursday, 10 December 2026, 23:59" — the day the repository link and the report are due. */
export function deadlineLabel(examDate: string) {
  return `${formatDateLong(submissionDeadline(examDate))}, 23:59`;
}

/**
 * What students must send before the exam, and by when. Shown when booking, on the confirmation
 * and on "My booking", so nobody can say they did not know.
 */
export function SubmissionNotice({
  examDate,
  contactEmail,
  timezone = 'Europe/Rome',
}: {
  examDate: string;
  contactEmail?: string | null;
  timezone?: string;
}) {
  const deadline = submissionDeadline(examDate);
  const passed = Date.now() > localToUtc(deadline, 23 * 60 + 59, timezone).getTime();
  const to = contactEmail ? (
    <a className="font-bold text-[#0000ee] underline" href={`mailto:${contactEmail}`}>
      {contactEmail}
    </a>
  ) : (
    'the lecturer'
  );
  return (
    <Alert tone={passed ? 'red' : 'amber'} title={`Send your code and report by ${deadlineLabel(examDate)}`}>
      <p>
        That is {GRADING_WORKING_DAYS} working days before your exam, so the lecturer has time to read your work.
        {passed && <strong> This deadline has already passed: send your material now and write to the lecturer.</strong>}
      </p>
      <p className="mt-2">
        <strong>One email per group</strong> to {to}, containing:
      </p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-6">
        <li>
          the <strong>link to your code repository</strong> (give the lecturer at least <strong>read access</strong>);
        </li>
        <li>
          your <strong>report as a PDF</strong>;
        </li>
        <li>
          a sentence <strong>confirming that your group will come to the exam</strong>.
        </li>
      </ol>
      <p className="mt-2">
        You may add other material, but only the repository and the report will be evaluated.{' '}
        <strong>If nothing arrives by the deadline, the lecturer will cancel your booking.</strong> Material sent later (for example the
        next afternoon) counts as late.
      </p>
    </Alert>
  );
}
