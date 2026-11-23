import type { BlockedInterval, Interval } from '../types';
import { formatRange } from '../time';

export interface DayAvailability {
  /** Overall session hours (e.g. 09:00–18:00). */
  dayStart: number;
  dayEnd: number;
  /** Availability windows. Empty means "the whole day". */
  windows: Interval[];
  /** Unavailable intervals (lunch, lectures, ...). */
  blocks: BlockedInterval[];
}

const byStart = (a: Interval, b: Interval) => a.start - b.start || a.end - b.end;

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Validates the availability configuration of a day; returns human-readable errors. */
export function validateAvailability(day: DayAvailability): string[] {
  const errors: string[] = [];
  const valid = (i: Interval) => Number.isInteger(i.start) && Number.isInteger(i.end) && i.start >= 0 && i.end <= 24 * 60;
  if (!valid({ start: day.dayStart, end: day.dayEnd }) || day.dayStart >= day.dayEnd) {
    errors.push('The session end time must be after its start time.');
    return errors;
  }
  const check = (list: Interval[], what: string) => {
    const sorted = [...list].sort(byStart);
    for (const i of sorted) {
      if (!valid(i) || i.start >= i.end) errors.push(`${what} ${formatRange(i.start, i.end)}: end must be after start.`);
      else if (i.start < day.dayStart || i.end > day.dayEnd)
        errors.push(`${what} ${formatRange(i.start, i.end)} lies outside the session hours ${formatRange(day.dayStart, day.dayEnd)}.`);
    }
    for (let k = 1; k < sorted.length; k++) {
      if (overlaps(sorted[k - 1], sorted[k]))
        errors.push(
          `${what}s ${formatRange(sorted[k - 1].start, sorted[k - 1].end)} and ${formatRange(sorted[k].start, sorted[k].end)} overlap.`,
        );
    }
  };
  check(day.windows, 'Availability window');
  check(day.blocks, 'Unavailable interval');
  return errors;
}

/** Effective windows: explicit windows, or the whole session if none are given. */
export function effectiveWindows(day: DayAvailability): Interval[] {
  if (day.windows.length === 0) return [{ start: day.dayStart, end: day.dayEnd }];
  return [...day.windows].sort(byStart).map((w) => ({ start: w.start, end: w.end }));
}

/** Subtracts `cuts` from `base`. Inputs need not be sorted or disjoint. */
export function subtract(base: Interval[], cuts: Interval[]): Interval[] {
  let result = merge(base);
  for (const c of merge(cuts)) {
    const next: Interval[] = [];
    for (const r of result) {
      if (!overlaps(r, c)) {
        next.push(r);
        continue;
      }
      if (r.start < c.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    result = next;
  }
  return result;
}

/** Merges overlapping/adjacent intervals. */
export function merge(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort(byStart);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** Free time in which examinations may take place. */
export function freeSegments(day: DayAvailability): Interval[] {
  return subtract(effectiveWindows(day), day.blocks);
}

export function totalMinutes(list: Interval[]): number {
  return merge(list).reduce((s, i) => s + (i.end - i.start), 0);
}
