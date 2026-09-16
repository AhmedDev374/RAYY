import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// The 14 collapsible dashboard sections — the SINGLE source of truth for the
// expand/collapse state of the whole dashboard.
//
// `DEFAULT_COLLAPSED` reproduces exactly what the dashboard showed before the
// collapsible system existed: every control card was always visible, and the
// decision explainer was the one block collapsed by default.
// ---------------------------------------------------------------------------

export const COLLAPSIBLE_SECTIONS = [
  'controlCenter',
  'quickControl',
  'irrigation',
  'ventilation',
  'temperature',
  'lighting',
  'vents',
  'waterTank',
  'environmentTargets',
  'deviceStatus',
  'alerts',
  'activeDecision',
  'schedule',
  'controlLog',
] as const;

export type SectionKey = (typeof COLLAPSIBLE_SECTIONS)[number];

export type SectionState = Record<SectionKey, boolean>;

export const DEFAULT_COLLAPSED: SectionKey[] = ['activeDecision'];

export const MAX_VISIBLE_DEFAULT_OPEN = 6;

function buildDefaultState(): SectionState {
  return COLLAPSIBLE_SECTIONS.reduce((acc, key) => {
    acc[key] = !DEFAULT_COLLAPSED.includes(key);
    return acc;
  }, {} as SectionState);
}

export function allExpanded(): SectionState {
  return COLLAPSIBLE_SECTIONS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as SectionState);
}

export function allCollapsed(): SectionState {
  return COLLAPSIBLE_SECTIONS.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as SectionState);
}

// ---------------------------------------------------------------------------
// Framework-free reactive store
//
// The state lives OUTSIDE React so that the twelve independent cards of the
// dashboard stay mounted with a single subscription each. React state is not
// lost when a card is collapsed because the card is never unmounted — only its
// body is hidden — which is what keeps device values, sensors and tank state
// intact (ticket requirement J/L/M).
// ---------------------------------------------------------------------------

export interface CollapsibleStore {
  get: () => SectionState;
  subscribe: (listener: () => void) => () => void;
  toggle: (key: SectionKey) => void;
  set: (key: SectionKey, expanded: boolean) => void;
  setMany: (patch: Partial<SectionState>) => void;
  expandAll: () => void;
  collapseAll: () => void;
}

export function createCollapsibleStore(
  initial: SectionState = buildDefaultState(),
): CollapsibleStore {
  let state = initial;
  const listeners = new Set<() => void>();

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const patch = (next: Partial<SectionState>) => {
    let changed = false;
    for (const key of Object.keys(next) as SectionKey[]) {
      const value = next[key];
      if (value !== undefined && state[key] !== value) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = { ...state, ...next };
    emit();
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toggle: (key) => patch({ [key]: !state[key] }),
    set: (key, expanded) => patch({ [key]: expanded }),
    setMany: (next) => patch(next),
    expandAll: () => patch(allExpanded()),
    collapseAll: () => patch(allCollapsed()),
  };
}

// ---------------------------------------------------------------------------
// React binding
// ---------------------------------------------------------------------------

const EMPTY_STORE: CollapsibleStore = {
  get: () => buildDefaultState(),
  subscribe: () => () => undefined,
  toggle: () => undefined,
  set: () => undefined,
  setMany: () => undefined,
  expandAll: () => undefined,
  collapseAll: () => undefined,
};

const CollapsibleStoreContext = createContext<CollapsibleStore | null>(null);

export function CollapsibleProvider({
  store,
  children,
}: {
  store?: CollapsibleStore;
  children: ReactNode;
}) {
  // The store is created once per provider instance: the dashboard lives inside
  // this provider, so a user's individual choices survive every re-render, the
  // periodic React Query poll, and moving between subsections of the dashboard.
  const fallback = useRef<CollapsibleStore>();
  if (!fallback.current) fallback.current = createCollapsibleStore();
  return (
    <CollapsibleStoreContext.Provider value={store ?? fallback.current}>
      {children}
    </CollapsibleStoreContext.Provider>
  );
}

export function useCollapsibleStore(): CollapsibleStore {
  return useContext(CollapsibleStoreContext) ?? EMPTY_STORE;
}

/**
 * True when this section is currently expanded. When no provider is mounted the
 * section falls back to its own local state (see `useCollapsibleState`), so the
 * operator cards also work when rendered on their own (tests, other pages).
 */
export function useCollapsibleExpanded(key: SectionKey, fallback = true): boolean {
  const store = useCollapsibleStore();
  const hasProvider = useContext(CollapsibleStoreContext) !== null;
  const [local, setLocal] = useState(fallback);
  const [snapshot, setSnapshot] = useState<SectionState>(() => store.get());

  useEffect(() => {
    if (!hasProvider) return undefined;
    setSnapshot(store.get());
    return store.subscribe(() => setSnapshot(store.get()));
  }, [store, hasProvider]);

  if (!hasProvider) return local;
  void setLocal;
  return snapshot[key] ?? fallback;
}

/** Toggle one section. Uses the shared store when a provider is mounted. */
export function useSectionToggle(key: SectionKey) {
  const store = useCollapsibleStore();
  const hasProvider = useContext(CollapsibleStoreContext) !== null;
  return useCallback(
    (next?: boolean) => {
      if (hasProvider) store.set(key, next ?? !store.get()[key]);
    },
    [store, key, hasProvider],
  );
}

/** Global controls: expand/collapse every section at once. */
export function useGlobalSectionControls() {
  const store = useCollapsibleStore();
  const hasProvider = useContext(CollapsibleStoreContext) !== null;
  const [snapshot, setSnapshot] = useState<SectionState>(() => store.get());

  useEffect(() => {
    if (!hasProvider) return undefined;
    setSnapshot(store.get());
    return store.subscribe(() => setSnapshot(store.get()));
  }, [store, hasProvider]);

  const state = hasProvider ? snapshot : store.get();
  const values = useMemo(() => COLLAPSIBLE_SECTIONS.map((key) => state[key]), [state]);
  const allOpen = values.every(Boolean);
  const allClosed = values.every((value) => !value);

  return {
    allOpen,
    allClosed,
    expandAll: useCallback(() => store.expandAll(), [store]),
    collapseAll: useCallback(() => store.collapseAll(), [store]),
  };
}
