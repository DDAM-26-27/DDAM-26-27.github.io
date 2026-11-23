import type { TimelineKind } from '../../shared/types';
import { formatDuration, formatRange, formatTime } from '../../shared/time';
import { cx } from './ui';

export interface TimelineEntry {
  start: number;
  end: number;
  kind: TimelineKind;
  label: string;
  sublabel?: string;
  revised?: boolean;
  highlight?: boolean;
}

/** Accessible colors + patterns + text labels: meaning never relies on color alone. */
export const KIND_STYLE: Record<TimelineKind, { bar: string; row: string; name: string; icon: string }> = {
  exam: { bar: 'bg-blue-600 text-white', row: 'border-l-blue-600 bg-blue-50/60', name: 'Examination', icon: '●' },
  break: { bar: 'bg-teal-200 text-teal-950', row: 'border-l-teal-400 bg-teal-50/60', name: 'Recovery break', icon: '◌' },
  blocked: {
    bar: 'bg-slate-400 text-white bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.25)_4px,rgba(255,255,255,.25)_8px)]',
    row: 'border-l-slate-500 bg-slate-100',
    name: 'Unavailable',
    icon: '▨',
  },
  available: {
    bar: 'bg-white text-slate-500 border border-dashed border-slate-300',
    row: 'border-l-slate-200 bg-white',
    name: 'Available',
    icon: '○',
  },
  unavailable: { bar: 'bg-slate-200 text-slate-500', row: 'border-l-slate-300 bg-slate-50', name: 'Not available', icon: '—' },
};

/** Horizontal day bar (desktop overview). */
export function TimelineBar({ entries, dayStart, dayEnd }: { entries: TimelineEntry[]; dayStart: number; dayEnd: number }) {
  const span = Math.max(1, dayEnd - dayStart);
  const hours: number[] = [];
  for (let h = Math.ceil(dayStart / 60) * 60; h <= dayEnd; h += 60) hours.push(h);
  return (
    <div aria-hidden className="hidden sm:block">
      <div className="relative h-12 overflow-hidden rounded-md bg-slate-100">
        {entries.map((e, i) => (
          <div
            key={i}
            title={`${formatRange(e.start, e.end)} ${e.label}`}
            className={cx(
              'absolute top-0 flex h-full items-center overflow-hidden px-1 text-[11px] font-medium leading-tight',
              KIND_STYLE[e.kind].bar,
              e.highlight && 'ring-2 ring-amber-400 ring-inset',
            )}
            style={{ left: `${((e.start - dayStart) / span) * 100}%`, width: `${((e.end - e.start) / span) * 100}%` }}
          >
            {e.kind === 'exam' || e.kind === 'blocked' ? <span className="truncate">{e.label}</span> : null}
          </div>
        ))}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-slate-500">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - dayStart) / span) * 100}%` }}>
            {formatTime(h)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Vertical list (works on all screen sizes and with screen readers). */
export function TimelineList({ entries, compact }: { entries: TimelineEntry[]; compact?: boolean }) {
  return (
    <ol className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200">
      {entries.map((e, i) => (
        <li
          key={i}
          className={cx(
            'flex items-start gap-3 border-l-4 px-3',
            compact ? 'py-1.5' : 'py-2.5',
            KIND_STYLE[e.kind].row,
            e.highlight && 'ring-2 ring-inset ring-amber-400',
          )}
        >
          <span className="w-28 shrink-0 font-mono text-sm tabular-nums text-slate-700">{formatRange(e.start, e.end)}</span>
          <span className="min-w-0 flex-1">
            <span className={cx('text-sm', e.kind === 'exam' ? 'font-semibold text-slate-900' : 'text-slate-700')}>
              <span aria-hidden className="mr-1.5 text-slate-500">
                {KIND_STYLE[e.kind].icon}
              </span>
              {e.label}
            </span>
            {e.revised && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">Revised</span>}
            {e.sublabel && <span className="block text-xs text-slate-500">{e.sublabel}</span>}
          </span>
          <span className="shrink-0 text-xs text-slate-500">
            <span className="sr-only">{KIND_STYLE[e.kind].name}, </span>
            {formatDuration(e.end - e.start)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function TimelineLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Legend">
      {(Object.keys(KIND_STYLE) as TimelineKind[]).map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span className={cx('inline-block h-3 w-5 rounded-sm', KIND_STYLE[k].bar)} />
          {KIND_STYLE[k].name}
        </li>
      ))}
    </ul>
  );
}
