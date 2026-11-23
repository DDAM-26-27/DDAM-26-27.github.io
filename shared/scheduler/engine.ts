/**
 * Deterministic scheduling engine: "FIFO priority + opportunistic gap filling".
 *
 * Model
 * -----
 * - Free time = availability windows minus unavailable intervals.
 * - An exam occupies [start, start + duration) and must lie entirely inside one free segment
 *   (exams are never split across a blocked interval).
 * - Two exams must be separated by at least `breakMinutes`. Any time between them counts,
 *   so a lunch break of ≥ breakMinutes already satisfies the recovery requirement and no extra
 *   break is inserted. No break is added after the last exam.
 *
 * Policy (in this order)
 * ----------------------
 * 1. Pinned exams (finalized schedule) keep their exact times.
 * 2. Exams with an administrator-defined manual position are placed in that exact relative order,
 *    each at the earliest feasible time after the previous one.
 * 3. All other exams are processed by priority (booking order, sequence number as tie-breaker) and
 *    each one is placed at the EARLIEST FEASIBLE time anywhere in the day.
 *
 *    Because higher-priority exams are placed first and never moved by later ones, a later booking
 *    can only use time that is left over: if the next group in order does not fit before lunch,
 *    it goes after lunch, and a later smaller group may fill the gap before lunch. Earlier bookings
 *    are never delayed by later bookings.
 * 4. Fallback: if the greedy pass leaves exams unscheduled, an exact depth-first search over
 *    time-ordered sequences (explored in priority order, so the first solution found is the most
 *    FIFO-like one) looks for a schedule that fits everybody. This avoids rejecting a booking
 *    merely because of the greedy order. If no full schedule exists, the greedy result is kept
 *    and the unscheduled exams are reported.
 */
import type { Interval } from '../types';
import { freeSegments, type DayAvailability } from './intervals';
import { buildTimeline, computeStats, type ScheduleStats } from './timeline';
import type { TimelineItem } from '../types';

export interface SchedulerExam {
  id: string;
  /** Priority: lower is earlier (booking order). Also the stable tie-breaker. */
  sequence: number;
  durationMinutes: number;
  /** Administrator-defined position; exams with a position are kept in that relative order. */
  manualPosition?: number | null;
  /** Fixed start (finalized schedule). */
  pinnedStart?: number | null;
}

export interface SchedulerInput extends DayAvailability {
  breakMinutes: number;
  exams: SchedulerExam[];
}

export type Placement = 'pinned' | 'manual' | 'auto';

export interface ScheduledExam extends Interval {
  id: string;
  placement: Placement;
  /** True if scheduled before an exam with higher priority (gap filling). */
  gapFill: boolean;
}

export interface UnscheduledExam {
  id: string;
  reason: string;
}

export interface ScheduleResult {
  scheduled: ScheduledExam[];
  unscheduled: UnscheduledExam[];
  strategy: 'greedy' | 'search';
  timeline: TimelineItem[];
  stats: ScheduleStats;
  feasible: boolean;
}

const SEARCH_MAX_EXAMS = 18;
const SEARCH_NODE_LIMIT = 200_000;

interface Placed extends Interval {
  id: string;
}

/**
 * Earliest start s ≥ lowerBound such that [s, s+d) lies in a free segment and keeps
 * at least `brk` minutes from every placed exam. Returns null if impossible.
 */
export function earliestFit(segments: Interval[], placed: Placed[], duration: number, brk: number, lowerBound = 0): number | null {
  const candidates = new Set<number>([lowerBound]);
  for (const s of segments) candidates.add(s.start);
  for (const p of placed) candidates.add(p.end + brk);
  const sorted = [...candidates].filter((c) => c >= lowerBound).sort((a, b) => a - b);
  for (const s of sorted) {
    const e = s + duration;
    if (!segments.some((seg) => seg.start <= s && e <= seg.end)) continue;
    if (placed.every((p) => s >= p.end + brk || e + brk <= p.start)) return s;
  }
  return null;
}

