import type { StateCreator } from 'zustand';
import {
  autoResolution,
  composeResult,
  hasConflictMarkers,
  MERGE_BASE_LABEL,
  parseMergedText,
  resolutionLines,
  type ConflictSegment,
  type MergeDoc,
  type MergeLabels,
  type Resolution,
} from '../git/merge/conflictModel';
import { proposeResolution, type ProposalConfidence } from '../git/merge/agentProposal';
import { conflictOrigins, intentFor, type ConflictOrigin } from '../git/merge/conflictOrigins';
import { mergeTabId } from '../git/mergeTabId';
import {
  abortMerge as abortMergeIpc,
  concludeMerge as concludeMergeIpc,
  getConflictFile,
  getConflictOrigins,
  getMergeState,
  mergeBranch as mergeBranchIpc,
  resolveConflict,
  resolveConflictSide,
  stepOperation as stepOperationIpc,
  type GitConflictEntry,
  type GitOperationAction,
  type GitOperationStepResult,
  type GitConflictFile,
  type GitMergeStartResult,
  type GitMergeState,
} from '../tauri/gitMerge';
import { llmCall } from '../tauri/llm';
import { sameValue } from './stableRefs';

/**
 * State of the merge panel: git's merge state per repo, and one document per
 * open merge tab holding the human's choices and the agent's proposals.
 * Nothing here writes a file except `resolveFile`, and that only after the
 * composed text is complete and free of markers. See
 * `docs/design-merge-panel.md`.
 */

export type ProposalState =
  | { status: 'loading' }
  | { status: 'ready'; lines: string[]; rationale: string; confidence: ProposalConfidence }
  | { status: 'error'; reason: string };

export interface MergeDocState {
  repoPath: string;
  /** Repo-relative. */
  filePath: string;
  file: GitConflictFile;
  /** `null` when git gave no markered text (binary, delete/modify): pick a side. */
  doc: MergeDoc | null;
  /** Keyed by `ConflictSegment.index`. */
  resolutions: Record<number, Resolution>;
  /** Why the wand resolved a conflict. Cleared when the human changes it. */
  autoReasons: Record<number, string>;
  proposals: Record<number, ProposalState>;
  /**
   * Keyed by `ConflictSegment.index`: the commits that changed each side
   * since the merge base. Loaded after the doc and never waited on; absent
   * until it arrives, and for good when it could not be read.
   */
  origins?: Record<number, ConflictOrigin>;
  /** Hand-written whole-file text; wins over the per-conflict choices when set. */
  manualText: string | null;
  /** The file was written and staged. The tab stays until closed. */
  resolved: boolean;
  /** `MERGE_HEAD` when the doc was loaded. */
  theirsOid: string | null;
  /**
   * Which stop of which operation the doc was loaded in (`operationKey`).
   * A rebase continued or skipped in a terminal changes it while path and
   * `theirsOid` stay the same; that is what ends the doc then.
   */
  operationKey: string;
  /**
   * The merge this doc belonged to was concluded, aborted or replaced, here
   * or in a terminal. The doc is kept so the tab can say so; nothing writes it.
   */
  ended: boolean;
}

export type SidePick = 'ours' | 'theirs' | 'delete';

