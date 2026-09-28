import { useMemo, useRef } from 'react';
import { useStore, type StoreState } from '@/lib/store';
import type { useIDEState } from '../useIDEState';

/**
 * Store fields `useIDEState` does not subscribe to because they change far too
 * often to re-render the page for (see its doc comment). Handlers still need
 * them, and read them from the store at call time.
 */
const HOT_STORE_KEYS = [
  'agents',
  'interruptedAgents',
  'minimizedAgentIds',
  'collapsedAgentRepos',
  'agentColors',
  'reviewedAgentIds',
  'fileTree',
  'repoStates',
  'diagnostics',
  'cursorPos',
  'inboxItems',
  // Every MCP ticket update an agent makes lands here.
  'pmDraftEpics',
  'pmDraftTickets',
] as const satisfies readonly (keyof StoreState)[];

type HotStoreKey = (typeof HOT_STORE_KEYS)[number];
const HOT_KEYS: ReadonlySet<PropertyKey> = new Set(HOT_STORE_KEYS);

/** What the handler hooks see: the page state plus the hot store fields. */
export type IDEState = ReturnType<typeof useIDEState> & Pick<StoreState, HotStoreKey>;

/**
 * One object for the component's lifetime that always reads the newest values.
 *
 * The handler hooks close over `state` and list it as a dependency. Handing
 * them the fresh page-state object each render made every handler a new
 * function each render, so no `memo` below the page could ever hold. This
 * object never changes identity; its reads are what stays current:
 *
 * - page-state fields come from the latest render (the ref is assigned during
 *   render so hooks computing values in that same render see its values);
 * - hot store fields come from `useStore.getState()` at the moment of the
 *   read — a field the passed object carries itself wins, which keeps test
 *   doubles that supply them working.
 *
 * The consequence to keep in mind: a `useMemo`/`useEffect` listing the bare
 * object as a dependency never re-runs. List the fields it reads instead, and
 * select a hot field with `useStore` where a render must depend on it.
 */
export function useLiveIDEState(state: ReturnType<typeof useIDEState>): IDEState {
  const latest = useRef(state);
  // Reading and writing the ref during render is the point here, not an
  // accident: the handler hooks compute values from this object in the same
  // render (breadcrumbs, badges, effect deps), so it must already hold this
  // render's state. Assigning it in an effect would hand them the last one.
  /* eslint-disable react-hooks/refs -- see above */
  latest.current = state;
  return useMemo(
    () =>
      new Proxy({} as IDEState, {
        get(_target, key) {
          const current = latest.current as Record<PropertyKey, unknown>;
          if (key in current) return current[key];
          if (HOT_KEYS.has(key))
            return (useStore.getState() as unknown as Record<PropertyKey, unknown>)[key];
          return undefined;
        },
      }),
    []
  );
  /* eslint-enable react-hooks/refs */
}
