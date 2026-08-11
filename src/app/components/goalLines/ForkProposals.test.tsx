import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useStore } from '@/lib/store';
import type { PmGoal } from '@/lib/tauri/goals';
import type { CommitInfo } from '@/lib/tauri/git';
import { ForkProposals } from './ForkProposals';

const mockGitLogSince = vi.fn<(...a: unknown[]) => Promise<CommitInfo[]>>(async () => []);
vi.mock('@/lib/tauri/git', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  gitLogSince: (repoPath: string, sinceIso?: string, pathPrefix?: string) =>
    mockGitLogSince(repoPath, sinceIso, pathPrefix),
}));

const mockDbGet = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => null);
const mockDbSet = vi.fn(
  async (_projectPath: string, _namespace: string, _key: string, _value: string) => {}
);
vi.mock('@/lib/tauri/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  dbGet: (projectPath: string, namespace: string, key: string) =>
    mockDbGet(projectPath, namespace, key),
  dbSet: (projectPath: string, namespace: string, key: string, value: string) =>
    mockDbSet(projectPath, namespace, key, value),
}));

const TS = '2026-01-10 10:00:00';

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: crypto.randomUUID(),
    parentId: null,
    name: 'Ship search',
    description: '',
    successCriteria: 'done',
    status: 'active',
    priority: 'normal',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function makeCommit(touched: string[], summary: string): CommitInfo {
  return { oid: crypto.randomUUID(), summary, author: 'dev', timestamp: TS, touched };
}

const CLUSTER = [
  makeCommit(['src/indexer/build.ts'], 'c1'),
  makeCommit(['src/indexer/build.ts'], 'c2'),
  makeCommit(['src/indexer/query.ts'], 'c3'),
];

describe('ForkProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbGet.mockResolvedValue(null);
    useStore.setState({
      rootPath: '/tmp/demo-project',
      goalsDraft: [makeGoal()],
      goalStationsDraft: [],
      saveGoals: vi.fn(async () => {}),
    });
  });

  it('proposes a cluster of unclaimed commits', async () => {
    mockGitLogSince.mockResolvedValueOnce(CLUSTER);
    render(<ForkProposals />);
    await waitFor(() => expect(screen.getByTestId('fork-proposal-src/indexer/')).toBeTruthy());
    expect(screen.getByTestId('fork-proposal-src/indexer/').textContent).toContain('3 commits');
  });

  it('claiming creates a station with a git_touches predicate and persists', async () => {
    mockGitLogSince.mockResolvedValueOnce(CLUSTER);
    render(<ForkProposals />);
    await waitFor(() => expect(screen.getByTestId('fork-claim-src/indexer/')).toBeTruthy());
    fireEvent.click(screen.getByTestId('fork-claim-src/indexer/'));

    const station = useStore.getState().goalStationsDraft[0];
    expect(station.predicate).toMatchObject({ type: 'git_touches', pathPrefix: 'src/indexer/' });
    expect(useStore.getState().saveGoals).toHaveBeenCalled();
  });

  it('dismissing hides the proposal and records the prefix', async () => {
    mockGitLogSince.mockResolvedValueOnce(CLUSTER);
    render(<ForkProposals />);
    await waitFor(() => expect(screen.getByTestId('fork-dismiss-src/indexer/')).toBeTruthy());
    fireEvent.click(screen.getByTestId('fork-dismiss-src/indexer/'));

    expect(screen.queryByTestId('fork-proposal-src/indexer/')).toBeNull();
    expect(mockDbSet).toHaveBeenCalledWith(
      '/tmp/demo-project',
      'goal_line_fork_dismissals',
      '_global',
      JSON.stringify(['src/indexer/'])
    );
  });

  it('a previously dismissed prefix never nags again', async () => {
    mockDbGet.mockResolvedValueOnce(JSON.stringify(['src/indexer/']));
    mockGitLogSince.mockResolvedValueOnce(CLUSTER);
    render(<ForkProposals />);
    await waitFor(() => expect(mockGitLogSince).toHaveBeenCalled());
    expect(screen.queryByTestId('fork-proposal-src/indexer/')).toBeNull();
  });
});
