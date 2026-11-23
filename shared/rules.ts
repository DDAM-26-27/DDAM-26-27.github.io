import type { DurationRules } from './types';

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
