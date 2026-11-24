/**
 * Shared UI in a "University of Pisa meets Windows 98" style: windows with title bars, bevelled
 * buttons, sunken fields and message boxes with big icons. The bevel classes live in index.css.
 */
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'btn98 btn98-primary font-bold',
  secondary: 'btn98',
  danger: 'btn98 btn98-danger font-bold',
  ghost: 'btn98',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap',
        size === 'sm' ? 'min-h-7 px-3 py-0.5 text-sm' : 'min-h-9 px-5 py-1.5 text-sm',
        variants[variant],
        className,
      )}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

/** A Windows-style window. The title bar shows `title`; `actions` go in a toolbar below it. */
export function Card({
  children,
  className,
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={cx('win-raised p-[3px]', className)}>
      {title && (
        <header className="win-titlebar flex items-center gap-2 px-2 py-1">
          <span aria-hidden className="text-xs">
            ▣
          </span>
          <h2 className="text-sm font-bold tracking-wide">{title}</h2>
        </header>
      )}
      {actions && <div className="flex flex-wrap items-center justify-end gap-2 px-1 py-1.5">{actions}</div>}
      <div className={cx('bg-white p-5', title || actions ? 'mt-[3px]' : null, 'win-sunken')}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';
const tones: Record<Tone, string> = {
  neutral: 'bg-win text-black border-slate-500',
  blue: 'bg-blue-700 text-white border-blue-900',
  green: 'bg-[#008000] text-white border-[#004000]',
  amber: 'bg-tooltip text-black border-[#806000]',
  red: 'bg-[#a00000] text-white border-[#400000]',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex items-center border px-1.5 py-px text-xs font-bold uppercase tracking-wide', tones[tone])}>
      {children}
    </span>
  );
}

const alertStyle: Record<Tone, { box: string; icon: string; glyph: string; label: string }> = {
  neutral: { box: 'bg-white', icon: 'bg-slate-500 text-white rounded-full', glyph: 'i', label: 'Note' },
  blue: { box: 'bg-blue-50', icon: 'bg-blue-700 text-white rounded-full', glyph: 'i', label: 'Information' },
  green: { box: 'bg-[#ecf8ec]', icon: 'bg-[#008000] text-white rounded-full', glyph: '✓', label: 'Done' },
  amber: {
    box: 'bg-tooltip',
    icon: 'bg-[#ffd700] text-black [clip-path:polygon(50%_0,100%_100%,0_100%)] pt-2',
    glyph: '!',
    label: 'Warning',
  },
  red: { box: 'bg-[#fff0f0]', icon: 'bg-[#c00000] text-white rounded-full', glyph: '✕', label: 'Error' },
};

/** A message box with a big icon, so the kind of message is obvious at a glance. */
export function Alert({ tone = 'blue', title, children }: { tone?: Tone; title?: ReactNode; children?: ReactNode }) {
  const s = alertStyle[tone];
  return (
    <div role={tone === 'red' ? 'alert' : 'status'} className={cx('flex gap-3 border-2 border-black px-3 py-3 text-sm', s.box)}>
      <span
        aria-hidden
        className={cx('flex h-8 w-8 shrink-0 items-center justify-center font-[Georgia,serif] text-lg leading-none font-bold', s.icon)}
      >
        {s.glyph}
      </span>
      <div className="min-w-0 flex-1 self-center">
        <span className="sr-only">{s.label}: </span>
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span aria-hidden className={cx('inline-block', small ? 'text-sm' : 'text-xl')}>
      ⌛
    </span>
  );
}

export function Loading({ label = 'Loading… please wait' }: { label?: string }) {
  return (
    <div className="flex flex-col items-start gap-2 py-10 text-sm" role="status">
      <span>{label}</span>
      <span className="win-sunken p-[2px]">
        <span className="progress98 block" />
      </span>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-bold text-black">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-600">{hint}</p>}
      {error && (
        <p
          className="mt-1 border border-[#c00000] bg-[#fff0f0] px-2 py-1 text-sm font-bold text-[#a00000]"
          id={htmlFor ? `${htmlFor}-error` : undefined}
        >
          ✕ {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  'win-sunken block w-full bg-white px-2 py-1.5 text-sm text-black placeholder:text-slate-400 focus:outline focus:outline-1 focus:outline-offset-1 focus:outline-black disabled:bg-win disabled:text-slate-500 aria-[invalid=true]:bg-[#fff0f0]';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, props.className)} />;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx('win-raised m-auto w-[calc(100%-2rem)] p-[3px] shadow-xl backdrop:bg-black/40', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="win-titlebar flex items-center justify-between gap-2 py-1 pr-1 pl-2">
            <h2 id={id} className="text-sm font-bold tracking-wide">
              {title}
            </h2>
            <button type="button" onClick={onClose} className="btn98 h-5 w-6 text-xs leading-none font-bold" aria-label="Close">
              ✕
            </button>
          </header>
          <div className="mt-[3px] overflow-y-auto bg-white px-5 py-4 win-sunken">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 px-2 pt-3 pb-2">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="win-raised p-[3px]">
      <div className="win-sunken bg-white px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-600">{label}</p>
        <p className="mt-1 font-mono text-xl font-bold text-blue-700">{value}</p>
        {hint && <p className="text-xs text-slate-600">{hint}</p>}
      </div>
    </div>
  );
}

export function ScheduleStatusBadge({ status }: { status: 'tentative' | 'finalized' }) {
  return status === 'finalized' ? (
    <Badge tone="green">Finalized · times confirmed</Badge>
  ) : (
    <Badge tone="amber">Provisional · times may change</Badge>
  );
}

export function RegistrationBadge({ status }: { status: 'draft' | 'open' | 'closed' }) {
  if (status === 'open') return <Badge tone="blue">Registration open</Badge>;
  if (status === 'closed') return <Badge tone="red">Registration closed</Badge>;
  return <Badge>Draft (hidden)</Badge>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5 border-b-4 border-double border-blue-700 bg-white px-4 py-3">
      <h1 className="text-2xl font-bold text-blue-700">{children}</h1>
      {sub && <div className="mt-1 text-sm text-slate-700">{sub}</div>}
    </div>
  );
}

export { cx };
