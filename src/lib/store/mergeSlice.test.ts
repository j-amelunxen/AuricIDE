import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { GitConflictFile, GitMergeState } from '../tauri/gitMerge';
import { mergeTabId } from '../git/mergeTabId';
import {
  createMergeSlice,
  selectMergeDoc,
  selectMergeState,
  selectRepoConflicts,
  unresolvedConflictIndexes,
  type MergeSlice,
} from './mergeSlice';

const gitMerge = vi.hoisted(() => ({
  getMergeState: vi.fn(),
  getConflictFile: vi.fn(),
  getConflictOrigins: vi.fn(),
  resolveConflict: vi.fn(async () => undefined),
  resolveConflictSide: vi.fn(async () => undefined),
  abortMerge: vi.fn(async () => undefined),
  concludeMerge: vi.fn(async () => 'oid-merge'),
  mergeBranch: vi.fn(),
  stepOperation: vi.fn(),
}));
vi.mock('../tauri/gitMerge', () => gitMerge);

const llm = vi.hoisted(() => ({ llmCall: vi.fn() }));
vi.mock('../tauri/llm', () => llm);

const REPO = '/work/app';
const FILE = 'src/a.ts';
const TAB = mergeTabId(REPO, FILE);

const MERGED = [
  'top',
  '<<<<<<< main',
  'same',
  '||||||| base',
  'old',
  '=======',
  'same',
  '>>>>>>> feature/x',
  'middle',
  '<<<<<<< main',
  'ours real',
  '||||||| base',
  'base real',
  '=======',
  'theirs real',
  '>>>>>>> feature/x',
  'bottom',
  '',
].join('\n');

function conflictFile(overrides: Partial<GitConflictFile> = {}): GitConflictFile {
  return {
    path: FILE,
    kind: 'content',
    base: 'x',
    ours: 'ours file\n',
    theirs: 'theirs file\n',
    merged: MERGED,
    oursLabel: 'main',
    theirsLabel: 'feature/x',
    ...overrides,
  };
}

function mergeState(overrides: Partial<GitMergeState> = {}): GitMergeState {
  return {
    inProgress: true,
    operation: 'merge',
    oursLabel: 'main',
    theirsLabel: 'feature/x',
    theirsOid: 'abc1234',
    message: "Merge branch 'feature/x'",
    conflicts: [{ path: FILE, kind: 'content' }],
    ...overrides,
  };
}

interface Host {
  rootPath: string | null;
  refreshRepoStatus: (repoPath: string) => Promise<void>;
}

let store: StoreApi<MergeSlice & Host>;
let refreshRepoStatus: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  gitMerge.getMergeState.mockResolvedValue(mergeState());
  gitMerge.getConflictFile.mockResolvedValue(conflictFile());
  gitMerge.getConflictOrigins.mockResolvedValue({ ours: [], theirs: [], commits: [] });
  refreshRepoStatus = vi.fn(async () => undefined);
  store = createStore<MergeSlice & Host>()((...a) => ({
    ...createMergeSlice(...(a as unknown as Parameters<typeof createMergeSlice>)),
    rootPath: '/work',
    refreshRepoStatus: refreshRepoStatus as unknown as Host['refreshRepoStatus'],
  }));
});

const s = () => store.getState();

describe('refreshMergeState', () => {
  it('stores the state per repo and keeps the reference when nothing changed', async () => {
    await s().refreshMergeState(REPO);
    const first = s().mergeStates[REPO];
    expect(first.theirsLabel).toBe('feature/x');
    await s().refreshMergeState(REPO);
    expect(s().mergeStates[REPO]).toBe(first);
  });

  it('drops the entry when the state cannot be read', async () => {
    await s().refreshMergeState(REPO);
    gitMerge.getMergeState.mockRejectedValueOnce(new Error('gone'));
    await s().refreshMergeState(REPO);
    expect(s().mergeStates[REPO]).toBeUndefined();
  });
});

