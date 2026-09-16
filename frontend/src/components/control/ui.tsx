import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Severity } from '../../lib/control';
import {
  CollapsibleBody,
  Chevron,
  useSectionState,
} from '../collapsible/CollapsibleSection';
import type { SectionKey } from '../collapsible';

export const SEVERITY_STYLES: Record<
  Severity,
  { chip: string; dot: string; text: string; bar: string; soft: string }
> = {
  ok: {
    chip: 'bg-green-50 text-green-700 ring-1 ring-green-200',
    dot: 'bg-green-500',
    text: 'text-green-700',
    bar: 'bg-green-500',
    soft: 'bg-green-50',
  },
  info: {
    chip: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    dot: 'bg-sky-500',
    text: 'text-sky-700',
    bar: 'bg-sky-500',
    soft: 'bg-sky-50',
  },
  warning: {
    chip: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    dot: 'bg-amber-500',
    text: 'text-amber-700',
    bar: 'bg-amber-500',
    soft: 'bg-amber-50',
  },
  critical: {
    chip: 'bg-red-50 text-red-700 ring-1 ring-red-200',
    dot: 'bg-red-500',
    text: 'text-red-700',
    bar: 'bg-red-500',
    soft: 'bg-red-50',
  },
};

export const SYSTEM_STATUS_STYLES: Record<string, string> = {
  ok: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  critical: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  unknown: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
  stopped: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  offline: 'bg-gray-100 text-gray-600 ring-1 ring-gray-200',
};

export function StatusPill({
  label,
  severity = 'info',
  dot = true,
  pulse = false,
}: {
  label: string;
  severity?: Severity;
  dot?: boolean;
  pulse?: boolean;
}) {
  const styles = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${styles.chip}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${styles.dot} ${pulse ? 'animate-pulse' : ''}`} />}
      {label}
    </span>
  );
}

export function ControlCard({
  title,
  icon,
  subtitle,
  badge,
  children,
  className = '',
  tone = '',
  section,
  collapsible: collapsibleProp,
}: {
  title?: string;
  icon?: ReactNode;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: string;
  /** Key of the collapsible dashboard section this card represents. */
  section?: SectionKey;
  /**
   * Explicit opt-out. Pass `false` to make a card permanently visible: it then
   * renders a plain header (no collapse button, no arrow), is never hidden, and
   * is not part of the expand/collapse state — so neither an individual toggle
   * nor the global "توسيع الكل" / "طي الكل" controls can affect it. A card with
   * no `section` is already non-collapsible; this makes that intent explicit
   * and keeps it true even if a `section` key is ever supplied by mistake.
   */
  collapsible?: boolean;
}) {
  // Hooks must run unconditionally, so the state is always resolved and only
  // *used* when the card is registered as a collapsible section.
  const sectionState = useSectionState(section ?? 'controlCenter');
  const collapsible = collapsibleProp ?? !!section;
  const expanded = collapsible ? sectionState.expanded : true;
  const bodyId = section ? `section-body-${section}` : undefined;
  const headerId = section ? `section-header-${section}` : undefined;
  return (
    <section
      data-section={section}
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${tone} ${className}`}
    >
      {collapsible ? (
        <button
          type="button"
          id={headerId}
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => sectionState.toggle()}
          title={expanded ? `طي ${title}` : `توسيع ${title}`}
          className={`w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-right cursor-pointer select-none transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500 focus-visible:ring-inset ${
            expanded ? 'border-b border-gray-50' : ''
          }`}
        >
          <div className="flex items-center gap-2.5 text-right min-w-0">
            {icon && <span className="text-xl leading-none">{icon}</span>}
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-800">{title}</h3>
              {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {/* Badges and the arrow are anchored together at the far end of the
              header (the LEFT edge in this RTL dashboard), so the arrow sits in
              the same place in every section. */}
          <div className="flex items-center gap-3 shrink-0">
            {badge}
            <span
              data-state={expanded ? 'expanded' : 'collapsed'}
              className={`w-7 h-7 rounded-full flex items-center justify-center border transition-colors ${
                expanded
                  ? 'bg-leaf-50 border-leaf-100 text-leaf-700'
                  : 'bg-gray-50 border-gray-100 text-gray-400'
              }`}
            >
              <Chevron expanded={expanded} />
            </span>
          </div>
        </button>
      ) : (title || subtitle || icon || badge) ? (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-50">
          <div className="flex items-center gap-2.5 text-right min-w-0">
            {icon && <span className="text-xl leading-none">{icon}</span>}
            <div className="min-w-0">
              {title && <h3 className="text-sm font-bold text-gray-800">{title}</h3>}
              {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">{badge}</div>
        </header>
      ) : null}
      {collapsible ? (
        <CollapsibleBody id={bodyId as string} expanded={expanded}>
          <div className="p-5">{children}</div>
        </CollapsibleBody>
      ) : (
        <div className="p-5">{children}</div>
      )}
    </section>
  );
}

