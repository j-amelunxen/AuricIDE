import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMergedText } from '@/lib/git/merge/conflictModel';
import { mergeTabId } from '@/lib/git/mergeTabId';
import { useStore } from '@/lib/store';
import type { MergeDocState, ProposalState } from '@/lib/store/mergeSlice';
import type { GitConflictFile, GitMergeState } from '@/lib/tauri/gitMerge';
import { MergeView } from './MergeView';

const REPO = '/work/app';
const FILE = 'src/config.ts';
const TAB = mergeTabId(REPO, FILE);

const MERGED = [
  'line 1',
  'line 2',
  '<<<<<<< main',
  'const a = 1;',
  '||||||| base',
  'const a = 0;',
  '=======',
  'const a = 0;',
  '>>>>>>> feature/x',
  'mid',
  '<<<<<<< main',
  'const x = "yours";',
  '||||||| base',
  'const x = "orig";',
  '=======',
  'const x = "incoming";',
  '>>>>>>> feature/x',
  '<<<<<<< main',
  'same',
  '||||||| base',
  'old',
  '=======',
  'same',
  '>>>>>>> feature/x',
  'end',
  '',
].join('\n');

function conflictFile(overrides: Partial<GitConflictFile> = {}): GitConflictFile {
  return {
    path: FILE,
    kind: 'content',
    base: null,
    ours: null,
    theirs: null,
    merged: MERGED,
    oursLabel: 'main',
    theirsLabel: 'feature/x',
    ...overrides,
  };
}

function docState(overrides: Partial<MergeDocState> = {}): MergeDocState {
  const file = overrides.file ?? conflictFile();
  return {
    repoPath: REPO,
    filePath: FILE,
    file,
    doc: file.merged === null ? null : parseMergedText(file.merged),
    resolutions: {},
    autoReasons: {},
    proposals: {},
    manualText: null,
    resolved: false,
    theirsOid: 'abc1234',
    operationKey: 'merge:abc1234:::',
    ended: false,
    ...overrides,
  };
}

const mergeState: GitMergeState = {
  inProgress: true,
  operation: 'merge',
  oursLabel: 'main',
  theirsLabel: 'feature/x',
  theirsOid: 'abc1234',
  message: "Merge branch 'feature/x'",
  conflicts: [
    { path: FILE, kind: 'content' },
    { path: 'src/other.ts', kind: 'content' },
  ],
};

const resolveFile = vi.fn(async () => undefined);
const requestProposal = vi.fn(async () => undefined);
const showToast = vi.fn(() => 1);

function seed(doc: MergeDocState | null) {
  useStore.setState({
    mergeDocs: doc ? { [TAB]: doc } : {},
    mergeStates: { [REPO]: mergeState },
  });
}

