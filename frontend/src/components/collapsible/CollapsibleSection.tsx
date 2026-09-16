import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  useCollapsibleExpanded,
  useGlobalSectionControls,
  useSectionToggle,
  type SectionKey,
} from './CollapsibleContext';

// ---------------------------------------------------------------------------
// The one arrow every section header carries.
//
// It is a real state indicator, not decoration: `expanded === true` points the
// arrow up (content visible), `expanded === false` points it down (content
// hidden). It rotates smoothly between the two with no layout jump.
// ---------------------------------------------------------------------------

export function Chevron({ expanded, className = '' }: { expanded: boolean; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      data-expanded={expanded ? 'true' : 'false'}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`w-4 h-4 shrink-0 transition-transform duration-200 ease-out ${expanded ? 'rotate-180' : 'rotate-0'
        } ${className}`}
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

/**
 * The collapsible body: a smooth 200ms height animation instead of an
 * unmount/remount, so the content keeps its DOM identity (and any input focus or
 * local state) while collapsed. `aria-hidden` keeps hidden content out of the
 * accessibility tree; the body is hidden with `visibility` once collapsed, so it
 * is also skipped by keyboard navigation.
 */
export function CollapsibleBody({
  id,
  expanded,
  children,
  className = '',
}: {
  id: string;
  expanded: boolean;
  children: ReactNode;
  className?: string;
}) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const node = inner.current;
    if (!node) return undefined;

    const measure = () => setHeight(node.scrollHeight);
    measure();

    // Content inside a card is live (sensors, tank level, schedules), so the
    // open height is kept in sync while it is visible.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);

  const openHeight = height === null ? undefined : `${height}px`;

  return (
    <div
      id={id}
      aria-hidden={!expanded}
      style={{ maxHeight: expanded ? openHeight : 0 }}
      className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${expanded ? 'opacity-100' : 'opacity-0 invisible'
        } ${className}`}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global controls — expand all / collapse all
//
// These are deliberately separate from the per-section arrows: they are the only
// controls that change every section at once.
// ---------------------------------------------------------------------------

export function CollapsibleToolbar({ className = '' }: { className?: string }) {
  const { allOpen, allClosed, expandAll, collapseAll } = useGlobalSectionControls();

  return (
    <div
      role="group"
      aria-label="التحكم في عرض أقسام لوحة التحكم"
      className={`flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ${className}`}
    >
      <button
        type="button"
        onClick={expandAll}
        aria-pressed={allOpen}
        aria-label="توسيع كل الأقسام في لوحة التحكم"
        title="توسيع كل الأقسام"
        className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border shadow-sm transition-all active:scale-[0.97] ${allOpen
            ? 'bg-leaf-700 border-leaf-700 text-white shadow-leaf-700/25'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 shrink-0"
        >
          <path d="M5 12l5-5 5 5" />
        </svg>
        توسيع الكل
      </button>

      <button
        type="button"
        onClick={collapseAll}
        aria-pressed={allClosed}
        aria-label="طي كل الأقسام في لوحة التحكم"
        title="طي كل الأقسام"
        className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border shadow-sm transition-all active:scale-[0.97] ${allClosed
            ? 'bg-leaf-700 border-leaf-700 text-white shadow-leaf-700/25'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
          }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 shrink-0"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
        طي الكل
      </button>
    </div>
  );
}

/**
 * Registered-section helper used by the cards. Kept here so every collapsible
 * surface (ControlCard, the Recharts cards, the legacy Collapsible) uses the
 * exact same state source.
 */
export function useSectionState(section: SectionKey, fallback = true) {
  const expanded = useCollapsibleExpanded(section, fallback);
  const toggle = useSectionToggle(section);
  return { expanded, toggle };
}