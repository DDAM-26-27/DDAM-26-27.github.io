/** Domain types shared by the client, the server and the scheduling engine. */

export type RegistrationStatus = 'draft' | 'open' | 'closed';
export type ScheduleStatus = 'tentative' | 'finalized';
export type BookingStatus = 'active' | 'cancelled';
export type IntervalKind = 'window' | 'blocked';
export type BlockType = 'lunch' | 'lecture' | 'meeting' | 'personal' | 'other';
export type PublicScheduleMode = 'names' | 'anonymous' | 'hidden';

export const BLOCK_TYPES: BlockType[] = ['lunch', 'lecture', 'meeting', 'personal', 'other'];

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  lunch: 'Lunch break',
  lecture: 'Lecture',
  meeting: 'Meeting',
  personal: 'Personal commitment',
  other: 'Unavailable',
};

export interface DurationRules {
  presentationMinutes: number;
  questionsPerStudentMinutes: number;
  breakMinutes: number;
  minGroupSize: number;
  maxGroupSize: number;
}

export const DEFAULT_RULES: DurationRules = {
  presentationMinutes: 20,
  questionsPerStudentMinutes: 10,
  breakMinutes: 10,
  minGroupSize: 1,
  maxGroupSize: 5,
};

/** Half-open interval [start, end) in minutes since local midnight. */
export interface Interval {
  start: number;
  end: number;
}

export interface BlockedInterval extends Interval {
  id?: string;
  type: BlockType;
  label?: string | null;
}

export type TimelineKind = 'exam' | 'break' | 'blocked' | 'available' | 'unavailable';

export interface TimelineItem extends Interval {
  kind: TimelineKind;
  bookingId?: string;
  blockType?: BlockType;
  label?: string | null;
}

/** Course as exposed publicly. */
export interface PublicCourse {
  id: string;
  name: string;
  academicYear: string;
  description: string;
  institution: string;
  timezone: string;
  contactEmail: string | null;
  privacyText: string;
  publicScheduleMode: PublicScheduleMode;
  rules: DurationRules;
}

export interface SessionAvailability {
  /** Number of active groups. */
  groupCount: number;
  studentCount: number;
  /** Free minutes not used by examinations or breaks. */
  availableMinutes: number;
  /** Local minutes of the end of the last examination, or null. */
  estimatedEndMinutes: number | null;
  /** Largest group size that can still be accommodated (0 if none). */
  maxBookableGroupSize: number;
  canBook: boolean;
  reason: string | null;
}

export interface PublicSession {
  id: string;
  date: string;
  title: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  registrationStatus: RegistrationStatus;
  scheduleStatus: ScheduleStatus;
  scheduleVersion: number;
  scheduleUpdatedAt: string | null;
  availability: SessionAvailability;
}

export interface PublicScheduleEntry extends Interval {
  kind: TimelineKind;
  label: string;
  blockType?: BlockType;
  revised?: boolean;
}

export interface PublicSchedule {
  session: PublicSession;
  mode: PublicScheduleMode;
  entries: PublicScheduleEntry[];
}

export interface BookingPreview {
  sessionId: string;
  date: string;
  durationMinutes: number;
  start: number;
  end: number;
  scheduleVersion: number;
  scheduleStatus: ScheduleStatus;
}

export interface ManagedBooking {
  id: string;
  sequence: number;
  sessionId: string;
  date: string;
  timezone: string;
  groupName: string;
  groupSize: number;
  members: string[];
  representativeEmail: string;
  notes: string;
  status: BookingStatus;
  durationMinutes: number;
  start: number | null;
  end: number | null;
  scheduleStatus: ScheduleStatus;
  /** True when the current time differs from a previously confirmed (finalized) time. */
  revised: boolean;
  /** ISO instant after which the booking can no longer be cancelled online. */
  cancelDeadline: string;
  /** Whether the student can still cancel (or move to another date) online. */
  canCancel: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EmailStatus = 'sent' | 'not_configured' | 'failed' | 'skipped';
