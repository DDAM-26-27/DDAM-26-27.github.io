import { formatTime, localToUtc, toIcsUtc } from './time';

export function csvEscape(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

/** ISO 8601 with the correct UTC offset for the session's time zone, e.g. 2026-12-15T09:00:00+01:00 */
export function isoWithOffset(date: string, minutes: number, timeZone: string): string {
  const utc = localToUtc(date, minutes, timeZone);
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const offset = Math.round((naive - utc.getTime()) / 60000);
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date}T${formatTime(minutes)}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export interface IcsEvent {
  uid: string;
  date: string;
  start: number;
  end: number;
  timeZone: string;
  summary: string;
  description?: string;
  location?: string | null;
}

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Line folding at 75 octets as required by RFC 5545 (approximated by characters). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

/** Builds an iCalendar file. Times are emitted in UTC so every client shows the right local time. */
export function toIcs(events: IcsEvent[], calendarName = 'Exam schedule'): string {
  const stamp = toIcsUtc(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DDAM Exam Booking//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(calendarName)}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsUtc(localToUtc(e.date, e.start, e.timeZone))}`,
      `DTEND:${toIcsUtc(localToUtc(e.date, e.end, e.timeZone))}`,
      `SUMMARY:${icsText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