describe('openConflict', () => {
  it('loads and parses the file under the merge tab id', async () => {
    const id = await s().openConflict(REPO, FILE);
    expect(id).toBe(TAB);
    expect(gitMerge.getConflictFile).toHaveBeenCalledWith(REPO, FILE);
    const doc = s().mergeDocs[TAB];
    expect(doc.doc?.conflictCount).toBe(2);
    expect(doc.resolutions).toEqual({});
    expect(doc.resolved).toBe(false);
  });

  it('keeps choices when the same file is opened again', async () => {
    await s().openConflict(REPO, FILE);
    s().setResolution(TAB, 1, { kind: 'theirs' });
    await s().openConflict(REPO, FILE);
    expect(gitMerge.getConflictFile).toHaveBeenCalledTimes(1);
    expect(s().mergeDocs[TAB].resolutions[1]).toEqual({ kind: 'theirs' });
  });

  it('has no doc for a delete/modify conflict', async () => {
    gitMerge.getConflictFile.mockResolvedValueOnce(
      conflictFile({ kind: 'deleted-by-them', merged: null, theirs: null })
    );
    await s().openConflict(REPO, FILE);
    expect(s().mergeDocs[TAB].doc).toBeNull();
  });
});

describe('resolutions', () => {
  beforeEach(async () => {
    await s().openConflict(REPO, FILE);
  });

  it('sets and clears a resolution', () => {
    s().setResolution(TAB, 1, { kind: 'ours' });
    expect(s().mergeDocs[TAB].resolutions).toEqual({ 1: { kind: 'ours' } });
    s().setResolution(TAB, 1, null);
    expect(s().mergeDocs[TAB].resolutions).toEqual({});
  });

  it('auto-resolves only the safe conflicts and records why', () => {
    expect(s().autoResolveAll(TAB)).toBe(1);
    const doc = s().mergeDocs[TAB];
    expect(doc.resolutions).toEqual({ 0: { kind: 'ours' } });
    expect(doc.autoReasons[0]).toMatch(/same change/i);
    expect(unresolvedConflictIndexes(doc)).toEqual([1]);
  });

  it('does not overwrite a choice the human already made', () => {
    s().setResolution(TAB, 0, { kind: 'theirs' });
    expect(s().autoResolveAll(TAB)).toBe(0);
    expect(s().mergeDocs[TAB].resolutions[0]).toEqual({ kind: 'theirs' });
  });

  it('forgets the auto reason once the human changes that conflict', () => {
    s().autoResolveAll(TAB);
    s().setResolution(TAB, 0, { kind: 'theirs' });
    expect(s().mergeDocs[TAB].autoReasons[0]).toBeUndefined();
  });
});

describe('proposals', () => {
  beforeEach(async () => {
    await s().openConflict(REPO, FILE);
  });

  it('asks the LLM with the project path and stores a ready proposal, not a resolution', async () => {
    llm.llmCall.mockResolvedValueOnce({
      content: JSON.stringify({
        resolution: 'merged real',
        rationale: 'Both renamed it.',
        confidence: 'medium',
      }),
    });
    const pending = s().requestProposal(TAB, 1);
    expect(s().mergeDocs[TAB].proposals[1]).toEqual({ status: 'loading' });
    await pending;
    const call = llm.llmCall.mock.calls[0][0];
    expect(call.projectPath).toBe('/work');
    expect(call.temperature).toBe(0.2);
    expect(call.messages.at(-1).content).toContain('ours real');
    expect(call.messages.at(-1).content).toContain('middle');
    expect(s().mergeDocs[TAB].proposals[1]).toEqual({
      status: 'ready',
      lines: ['merged real'],
      rationale: 'Both renamed it.',
      confidence: 'medium',
    });
    expect(s().mergeDocs[TAB].resolutions[1]).toBeUndefined();
  });

  it('accepting a proposal makes it an agent resolution', async () => {
    llm.llmCall.mockResolvedValueOnce({
      content: JSON.stringify({ resolution: 'm', rationale: 'r', confidence: 'high' }),
    });
    await s().requestProposal(TAB, 1);
    s().acceptProposal(TAB, 1);
    expect(s().mergeDocs[TAB].resolutions[1]).toEqual({
      kind: 'custom',
      lines: ['m'],
      source: 'agent',
    });
    expect(s().mergeDocs[TAB].proposals[1]).toBeUndefined();
  });

  it('dismissing a proposal removes it and leaves the resolution alone', async () => {
    llm.llmCall.mockResolvedValueOnce({
      content: JSON.stringify({ resolution: 'm', rationale: 'r', confidence: 'high' }),
    });
    s().setResolution(TAB, 1, { kind: 'ours' });
    await s().requestProposal(TAB, 1);
    s().dismissProposal(TAB, 1);
    expect(s().mergeDocs[TAB].proposals[1]).toBeUndefined();
    expect(s().mergeDocs[TAB].resolutions[1]).toEqual({ kind: 'ours' });
    const before = s().mergeDocs;
    s().dismissProposal(TAB, 1);
    expect(s().mergeDocs).toBe(before);
  });

  it('stores a rejected answer as an error with a reason', async () => {
    llm.llmCall.mockResolvedValueOnce({ content: 'sure, here is the fix' });
    await s().requestProposal(TAB, 1);
    expect(s().mergeDocs[TAB].proposals[1]).toMatchObject({ status: 'error' });
  });

  it('turns a failed call into an error proposal', async () => {
    llm.llmCall.mockRejectedValueOnce(new Error('no key'));
    await s().requestProposal(TAB, 1);
    const p = s().mergeDocs[TAB].proposals[1];
    expect(p.status).toBe('error');
    if (p.status === 'error') expect(p.reason).toContain('no key');
  });

  it('drops a late answer for a doc that was closed', async () => {
    let answer!: (v: { content: string }) => void;
    llm.llmCall.mockReturnValueOnce(new Promise((r) => (answer = r)));
    const pending = s().requestProposal(TAB, 1);
    s().closeMergeDoc(TAB);
    answer({ content: JSON.stringify({ resolution: 'm', rationale: 'r', confidence: 'high' }) });
    await pending;
    expect(s().mergeDocs[TAB]).toBeUndefined();
  });
});