export interface MergeSlice {
  mergeStates: Record<string, GitMergeState>;
  mergeDocs: Record<string, MergeDocState>;
  /**
   * Re-reads git's merge state for one repo. Never throws; an unreadable
   * state drops the entry. Docs of a merge that ended or was replaced are
   * marked `ended`.
   */
  refreshMergeState: (repoPath: string) => Promise<GitMergeState | null>;
  /**
   * Loads and parses one conflicted file under its merge tab id and returns
   * the id. Opening it again keeps the choices made so far, unless the doc
   * belongs to a merge that has since ended or changed. Does not open a tab:
   * the caller does. Throws when the file is not conflicted.
   */
  openConflict: (repoPath: string, filePath: string) => Promise<string>;
  /** `null` clears the choice. */
  setResolution: (tabId: string, index: number, resolution: Resolution | null) => void;
  /** `null` clears it. For files whose markers could not be parsed. */
  setManualText: (tabId: string, text: string | null) => void;
  /** Resolves every still-open conflict `autoResolution` calls safe. Returns how many. */
  autoResolveAll: (tabId: string) => number;
  /** Asks the project's LLM for one conflict. The answer lands in `proposals`, never in `resolutions`. */
  requestProposal: (tabId: string, index: number) => Promise<void>;
  /** A ready proposal becomes a custom resolution with source `agent`. */
  acceptProposal: (tabId: string, index: number) => void;
  /** Drops the proposal for one conflict, whatever its status. The resolution is untouched. */
  dismissProposal: (tabId: string, index: number) => void;
  /**
   * Writes and stages the file, then refreshes merge state and repo status.
   * Without `pick` the composed text is written. With it, a whole side is
   * taken from its index stage, blob and mode, for every kind of conflict.
   * Throws a readable message when anything is unresolved, a marker is
   * left, or the merge ended or changed since the doc was loaded.
   */
  resolveFile: (tabId: string, pick?: SidePick) => Promise<void>;
  /** `git reset --merge`. Marks the repo's merge docs ended. Rethrows. */
  abortMerge: (repoPath: string) => Promise<void>;
  /** Commits the merge, returns the oid. Marks the repo's merge docs ended. Rethrows. */
  concludeMerge: (repoPath: string, message: string) => Promise<string>;
  /** `git merge <branch>`; refreshes merge state and repo status. Rethrows. */
  mergeBranch: (repoPath: string, branch: string) => Promise<GitMergeStartResult>;
  /**
   * Continues, skips or aborts a rebase, cherry-pick or revert. Every doc of
   * the repo ends, whatever the outcome: it belonged to the commit that was
   * being replayed, and the next one can conflict on the same path with no
   * oid to tell them apart. Refreshes merge state and repo status. Rethrows.
   */
  stepOperation: (repoPath: string, action: GitOperationAction) => Promise<GitOperationStepResult>;
  closeMergeDoc: (tabId: string) => void;
  /** Forgets every merge state and document, for a project switch. Touches no file. */
  resetMergeInMemory: () => void;
}

/** What the slice reads from the rest of the store, duck-typed like agentSlice does. */
interface MergeHost {
  rootPath?: string | null;
  refreshRepoStatus?: (repoPath: string) => Promise<void>;
}

const NO_CONFLICTS: GitConflictEntry[] = [];

export const selectMergeState =
  (repoPath: string) =>
  (s: MergeSlice): GitMergeState | null =>
    s.mergeStates[repoPath] ?? null;

/** The repo's conflicts; one shared empty array when there are none known. */
export const selectRepoConflicts =
  (repoPath: string) =>
  (s: MergeSlice): GitConflictEntry[] =>
    s.mergeStates[repoPath]?.conflicts ?? NO_CONFLICTS;

export const selectMergeDoc =
  (tabId: string) =>
  (s: MergeSlice): MergeDocState | null =>
    s.mergeDocs[tabId] ?? null;

function conflictSegments(doc: MergeDoc | null): ConflictSegment[] {
  return (doc?.segments ?? []).filter((seg): seg is ConflictSegment => seg.kind === 'conflict');
}

/** Indexes still waiting for a choice, in file order. Derive in `useMemo`, not in a selector. */
export function unresolvedConflictIndexes(state: MergeDocState): number[] {
  return conflictSegments(state.doc)
    .filter((c) => !state.resolutions[c.index])
    .map((c) => c.index);
}

/** The file around one conflict, other conflicts shown as chosen (or as our side). */
function contextAround(state: MergeDocState, index: number): { before: string[]; after: string[] } {
  const before: string[] = [];
  const after: string[] = [];
  let target: string[] = before;
  for (const seg of state.doc?.segments ?? []) {
    if (seg.kind === 'clean') target.push(...seg.lines);
    else if (seg.kind === 'conflict' && seg.index === index) target = after;
    else if (seg.kind === 'conflict') {
      const chosen = state.resolutions[seg.index];
      target.push(...(chosen ? resolutionLines(seg, chosen) : seg.ours));
    }
  }
  return { before, after };
}

function without<T>(record: Record<number, T>, index: number): Record<number, T> {
  if (!(index in record)) return record;
  const next = { ...record };
  delete next[index];
  return next;
}

function labelsOf(file: GitConflictFile): MergeLabels {
  return { ours: file.oursLabel, theirs: file.theirsLabel, base: MERGE_BASE_LABEL };
}

/**
 * Names one stop of one operation: the merge (`theirsOid`), and for a rebase,
 * cherry-pick or revert the commit being applied, HEAD and the step. Each
 * `--continue` moves HEAD; a `--skip` moves the applied commit.
 */
export function operationKey(state: GitMergeState | null): string {
  if (!state?.inProgress) return 'none';
  return [
    state.operation,
    state.theirsOid ?? '',
    state.headOid ?? '',
    state.applyingOid ?? '',
    state.step?.current ?? '',
  ].join(':');
}

/** Whether a doc can no longer be written for the operation git reports now. */
function isStale(doc: MergeDocState, state: GitMergeState | null): boolean {
  return !state?.inProgress || operationKey(state) !== doc.operationKey;
}

