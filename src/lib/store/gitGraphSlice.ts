import type { StateCreator } from 'zustand';
import { layoutGraph, type GraphRow, type LayoutCarry } from '../git/graphLayout';
import {
  gitBranchCreate,
  gitBranchDelete,
  gitBranchRename,
  gitCheckout,
  gitCherryPick,
  gitCommitDetail,
  gitGraphLog,
  gitRefs,
  gitRevert,
  gitTagCreate,
  gitTagDelete,
  parseGitError,
  type CommitDetail,
  type GitError,
  type GitRefs,
  type GraphCommit,
  type PickResult,
} from '../tauri/gitGraph';
import { sameValue } from './stableRefs';

/**
 * State of the git graph browser, per repository. Rust sends commits and refs;
 * the lanes are laid out here (`git/graphLayout.ts`). Every write operation
 * reloads refs and the first page afterwards, so the tab shows the repository
 * and not a cache. See `docs/design-git-graph.md`.
 */

export const GRAPH_PAGE_SIZE = 200;

/** `null` shows everything; `'current'` is HEAD's line; otherwise a full ref name. */
export type GraphBranchFilter = null | 'current' | string;

export interface GraphRepoState {
  commits: GraphCommit[];
  rows: GraphRow[];
  carry: LayoutCarry | null;
  hasMore: boolean;
  loading: boolean;
  refs: GitRefs | null;
  selectedOid: string | null;
  /** Keyed by `graphDetailKey(oid, parentIndex)`. */
  details: Record<string, CommitDetail>;
  filterText: string;
  branchFilter: GraphBranchFilter;
  /** Label of the running operation, or null. */
  busy: string | null;
  lastError: string | null;
  /** Bumped by every reload; an answer for an older one is dropped. */
  generation: number;
}

export type GraphOperationResult =
  { ok: true; pick?: PickResult } | { ok: false; code: GitError['code'] | 'busy'; message: string };

export interface GitGraphSlice {
  graphs: Record<string, GraphRepoState>;
  openGraph: (repoPath: string) => Promise<void>;
  closeGraph: (repoPath: string) => void;
  loadFirstPage: (repoPath: string) => Promise<void>;
  loadMore: (repoPath: string) => Promise<void>;
  /** Re-reads the refs; true when HEAD or any ref differs from what is stored. */
  refreshRefs: (repoPath: string) => Promise<boolean>;
  selectGraphCommit: (repoPath: string, oid: string | null) => void;
  loadGraphDetail: (
    repoPath: string,
    oid: string,
    parentIndex?: number
  ) => Promise<CommitDetail | null>;
  setGraphFilterText: (repoPath: string, text: string) => void;
  setGraphBranchFilter: (repoPath: string, filter: GraphBranchFilter) => void;
  graphCheckout: (repoPath: string, target: string) => Promise<GraphOperationResult>;
  graphCreateBranch: (
    repoPath: string,
    name: string,
    atOid: string,
    checkout: boolean
  ) => Promise<GraphOperationResult>;
  graphRenameBranch: (
    repoPath: string,
    oldName: string,
    newName: string
  ) => Promise<GraphOperationResult>;
  graphDeleteBranch: (
    repoPath: string,
    name: string,
    force: boolean
  ) => Promise<GraphOperationResult>;
  graphCreateTag: (
    repoPath: string,
    name: string,
    oid: string,
    message?: string
  ) => Promise<GraphOperationResult>;
  graphDeleteTag: (repoPath: string, name: string) => Promise<GraphOperationResult>;
  graphCherryPick: (repoPath: string, oid: string) => Promise<GraphOperationResult>;
  graphRevert: (repoPath: string, oid: string) => Promise<GraphOperationResult>;
}

/** What the slice reads from the rest of the store, duck-typed like mergeSlice does. */
interface GraphHost {
  refreshRepoStatus?: (repoPath: string) => Promise<void>;
  loadBranches?: (repoPath: string) => Promise<void>;
}

export const EMPTY_GRAPH_ROWS: GraphRow[] = [];
export const EMPTY_GRAPH_COMMITS: GraphCommit[] = [];

const LOAD_FAILED_MESSAGE = 'Could not read the commit history.';
const BUSY_MESSAGE = 'Another operation is still running.';

let generationCounter = 0;

