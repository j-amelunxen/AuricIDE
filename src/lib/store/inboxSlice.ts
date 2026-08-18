import type { StateCreator } from 'zustand';
import {
  inboxAdd,
  inboxAssign,
  inboxAttach,
  inboxDetach,
  inboxDismiss,
  inboxList,
  inboxUnassign,
  inboxUpdate,
  projectsPmOverview,
  type InboxAssignRequest,
  type InboxItem,
  type InboxItemPatch,
  type ProjectPmOverview,
} from '@/lib/tauri/inbox';
import { settledInboxItems } from '@/lib/inbox/inboxTicketStatus';
import { inboxPatchFromNewerDigest, ticketUpdatesFromInboxPatch } from '@/lib/inbox/inboxMirror';

/**
 * The pieces of the wider store this slice reaches into, cast rather than
 * imported — `rootPath` lives in `fileTreeSlice`, `refreshPmData` in
 * `pmSlice`, and pulling either type in directly would make this slice
 * depend on the whole store shape it is itself composed into. `get()` is
 * cast to `Partial<CrossSlices>` and every field is accessed optionally,
 * because an isolated store built from just `createInboxSlice` (as the tests
 * here do) genuinely does not have them.
 */
interface CrossSlices {
  rootPath: string | null;
  refreshPmData: (projectPath: string) => Promise<void>;
  updateTicket: (
    id: string,
    updates: { name?: string; description?: string; priority?: string; dueDate?: string | null }
  ) => void;
}

/**
 * The app-level GTD inbox. Items live here independent of any project until
 * they are assigned, at which point a real ticket exists in that project's
 * own database and this slice only mirrors it.
 *
 * `inboxError` is the one place every action reports failure — actions never
 * throw out of the store, so a caller can always `await` them safely; a
 * failed IPC call (or browser mode, where there is no backend at all) leaves
 * the previous state in place and records what went wrong.
 */
export interface InboxSlice {
  inboxItems: InboxItem[];
  inboxLoading: boolean;
  inboxError: string | null;
  /** Cross-project PM snapshots, keyed by project path. */
  inboxOverview: Record<string, ProjectPmOverview>;

