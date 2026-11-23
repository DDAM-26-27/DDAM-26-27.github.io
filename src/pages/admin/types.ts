import type {
  DurationRules,
  PublicScheduleMode,
  RegistrationStatus,
  ScheduleStatus,
  SessionAvailability,
  TimelineItem,
} from '../../../shared/types';
import type { ScheduleStats } from '../../../shared/scheduler';

export interface AdminCourse {
  id: string;
  slug: string;
  name: string;
  academicYear: string;
  description: string;
  institution: string;
  timezone: string;
  contactEmail: string | null;
  publicScheduleMode: PublicScheduleMode;
  privacyText: string;
  notifyThresholdMinutes: number;
  rules: DurationRules;
}

export interface AdminSession {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  timezone: string;
  title: string | null;
  location: string | null;
  registrationStatus: RegistrationStatus;
  scheduleStatus: ScheduleStatus;
  scheduleVersion: number;
  scheduleUpdatedAt: string | null;
  finalizedAt: string | null;
}

export interface AdminBooking {
  id: string;
  sessionId: string;
  date: string | null;
  sequence: number;
  priority: number;
  groupName: string;
  groupSize: number;
  members: string[];
  representativeEmail: string;
  notes: string;
  status: 'active' | 'cancelled';
  durationMinutes: number;
  start: number | null;
  end: number | null;
  confirmedStart: number | null;
  confirmedEnd: number | null;
  revised: boolean;
  manualPosition: number | null;
  capacityOverride: boolean;
  createdBy: 'student' | 'admin';
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  placement: 'pinned' | 'manual' | 'auto' | null;
  gapFill: boolean;
  unscheduledReason: string | null;
}

export interface IntervalDTO {
  id?: string;
  kind: 'window' | 'blocked';
  blockType: 'lunch' | 'lecture' | 'meeting' | 'personal' | 'other' | null;
  start: string;
  end: string;
  label: string | null;
  description: string | null;
}

export interface SessionDetail {
  session: AdminSession;
  intervals: IntervalDTO[];
  bookings: AdminBooking[];
  cancelled: AdminBooking[];
  timeline: TimelineItem[];
  stats: ScheduleStats;
  availability: SessionAvailability;
  manualOrder: boolean;
  attention: number;
  course: AdminCourse;
  revisions: { version: number; actor: string; reason: string; schedule_status: string; createdAt: string }[];
  allSessions: AdminSession[];
}

export interface Overview {
  course: AdminCourse;
  sessions: (AdminSession & { stats: ScheduleStats; availability: SessionAvailability; attention: number; groupCount: number })[];
  totals: {
    sessions: number;
    groups: number;
    students: number;
    examMinutes: number;
    breakMinutes: number;
    blockedMinutes: number;
    availableMinutes: number;
    attention: number;
  };
  attention: { bookingId: string; sessionId: string; date: string; groupName: string; issue: string }[];
}

export interface BookingState {
  sessionId: string;
  date: string;
  start: number | null;
  end: number | null;
  status: 'active' | 'cancelled';
}

export interface ChangeSummary {
  changes: { bookingId: string; groupName: string; before: BookingState | null; after: BookingState | null }[];
  unscheduled: { bookingId: string; groupName: string; sessionId: string; date: string; reason: string }[];
  newlyUnscheduled: { bookingId: string; groupName: string; sessionId: string; date: string; reason: string }[];
  sessions: { id: string; date: string; version: number; feasible: boolean }[];
}