export function Notice({
  tone = 'info',
  icon,
  children,
}: {
  tone?: 'info' | 'warning' | 'critical' | 'ok';
  icon?: string;
  children: ReactNode;
}) {
  const styles = SEVERITY_STYLES[tone] ?? SEVERITY_STYLES.info;
  const defaultIcon = tone === 'critical' ? '⛔' : tone === 'warning' ? '⚠️' : tone === 'ok' ? '✓' : 'ℹ️';
  return (
    <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs ${styles.soft}`}>
      <span className="text-sm leading-5 shrink-0">{icon ?? defaultIcon}</span>
      <p className={`leading-5 ${styles.text}`}>{children}</p>
    </div>
  );
}

export function ProgressBar({
  value,
  min = 0,
  max = 100,
  severity = 'info',
  height = 'h-2',
}: {
  value: number | null;
  min?: number;
  max?: number;
  severity?: Severity;
  height?: string;
}) {
  const span = Math.max(1, max - min);
  const pct = value === null ? 0 : Math.min(100, Math.max(0, ((value - min) / span) * 100));
  return (
    <div className={`${height} w-full bg-gray-100 rounded-full overflow-hidden`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${SEVERITY_STYLES[severity].bar}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  disabled = false,
  hint,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600 font-medium">{label}</span>
        <span dir="ltr" className="font-bold text-gray-800 tabular-nums">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full h-2 rounded-full appearance-none bg-gray-100 accent-leaf-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={label}
      />
      {hint && <p className="text-[11px] text-gray-400 leading-4">{hint}</p>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="text-gray-600 font-medium block mb-1">{label}</span>
      <span className="relative flex items-center">
        <input
          type="number"
          dir="ltr"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-semibold text-gray-800 text-center shadow-sm focus:outline-none focus:ring-2 focus:ring-leaf-500 focus:border-leaf-500 disabled:bg-gray-50 disabled:text-gray-400"
        />
        {unit && (
          <span className="absolute left-2 text-[11px] text-gray-400 pointer-events-none">{unit}</span>
        )}
      </span>
    </label>
  );
}

type ButtonVariant = 'primary' | 'danger' | 'ghost' | 'outline' | 'warning';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-leaf-700 hover:bg-leaf-800 text-white shadow-sm shadow-leaf-700/20 disabled:bg-gray-300 disabled:shadow-none',
  danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-600/20 disabled:bg-gray-300',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm shadow-amber-500/20 disabled:bg-gray-300',
  outline:
    'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:text-gray-400 disabled:hover:bg-white',
  ghost: 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:text-gray-400',
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  busy = false,
  size = 'md',
  type = 'button',
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** True while the command this button sent is still in flight. */
  busy?: boolean;
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const sizing = size === 'sm' ? 'px-3 py-1.5 text-xs rounded-lg' : 'px-4 py-2.5 text-sm rounded-xl';
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      className={`relative inline-flex items-center justify-center gap-1.5 font-semibold transition-all active:scale-[0.97] disabled:cursor-not-allowed ${sizing} ${
        busy ? 'opacity-80 cursor-progress' : ''
      } ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      )}
      {children}
    </button>
  );
}

/**
 * A device control button that shows its OWN state.
 *
 * `active` = this action is the one currently applied (rendered pressed with a
 * ✓ and a filled background), `pending` = the command is in flight (spinner).
 * The visual state is derived from the control snapshot, never invented here, so
 * it can never disagree with the backend.
 */