describe('resolveFile', () => {
  beforeEach(async () => {
    await s().openConflict(REPO, FILE);
  });

  it('refuses while a conflict is unresolved', async () => {
    s().setResolution(TAB, 0, { kind: 'ours' });
    await expect(s().resolveFile(TAB)).rejects.toThrow(/1 conflict/);
    expect(gitMerge.resolveConflict).not.toHaveBeenCalled();
  });

  it('refuses a result that still has a marker line', async () => {
    s().setResolution(TAB, 0, { kind: 'ours' });
    s().setResolution(TAB, 1, {
      kind: 'custom',
      lines: ['a', '>>>>>>> feature/x'],
      source: 'manual',
    });
    await expect(s().resolveFile(TAB)).rejects.toThrow(/marker/i);
    expect(gitMerge.resolveConflict).not.toHaveBeenCalled();
  });

  it('writes the composed text, then refreshes merge state and repo status', async () => {
    s().setResolution(TAB, 0, { kind: 'ours' });
    s().setResolution(TAB, 1, { kind: 'both', first: 'theirs' });
    // First read: the check before writing. Second: the refresh after it.
    gitMerge.getMergeState
      .mockResolvedValueOnce(mergeState())
      .mockResolvedValueOnce(mergeState({ conflicts: [] }));
    await s().resolveFile(TAB);
    expect(gitMerge.resolveConflict).toHaveBeenCalledWith(
      REPO,
      FILE,
      'top\nsame\nmiddle\ntheirs real\nours real\nbottom\n'
    );
    expect(s().mergeDocs[TAB].resolved).toBe(true);
    expect(s().mergeStates[REPO].conflicts).toEqual([]);
    expect(refreshRepoStatus).toHaveBeenCalledWith(REPO);
  });

  it('picks a whole side of a text conflict from the index stage too (keeps the mode)', async () => {
    await s().resolveFile(TAB, 'theirs');
    expect(gitMerge.resolveConflictSide).toHaveBeenLastCalledWith(REPO, FILE, 'theirs');
    expect(gitMerge.resolveConflict).not.toHaveBeenCalled();
  });

  it.each(['binary', 'symlink', 'deleted-by-us', 'deleted-by-them'] as const)(
    'resolves a %s conflict from the index stage, not from text',
    async (kind) => {
      s().closeMergeDoc(TAB);
      gitMerge.getConflictFile.mockResolvedValueOnce(
        conflictFile({ kind, merged: null, ours: null, theirs: null, base: null })
      );
      await s().openConflict(REPO, FILE);
      await s().resolveFile(TAB, 'ours');
      expect(gitMerge.resolveConflictSide).toHaveBeenLastCalledWith(REPO, FILE, 'ours');
      await s().resolveFile(TAB, 'theirs');
      expect(gitMerge.resolveConflictSide).toHaveBeenLastCalledWith(REPO, FILE, 'theirs');
      expect(gitMerge.resolveConflict).not.toHaveBeenCalled();
      expect(refreshRepoStatus).toHaveBeenCalledWith(REPO);
    }
  );

  it('delete still goes through the content path', async () => {
    await s().resolveFile(TAB, 'delete');
    expect(gitMerge.resolveConflict).toHaveBeenLastCalledWith(REPO, FILE, null);
  });

  it('writes a Markdown file whose setext headings sit next to the conflict', async () => {
    s().closeMergeDoc(TAB);
    const merged = [
      'Title',
      '=======',
      '<<<<<<< main',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> feature/x',
      'Next',
      '=======',
      '',
    ].join('\n');
    gitMerge.getConflictFile.mockResolvedValueOnce(conflictFile({ path: 'README.md', merged }));
    await s().openConflict(REPO, FILE);
    s().setResolution(TAB, 0, { kind: 'theirs' });
    await s().resolveFile(TAB);
    expect(gitMerge.resolveConflict).toHaveBeenLastCalledWith(
      REPO,
      FILE,
      'Title\n=======\ntheirs\nNext\n=======\n'
    );
  });

  it('asks for a side when there is no text to compose', async () => {
    s().closeMergeDoc(TAB);
    gitMerge.getConflictFile.mockResolvedValueOnce(
      conflictFile({ kind: 'deleted-by-us', merged: null, ours: null })
    );
    await s().openConflict(REPO, FILE);
    await expect(s().resolveFile(TAB)).rejects.toThrow(/pick/i);
  });

  it('uses hand-written text for a file whose markers could not be parsed', async () => {
    s().closeMergeDoc(TAB);
    gitMerge.getConflictFile.mockResolvedValueOnce(conflictFile({ merged: '<<<<<<< main\nx\n' }));
    await s().openConflict(REPO, FILE);
    await expect(s().resolveFile(TAB)).rejects.toThrow();
    s().setManualText(TAB, 'fixed by hand\n');
    await s().resolveFile(TAB);
    expect(gitMerge.resolveConflict).toHaveBeenLastCalledWith(REPO, FILE, 'fixed by hand\n');
  });
});

