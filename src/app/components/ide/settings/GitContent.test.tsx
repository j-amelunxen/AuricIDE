import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';

const loadIgnoredRepos = vi.fn(async () => [] as string[]);
const saveIgnoredRepos = vi.fn(async () => {});

vi.mock('@/lib/config/projectConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config/projectConfig')>();
  return {
    ...actual,
    loadIgnoredRepos: (...args: unknown[]) => loadIgnoredRepos(...(args as [])),
    saveIgnoredRepos: (...args: unknown[]) => saveIgnoredRepos(...(args as [])),
  };
});

import { GitContent } from './GitContent';

const ROOT = '/work/meta';

beforeEach(() => {
  loadIgnoredRepos.mockReset();
  saveIgnoredRepos.mockReset();
  loadIgnoredRepos.mockResolvedValue([]);
  saveIgnoredRepos.mockResolvedValue(undefined);
  useStore.setState({
    rootPath: ROOT,
    repos: [
      { path: ROOT, relativePath: '', name: 'meta', kind: 'root' },
      { path: `${ROOT}/api`, relativePath: 'api', name: 'api', kind: 'nested' },
    ],
    discoverAndRefreshGit: vi.fn(async () => {}),
    showToast: vi.fn(),
  });
});

describe('GitContent', () => {
  it('asks to open a project when none is open', () => {
    useStore.setState({ rootPath: null });
    render(<GitContent />);

    expect(screen.getByText(/open a project/i)).toBeInTheDocument();
    expect(screen.queryByTestId('ignored-repo-input')).not.toBeInTheDocument();
  });

  it('adds a typed path and rediscovers git', async () => {
    const user = userEvent.setup();
    const discoverAndRefreshGit = vi.fn(async () => {});
    useStore.setState({ discoverAndRefreshGit });
    render(<GitContent />);

    await screen.findByTestId('ignored-repos-empty');
    await user.type(screen.getByTestId('ignored-repo-input'), 'vendor');
    await user.click(screen.getByTestId('ignored-repo-add'));

    expect(saveIgnoredRepos).toHaveBeenCalledWith(ROOT, ['vendor']);
    expect(discoverAndRefreshGit).toHaveBeenCalledWith(ROOT);
    expect(await screen.findByTestId('unignore-repo-vendor')).toBeInTheDocument();
  });

  it('unignores a stored path', async () => {
    const user = userEvent.setup();
    loadIgnoredRepos.mockResolvedValue(['vendor']);
    render(<GitContent />);

    await user.click(await screen.findByTestId('unignore-repo-vendor'));

    expect(saveIgnoredRepos).toHaveBeenCalledWith(ROOT, []);
  });

  it('offers Ignore on a visible nested repo', async () => {
    const user = userEvent.setup();
    render(<GitContent />);

    await user.click(await screen.findByTestId('ignore-visible-repo-api'));

    expect(saveIgnoredRepos).toHaveBeenCalledWith(ROOT, ['api']);
  });
});
