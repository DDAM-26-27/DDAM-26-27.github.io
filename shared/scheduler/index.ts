export * from './engine';
export * from './intervals';
export * from './timeline';
import { schedule, type SchedulerExam, type SchedulerInput } from './engine';
import { examDuration } from '../rules';
import type { DurationRules } from '../types';

/** Simulates adding one more exam (lowest priority) and reports whether everyone still fits. */
export function simulateAdd(input: SchedulerInput, exam: SchedulerExam) {
  const result = schedule({ ...input, exams: [...input.exams, exam] });
  const placed = result.scheduled.find((s) => s.id === exam.id) ?? null;
  return { result, placed, feasible: result.feasible };
}

/** Largest group size (within rules) that could still be booked; 0 if none. */
export function maxBookableGroupSize(input: SchedulerInput, rules: DurationRules): number {
  const base = schedule(input);
  if (!base.feasible) return 0;
  const nextSeq = Math.max(0, ...input.exams.map((e) => e.sequence)) + 1;
  for (let size = rules.maxGroupSize; size >= rules.minGroupSize; size--) {
    const { feasible } = simulateAdd(input, {
      id: '__probe__',
      sequence: nextSeq,
      durationMinutes: examDuration(rules, size),
    });
    if (feasible) return size;
  }
  return 0;
}