describe('whole-merge actions', () => {
  it('abort ends the repo docs and refreshes', async () => {
    await s().openConflict(REPO, FILE);
    gitMerge.getMergeState.mockResolvedValueOnce(
      mergeState({ inProgress: false, operation: 'none', conflicts: [] })
    );
    await s().abortMerge(REPO);
    expect(gitMerge.abortMerge).toHaveBeenCalledWith(REPO);
    expect(s().mergeDocs[TAB].ended).toBe(true);
    expect(s().mergeStates[REPO].inProgress).toBe(false);
    expect(refreshRepoStatus).toHaveBeenCalledWith(REPO);
  });

  it('conclude returns the oid and ends the repo docs', async () => {
    await s().openConflict(REPO, FILE);
    expect(await s().concludeMerge(REPO, 'Merge it')).toBe('oid-merge');
    expect(gitMerge.concludeMerge).toHaveBeenCalledWith(REPO, 'Merge it');
    expect(s().mergeDocs[TAB].ended).toBe(true);
  });

  it('a failed conclude keeps the docs and rethrows', async () => {
    await s().openConflict(REPO, FILE);
    gitMerge.concludeMerge.mockRejectedValueOnce(new Error('conflicts left'));
    await expect(s().concludeMerge(REPO, 'm')).rejects.toThrow('conflicts left');
    expect(s().mergeDocs[TAB].ended).toBe(false);
  });

  it('mergeBranch returns the outcome and refreshes', async () => {
    gitMerge.mergeBranch.mockResolvedValueOnce({
      outcome: 'conflicts',
      oid: null,
      conflicts: [FILE],
    });
    const r = await s().mergeBranch(REPO, 'feature/x');
    expect(r.outcome).toBe('conflicts');
    expect(gitMerge.getMergeState).toHaveBeenCalledWith(REPO);
    expect(refreshRepoStatus).toHaveBeenCalledWith(REPO);
  });
});

