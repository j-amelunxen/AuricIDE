import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CompareView } from './CompareView';
import type { GitBranch, GitNameStatus } from '@/lib/tauri/git';

const branches: GitBranch[] = [
  { name: 'main', kind: 'local', isCurrent: true },
  { name: 'feature', kind: 'local', isCurrent: false },
  { name: 'origin/main', kind: 'remote', isCurrent: false },
];

const files: GitNameStatus[] = [
  { path: 'src/a.ts', status: 'modified' },
  { path: 'src/b.ts', status: 'added' },
];

describe('CompareView', () => {
  it('lists local and remote branches in optgroups', () => {
    render(<CompareView branches={branches} compareRef={null} files={[]} />);

    const select = screen.getByTestId('compare-ref-select');
    expect(within(select).getByRole('group', { name: 'Local' })).toBeInTheDocument();
    expect(within(select).getByRole('group', { name: 'Remote' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'main' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'origin/main' })).toBeInTheDocument();
  });

  it('starts with no branch selected', () => {
    render(<CompareView branches={branches} compareRef={null} files={[]} />);

    expect(screen.getByTestId('compare-ref-select')).toHaveValue('');
  });

  it('allows picking the current branch', async () => {
    const user = userEvent.setup();
    const onRefChange = vi.fn();
    render(
      <CompareView branches={branches} compareRef={null} files={[]} onRefChange={onRefChange} />
    );

    await user.selectOptions(screen.getByTestId('compare-ref-select'), 'main');
    expect(onRefChange).toHaveBeenCalledWith('main');
  });

  it('lists compare files and reports a click', async () => {
    const user = userEvent.setup();
    const onFileClick = vi.fn();
    render(
      <CompareView
        branches={branches}
        compareRef="feature"
        files={files}
        onFileClick={onFileClick}
      />
    );

    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('src/b.ts')).toBeInTheDocument();

    await user.click(screen.getByText('src/a.ts'));
    expect(onFileClick).toHaveBeenCalledWith('src/a.ts');
  });
});
