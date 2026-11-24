import type { DurationRules } from './types';

/**
 * Students can cancel their booking (or move it to another date) online until this many hours
 * before their examination. After that they must email the lecturer.
 */
export const CANCEL_CUTOFF_HOURS = 24;

/** Full working days the lecturer keeps free to read the material before the exam. */
export const GRADING_WORKING_DAYS = 2;

/**
 * Last day (YYYY-MM-DD; due by 23:59 local time) to send the repository link and the PDF report:
 * the working day before the GRADING_WORKING_DAYS working days that precede the exam. Weekends are
 * skipped (public holidays are not). Example: exam Tuesday 15 → Thursday 10, leaving Friday and Monday.
 */
export function submissionDeadline(examDate: string): string {
  const d = new Date(`${examDate}T12:00:00Z`);
  let left = GRADING_WORKING_DAYS + 1;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** exam_duration = presentation + questions_per_student × group_size */
export function examDuration(rules: DurationRules, groupSize: number): number {
  return rules.presentationMinutes + rules.questionsPerStudentMinutes * groupSize;
}

export function validateRules(r: DurationRules): string[] {
  const errors: string[] = [];
  const int = (v: number) => Number.isInteger(v);
  if (!int(r.presentationMinutes) || r.presentationMinutes < 1 || r.presentationMinutes > 240)
    errors.push('Presentation duration must be between 1 and 240 minutes.');
  if (!int(r.questionsPerStudentMinutes) || r.questionsPerStudentMinutes < 0 || r.questionsPerStudentMinutes > 120)
    errors.push('Questions per student must be between 0 and 120 minutes.');
  if (!int(r.breakMinutes) || r.breakMinutes < 0 || r.breakMinutes > 120) errors.push('Recovery break must be between 0 and 120 minutes.');
  if (!int(r.minGroupSize) || r.minGroupSize < 1) errors.push('Minimum group size must be at least 1.');
  if (!int(r.maxGroupSize) || r.maxGroupSize < r.minGroupSize || r.maxGroupSize > 20)
    errors.push('Maximum group size must be between the minimum group size and 20.');
  return errors;
}