describe('stepping a rebase, cherry-pick or revert', () => {
  const rebasing = mergeState({ operation: 'rebase', theirsOid: null, message: null });

  it('ends every doc of the repo: they belong to the commit that was replayed', async () => {
    gitMerge.getMergeState.mockResolvedValue(rebasing);
    await s().openConflict(REPO, FILE);
    gitMerge.stepOperation.mockResolvedValueOnce({
      outcome: 'conflicts',
      operation: 'rebase',
      conflicts: [FILE],
      message: 'Stopped on the next commit: 1 file to resolve.',
      details: null,
    });

    const result = await s().stepOperation(REPO, 'continue');

    expect(gitMerge.stepOperation).toHaveBeenCalledWith(REPO, 'continue');
    expect(result.outcome).toBe('conflicts');
    // Same path, same null theirsOid: without this the next commit's conflict reopened stale.
    expect(s().mergeDocs[TAB].ended).toBe(true);
    expect(refreshRepoStatus).toHaveBeenCalledWith(REPO);
    await s().openConflict(REPO, FILE);
    expect(gitMerge.getConflictFile).toHaveBeenCalledTimes(2);
  });

  it('a refused step keeps the docs and rethrows', async () => {
    gitMerge.getMergeState.mockResolvedValue(rebasing);
    await s().openConflict(REPO, FILE);
    gitMerge.stepOperation.mockRejectedValueOnce(new Error('1 conflict left to resolve'));
    await expect(s().stepOperation(REPO, 'continue')).rejects.toThrow('1 conflict left');
    expect(s().mergeDocs[TAB].ended).toBe(false);
  });
});

describe('a rebase or cherry-pick continued in a terminal', () => {
  const stop1 = mergeState({
    operation: 'rebase',
    theirsOid: null,
    message: null,
    headOid: 'head-1',
    applyingOid: 'commit-1',
    step: { current: 1, total: 2, subject: 'first', branch: 'feature/x' },
  });

  beforeEach(async () => {
    gitMerge.getMergeState.mockResolvedValue(stop1);
    await s().openConflict(REPO, FILE);
  });

  it('keeps the doc while the same stop is polled again', async () => {
    await s().refreshMergeState(REPO);
    expect(s().mergeDocs[TAB].ended).toBe(false);
  });

  it('ends the doc when the poll finds the next commit stopped on the same path', async () => {
    gitMerge.getMergeState.mockResolvedValue({
      ...stop1,
      headOid: 'head-2',
      applyingOid: 'commit-2',
      step: { current: 2, total: 2, subject: 'second', branch: 'feature/x' },
    });
    await s().refreshMergeState(REPO);
    expect(s().mergeDocs[TAB].ended).toBe(true);
  });

  it('ends the doc after a terminal skip, which leaves HEAD where it was', async () => {
    gitMerge.getMergeState.mockResolvedValue({ ...stop1, applyingOid: 'commit-2' });
    await s().refreshMergeState(REPO);
    expect(s().mergeDocs[TAB].ended).toBe(true);
  });

  it('resolveFile refuses a doc from the previous stop and writes nothing', async () => {
    s().setResolution(TAB, 0, { kind: 'ours' });
    s().setResolution(TAB, 1, { kind: 'ours' });
    gitMerge.getMergeState.mockResolvedValue({ ...stop1, headOid: 'head-2', applyingOid: 'c2' });
    await expect(s().resolveFile(TAB)).rejects.toThrow(/closed or changed/i);
    await expect(s().resolveFile(TAB, 'ours')).rejects.toThrow(/closed or changed/i);
    expect(gitMerge.resolveConflict).not.toHaveBeenCalled();
    expect(gitMerge.resolveConflictSide).not.toHaveBeenCalled();
  });

  it('reopening after the stop moved loads the new commit fresh', async () => {
    s().setResolution(TAB, 1, { kind: 'ours' });
    gitMerge.getMergeState.mockResolvedValue({ ...stop1, headOid: 'head-2', applyingOid: 'c2' });
    await s().openConflict(REPO, FILE);
    expect(gitMerge.getConflictFile).toHaveBeenCalledTimes(2);
    expect(s().mergeDocs[TAB].resolutions).toEqual({});
    expect(s().mergeDocs[TAB].ended).toBe(false);
  });
});

