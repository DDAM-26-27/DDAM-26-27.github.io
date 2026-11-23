import { describe, expect, it } from 'vitest';
import {
  freeSegments,
  maxBookableGroupSize,
  schedule,
  validateAvailability,
  type SchedulerExam,
  type SchedulerInput,
  type ScheduleResult,
} from '../shared/scheduler';
import { examDuration } from '../shared/rules';
import { DEFAULT_RULES, type BlockedInterval } from '../shared/types';
import { parseTime as t, formatRange } from '../shared/time';

const R = DEFAULT_RULES;
const g = (id: string, size: number, sequence: number, extra: Partial<SchedulerExam> = {}): SchedulerExam => ({
  id,
  sequence,
  durationMinutes: examDuration(R, size),
  ...extra,
});
const lunch: BlockedInterval = { start: t('13:00'), end: t('14:00'), type: 'lunch', label: 'Lunch' };

function day(over: Partial<SchedulerInput> = {}): SchedulerInput {
  return { dayStart: t('09:00'), dayEnd: t('18:00'), windows: [], blocks: [], breakMinutes: 10, exams: [], ...over };
}
const at = (r: ScheduleResult, id: string) => {
  const s = r.scheduled.find((x) => x.id === id);
  return s ? formatRange(s.start, s.end) : null;
};

/** Invariants every schedule must satisfy. */
function assertInvariants(input: SchedulerInput, r: ScheduleResult) {
  const free = freeSegments(input);
  const sorted = [...r.scheduled].sort((a, b) => a.start - b.start);
  const durations = new Map(input.exams.map((e) => [e.id, e.durationMinutes]));
  for (const s of sorted) {
    expect(s.end - s.start).toBe(durations.get(s.id));
    // Fully within one free segment: never split, never in a blocked interval or outside windows.
    expect(free.some((f) => f.start <= s.start && s.end <= f.end)).toBe(true);
    for (const b of input.blocks) expect(s.start < b.end && b.start < s.end).toBe(false);
  }
  for (let k = 1; k < sorted.length; k++) {
    expect(sorted[k].start - sorted[k - 1].end).toBeGreaterThanOrEqual(input.breakMinutes); // no overlap + break
  }
  // Every exam is either scheduled or reported unscheduled, exactly once.
  const ids = [...r.scheduled.map((s) => s.id), ...r.unscheduled.map((u) => u.id)].sort();
  expect(ids).toEqual(input.exams.map((e) => e.id).sort());
  // Timeline covers the session without gaps or overlaps.
  let cursor = input.dayStart;
  for (const item of r.timeline) {
    expect(item.start).toBe(cursor);
    expect(item.end).toBeGreaterThan(item.start);
    cursor = item.end;
  }
  expect(cursor).toBe(input.dayEnd);
}

describe('duration rules', () => {
  it('computes 20 + 10 × size', () => {
    expect([1, 2, 3, 4, 5].map((n) => examDuration(R, n))).toEqual([30, 40, 50, 60, 70]);
  });
});