export function ActionButton({
  label,
  active,
  pending = false,
  disabled = false,
  onClick,
  className = '',
}: {
  label: string;
  active: boolean;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      aria-pressed={active}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-all active:scale-[0.97] disabled:cursor-not-allowed ${
        pending
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : active
            ? 'bg-leaf-700 border-leaf-700 text-white shadow-sm shadow-leaf-700/25'
            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
      } ${className}`}
    >
      {pending ? (
        <span
          aria-hidden="true"
          className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      ) : active ? (
        <span aria-hidden="true">✓</span>
      ) : null}
      {pending ? 'جارٍ التطبيق…' : label}
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  onConfirm,
  onCancel,
  danger = false,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onCancel}
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        dir="rtl"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 p-6 text-right"
      >
        <h3 className="text-base font-bold text-gray-900 mb-2">{title}</h3>
        <div className="text-sm text-gray-600 leading-6 mb-5">{message}</div>
        <div className="flex items-center gap-2 justify-start">
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function KeyValue({
  label,
  value,
  dir,
}: {
  label: string;
  value: ReactNode;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span dir={dir} className="font-semibold text-gray-800 text-left">
        {value}
      </span>
    </div>
  );
}

/** Small label for provenance: "محاكاة" vs a real device. */
export function Chip({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'sim' | 'hardware' | 'muted';
  title?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-gray-100 text-gray-600',
    sim: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
    hardware: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    muted: 'bg-gray-50 text-gray-400 ring-1 ring-gray-100',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A live value with its unit, sized for an operator panel.
 */
export function Reading({
  label,
  value,
  unit,
  tone = 'text-gray-900',
  caption,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  caption?: string;
}) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2.5">
      <p className="text-[11px] text-gray-500 mb-1">{label}</p>
      <p dir="ltr" className={`text-lg font-bold tabular-nums text-right ${tone}`}>
        {value}
        {unit && <span className="text-xs font-medium text-gray-500 mr-1">{unit}</span>}
      </p>
      {caption && <p className="text-[10px] text-gray-400 mt-0.5">{caption}</p>}
    </div>
  );
}

/**
 * ON/OFF control. Renders the real device state, and is disabled with the
 * backend's reason when the hardware for it does not exist.
 */
export function Toggle({
  label,
  on,
  onChange,
  disabled = false,
  busy = false,
  onLabel = 'تشغيل',
  offLabel = 'إيقاف',
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-bold ${on ? 'text-leaf-700' : 'text-gray-400'}`}>
          {on ? onLabel : offLabel}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={disabled || busy}
          onClick={() => onChange(!on)}
          className={`relative w-12 h-6 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            on ? 'bg-leaf-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${
              on ? 'right-0.5' : 'right-6'
            }`}
          />
        </button>
      </div>
    </div>
  );
}

/** Radio-style selector used for وضع التشغيل. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      {label && <p className="text-xs font-bold text-gray-700 mb-2">{label}</p>}
      <div className="inline-flex flex-wrap gap-1.5 bg-gray-50 p-1 rounded-xl">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-all disabled:cursor-not-allowed ${
                active
                  ? 'bg-white text-leaf-800 shadow-sm ring-1 ring-leaf-200'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Preset buttons (e.g. water quantities) with an explicit active state.
 */
export function PresetRow({
  label,
  options,
  value,
  onChange,
  disabled = false,
  suffix,
}: {
  label: string;
  options: number[];
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold tabular-nums transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
              option === value
                ? 'bg-leaf-700 text-white shadow-sm'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span dir="ltr">{option}</span>
            {suffix && <span className="mr-1 font-medium">{suffix}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Collapsible block, used to move explanations out of the control area. */
export function Collapsible({
  title,
  icon,
  children,
  defaultOpen = false,
  badge,
  section,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: ReactNode;
  /** Registers this block with the dashboard's global expand/collapse controls. */
  section?: SectionKey;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionState = useSectionState(section ?? 'activeDecision', defaultOpen);
  // Sections registered with the dashboard follow the shared state (so the
  // global "توسيع الكل" / "طي الكل" controls drive them too); unregistered blocks
  // keep their own local state exactly as before.
  const expanded = section ? sectionState.expanded : open;
  const bodyId = section ? `section-body-${section}` : undefined;
  const toggle = () => {
    if (section) sectionState.toggle();
    else setOpen((current) => !current);
  };
  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        type="button"
        id={section ? `section-header-${section}` : undefined}
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        title={expanded ? `طي ${title}` : `توسيع ${title}`}
        className={`w-full flex items-center justify-between gap-3 px-5 py-4 text-right hover:bg-gray-50 transition-colors ${
          expanded ? 'border-b border-gray-50' : ''
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          {icon && <span className="text-xl leading-none">{icon}</span>}
          <span className="text-sm font-bold text-gray-800">{title}</span>
          {badge}
        </span>
        <span
          data-state={expanded ? 'expanded' : 'collapsed'}
          className={`w-7 h-7 rounded-full flex items-center justify-center border shrink-0 transition-colors ${
            expanded
              ? 'bg-leaf-50 border-leaf-100 text-leaf-700'
              : 'bg-gray-50 border-gray-100 text-gray-400'
          }`}
        >
          <Chevron expanded={expanded} />
        </span>
      </button>
      <CollapsibleBody id={bodyId ?? 'collapsible-body'} expanded={expanded}>
        <div className="px-5 pb-5 pt-4">{children}</div>
      </CollapsibleBody>
    </section>
  );
}
