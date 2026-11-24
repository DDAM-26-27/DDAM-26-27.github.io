import { describe, expect, it } from 'vitest';
import { submissionDeadline } from '../shared/rules';

describe('submissionDeadline', () => {
  it('leaves two full working days before the exam, skipping weekends', () => {
    expect(submissionDeadline('2026-12-15')).toBe('2026-12-10'); // Tue → Thu (Fri + Mon to grade)
    expect(submissionDeadline('2026-12-18')).toBe('2026-12-15'); // Fri → Tue (Wed + Thu to grade)
    expect(submissionDeadline('2026-12-14')).toBe('2026-12-09'); // Mon → Wed (Thu + Fri to grade)
    expect(submissionDeadline('2027-01-13')).toBe('2027-01-08'); // Wed → Fri (Mon + Tue to grade)
  });
});