describe('scheduling engine', () => {
  it('1. schedules a single group at the start of the day', () => {
    const input = day({ exams: [g('A', 4, 1)] });
    const r = schedule(input);
    expect(at(r, 'A')).toBe('09:00–10:00');
    expect(r.feasible).toBe(true);
    assertInvariants(input, r);
  });

  it('2+3. schedules groups of different sizes with explicit recovery breaks', () => {
    const input = day({ exams: [g('A', 4, 1), g('B', 3, 2), g('C', 4, 3)] });
    const r = schedule(input);
    expect(at(r, 'A')).toBe('09:00–10:00');
    expect(at(r, 'B')).toBe('10:10–11:00');
    expect(at(r, 'C')).toBe('11:10–12:10');
    const breaks = r.timeline.filter((i) => i.kind === 'break').map((b) => formatRange(b.start, b.end));
    expect(breaks).toEqual(['10:00–10:10', '11:00–11:10']);
    assertInvariants(input, r);
  });

  it('4. adds no break after the last examination', () => {
    const input = day({ exams: [g('A', 2, 1), g('B', 2, 2)] });
    const r = schedule(input);
    const after = r.timeline.find((i) => i.start === r.scheduled[1].end);
    expect(after?.kind).toBe('available');
    expect(r.stats.breakMinutes).toBe(10);
  });

  it('5. respects lunch and does not add a redundant break after it', () => {
    const input = day({ blocks: [lunch], exams: [g('A', 4, 1), g('B', 4, 2), g('C', 4, 3), g('D', 4, 4)] });
    const r = schedule(input);
    expect(at(r, 'C')).toBe('11:20–12:20');
    // D (60 min) cannot fit 12:30–13:00, so it starts right after lunch with no extra break.
    expect(at(r, 'D')).toBe('14:00–15:00');
    expect(r.timeline.some((i) => i.kind === 'break' && i.start >= t('13:00') && i.start < t('14:10'))).toBe(false);
    assertInvariants(input, r);
  });

  it('5b. an exam ending exactly at lunch is followed directly by an exam at 14:00', () => {
    const input = day({ dayStart: t('12:00'), blocks: [lunch], exams: [g('A', 4, 1), g('B', 1, 2)] });
    const r = schedule(input);
    expect(at(r, 'A')).toBe('12:00–13:00');
    expect(at(r, 'B')).toBe('14:00–14:30');
    expect(r.stats.breakMinutes).toBe(0);
  });

  it('5c. a blocked interval shorter than the break does not satisfy it', () => {
    const short: BlockedInterval = { start: t('10:00'), end: t('10:05'), type: 'other' };
    const input = day({ blocks: [short], exams: [g('A', 4, 1), g('B', 1, 2)] });
    const r = schedule(input);
    expect(at(r, 'B')).toBe('10:10–10:40');
    assertInvariants(input, r);
  });

  it('6. never schedules during lecture intervals', () => {
    const lecture: BlockedInterval = { start: t('10:00'), end: t('12:30'), type: 'lecture' };
    const input = day({ blocks: [lecture], exams: [g('A', 5, 1), g('B', 1, 2)] });
    const r = schedule(input);
    expect(at(r, 'A')).toBe('12:30–13:40');
    expect(at(r, 'B')).toBe('09:00–09:30');
    assertInvariants(input, r);
  });

  it('7. supports multiple availability windows', () => {
    const input = day({
      windows: [
        { start: t('09:00'), end: t('11:00') },
        { start: t('15:00'), end: t('17:00') },
      ],
      exams: [g('A', 4, 1), g('B', 4, 2), g('C', 3, 3), g('D', 3, 4)],
    });
    const r = schedule(input);
    expect(at(r, 'A')).toBe('09:00–10:00');
    expect(at(r, 'B')).toBe('15:00–16:00'); // 10:10–11:10 would exceed the window
    expect(at(r, 'C')).toBe('10:10–11:00'); // fills the end of the morning window
    expect(at(r, 'D')).toBe('16:10–17:00');
    expect(r.timeline.some((i) => i.kind === 'unavailable' && i.start === t('11:00') && i.end === t('15:00'))).toBe(true);
    assertInvariants(input, r);
  });

  it('8. a group too large for the remaining interval is not split across a blocked interval', () => {
    const input = day({ dayStart: t('12:30'), blocks: [lunch], exams: [g('A', 4, 1)] });
    const r = schedule(input);
    expect(at(r, 'A')).toBe('14:00–15:00'); // cannot start at 12:30
    assertInvariants(input, r);
  });

  it('9. spec example: 50 minutes before lunch, a 70-minute group waits and a 40-minute later group fills the gap', () => {
    const input = day({
      dayStart: t('09:00'),
      dayEnd: t('16:00'),
      windows: [
        { start: t('09:00'), end: t('13:00') },
        { start: t('14:00'), end: t('16:00') },
      ],
      // A: 09:00–10:00, B: 10:10–11:10, C: 11:20–12:00 (size 1 → 30 min? no, size 2 = 40) → 12:10 onwards = 50 min left.
      exams: [g('A', 4, 1), g('B', 4, 2), g('C', 2, 3), g('Big', 5, 4), g('Small', 2, 5)],
    });
    const r = schedule(input);
    expect(at(r, 'C')).toBe('11:20–12:00');
    expect(at(r, 'Big')).toBe('14:00–15:10'); // does not fit in 12:10–13:00 (50 min)
    expect(at(r, 'Small')).toBe('12:10–12:50'); // later, smaller group fills the gap
    expect(r.scheduled.find((s) => s.id === 'Small')?.gapFill).toBe(true);
    expect(r.feasible).toBe(true);
    assertInvariants(input, r);
  });

  it('10. keeps FIFO order when everything fits', () => {
    const exams = [g('A', 3, 1), g('B', 5, 2), g('C', 1, 3), g('D', 4, 4), g('E', 2, 5)];
    const r = schedule(day({ exams }));
    expect(r.scheduled.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(r.scheduled.every((s) => !s.gapFill)).toBe(true);
  });

  it('10b. earlier bookings are never delayed by later bookings (prefix stability)', () => {
    const exams = [g('A', 5, 1), g('B', 3, 2), g('C', 5, 3), g('D', 1, 4), g('E', 4, 5), g('F', 2, 6)];
    const input = day({ blocks: [lunch], dayEnd: t('17:00') });
    for (let k = 1; k <= exams.length; k++) {
      const prefix = schedule({ ...input, exams: exams.slice(0, k - 1) });
      const full = schedule({ ...input, exams: exams.slice(0, k) });
      for (const s of prefix.scheduled) expect(at(full, s.id)).toBe(at(prefix, s.id));
    }
  });

  it('11. recalculates after a cancellation', () => {
    const exams = [g('A', 4, 1), g('B', 4, 2), g('C', 4, 3)];
    const before = schedule(day({ exams }));
    expect(at(before, 'C')).toBe('11:20–12:20');
    const after = schedule(day({ exams: exams.filter((e) => e.id !== 'B') }));
    expect(at(after, 'C')).toBe('10:10–11:10');
  });

  it('12. recalculates after a group-size change', () => {
    const r1 = schedule(day({ exams: [g('A', 2, 1), g('B', 3, 2)] }));
    expect(at(r1, 'B')).toBe('09:50–10:40');
    const r2 = schedule(day({ exams: [g('A', 5, 1), g('B', 3, 2)] }));
    expect(at(r2, 'B')).toBe('10:20–11:10');
  });

  it('13+14. random schedules never overlap and never touch blocked intervals (property test)', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let iter = 0; iter < 300; iter++) {
      const blocks: BlockedInterval[] = [];
      let cursor = t('09:30');
      const nBlocks = Math.floor(rand() * 4);
      for (let b = 0; b < nBlocks; b++) {
        const start = cursor + Math.floor(rand() * 12) * 15;
        const end = start + 15 + Math.floor(rand() * 6) * 15;
        if (end >= t('18:00')) break;
        blocks.push({ start, end, type: 'other' });
        cursor = end + 15;
      }
      const exams = Array.from({ length: 1 + Math.floor(rand() * 12) }, (_, i) => g(`G${i}`, 1 + Math.floor(rand() * 5), i + 1));
      const input = day({ blocks, exams, breakMinutes: [0, 5, 10, 15][Math.floor(rand() * 4)] });
      expect(validateAvailability(input)).toEqual([]);
      const r = schedule(input);
      assertInvariants(input, r);
      // Determinism: same input → same output, independent of input order.
      const shuffled = { ...input, exams: [...exams].reverse() };
      expect(schedule(shuffled).scheduled).toEqual(r.scheduled);
    }
  });

  it('15. reports capacity exhaustion and the largest bookable group', () => {
    const input = day({ dayStart: t('09:00'), dayEnd: t('11:00'), exams: [g('A', 4, 1)] });
    // 09:00–10:00 used, break until 10:10, 50 minutes left → up to 3 students.
    expect(maxBookableGroupSize(input, R)).toBe(3);
    const full = { ...input, exams: [g('A', 4, 1), g('B', 3, 2)] };
    expect(maxBookableGroupSize(full, R)).toBe(0);
    const over = schedule({ ...input, exams: [g('A', 4, 1), g('B', 4, 2)] });
    expect(over.feasible).toBe(false);
    expect(over.unscheduled.map((u) => u.id)).toEqual(['B']);
  });

  it('16. pinned (finalized) times never change, new groups go around them', () => {
    const pinned = [g('A', 4, 1, { pinnedStart: t('09:00') }), g('B', 3, 2, { pinnedStart: t('10:10') })];
    const r1 = schedule(day({ exams: pinned }));
    // Even if A is cancelled, B stays at its confirmed time.
    const r2 = schedule(day({ exams: [pinned[1], g('C', 4, 3)] }));
    expect(at(r1, 'B')).toBe('10:10–11:00');
    expect(at(r2, 'B')).toBe('10:10–11:00');
    expect(at(r2, 'C')).toBe('09:00–10:00'); // fits before B with exactly the required break
    // A short group can use the freed morning slot before B, respecting the break.
    const r3 = schedule(day({ exams: [pinned[1], g('D', 5, 4)] }));
    expect(at(r3, 'D')).toBe('11:10–12:20'); // 70 min does not fit before 10:00
    expect(at(r3, 'B')).toBe('10:10–11:00');
    assertInvariants(day({ exams: [pinned[1], g('D', 5, 4)] }), r3);
  });

  it('16b. a pinned exam that now conflicts with a new block is reported, not moved', () => {
    const input = day({ blocks: [lunch], exams: [g('A', 4, 1, { pinnedStart: t('12:30') })] });
    const r = schedule(input);
    expect(r.scheduled).toEqual([]);
    expect(r.unscheduled[0].id).toBe('A');
    expect(r.feasible).toBe(false);
  });

  it('17. administrator-defined manual order is respected', () => {
    const exams = [g('A', 3, 1, { manualPosition: 3 }), g('B', 3, 2, { manualPosition: 1 }), g('C', 3, 3, { manualPosition: 2 })];
    const r = schedule(day({ exams }));
    expect(r.scheduled.map((s) => s.id)).toEqual(['B', 'C', 'A']);
    expect(r.scheduled.every((s) => s.placement === 'manual')).toBe(true);
  });

  it('17b. manual order is kept even when it leaves a gap; new auto bookings may fill gaps', () => {
    const exams = [g('A', 5, 1, { manualPosition: 1 }), g('B', 5, 2, { manualPosition: 2 }), g('N', 1, 9)];
    const input = day({ dayStart: t('11:00'), blocks: [lunch], exams });
    const r = schedule(input);
    expect(at(r, 'A')).toBe('11:00–12:10');
    expect(at(r, 'B')).toBe('14:00–15:10');
    expect(at(r, 'N')).toBe('12:20–12:50');
    assertInvariants(input, r);
  });

  it('18. output is deterministic', () => {
    const input = day({ blocks: [lunch], exams: [g('A', 5, 1), g('B', 2, 2), g('C', 4, 3), g('D', 1, 4)] });
    expect(schedule(input)).toEqual(schedule(structuredClone(input)));
  });

  it('19. rejects overlapping or invalid availability intervals', () => {
    const errs = validateAvailability(
      day({
        blocks: [
          { start: t('12:00'), end: t('13:30'), type: 'meeting' },
          { start: t('13:00'), end: t('14:00'), type: 'lunch' },
          { start: t('15:00'), end: t('14:30'), type: 'other' },
          { start: t('17:00'), end: t('19:00'), type: 'lecture' },
        ],
      }),
    );
    expect(errs.some((e) => e.includes('overlap'))).toBe(true);
    expect(errs.some((e) => e.includes('end must be after start'))).toBe(true);
    expect(errs.some((e) => e.includes('outside the session hours'))).toBe(true);
    expect(validateAvailability(day({ dayStart: t('12:00'), dayEnd: t('11:00') })).length).toBe(1);
  });

  it('uses the exact search fallback when the greedy order would waste capacity', () => {
    // Window 09:00–10:20 (80 min) and 10:30–11:20 (50 min) separated by a 10-min block.
    // Priority: A=30, B=70. Greedy: A 09:00–09:30, then B (70) fits nowhere → search puts B first.
    const input = day({
      dayStart: t('09:00'),
      dayEnd: t('11:20'),
      blocks: [{ start: t('10:20'), end: t('10:30'), type: 'other' }],
      exams: [g('A', 1, 1), g('B', 5, 2)],
    });
    const r = schedule(input);
    expect(r.feasible).toBe(true);
    expect(r.strategy).toBe('search');
    expect(at(r, 'B')).toBe('09:00–10:10');
    expect(at(r, 'A')).toBe('10:30–11:00');
    assertInvariants(input, r);
  });

  it('timeline marks blocks, breaks, available time and non-window time', () => {
    const input = day({
      dayEnd: t('18:00'),
      windows: [
        { start: t('09:00'), end: t('16:00') },
        { start: t('17:00'), end: t('18:00') },
      ],
      blocks: [lunch],
      exams: [g('A', 4, 1), g('B', 3, 2)],
    });
    const r = schedule(input);
    const kinds = r.timeline.map((i) => `${i.kind}@${formatRange(i.start, i.end)}`);
    expect(kinds).toEqual([
      'exam@09:00–10:00',
      'break@10:00–10:10',
      'exam@10:10–11:00',
      'available@11:00–13:00',
      'blocked@13:00–14:00',
      'available@14:00–16:00',
      'unavailable@16:00–17:00',
      'available@17:00–18:00',
    ]);
    expect(r.stats).toMatchObject({ examMinutes: 110, breakMinutes: 10, blockedMinutes: 60, estimatedEnd: t('11:00') });
  });
});
