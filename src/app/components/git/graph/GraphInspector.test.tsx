import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { graphDetailKey } from '@/lib/store/gitGraphSlice';
import type { CommitDetail } from '@/lib/tauri/gitGraph';
import { GraphInspector } from './GraphInspector';
import { makeCommit, makeRef } from './testGraph';

const REPO = '/work/app';
const OID = 'a'.repeat(40);

const detail = (over: Partial<CommitDetail> = {}): CommitDetail => ({
  oid: OID,
  parents: ['p1'],
  message: 'Fix login\n\nThe token was read before the session existed.',
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  authorTime: 1_760_000_000,
  committerName: 'Ada Lovelace',
  committerEmail: 'ada@example.com',
  committerTime: 1_760_000_000,
  files: [
    { path: 'src/login.ts', status: 'modified' },
    { path: 'README.md', status: 'added' },
  ],
  ...over,
});

function seed(d?: CommitDetail, parentIndex = 0) {
  useStore.setState({
    graphs: {
      [REPO]: {
        details: d ? { [graphDetailKey(OID, parentIndex)]: d } : {},
      },
    },
    loadGraphDetail: vi.fn(async () => null),
  } as never);
}

function setup(over: Partial<React.ComponentProps<typeof GraphInspector>> = {}) {
  const props: React.ComponentProps<typeof GraphInspector> = {
    repoPath: REPO,
    commit: makeCommit(0, ['p1'], { oid: OID, summary: 'Fix login' }),
    refs: [makeRef('main', 'local', OID, true)],
    laneColor: '#3ec97f',
    parentSummary: () => 'Earlier work',
    onSelectParent: vi.fn(),
    onFileClick: vi.fn(),
    onCopySha: vi.fn(),
    onOpenMenu: vi.fn(),
    onRefMenu: vi.fn(),
    ...over,
  };
  return { props, ...render(<GraphInspector {...props} />) };
}

describe('GraphInspector', () => {
  beforeEach(() => seed(detail()));

  it('shows the full message, the sha and the refs', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Fix login' })).toBeInTheDocument();
    expect(screen.getByText(/The token was read before/)).toBeInTheDocument();
    const sha = screen.getByText(OID.slice(0, 7));
    expect(sha).toHaveAttribute('title', OID);
    expect(sha).toHaveClass('select-text');
    expect(screen.getByRole('button', { name: 'Actions for main' })).toBeInTheDocument();
  });

  it('copies the sha', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'Copy SHA' }));
    expect(props.onCopySha).toHaveBeenCalledWith(OID);
  });

  it('offers the commit menu as a button, not only on right-click', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(props.onOpenMenu).toHaveBeenCalledWith(
      expect.objectContaining({ x: expect.any(Number) })
    );
  });

  it('leaves out the committer when it is the author', () => {
    setup();
    expect(screen.queryByText(/Committer/)).toBeNull();
  });

  it('shows the committer when it is somebody else', () => {
    seed(detail({ committerName: 'Grace Hopper', committerEmail: 'grace@example.com' }));
    setup();
    expect(screen.getByText(/Committer/)).toBeInTheDocument();
    expect(screen.getByText(/Grace Hopper/)).toBeInTheDocument();
  });

  it('lists parents as buttons that select them', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.click(screen.getByRole('button', { name: /Parent p1/ }));
    expect(props.onSelectParent).toHaveBeenCalledWith('p1');
  });

  it('opens a changed file at the chosen parent', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    const files = screen.getByRole('list', { name: 'Changed files' });
    expect(within(files).getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /login\.ts/ }));
    expect(props.onFileClick).toHaveBeenCalledWith('src/login.ts', 0);
  });

  it('says what each status letter means', () => {
    setup();
    expect(screen.getByText('Added')).toHaveClass('sr-only');
    expect(screen.getByText('Modified')).toHaveClass('sr-only');
    expect(screen.getByText('A')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows what it has while the detail loads, then fills in when it arrives', () => {
    seed(undefined);
    setup();
    expect(screen.getByRole('heading', { name: 'Fix login' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Changed files' })).toBeNull();
    act(() => {
      useStore.setState({
        graphs: { [REPO]: { details: { [graphDetailKey(OID, 0)]: detail() } } },
      } as never);
    });
    expect(screen.getByRole('list', { name: 'Changed files' })).toBeInTheDocument();
  });

  it('asks for the detail of the commit it shows', () => {
    seed(undefined);
    setup();
    expect(useStore.getState().loadGraphDetail).toHaveBeenCalledWith(REPO, OID, 0);
  });

  it('lets a merge commit pick which parent the files are compared with', async () => {
    const user = userEvent.setup();
    seed(detail({ parents: ['p1', 'p2'] }));
    const second = detail({
      parents: ['p1', 'p2'],
      files: [{ path: 'only-vs-p2.ts', status: 'added' }],
    });
    useStore.setState({
      graphs: {
        [REPO]: {
          details: {
            [graphDetailKey(OID, 0)]: detail({ parents: ['p1', 'p2'] }),
            [graphDetailKey(OID, 1)]: second,
          },
        },
      },
    } as never);
    const { props } = setup({
      commit: makeCommit(0, ['p1', 'p2'], { oid: OID, summary: 'Merge' }),
    });
    const group = screen.getByRole('radiogroup', { name: 'Compare with' });
    expect(within(group).getByRole('radio', { name: 'First Parent' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Second Parent' }));
    expect(useStore.getState().loadGraphDetail).toHaveBeenLastCalledWith(REPO, OID, 1);
    await user.click(screen.getByRole('button', { name: /only-vs-p2\.ts/ }));
    expect(props.onFileClick).toHaveBeenCalledWith('only-vs-p2.ts', 1);
  });

  it('has no parent picker for an ordinary commit', () => {
    setup();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('marks its menu buttons as opening menus and tints pills with the lane colour', () => {
    setup();
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveAttribute(
      'aria-haspopup',
      'menu'
    );
    const refButton = screen.getByRole('button', { name: 'Actions for main' });
    expect(refButton).toHaveAttribute('aria-haspopup', 'menu');
    expect(
      refButton.querySelector('[style*="3ec97f"]') ?? refButton.firstElementChild
    ).toBeTruthy();
    expect(refButton.innerHTML).toMatch(/3ec97f|62, 201, 127/i);
  });

  it('offers to try again when the detail could not be read', async () => {
    const user = userEvent.setup();
    seed(undefined);
    setup();
    await user.click(await screen.findByRole('button', { name: 'Try Again' }));
    expect(useStore.getState().loadGraphDetail).toHaveBeenCalledTimes(2);
  });

  it('says when the detail cannot be read', async () => {
    seed(undefined);
    setup();
    expect(await screen.findByText('Could not read this commit.')).toBeInTheDocument();
  });
});
