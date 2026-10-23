import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { DependencyReport } from '@/lib/tauri/machine';

const { machineDependencies, copyToClipboard, openDialog } = vi.hoisted(() => ({
  machineDependencies: vi.fn(),
  copyToClipboard: vi.fn(async () => true),
  openDialog: vi.fn(),
}));
vi.mock('@/lib/tauri/machine', () => ({ machineDependencies }));
vi.mock('@/lib/tauri/clipboard', () => ({ copyToClipboard }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: openDialog }));

import { MachineContent } from './MachineContent';

const OKF_FIX = 'go install example.com/okf/cmd/okf@latest';

const report = (patch: Partial<DependencyReport>): DependencyReport => ({
  id: 'ffmpeg',
  label: 'ffmpeg',
  ok: true,
  found: '7.1',
  requirement: 'on PATH',
  detail: 'Found.',
  fix: null,
  features: ['Video import'],
  version: '7.1',
  path: '/opt/homebrew/bin/ffmpeg',
  outsidePath: false,
  ...patch,
});

const okfMissing = report({
  id: 'okf',
  label: 'okf',
  ok: false,
  found: null,
  requirement: 'okf 0.7.0 or newer',
  detail: 'okf was not found.',
  fix: OKF_FIX,
  features: ['Project Manager memory check'],
  version: null,
  path: null,
});

const okfOutsidePath = report({
  id: 'okf',
  label: 'okf',
  found: '0.7.0 (found outside PATH, at /Users/dev/go/bin/okf)',
  version: '0.7.0',
  path: '/Users/dev/go/bin/okf',
  outsidePath: true,
  requirement: 'okf 0.7.0 or newer',
  features: ['Project Manager memory check'],
});

describe('Settings → Machine', () => {
  beforeEach(() => {
    localStorage.clear();
    machineDependencies.mockReset();
    copyToClipboard.mockClear();
    openDialog.mockReset();
    useStore.setState({ toasts: [] });
  });

  it('lists each tool with its state, version and the features that need it', async () => {
    machineDependencies.mockResolvedValue([report({}), okfOutsidePath]);
    render(<MachineContent />);

    const ffmpeg = await screen.findByTestId('machine-dependency-ffmpeg');
    expect(ffmpeg).toHaveAttribute('data-state', 'found');
    expect(ffmpeg).toHaveTextContent('Found');
    expect(ffmpeg).toHaveTextContent('7.1');
    expect(ffmpeg).toHaveTextContent('Needed by Video import');
    expect(machineDependencies).toHaveBeenCalledWith();
  });

  it('shows a missing tool calmly, with the fix command to copy', async () => {
    machineDependencies.mockResolvedValue([okfMissing]);
    render(<MachineContent />);

    const row = await screen.findByTestId('machine-dependency-okf');
    expect(row).toHaveAttribute('data-state', 'missing');
    expect(row).toHaveTextContent('Not installed');
    expect(row).toHaveTextContent(OKF_FIX);
    expect(within(row).queryByRole('alert')).toBeNull();

    await userEvent.click(within(row).getByRole('button', { name: 'Copy command for okf' }));
    expect(copyToClipboard).toHaveBeenCalledWith(OKF_FIX);
    expect(useStore.getState().toasts.at(-1)?.message).toBe('Copied the command for okf');
  });

  it('says where a tool was found when it is not on PATH, and counts it as fine', async () => {
    machineDependencies.mockResolvedValue([okfOutsidePath]);
    render(<MachineContent />);

    const row = await screen.findByTestId('machine-dependency-okf');
    expect(row).toHaveAttribute('data-state', 'outside-path');
    expect(row).toHaveTextContent('Found outside PATH');
    expect(row).toHaveTextContent('0.7.0');
    expect(row).toHaveTextContent('/Users/dev/go/bin/okf');
    expect(within(row).queryByRole('button', { name: /Copy command/ })).toBeNull();
  });

  it('marks a tool that is there but unusable as the one thing needing attention', async () => {
    machineDependencies.mockResolvedValue([
      report({
        id: 'okf',
        label: 'okf',
        ok: false,
        found: '0.5.0',
        version: '0.5.0',
        path: '/usr/local/bin/okf',
        requirement: 'okf 0.7.0 or newer',
        detail: 'This okf is older than the version it is checked against.',
        fix: OKF_FIX,
      }),
    ]);
    render(<MachineContent />);

    const row = await screen.findByTestId('machine-dependency-okf');
    expect(row).toHaveAttribute('data-state', 'problem');
    expect(row).toHaveTextContent('Needs attention');
    expect(row).toHaveTextContent('older than the version it is checked against');
  });

  it('checks everything again with a refresh of the login shell', async () => {
    machineDependencies.mockResolvedValueOnce([okfMissing]);
    render(<MachineContent />);
    await screen.findByTestId('machine-dependency-okf');

    machineDependencies.mockResolvedValueOnce([okfOutsidePath]);
    await userEvent.click(screen.getByRole('button', { name: 'Check Again' }));

    await waitFor(() =>
      expect(screen.getByTestId('machine-dependency-okf')).toHaveAttribute(
        'data-state',
        'outside-path'
      )
    );
    expect(machineDependencies).toHaveBeenLastCalledWith({ refresh: true });
  });

  it('disables Check Again while it checks, and says so', async () => {
    machineDependencies.mockResolvedValueOnce([okfMissing]);
    render(<MachineContent />);
    await screen.findByTestId('machine-dependency-okf');

    let finish: (value: DependencyReport[]) => void = () => undefined;
    machineDependencies.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await userEvent.click(screen.getByRole('button', { name: 'Check Again' }));

    expect(screen.getByRole('button', { name: 'Check Again' })).toBeDisabled();
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    finish([okfMissing]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check Again' })).toBeEnabled());
  });

  it('says it could not check, in one sentence, when there is no answer', async () => {
    machineDependencies.mockRejectedValueOnce(
      new Error('Tauri IPC is unavailable (machine_dependencies)')
    );
    render(<MachineContent />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check this machine.');
    expect(screen.queryByText(/IPC/)).toBeNull();
  });

  it('keeps task tracking off by default and persists toggle and folder changes', async () => {
    const user = userEvent.setup();
    machineDependencies.mockResolvedValue([]);
    render(<MachineContent />);

    const toggle = await screen.findByTestId('task-log-enabled-toggle');
    const dirInput = screen.getByTestId('task-log-dir-input');

    expect(toggle).not.toBeChecked();
    expect(dirInput).toHaveValue('');

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(localStorage.getItem('auric.task-log.enabled')).toBe('true');

    await user.type(dirInput, '/Users/dev/billing');
    expect(localStorage.getItem('auric.task-log.dir')).toBe('/Users/dev/billing');

    openDialog.mockResolvedValueOnce('/Users/dev/chosen-logs');
    await user.click(screen.getByTestId('task-log-dir-browse'));
    expect(openDialog).toHaveBeenCalledWith(expect.objectContaining({ directory: true }));
    expect(dirInput).toHaveValue('/Users/dev/chosen-logs');
    expect(localStorage.getItem('auric.task-log.dir')).toBe('/Users/dev/chosen-logs');

    await user.click(screen.getByTestId('task-log-dir-clear'));
    expect(dirInput).toHaveValue('');
    expect(localStorage.getItem('auric.task-log.dir')).toBe('');
  });
});
