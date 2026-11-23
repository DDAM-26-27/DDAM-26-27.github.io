import type { Interval, TimelineItem } from '../types';
import { effectiveWindows, freeSegments, merge, subtract, totalMinutes, type DayAvailability } from './intervals';

export interface ScheduleStats {
  /** Total minutes within session hours. */
  sessionMinutes: number;
  /** Minutes inside availability windows that are not blocked. */
  freeMinutes: number;
  examMinutes: number;
  breakMinutes: number;
  blockedMinutes: number;
  /** Free minutes not used by exams or recovery breaks. */
  availableMinutes: number;
  examCount: number;
  /** End of the last exam, or null. */
  estimatedEnd: number | null;
}

/**
 * Builds a complete, gap-free timeline covering the session hours. Recovery breaks are shown
 * explicitly only when the time between two consecutive exams is entirely free time; when an
 * unavailable interval (e.g. lunch) separates them, it already provides the recovery time.
 */
export function buildTimeline(day: DayAvailability, exams: (Interval & { id: string })[], brk: number): TimelineItem[] {
  const segments = freeSegments(day);
  const sorted = [...exams].sort((a, b) => a.start - b.start);
  const items: TimelineItem[] = [];

  for (const e of sorted) items.push({ kind: 'exam', start: e.start, end: e.end, bookingId: e.id });

  const breaks: Interval[] = [];
  if (brk > 0) {
    for (let k = 1; k < sorted.length; k++) {
      const a = sorted[k - 1];
      const b = sorted[k];
      const sameSegment = segments.some((seg) => seg.start <= a.end && b.start <= seg.end);
      if (sameSegment && b.start - a.end >= 0) {
        const brEnd = Math.min(a.end + brk, b.start);
        if (brEnd > a.end) breaks.push({ start: a.end, end: brEnd });
      }
    }
  }
  for (const b of breaks) items.push({ kind: 'break', start: b.start, end: b.end, label: 'Recovery break' });

  for (const bl of day.blocks) {
    const start = Math.max(bl.start, day.dayStart);
    const end = Math.min(bl.end, day.dayEnd);
    if (end > start) items.push({ kind: 'blocked', start, end, blockType: bl.type, label: bl.label ?? null });
  }

  const used = [...sorted, ...breaks];
  for (const free of subtract(segments, used)) items.push({ kind: 'available', start: free.start, end: free.end });

  const unavailable = subtract([{ start: day.dayStart, end: day.dayEnd }], [...effectiveWindows(day), ...day.blocks]);
  for (const u of unavailable) items.push({ kind: 'unavailable', start: u.start, end: u.end, label: 'Not available' });

  return items.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function computeStats(day: DayAvailability, exams: Interval[], timeline: TimelineItem[]): ScheduleStats {
  const sum = (kind: TimelineItem['kind']) => timeline.filter((t) => t.kind === kind).reduce((s, t) => s + (t.end - t.start), 0);
  const sessionMinutes = day.dayEnd - day.dayStart;
  const freeMinutes = totalMinutes(freeSegments(day));
  const blocked = merge(day.blocks.map((b) => ({ start: Math.max(b.start, day.dayStart), end: Math.min(b.end, day.dayEnd) })));
  return {
    sessionMinutes,
    freeMinutes,
    examMinutes: sum('exam'),
    breakMinutes: sum('break'),
    blockedMinutes: totalMinutes(blocked),
    availableMinutes: sum('available'),
    examCount: exams.length,
    estimatedEnd: exams.length ? Math.max(...exams.map((e) => e.end)) : null,
  };
}