  loadInbox: () => Promise<void>;
  addInboxItem: (title: string, notes?: string) => Promise<InboxItem | null>;
  updateInboxItem: (id: string, patch: InboxItemPatch) => Promise<void>;
  dismissInboxItem: (id: string) => Promise<void>;
  assignInboxItem: (request: InboxAssignRequest) => Promise<void>;
  unassignInboxItem: (id: string) => Promise<void>;
  attachInboxFile: (itemId: string, sourcePath: string) => Promise<InboxItem | null>;
  detachInboxFile: (itemId: string, attachmentId: string) => Promise<void>;
  refreshInboxOverview: (projectPaths: string[]) => Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function replaceItem(items: InboxItem[], id: string, updated: InboxItem): InboxItem[] {
  return items.map((item) => (item.id === id ? updated : item));
}

export const createInboxSlice: StateCreator<InboxSlice> = (set, get) => ({
  inboxItems: [],
  inboxLoading: false,
  inboxError: null,
  inboxOverview: {},

  loadInbox: async () => {
    set({ inboxLoading: true, inboxError: null });
    try {
      const inboxItems = await inboxList();
      set({ inboxItems, inboxLoading: false });
    } catch (error) {
      set({ inboxLoading: false, inboxError: describeError(error) });
    }
  },

  addInboxItem: async (title, notes) => {
    try {
      const item = await inboxAdd({ title, notes: notes ?? '' });
      set({ inboxItems: [item, ...get().inboxItems], inboxError: null });
      return item;
    } catch (error) {
      set({ inboxError: describeError(error) });
      return null;
    }
  },

  updateInboxItem: async (id, patch) => {
    try {
      const item = await inboxUpdate(id, patch);
      set({ inboxItems: replaceItem(get().inboxItems, id, item), inboxError: null });

      // After assign the ticket is the durable record. The open project's
      // draft must move with the inbox row or Save in PM would write the
      // previous title/priority back over what we just stored.
      const cross = get() as unknown as Partial<CrossSlices>;
      if (
        item.ticketId !== null &&
        item.projectPath !== null &&
        item.projectPath === cross.rootPath
      ) {
        const updates = ticketUpdatesFromInboxPatch(patch);
        if (Object.keys(updates).length > 0) {
          cross.updateTicket?.(item.ticketId, updates);
        }
      }
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  },

  dismissInboxItem: async (id) => {
    try {
      await inboxDismiss(id);
      set({
        inboxItems: get().inboxItems.filter((item) => item.id !== id),
        inboxError: null,
      });
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  },

  assignInboxItem: async (request) => {
    try {
      const item = await inboxAssign(request);
      set({ inboxItems: replaceItem(get().inboxItems, item.id, item), inboxError: null });

      // The overview a moment ago did not know this project's new ticket
      // existed. Re-fetch it alongside every project already tracked —
      // never just the one path — or a second item assigned to the SAME
      // project would see the first item's ticket vanish from an untouched,
      // now-stale snapshot and report it as 'done'.
      await get().refreshInboxOverview(trackedOverviewPaths(get(), request.projectPath));

      // The inbox overview and the open project's own PM draft (pmSlice) are
      // two separate caches. If the project just assigned into is the one
      // open right now, that draft needs the new ticket too.
      const cross = get() as unknown as Partial<CrossSlices>;
      if (cross.rootPath === request.projectPath) {
        void cross.refreshPmData?.(request.projectPath);
      }
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  },

  attachInboxFile: async (itemId, sourcePath) => {
    try {
      const item = await inboxAttach(itemId, sourcePath);
      set({ inboxItems: replaceItem(get().inboxItems, item.id, item), inboxError: null });

      const cross = get() as unknown as Partial<CrossSlices>;
      if (
        item.ticketId !== null &&
        item.projectPath !== null &&
        item.projectPath === cross.rootPath
      ) {
        void cross.refreshPmData?.(item.projectPath);
      }
      return item;
    } catch (error) {
      set({ inboxError: describeError(error) });
      return null;
    }
  },

  detachInboxFile: async (itemId, attachmentId) => {
    try {
      const item = await inboxDetach(itemId, attachmentId);
      set({ inboxItems: replaceItem(get().inboxItems, item.id, item), inboxError: null });

      const cross = get() as unknown as Partial<CrossSlices>;
      if (
        item.ticketId !== null &&
        item.projectPath !== null &&
        item.projectPath === cross.rootPath
      ) {
        void cross.refreshPmData?.(item.projectPath);
      }
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  },

  unassignInboxItem: async (id) => {
    const previousProjectPath =
      get().inboxItems.find((item) => item.id === id)?.projectPath ?? null;
    try {
      const item = await inboxUnassign(id);
      set({ inboxItems: replaceItem(get().inboxItems, id, item), inboxError: null });

      if (previousProjectPath !== null) {
        await get().refreshInboxOverview(trackedOverviewPaths(get(), previousProjectPath));
      }
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  },

  /**
   * Replaces `inboxOverview` with exactly the results for `projectPaths` —
   * never merges. A caller that still cares about a previously-tracked
   * project passes it again (see `trackedOverviewPaths`); one that doesn't
   * is trusted to mean it, so a project that fell out of relevance (no
   * longer starred, recent, open or assigned to anything) actually leaves
   * the map instead of keeping a snapshot nothing will ever refresh again.
   */
  refreshInboxOverview: async (projectPaths) => {
    try {
      const overviews = await projectsPmOverview(projectPaths);
      const inboxOverview: Record<string, ProjectPmOverview> = {};
      for (const overview of overviews) {
        inboxOverview[overview.projectPath] = overview;
      }
      set({ inboxOverview, inboxError: null });
      await persistMirrorsFromOverview(get, set, inboxOverview);
      await dismissSettledInboxItems(get, set, inboxOverview);
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  },
});

/**
 * Ticket → inbox persist for assigned rows. Only writes when the project
 * db is ahead of the inbox row, so an edit made here a moment ago is not
 * overwritten by a stale overview snapshot.
 */
async function persistMirrorsFromOverview(
  get: () => InboxSlice,
  set: (partial: Partial<InboxSlice>) => void,
  overview: Record<string, ProjectPmOverview>
): Promise<void> {
  let items = get().inboxItems;
  for (const item of items) {
    if (item.projectPath === null || item.ticketId === null) continue;
    const digest = overview[item.projectPath]?.tickets.find(
      (ticket) => ticket.id === item.ticketId
    );
    if (digest === undefined) continue;
    const patch = inboxPatchFromNewerDigest(item, digest);
    if (patch === null) continue;
    try {
      const updated = await inboxUpdate(item.id, patch);
      items = replaceItem(items, item.id, updated);
      set({ inboxItems: items });
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  }
}

/**
 * The project db is the source of truth after assign. A ticket that is
 * done or archived — or gone from the active overview list — leaves the
 * inbox the same way a manual dismiss would, without asking: the user
 * already finished that work in PM.
 */
async function dismissSettledInboxItems(
  get: () => InboxSlice,
  set: (partial: Partial<InboxSlice>) => void,
  overview: Record<string, ProjectPmOverview>
): Promise<void> {
  const settled = settledInboxItems(get().inboxItems, overview);
  if (settled.length === 0) return;

  const dismissed = new Set<string>();
  for (const item of settled) {
    try {
      await inboxDismiss(item.id);
      dismissed.add(item.id);
    } catch (error) {
      set({ inboxError: describeError(error) });
    }
  }
  if (dismissed.size === 0) return;
  set({ inboxItems: get().inboxItems.filter((item) => !dismissed.has(item.id)) });
}

/** Every project path already tracked in the overview, plus one more. */
function trackedOverviewPaths(state: InboxSlice, extra: string): string[] {
  return Array.from(new Set([...Object.keys(state.inboxOverview), extra]));
}