describe('a merge that ended or changed elsewhere', () => {
  beforeEach(async () => {
    await s().openConflict(REPO, FILE);
  });

  it('remembers which merge a doc belongs to', () => {
    expect(s().mergeDocs[TAB].theirsOid).toBe('abc1234');
    expect(s().mergeDocs[TAB].ended).toBe(false);
  });

  it('ends the docs when the merge is no longer in progress', async () => {
    gitMerge.getMergeState.mockResolvedValueOnce(
      mergeState({ inProgress: false, operation: 'none', theirsOid: null, conflicts: [] })
    );
    await s().refreshMergeState(REPO);
    expect(s().mergeDocs[TAB].ended).toBe(true);
  });

  it('ends the docs when a different merge is now in progress', async () => {
    gitMerge.getMergeState.mockResolvedValueOnce(mergeState({ theirsOid: 'fff9999' }));
    await s().refreshMergeState(REPO);
    expect(s().mergeDocs[TAB].ended).toBe(true);
  });

  it('leaves docs of the same merge and of other repos alone', async () => {
    const other = '/work/other';
    gitMerge.getMergeState.mockResolvedValueOnce(mergeState({ inProgress: false }));
    await s().refreshMergeState(other);
    await s().refreshMergeState(REPO);
    expect(s().mergeDocs[TAB].ended).toBe(false);
  });

  it('reloads instead of reusing a doc from another merge', async () => {
    s().setResolution(TAB, 1, { kind: 'ours' });
    gitMerge.getMergeState.mockResolvedValue(mergeState({ theirsOid: 'fff9999' }));
    await s().openConflict(REPO, FILE);
    expect(gitMerge.getConflictFile).toHaveBeenCalledTimes(2);
    expect(s().mergeDocs[TAB].theirsOid).toBe('fff9999');
    expect(s().mergeDocs[TAB].resolutions).toEqual({});
    expect(s().mergeDocs[TAB].ended).toBe(false);
  });

  it('resolveFile refuses when the merge changed under the doc', async () => {
    s().setResolution(TAB, 0, { kind: 'ours' });
    s().setResolution(TAB, 1, { kind: 'ours' });
    gitMerge.getMergeState.mockResolvedValueOnce(mergeState({ theirsOid: 'fff9999' }));
    await expect(s().resolveFile(TAB)).rejects.toThrow(/conflict is closed or changed/i);
    await expect(s().resolveFile(TAB, 'ours')).rejects.toThrow(/conflict is closed or changed/i);
    expect(gitMerge.resolveConflict).not.toHaveBeenCalled();
    expect(gitMerge.resolveConflictSide).not.toHaveBeenCalled();
  });
});

describe('labels and file endings from git', () => {
  it('leaves a fixture that spells out a conflict alone', async () => {
    const merged = [
      "const sample = '<<<<<<< HEAD';",
      '<<<<<<< HEAD',
      'old fixture',
      '>>>>>>> topic',
      '<<<<<<< main',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> feature/x',
      'end',
      '',
    ].join('\n');
    gitMerge.getConflictFile.mockResolvedValueOnce(conflictFile({ merged }));
    await s().openConflict(REPO, FILE);
    expect(s().mergeDocs[TAB].doc?.conflictCount).toBe(1);
    s().setResolution(TAB, 0, { kind: 'theirs' });
    await s().resolveFile(TAB);
    expect(gitMerge.resolveConflict).toHaveBeenLastCalledWith(
      REPO,
      FILE,
      "const sample = '<<<<<<< HEAD';\n<<<<<<< HEAD\nold fixture\n>>>>>>> topic\ntheirs\nend\n"
    );
  });

  it('still refuses a leftover marker with the real label', async () => {
    await s().openConflict(REPO, FILE);
    s().setResolution(TAB, 0, { kind: 'ours' });
    s().setResolution(TAB, 1, { kind: 'custom', lines: ['<<<<<<< main'], source: 'manual' });
    await expect(s().resolveFile(TAB)).rejects.toThrow(/marker/i);
  });

  it('keeps a missing final newline when the file ends in a conflict', async () => {
    const merged = ['top', '<<<<<<< main', 'o', '=======', 't', '>>>>>>> feature/x', ''].join('\n');
    gitMerge.getConflictFile.mockResolvedValueOnce(
      conflictFile({ merged, ours: 'top\no', theirs: 'top\nt', base: null })
    );
    await s().openConflict(REPO, FILE);
    s().setResolution(TAB, 0, { kind: 'ours' });
    await s().resolveFile(TAB);
    expect(gitMerge.resolveConflict).toHaveBeenLastCalledWith(REPO, FILE, 'top\no');
  });
});