export function graphDetailKey(oid: string, parentIndex: number): string {
  return `${oid}:${parentIndex}`;
}

function emptyGraph(generation: number): GraphRepoState {
  return {
    commits: EMPTY_GRAPH_COMMITS,
    rows: EMPTY_GRAPH_ROWS,
    carry: null,
    hasMore: false,
    loading: false,
    refs: null,
    selectedOid: null,
    details: {},
    filterText: '',
    branchFilter: null,
    busy: null,
    lastError: null,
    generation,
  };
}

export const selectGraph = (state: GitGraphSlice, repoPath: string) => state.graphs[repoPath];

export const selectGraphRows = (state: GitGraphSlice, repoPath: string): GraphRow[] =>
  state.graphs[repoPath]?.rows ?? EMPTY_GRAPH_ROWS;

export const selectGraphDetail = (
  state: GitGraphSlice,
  repoPath: string,
  oid: string,
  parentIndex = 0
): CommitDetail | undefined => state.graphs[repoPath]?.details[graphDetailKey(oid, parentIndex)];

/** The commit a branch filter dims everything else against, or null when nothing is filtered. */
export function resolveBranchFilterTip(
  filter: GraphBranchFilter,
  refs: GitRefs | null
): string | null {
  if (!filter || !refs) return null;
  if (filter === 'current') return refs.headOid;
  return refs.refs.find((r) => r.name === filter)?.target ?? null;
}