describe('MergeView', () => {
  beforeEach(() => {
    resolveFile.mockClear();
    requestProposal.mockClear();
    showToast.mockClear();
    useStore.setState({ resolveFile, requestProposal, showToast, openTabs: [] });
    seed(null);
  });

  it('shows under each side header the commit that changed it, and nothing for an unchanged side', () => {
    const feature = {
      oid: 'f'.repeat(40),
      shortOid: 'fffffff',
      summary: 'Say incoming',
      author: 'Dev',
      time: Math.floor(Date.now() / 1000) - 3 * 86400,
    };
    seed(docState({ origins: { 1: { ours: [], theirs: [feature] } } }));
    render(<MergeView tabId={TAB} />);
    const card = screen.getByTestId('conflict-card-1');
    const incoming = card.querySelector('[data-side="theirs"]') as HTMLElement;
    const yours = card.querySelector('[data-side="ours"]') as HTMLElement;
    expect(within(incoming).getByTestId('side-origin')).toHaveTextContent(
      /Say incoming · fffffff · 3 days ago/
    );
    expect(within(yours).queryByTestId('side-origin')).toBeNull();
    expect(within(screen.getByTestId('conflict-card-0')).queryByTestId('side-origin')).toBeNull();
  });

  it('shows the cards once the document arrives after mount', () => {
    const { rerender } = render(<MergeView tabId={TAB} />);
    expect(screen.getByText('This file is no longer open in a merge')).toBeInTheDocument();
    expect(screen.getByText('Open it again from Source Control.')).toBeInTheDocument();

    act(() => seed(docState()));
    rerender(<MergeView tabId={TAB} />);

    expect(screen.getAllByRole('region', { name: /Conflict \d of 3/ })).toHaveLength(3);
    expect(screen.getByText(/0 of 3 conflicts resolved/)).toBeInTheDocument();
    expect(screen.getByTestId('merge-toolbar')).toHaveTextContent(
      'Merging feature/x (incoming) into main (yours)'
    );
  });

  it('names the sides by branch on every card', () => {
    seed(docState());
    render(<MergeView tabId={TAB} />);
    const card = screen.getByTestId('conflict-card-1');
    expect(within(card).getByText('main (yours)')).toBeInTheDocument();
    expect(within(card).getByText('feature/x (incoming)')).toBeInTheDocument();
  });

  it('resolves only the simple conflicts with the wand, each saying why', async () => {
    seed(docState());
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    await user.click(screen.getByRole('button', { name: /Resolve simple conflicts \(2\)/ }));

    expect(screen.getByText(/2 of 3 conflicts resolved/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId('conflict-card-0')).getByTestId('auto-reason')
    ).toHaveTextContent('Only your side changed this region.');
    expect(
      within(screen.getByTestId('conflict-card-2')).getByTestId('auto-reason')
    ).toHaveTextContent('Both sides made the same change.');
    expect(screen.getByTestId('conflict-card-1')).not.toHaveAttribute('data-resolved');
    expect(screen.getByRole('button', { name: /Mark resolved/ })).toBeDisabled();
    expect(screen.getByTestId('mark-resolved-reason')).toHaveTextContent('1 conflict open');
    expect(screen.getByRole('button', { name: /Mark resolved/ })).toHaveAccessibleDescription(
      '1 conflict open'
    );
    // The wand disabled itself; focus went to the conflict that is still open.
    expect(screen.getByTestId('conflict-card-1')).toHaveFocus();
  });

  it('takes a side from the keyboard, moves on, and announces it', async () => {
    seed(docState());
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    expect(screen.getByTestId('conflict-card-0')).toHaveAttribute('data-focused', 'true');
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');

    expect(
      within(screen.getByTestId('conflict-card-0')).getByTestId('resolution-summary')
    ).toHaveTextContent('Took feature/x (incoming)');
    expect(screen.getByTestId('conflict-card-1')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('merge-announcer')).toHaveTextContent(
      'Conflict 1: Took feature/x (incoming). 2 conflicts left.'
    );

    await user.keyboard('{Alt>}b{/Alt}');
    expect(
      within(screen.getByTestId('conflict-card-1')).getByTestId('resolution-summary')
    ).toHaveTextContent('Kept both, main first');
  });

  it('marks the file resolved with ⌘↵ only when every conflict has a choice', async () => {
    seed(docState({ resolutions: { 0: { kind: 'ours' }, 1: { kind: 'theirs' } } }));
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(resolveFile).not.toHaveBeenCalled();

    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(resolveFile).toHaveBeenCalledWith(TAB);
  });

  it('shows the original on request, and says when there is none', async () => {
    seed(docState());
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    await user.keyboard('{Alt>}o{/Alt}');
    expect(
      within(screen.getByTestId('conflict-card-0')).getByText('Original (common ancestor)')
    ).toBeInTheDocument();
  });

  it('shows a proposal with its reasons and applies it only on Use proposal', async () => {
    const proposal: ProposalState = {
      status: 'ready',
      lines: ['const x = "both";'],
      rationale: 'Both sides renamed the value; this keeps the incoming name.',
      confidence: 'medium',
    };
    seed(docState({ proposals: { 1: proposal } }));
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    const card = screen.getByTestId('conflict-card-1');

    expect(within(card).getByText(proposal.rationale)).toBeInTheDocument();
    expect(within(card).getByTestId('proposal-confidence')).toHaveTextContent('medium confidence');
    expect(card).not.toHaveAttribute('data-resolved');

    await user.click(within(card).getByRole('button', { name: 'Use proposal' }));
    expect(within(card).getByTestId('resolution-summary')).toHaveTextContent(
      'Accepted the agent proposal'
    );
  });

  it('says calmly that the merge ended, offers nothing that writes, and closes the tab', async () => {
    seed(docState({ ended: true, resolutions: { 0: { kind: 'ours' } } }));
    useStore.setState({
      openTabs: [{ id: TAB, path: FILE, name: 'config.ts (merge)', isDirty: false }],
    });
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    expect(screen.getByRole('heading', { name: 'This conflict is closed' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Git moved past it, here or in a terminal. If the file still has a conflict, open it again from Source Control.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark resolved/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('conflict-card-0')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(useStore.getState().openTabs).toEqual([]);
  });

  it('hides a dismissed proposal without touching the resolution', async () => {
    seed(
      docState({
        proposals: { 1: { status: 'error', reason: 'The answer was not valid JSON.' } },
      })
    );
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    const card = screen.getByTestId('conflict-card-1');
    expect(within(card).getByTestId('proposal-error')).toHaveTextContent('not valid JSON');

    await user.click(within(card).getByRole('button', { name: 'Retry' }));
    expect(requestProposal).toHaveBeenCalledWith(TAB, 1);

    await user.click(within(card).getByRole('button', { name: 'Dismiss' }));
    expect(within(card).queryByTestId('proposal-error')).not.toBeInTheDocument();
    expect(useStore.getState().mergeDocs[TAB].proposals[1]).toBeUndefined();
  });

  it('refuses an edited resolution that still has a marker line', async () => {
    seed(docState());
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    const card = screen.getByTestId('conflict-card-1');

    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const box = within(card).getByRole('textbox', { name: 'Resolution for conflict 2' });
    await user.clear(box);
    await user.type(box, '<<<<<<< main');
    expect(within(card).getByRole('alert')).toHaveTextContent('conflict marker');
    expect(within(card).getByRole('button', { name: /Use this text/ })).toBeDisabled();

    await user.clear(box);
    await user.type(box, 'merged by hand');
    await user.click(within(card).getByRole('button', { name: /Use this text/ }));
    expect(within(card).getByTestId('resolution-summary')).toHaveTextContent('Edited by hand');
  });

  it('offers the next conflicted file once this one is resolved', () => {
    seed(docState({ resolved: true }));
    render(<MergeView tabId={TAB} />);
    expect(screen.getByText('config.ts is resolved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next conflicted file/ })).toHaveTextContent(
      'src/other.ts'
    );
  });

  it('asks before resolving a delete/modify conflict by deleting', async () => {
    const file = conflictFile({ kind: 'deleted-by-them', merged: null });
    seed(docState({ file, doc: null }));
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    expect(screen.getByText(/feature\/x \(incoming\) deleted this file/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete it, like feature/x' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete file' }));
    expect(resolveFile).toHaveBeenCalledWith(TAB, 'theirs');
  });

  it('keeps a side of a delete/modify conflict without asking', async () => {
    const file = conflictFile({ kind: 'deleted-by-them', merged: null });
    seed(docState({ file, doc: null }));
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    await user.click(screen.getByRole('button', { name: "Take main's version" }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(resolveFile).toHaveBeenCalledWith(TAB, 'ours');
  });

  it('shows markers it cannot read as raw text to edit by hand', async () => {
    const raw = 'a\n<<<<<<< main\nb\n<<<<<<< main\nc\n';
    seed(docState({ file: conflictFile({ merged: raw }) }));
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    const box = screen.getByRole('textbox', { name: `Contents of ${FILE}` });
    expect(box).toHaveValue(raw);
    expect(screen.getByRole('button', { name: /Mark resolved/ })).toBeDisabled();
    expect(screen.getByTestId('mark-resolved-reason')).toHaveTextContent('2 marker lines left');

    await user.clear(box);
    await user.type(box, 'a b c');
    expect(screen.getByRole('button', { name: /Mark resolved/ })).toBeEnabled();
  });
  it('words a rebase the way git means it: HEAD is the upstream, the incoming side is your commit', () => {
    seed(docState());
    useStore.setState({ mergeStates: { [REPO]: { ...mergeState, operation: 'rebase' } } });
    render(<MergeView tabId={TAB} />);

    expect(screen.getByTestId('operation-headline')).toHaveTextContent(
      'Rebasing: replaying feature/x (your commit) onto main (upstream)'
    );
    const card = screen.getByTestId('conflict-card-1');
    expect(within(card).getByText('main (upstream)')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Take your commit/ })).toBeInTheDocument();
    expect(screen.queryByText(/\(yours\)/)).not.toBeInTheDocument();
  });

  it('points a finished rebase at Continue rebase in Source Control, not at a terminal', async () => {
    seed(docState({ resolved: true }));
    useStore.setState({
      mergeStates: { [REPO]: { ...mergeState, operation: 'rebase', conflicts: [] } },
    });
    const onOpenSourceControl = vi.fn();
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} onOpenSourceControl={onOpenSourceControl} />);

    const hint = screen.getByTestId('finish-hint');
    expect(hint).toHaveTextContent('Continue rebase');
    expect(hint).not.toHaveTextContent(/terminal|git rebase --continue/);
    expect(screen.queryByText(/Commit the merge/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Source Control' }));
    expect(onOpenSourceControl).toHaveBeenCalled();
  });

  it('resolves a symlink conflict by picking a side, like a binary file', async () => {
    const file = conflictFile({ kind: 'symlink', merged: null });
    seed(docState({ file, doc: null }));
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);

    expect(screen.getByText(/Both sides changed where this link points/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take feature/x (incoming)' }));
    expect(resolveFile).toHaveBeenCalledWith(TAB, 'theirs');
  });
  it('never drops focus to body, whether a conflict is settled by key or by click', async () => {
    seed(
      docState({
        proposals: {
          2: { status: 'ready', lines: ['same'], rationale: 'Identical.', confidence: 'high' },
        },
      })
    );
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    const card = (i: number) => screen.getByTestId(`conflict-card-${i}`);
    const notBody = () => expect(document.activeElement).not.toBe(document.body);

    await user.click(within(card(0)).getByRole('button', { name: /Take yours/ }));
    expect(card(1)).toHaveFocus();

    await user.click(within(card(0)).getByRole('button', { name: /Undo/ }));
    expect(card(0)).toHaveFocus();

    await user.click(within(card(1)).getByRole('button', { name: /Both, yours first/ }));
    notBody();
    expect(card(1)).not.toHaveFocus();

    await user.click(within(card(0)).getByRole('button', { name: 'Edit' }));
    await user.keyboard('{Escape}');
    expect(card(0)).toHaveFocus();

    await user.click(within(card(0)).getByRole('button', { name: /Ask agent/ }));
    expect(card(0)).toHaveFocus();

    await user.click(within(card(2)).getByRole('button', { name: 'Dismiss' }));
    expect(card(2)).toHaveFocus();
  });

  it('moves on after Use proposal, like a key would', async () => {
    seed(
      docState({
        proposals: {
          0: { status: 'ready', lines: ['x'], rationale: 'Because.', confidence: 'low' },
        },
      })
    );
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    await user.click(screen.getByRole('button', { name: 'Use proposal' }));
    expect(screen.getByTestId('conflict-card-1')).toHaveFocus();
  });

  it('names its shortcuts for assistive tech and lists them on ?', async () => {
    seed(docState());
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    const card = screen.getByTestId('conflict-card-0');

    const take = within(card).getByRole('button', { name: /Take yours/ });
    expect(take).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');
    expect(take.querySelector('kbd')).toHaveAttribute('aria-hidden', 'true');
    expect(within(card).getByRole('button', { name: 'Swap order' })).toBeInTheDocument();

    await user.keyboard('?');
    const sheet = screen.getByRole('dialog', { name: 'Merge shortcuts' });
    expect(sheet).toHaveTextContent('Take yours');
    expect(sheet).toHaveTextContent('Option Left arrow');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('sums up how the file was resolved once it is done', () => {
    seed(
      docState({
        resolved: true,
        resolutions: { 0: { kind: 'ours' }, 1: { kind: 'theirs' }, 2: { kind: 'ours' } },
        autoReasons: { 0: 'Only your side changed this region.' },
      })
    );
    render(<MergeView tabId={TAB} />);
    expect(screen.getByTestId('resolution-breakdown')).toHaveTextContent(
      '3 resolved: 1 automatic, 1 yours, 1 incoming'
    );
  });
});

describe('MergeView syntax check', () => {
  const broken: ProposalState = {
    status: 'ready',
    lines: ['const x = ("both";'],
    rationale: 'Keeps both names.',
    confidence: 'low',
  };

  beforeEach(() => {
    resolveFile.mockClear();
    useStore.setState({ resolveFile, requestProposal, showToast, openTabs: [] });
  });

  it('says a proposal keeps the file balanced, and what that check covers', () => {
    seed(docState({ proposals: { 1: { ...broken, lines: ['const x = "both";'] } } }));
    render(<MergeView tabId={TAB} />);
    const line = within(screen.getByTestId('conflict-card-1')).getByTestId('proposal-syntax');
    expect(line).toHaveTextContent('Brackets and strings balance');
    expect(line).toHaveTextContent('This checks brackets and strings, not types.');
    expect(line).toHaveAttribute('data-kind', 'ok');
  });

  it('warns when a proposal would break the file, and still lets it be used', async () => {
    seed(docState({ proposals: { 1: broken } }));
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    const card = screen.getByTestId('conflict-card-1');
    const line = within(card).getByTestId('proposal-syntax');
    expect(line).toHaveTextContent('Would break: unbalanced `(` at line 5');
    expect(line).toHaveAttribute('data-kind', 'problem');

    await user.click(within(card).getByRole('button', { name: 'Use proposal' }));
    expect(within(card).getByTestId('resolution-summary')).toBeInTheDocument();
  });

  it('asks for a second press before marking resolved a file that would not parse', async () => {
    seed(
      docState({
        resolutions: {
          0: { kind: 'ours' },
          1: { kind: 'custom', lines: broken.lines, source: 'agent' },
          2: { kind: 'ours' },
        },
      })
    );
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    const toolbar = screen.getByTestId('merge-toolbar');

    await user.click(within(toolbar).getByRole('button', { name: /Mark resolved/ }));
    expect(resolveFile).not.toHaveBeenCalled();
    expect(within(toolbar).getByTestId('mark-resolved-syntax')).toHaveTextContent(
      'Would break: unbalanced `(` at line 5'
    );
    const again = within(toolbar).getByRole('button', { name: /Mark resolved anyway/ });
    expect(document.activeElement).not.toBe(document.body);

    await user.click(again);
    expect(resolveFile).toHaveBeenCalledWith(TAB);
  });

  it('asks again when the file changes after the warning', async () => {
    seed(
      docState({
        resolutions: {
          0: { kind: 'ours' },
          1: { kind: 'custom', lines: broken.lines, source: 'agent' },
          2: { kind: 'ours' },
        },
      })
    );
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(screen.getByTestId('mark-resolved-syntax')).toBeInTheDocument();

    act(() =>
      useStore.setState((s) => ({
        mergeDocs: {
          [TAB]: {
            ...s.mergeDocs[TAB],
            // Conflict 0's sides differ, so the file text really changes.
            resolutions: { ...s.mergeDocs[TAB].resolutions, 0: { kind: 'theirs' } },
          },
        },
      }))
    );
    expect(screen.queryByTestId('mark-resolved-syntax')).not.toBeInTheDocument();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(resolveFile).not.toHaveBeenCalled();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(resolveFile).toHaveBeenCalledWith(TAB);
  });

  it('marks resolved at once when the check cannot read this file even as git stored it', async () => {
    seed(
      docState({
        file: conflictFile({ ours: 'const x = (;\n', theirs: 'const x = 1;\n' }),
        resolutions: {
          0: { kind: 'ours' },
          1: { kind: 'custom', lines: broken.lines, source: 'agent' },
          2: { kind: 'ours' },
        },
      })
    );
    const user = userEvent.setup();
    render(<MergeView tabId={TAB} />);
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(resolveFile).toHaveBeenCalledWith(TAB);
  });
});
