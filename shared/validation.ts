import type { DurationRules } from './types';

export interface GroupInput {
  groupName: string;
  groupSize: number;
  members: string[];
  representativeEmail: string;
  notes?: string;
}

export type FieldErrors = Partial<Record<'groupName' | 'groupSize' | 'members' | 'representativeEmail' | 'notes', string>>;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function normalizeText(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Normalises and validates group information. Shared by the form and the server. */
export function validateGroup(raw: Partial<GroupInput>, rules: DurationRules): { value: GroupInput; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const groupName = normalizeText(raw.groupName);
  const groupSize = Number(raw.groupSize);
  const members = Array.isArray(raw.members) ? raw.members.map(normalizeText) : [];
  const representativeEmail = normalizeText(raw.representativeEmail).toLowerCase();
  const notes = typeof raw.notes === 'string' ? raw.notes.trim() : '';

  if (groupName.length < 2) errors.groupName = 'Please enter a group or project name (at least 2 characters).';
  else if (groupName.length > 100) errors.groupName = 'The group name must be at most 100 characters.';

  if (!Number.isInteger(groupSize) || groupSize < rules.minGroupSize || groupSize > rules.maxGroupSize)
    errors.groupSize = `Groups must have between ${rules.minGroupSize} and ${rules.maxGroupSize} students.`;

  if (!errors.groupSize) {
    if (members.length !== groupSize) errors.members = `Please provide exactly ${groupSize} student name(s).`;
    else if (members.some((m) => m.length < 2)) errors.members = 'Every student name must have at least 2 characters.';
    else if (members.some((m) => m.length > 120)) errors.members = 'Student names must be at most 120 characters.';
    else if (new Set(members.map((m) => m.toLowerCase())).size !== members.length)
      errors.members = 'Each student must be listed only once.';
  }

  if (!isValidEmail(representativeEmail)) errors.representativeEmail = 'Please enter a valid email address.';
  if (notes.length > 1000) errors.notes = 'Notes must be at most 1000 characters.';

  return { value: { groupName, groupSize, members, representativeEmail, notes }, errors };
}
