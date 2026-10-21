import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GraphToolbar, type GraphToolbarProps } from './GraphToolbar';

function setup(over: Partial<GraphToolbarProps> = {}) {
  const props: GraphToolbarProps = {
    repos: [{ path: '/work/app', name: 'app' }],
    repoPath: '/work/app',
    onRepoChange: vi.fn(),
    query: '',
    onQueryChange: vi.fn(),
    matchCount: 0,
    matchIndex: -1,
    onStepMatch: vi.fn(),
    searchRef: createRef<HTMLInputElement>(),
    branchFilterLabel: 'All Branches',
    onOpenBranchFilter: vi.fn(),
    onJumpToHead: vi.fn(),
    jumpDisabledReason: undefined,
    inspectorOpen: true,
    onToggleInspector: vi.fn(),
    ...over,
  };
  return { props, ...render(<GraphToolbar {...props} />) };
}

describe('GraphToolbar', () => {
  it('hides the repo picker for a single repository', () => {
    setup();
    expect(screen.queryByRole('combobox', { name: 'Repository' })).toBeNull();
  });

  it('switches repository when there are several', async () => {
    const user = userEvent.setup();
    const { props } = setup({
      repos: [
        { path: '/work/app', name: 'app' },
        { path: '/work/lib', name: 'lib' },
      ],
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Repository' }), '/work/lib');
    expect(props.onRepoChange).toHaveBeenCalledWith('/work/lib');
  });

  it('reports what is typed into the search field', async () => {
    const user = userEvent.setup();
    const { props } = setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search commits' }), 'x');
    expect(props.onQueryChange).toHaveBeenCalledWith('x');
  });

  it('shows the match position and steps through matches with buttons', async () => {
    const user = userEvent.setup();
    const { props } = setup({ query: 'login', matchCount: 12, matchIndex: 2 });
    expect(screen.getByText('3 of 12')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next match' }));
    await user.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(props.onStepMatch).toHaveBeenNthCalledWith(1, 1);
    expect(props.onStepMatch).toHaveBeenNthCalledWith(2, -1);
  });

  it('says when nothing matches', () => {
    setup({ query: 'zzz', matchCount: 0 });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('clears the search with its button', async () => {
    const user = userEvent.setup();
    const { props } = setup({ query: 'abc', matchCount: 1, matchIndex: 0 });
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(props.onQueryChange).toHaveBeenCalledWith('');
  });

  it('is a labelled group, not a toolbar that promises arrow-key navigation', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Graph' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('gives the clear button a comfortable target and marks the filter as a menu', () => {
    setup({ query: 'x', matchCount: 1, matchIndex: 0 });
    expect(screen.getByRole('button', { name: 'Clear search' })).toHaveClass('h-6', 'w-6');
    expect(screen.getByRole('button', { name: /Branches:/ })).toHaveAttribute(
      'aria-haspopup',
      'menu'
    );
  });

  it('opens the branch filter menu from its button', async () => {
    const user = userEvent.setup();
    const { props } = setup({ branchFilterLabel: 'main' });
    await user.click(screen.getByRole('button', { name: /Branches: main/ }));
    expect(props.onOpenBranchFilter).toHaveBeenCalled();
  });

  it('disables Jump to HEAD with the reason when there is no HEAD', () => {
    setup({ jumpDisabledReason: 'This repository has no commits yet.' });
    const button = screen.getByRole('button', { name: 'Jump to HEAD' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'This repository has no commits yet.');
  });

  it('toggles the inspector and reports its state', async () => {
    const user = userEvent.setup();
    const { props } = setup({ inspectorOpen: false });
    const toggle = screen.getByRole('button', { name: 'Inspector' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(props.onToggleInspector).toHaveBeenCalled();
  });
});