const STALE_MESSAGE =
  'This conflict is closed or changed. Open the file again from Source Control.';

function composedContent(state: MergeDocState): string {
  if (state.manualText !== null) {
    if (hasConflictMarkers(state.manualText, labelsOf(state.file))) {
      throw new Error('The edited text still contains a conflict marker line.');
    }
    return state.manualText;
  }
  if (!state.doc) throw new Error(`Pick a side for ${state.filePath}.`);
  if (state.doc.segments.some((seg) => seg.kind === 'unparsed')) {
    throw new Error(`The markers in ${state.filePath} could not be read. Edit the file by hand.`);
  }
  const open = unresolvedConflictIndexes(state).length;
  const text = composeResult(state.doc, state.resolutions);
  if (open > 0 || text === null) {
    throw new Error(`${open} ${open === 1 ? 'conflict is' : 'conflicts are'} still unresolved.`);
  }
  if (hasConflictMarkers(text, labelsOf(state.file))) {
    throw new Error('The result still contains a conflict marker line.');
  }
  return text;
}

export const createMergeSlice: StateCreator<MergeSlice> = (set, get) => {
  const host = () => get() as MergeSlice & MergeHost;

  const updateDoc = (tabId: string, update: (doc: MergeDocState) => MergeDocState) =>
    set((s) => {
      const doc = s.mergeDocs[tabId];
      if (!doc) return {};
      const next = update(doc);
      return next === doc ? {} : { mergeDocs: { ...s.mergeDocs, [tabId]: next } };
    });

  /** Marks the repo's docs ended; with `state`, only those that no longer match it. */
  const endRepoDocs = (repoPath: string, state?: GitMergeState | null) =>
    set((s) => {
      let changed = false;
      const next: Record<string, MergeDocState> = {};
      for (const [id, doc] of Object.entries(s.mergeDocs)) {
        const end =
          doc.repoPath === repoPath && !doc.ended && (state === undefined || isStale(doc, state));
        next[id] = end ? { ...doc, ended: true } : doc;
        changed ||= end;
      }
      return changed ? { mergeDocs: next } : {};
    });

  /** Background: a failure only means the side headers say nothing. */
  const loadOrigins = (tabId: string, repoPath: string, file: GitConflictFile, doc: MergeDoc) => {
    getConflictOrigins(repoPath, file.path)
      .then((raw) => {
        const origins = conflictOrigins(doc.segments, file, raw);
        // A reopened doc is a new object: an answer for the old one is dropped.
        updateDoc(tabId, (d) => (d.file === file ? { ...d, origins } : d));
      })
      .catch(() => undefined);
  };

  const refreshAll = async (repoPath: string) => {
    await get().refreshMergeState(repoPath);
    await host().refreshRepoStatus?.(repoPath);
  };

  return {
    mergeStates: {},
    mergeDocs: {},

    refreshMergeState: async (repoPath) => {
      let state: GitMergeState;
      try {
        state = await getMergeState(repoPath);
      } catch {
        set((s) => {
          if (!(repoPath in s.mergeStates)) return {};
          const next = { ...s.mergeStates };
          delete next[repoPath];
          return { mergeStates: next };
        });
        return null;
      }
      endRepoDocs(repoPath, state);
      const prev = get().mergeStates[repoPath];
      if (prev && sameValue(prev, state)) return prev;
      set((s) => ({ mergeStates: { ...s.mergeStates, [repoPath]: state } }));
      return state;
    },

    openConflict: async (repoPath, filePath) => {
      const tabId = mergeTabId(repoPath, filePath);
      const current = await get().refreshMergeState(repoPath);
      const existing = get().mergeDocs[tabId];
      if (existing && !existing.ended && !isStale(existing, current)) return tabId;
      const file = await getConflictFile(repoPath, filePath);
      const doc =
        file.merged === null
          ? null
          : parseMergedText(file.merged, {
              labels: labelsOf(file),
              sides: { ours: file.ours, theirs: file.theirs, base: file.base },
            });
      set((s) => ({
        mergeDocs: {
          ...s.mergeDocs,
          [tabId]: {
            repoPath,
            filePath,
            file,
            doc,
            resolutions: {},
            autoReasons: {},
            proposals: {},
            manualText: null,
            resolved: false,
            theirsOid: current?.theirsOid ?? null,
            operationKey: operationKey(current),
            ended: false,
          },
        },
      }));
      if (doc) loadOrigins(tabId, repoPath, file, doc);
      return tabId;
    },

    setResolution: (tabId, index, resolution) =>
      updateDoc(tabId, (doc) => ({
        ...doc,
        resolutions: resolution
          ? { ...doc.resolutions, [index]: resolution }
          : without(doc.resolutions, index),
        autoReasons: without(doc.autoReasons, index),
      })),

    setManualText: (tabId, text) => updateDoc(tabId, (doc) => ({ ...doc, manualText: text })),

    autoResolveAll: (tabId) => {
      const state = get().mergeDocs[tabId];
      if (!state) return 0;
      const resolutions = { ...state.resolutions };
      const autoReasons = { ...state.autoReasons };
      let count = 0;
      for (const conflict of conflictSegments(state.doc)) {
        if (resolutions[conflict.index]) continue;
        const auto = autoResolution(conflict);
        if (!auto) continue;
        resolutions[conflict.index] = auto.resolution;
        autoReasons[conflict.index] = auto.reason;
        count += 1;
      }
      if (count > 0) updateDoc(tabId, (doc) => ({ ...doc, resolutions, autoReasons }));
      return count;
    },

    requestProposal: async (tabId, index) => {
      const state = get().mergeDocs[tabId];
      const conflict = conflictSegments(state?.doc ?? null).find((c) => c.index === index);
      if (!state || !conflict) return;
      const setProposal = (proposal: ProposalState) =>
        updateDoc(tabId, (doc) =>
          // A reopened doc is a new object: an answer for the old one is dropped.
          doc.file === state.file
            ? { ...doc, proposals: { ...doc.proposals, [index]: proposal } }
            : doc
        );
      setProposal({ status: 'loading' });
      const projectPath = host().rootPath ?? state.repoPath;
      const result = await proposeResolution({
        filePath: state.filePath,
        oursLabel: state.file.oursLabel,
        theirsLabel: state.file.theirsLabel,
        conflict,
        ...contextAround(state, index),
        intent: intentFor(state.origins?.[index]),
        askLlm: async (prompt) => {
          const response = await llmCall({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            projectPath,
          });
          return response.content;
        },
      });
      setProposal(
        result.ok
          ? {
              status: 'ready',
              lines: result.lines,
              rationale: result.rationale,
              confidence: result.confidence,
            }
          : { status: 'error', reason: result.reason }
      );
    },

    acceptProposal: (tabId, index) =>
      updateDoc(tabId, (doc) => {
        const proposal = doc.proposals[index];
        if (proposal?.status !== 'ready') return doc;
        return {
          ...doc,
          resolutions: {
            ...doc.resolutions,
            [index]: { kind: 'custom', lines: proposal.lines, source: 'agent' },
          },
          autoReasons: without(doc.autoReasons, index),
          proposals: without(doc.proposals, index),
        };
      }),

    dismissProposal: (tabId, index) =>
      updateDoc(tabId, (doc) => {
        const proposals = without(doc.proposals, index);
        return proposals === doc.proposals ? doc : { ...doc, proposals };
      }),

    resolveFile: async (tabId, pick) => {
      const state = get().mergeDocs[tabId];
      if (!state) throw new Error('This merge document is no longer open.');
      const { repoPath, filePath } = state;
      const content = pick ? null : composedContent(state);
      // The doc's choices only make sense for the merge they were made in.
      const current = await get().refreshMergeState(repoPath);
      if (state.ended || isStale(state, current)) throw new Error(STALE_MESSAGE);
      if (pick === 'delete') await resolveConflict(repoPath, filePath, null);
      else if (pick) await resolveConflictSide(repoPath, filePath, pick);
      else await resolveConflict(repoPath, filePath, content);
      updateDoc(tabId, (doc) => ({ ...doc, resolved: true }));
      await refreshAll(state.repoPath);
    },

    abortMerge: async (repoPath) => {
      await abortMergeIpc(repoPath);
      endRepoDocs(repoPath);
      await refreshAll(repoPath);
    },

    concludeMerge: async (repoPath, message) => {
      const oid = await concludeMergeIpc(repoPath, message);
      endRepoDocs(repoPath);
      await refreshAll(repoPath);
      return oid;
    },

    mergeBranch: async (repoPath, branch) => {
      const result = await mergeBranchIpc(repoPath, branch);
      await refreshAll(repoPath);
      return result;
    },

    stepOperation: async (repoPath, action) => {
      const result = await stepOperationIpc(repoPath, action);
      endRepoDocs(repoPath);
      await refreshAll(repoPath);
      return result;
    },

    closeMergeDoc: (tabId) =>
      set((s) => {
        if (!(tabId in s.mergeDocs)) return {};
        const next = { ...s.mergeDocs };
        delete next[tabId];
        return { mergeDocs: next };
      }),

    resetMergeInMemory: () => set({ mergeStates: {}, mergeDocs: {} }),
  };
};
