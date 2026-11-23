/** Time helpers. All scheduling happens in minutes since local midnight of the session date. */

export function parseTime(value: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid time "${value}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`Invalid time "${value}"`);
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatRange(start: number, end: number): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** e.g. "Tuesday, 15 December 2026". `date` is an ISO date string (YYYY-MM-DD). */
export function formatDateLong(date: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

function tzOffsetMinutes(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - utcMillis) / 60000);
}

/** Converts a local wall-clock time on `date` in `timeZone` into a UTC Date. */
export function localToUtc(date: string, minutes: number, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, mo - 1, d, 0, minutes);
  let offset = tzOffsetMinutes(naive, timeZone);
  let utc = naive - offset * 60000;
  // Second pass handles DST transitions.
  const offset2 = tzOffsetMinutes(utc, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    utc = naive - offset * 60000;
  }
  return new Date(utc);
}

/** Converts a UTC instant into local minutes since midnight of `date` in `timeZone`. */
export function utcToLocalMinutes(instant: Date, date: string, timeZone: string): number {
  const midnight = localToUtc(date, 0, timeZone).getTime();
  return Math.round((instant.getTime() - midnight) / 60000);
}

/** Formats a UTC instant as an ICS UTC timestamp: 20261215T080000Z */
export function toIcsUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}