describe('resetMergeInMemory', () => {
  it('clears merge states and documents', async () => {
    await s().refreshMergeState(REPO);
    await s().openConflict(REPO, FILE);
    s().resetMergeInMemory();
    expect(s().mergeStates).toEqual({});
    expect(s().mergeDocs).toEqual({});
  });
});

describe('selectors', () => {
  it('return stable values for unknown keys', () => {
    expect(selectRepoConflicts('/nope')(s())).toBe(selectRepoConflicts('/other')(s()));
    expect(selectMergeState('/nope')(s())).toBeNull();
    expect(selectMergeDoc('nope')(s())).toBeNull();
  });

  it('return the stored conflicts for a known repo', async () => {
    await s().refreshMergeState(REPO);
    expect(selectRepoConflicts(REPO)(s())).toBe(s().mergeStates[REPO].conflicts);
  });
});

describe('conflict origins', () => {
  const lower = {
    oid: 'a'.repeat(40),
    shortOid: 'aaaaaaa',
    summary: 'Use ours',
    author: 'A',
    time: 1,
  };
  const raise = {
    oid: 'b'.repeat(40),
    shortOid: 'bbbbbbb',
    summary: 'Use theirs',
    author: 'B',
    time: 2,
  };
  const sides = {
    ours: 'top\nsame\nmiddle\nours real\nbottom\n',
    theirs: 'top\nsame\nmiddle\ntheirs real\nbottom\n',
  };
  const origins = {
    ours: [{ line: 4, oid: lower.oid }],
    theirs: [{ line: 4, oid: raise.oid }],
    commits: [raise, lower],
  };

  beforeEach(() => {
    gitMerge.getConflictFile.mockResolvedValue(conflictFile(sides));
    gitMerge.getConflictOrigins.mockResolvedValue(origins);
  });

  it('loads in the background and lands per conflict on the doc', async () => {
    await s().openConflict(REPO, FILE);
    await vi.waitFor(() => expect(s().mergeDocs[TAB].origins).toBeDefined());
    expect(gitMerge.getConflictOrigins).toHaveBeenCalledWith(REPO, FILE);
    expect(s().mergeDocs[TAB].origins).toEqual({
      0: { ours: [], theirs: [] },
      1: { ours: [lower], theirs: [raise] },
    });
  });

  it('never holds up opening the file', async () => {
    gitMerge.getConflictOrigins.mockReturnValueOnce(new Promise(() => undefined));
    await s().openConflict(REPO, FILE);
    expect(s().mergeDocs[TAB].doc?.conflictCount).toBe(2);
    expect(s().mergeDocs[TAB].origins).toBeUndefined();
  });

  it('a failure leaves them absent and resolving still works', async () => {
    gitMerge.getConflictOrigins.mockRejectedValueOnce(new Error('blame failed'));
    await s().openConflict(REPO, FILE);
    await new Promise((r) => setTimeout(r, 0));
    expect(s().mergeDocs[TAB].origins).toBeUndefined();
    s().setResolution(TAB, 0, { kind: 'ours' });
    s().setResolution(TAB, 1, { kind: 'theirs' });
    await s().resolveFile(TAB);
    expect(gitMerge.resolveConflict).toHaveBeenCalled();
  });

  it('are not asked for when git gave no markered text', async () => {
    gitMerge.getConflictFile.mockResolvedValueOnce(conflictFile({ merged: null }));
    await s().openConflict(REPO, FILE);
    expect(gitMerge.getConflictOrigins).not.toHaveBeenCalled();
  });

  it('tell the agent what each side meant', async () => {
    await s().openConflict(REPO, FILE);
    await vi.waitFor(() => expect(s().mergeDocs[TAB].origins).toBeDefined());
    llm.llmCall.mockResolvedValueOnce({
      content: JSON.stringify({ resolution: 'm', rationale: 'r', confidence: 'high' }),
    });
    await s().requestProposal(TAB, 1);
    const prompt: string = llm.llmCall.mock.calls[0][0].messages.at(-1).content;
    expect(prompt).toContain('Side "main" changed this region in: "Use ours".');
    expect(prompt).toContain('Side "feature/x" changed this region in: "Use theirs".');
  });
});