export const createGitGraphSlice: StateCreator<GitGraphSlice> = (set, get) => {
  const host = () => get() as GitGraphSlice & GraphHost;

  const patch = (repoPath: string, changes: Partial<GraphRepoState>) =>
    set((s) => {
      const graph = s.graphs[repoPath];
      return graph ? { graphs: { ...s.graphs, [repoPath]: { ...graph, ...changes } } } : {};
    });

  const ensure = (repoPath: string): GraphRepoState => {
    const existing = get().graphs[repoPath];
    if (existing) return existing;
    const created = emptyGraph(++generationCounter);
    set((s) => ({ graphs: { ...s.graphs, [repoPath]: created } }));
    return created;
  };

  const isCurrent = (repoPath: string, generation: number) =>
    get().graphs[repoPath]?.generation === generation;

  const loadFirstPage = async (repoPath: string) => {
    ensure(repoPath);
    const generation = ++generationCounter;
    patch(repoPath, { generation, loading: true, lastError: null });
    try {
      const [refs, page] = await Promise.all([
        gitRefs(repoPath),
        gitGraphLog(repoPath, 0, GRAPH_PAGE_SIZE),
      ]);
      if (!isCurrent(repoPath, generation)) return;
      const { rows, carry } = layoutGraph(page.commits, refs.headOid);
      const stored = get().graphs[repoPath].refs;
      patch(repoPath, {
        commits: page.commits,
        rows,
        carry,
        hasMore: page.hasMore,
        refs: sameValue(stored, refs) ? stored : refs,
        loading: false,
      });
    } catch {
      if (isCurrent(repoPath, generation)) {
        patch(repoPath, { loading: false, lastError: LOAD_FAILED_MESSAGE });
      }
    }
  };

  const loadMore = async (repoPath: string) => {
    const graph = get().graphs[repoPath];
    if (!graph || graph.loading || !graph.hasMore) return;
    const { generation } = graph;
    patch(repoPath, { loading: true });
    try {
      // Refs ride along: a commit made meanwhile shifts every later page, so a
      // changed repository restarts from the top instead of appending.
      const [page, refs] = await Promise.all([
        gitGraphLog(repoPath, graph.commits.length, GRAPH_PAGE_SIZE),
        gitRefs(repoPath),
      ]);
      if (!isCurrent(repoPath, generation)) return;
      const current = get().graphs[repoPath];
      if (!sameValue(current.refs, refs)) {
        await loadFirstPage(repoPath);
        return;
      }
      const known = new Set(current.commits.map((c) => c.oid));
      const fresh = page.commits.filter((c) => !known.has(c.oid));
      const { rows, carry } = layoutGraph(
        fresh,
        current.refs?.headOid ?? null,
        current.carry ?? undefined
      );
      patch(repoPath, {
        commits: [...current.commits, ...fresh],
        rows: [...current.rows, ...rows],
        carry,
        hasMore: page.hasMore,
        loading: false,
      });
    } catch {
      if (isCurrent(repoPath, generation)) {
        patch(repoPath, { loading: false, lastError: LOAD_FAILED_MESSAGE });
      }
    }
  };

  /** The Source Control mirror failing must not turn a finished git operation into a failure. */
  const settle = (work?: Promise<void>) => (work ?? Promise.resolve()).catch(() => undefined);

  /** After a failure too: git may have left an operation open that the banner must show. */
  const reload = (repoPath: string) =>
    Promise.all([
      get().loadFirstPage(repoPath),
      settle(host().refreshRepoStatus?.(repoPath)),
      settle(host().loadBranches?.(repoPath)),
    ]);

  const runOperation = async (
    repoPath: string,
    label: string,
    run: () => Promise<PickResult | void>
  ): Promise<GraphOperationResult> => {
    if (ensure(repoPath).busy) return { ok: false, code: 'busy', message: BUSY_MESSAGE };
    patch(repoPath, { busy: label, lastError: null });
    let pick: PickResult | void;
    try {
      pick = await run();
    } catch (error) {
      const { code, message } = parseGitError(error);
      await reload(repoPath);
      patch(repoPath, { busy: null, lastError: message });
      return { ok: false, code, message };
    }
    await reload(repoPath);
    patch(repoPath, { busy: null });
    return pick ? { ok: true, pick } : { ok: true };
  };

  return {
    graphs: {},

    openGraph: async (repoPath) => {
      const existing = get().graphs[repoPath];
      if (existing && !existing.lastError) return;
      await loadFirstPage(repoPath);
    },

    closeGraph: (repoPath) =>
      set((s) => {
        const rest = { ...s.graphs };
        delete rest[repoPath];
        return { graphs: rest };
      }),

    loadFirstPage,
    loadMore,

    refreshRefs: async (repoPath) => {
      const graph = get().graphs[repoPath];
      if (!graph) return false;
      const refs = await gitRefs(repoPath);
      if (sameValue(get().graphs[repoPath]?.refs, refs)) return false;
      patch(repoPath, { refs });
      return true;
    },

    selectGraphCommit: (repoPath, oid) => patch(repoPath, { selectedOid: oid }),

    loadGraphDetail: async (repoPath, oid, parentIndex = 0) => {
      const key = graphDetailKey(oid, parentIndex);
      const cached = get().graphs[repoPath]?.details[key];
      if (cached) return cached;
      try {
        const detail = await gitCommitDetail(repoPath, oid, parentIndex);
        const graph = get().graphs[repoPath];
        if (graph) patch(repoPath, { details: { ...graph.details, [key]: detail } });
        return detail;
      } catch {
        return null;
      }
    },

    setGraphFilterText: (repoPath, filterText) => patch(repoPath, { filterText }),
    setGraphBranchFilter: (repoPath, branchFilter) => patch(repoPath, { branchFilter }),

    graphCheckout: (repoPath, target) =>
      runOperation(repoPath, 'Checking out', () => gitCheckout(repoPath, target)),
    graphCreateBranch: (repoPath, name, atOid, checkout) =>
      runOperation(repoPath, 'Creating branch', () =>
        gitBranchCreate(repoPath, name, atOid, checkout)
      ),
    graphRenameBranch: (repoPath, oldName, newName) =>
      runOperation(repoPath, 'Renaming branch', () => gitBranchRename(repoPath, oldName, newName)),
    graphDeleteBranch: (repoPath, name, force) =>
      runOperation(repoPath, 'Deleting branch', () => gitBranchDelete(repoPath, name, force)),
    graphCreateTag: (repoPath, name, oid, message) =>
      runOperation(repoPath, 'Creating tag', () => gitTagCreate(repoPath, name, oid, message)),
    graphDeleteTag: (repoPath, name) =>
      runOperation(repoPath, 'Deleting tag', () => gitTagDelete(repoPath, name)),
    graphCherryPick: (repoPath, oid) =>
      runOperation(repoPath, 'Cherry-picking', () => gitCherryPick(repoPath, oid)),
    graphRevert: (repoPath, oid) =>
      runOperation(repoPath, 'Reverting', () => gitRevert(repoPath, oid)),
  };
};