function compareExams(a: SchedulerExam, b: SchedulerExam): number {
  return a.sequence - b.sequence || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function compareManual(a: SchedulerExam, b: SchedulerExam): number {
  return (a.manualPosition ?? 0) - (b.manualPosition ?? 0) || compareExams(a, b);
}

export function schedule(input: SchedulerInput): ScheduleResult {
  const segments = freeSegments(input);
  const brk = Math.max(0, input.breakMinutes);
  const placed: (Placed & { placement: Placement })[] = [];
  const unscheduled: UnscheduledExam[] = [];

  // 1. Pinned exams.
  const pinned = input.exams.filter((e) => e.pinnedStart != null).sort(compareExams);
  for (const e of pinned) {
    const s = e.pinnedStart as number;
    const iv = { start: s, end: s + e.durationMinutes };
    const inFree = segments.some((seg) => seg.start <= iv.start && iv.end <= seg.end);
    const clash = placed.some((p) => !(iv.start >= p.end + brk || iv.end + brk <= p.start));
    if (!inFree) unscheduled.push({ id: e.id, reason: 'The fixed time overlaps an unavailable interval.' });
    else if (clash) unscheduled.push({ id: e.id, reason: 'The fixed time conflicts with another fixed examination.' });
    else placed.push({ id: e.id, ...iv, placement: 'pinned' });
  }
  const fixed = [...placed];

  const manual = input.exams.filter((e) => e.pinnedStart == null && e.manualPosition != null).sort(compareManual);
  const auto = input.exams.filter((e) => e.pinnedStart == null && e.manualPosition == null).sort(compareExams);

  // 2. Manual order (strict relative order).
  let cursor = 0;
  for (const e of manual) {
    const s = earliestFit(segments, placed, e.durationMinutes, brk, cursor);
    if (s == null) {
      unscheduled.push({ id: e.id, reason: 'Not enough available time in the requested manual order.' });
      continue;
    }
    placed.push({ id: e.id, start: s, end: s + e.durationMinutes, placement: 'manual' });
    cursor = s + e.durationMinutes;
  }
  // 3. Priority order with earliest-fit (gap filling).
  for (const e of auto) {
    const s = earliestFit(segments, placed, e.durationMinutes, brk, 0);
    if (s == null) {
      unscheduled.push({ id: e.id, reason: 'Not enough available time on this day.' });
      continue;
    }
    placed.push({ id: e.id, start: s, end: s + e.durationMinutes, placement: 'auto' });
  }

  let strategy: ScheduleResult['strategy'] = 'greedy';
  let finalPlaced = placed;
  let finalUnscheduled = unscheduled;

  // 4. Exact fallback when some non-pinned exam could not be placed.
  const pinnedFailed = unscheduled.some((u) => pinned.some((p) => p.id === u.id));
  if (unscheduled.length > 0 && !pinnedFailed) {
    const movable = [...manual, ...auto];
    if (movable.length <= SEARCH_MAX_EXAMS) {
      const found = exactSearch(segments, fixed, manual, auto, brk);
      if (found) {
        strategy = 'search';
        finalPlaced = [...fixed.map((p) => ({ ...p })), ...found];
        finalUnscheduled = [];
      }
    }
  }

  const scheduled = annotate(finalPlaced, input.exams);
  const timeline = buildTimeline(input, scheduled, brk);
  return {
    scheduled,
    unscheduled: finalUnscheduled,
    strategy,
    timeline,
    stats: computeStats(input, scheduled, timeline),
    feasible: finalUnscheduled.length === 0,
  };
}

function annotate(placed: (Placed & { placement: Placement })[], exams: SchedulerExam[]): ScheduledExam[] {
  const byId = new Map(exams.map((e) => [e.id, e]));
  const sorted = [...placed].sort((a, b) => a.start - b.start || a.end - b.end);
  return sorted.map((p, idx) => {
    const me = byId.get(p.id)!;
    const gapFill =
      p.placement === 'auto' &&
      sorted.slice(idx + 1).some((q) => {
        const other = byId.get(q.id)!;
        return q.placement === 'auto' && compareExams(other, me) < 0;
      });
    return { id: p.id, start: p.start, end: p.end, placement: p.placement, gapFill };
  });
}

/**
 * Depth-first search over time-ordered sequences. Placing each exam of a sequence at its
 * earliest feasible start is optimal for that sequence (left-shifting never hurts later exams),
 * so exploring sequences is complete. State (remaining set, end of last exam) is memoised.
 */
function exactSearch(
  segments: Interval[],
  fixed: Placed[],
  manual: SchedulerExam[],
  auto: SchedulerExam[],
  brk: number,
): (Placed & { placement: Placement })[] | null {
  const items = [...manual, ...auto];
  const n = items.length;
  const manualIdx = manual.map((_, i) => i); // manual items are the first `manual.length` items
  const failed = new Set<string>();
  let nodes = 0;
  const path: (Placed & { placement: Placement })[] = [];

  const dfs = (mask: number, lastEnd: number): boolean => {
    if (mask === (1 << n) - 1) return true;
    const key = `${mask}:${lastEnd}`;
    if (failed.has(key)) return false;
    if (++nodes > SEARCH_NODE_LIMIT) return false;
    // Next manual item that must come before the following manual ones.
    const nextManual = manualIdx.find((i) => !(mask & (1 << i)));
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      if (i < manual.length && i !== nextManual) continue;
      const e = items[i];
      const s = earliestFit(segments, [...fixed, ...path], e.durationMinutes, brk, lastEnd);
      if (s == null) continue;
      path.push({ id: e.id, start: s, end: s + e.durationMinutes, placement: i < manual.length ? 'manual' : 'auto' });
      if (dfs(mask | (1 << i), s + e.durationMinutes)) return true;
      path.pop();
      if (nodes > SEARCH_NODE_LIMIT) return false;
    }
    failed.add(key);
    return false;
  };

  return dfs(0, 0) ? path.map((p) => ({ ...p })) : null;
}
