import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SpawnAgentDialog } from './SpawnAgentDialog';
import type { ProviderInfo } from '@/lib/tauri/providers';

// Suppress InfoTooltip from rendering buttons inside <label> elements, which
// causes Testing Library's getByLabelText to find multiple associated elements.
vi.mock('@/app/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

const mockListProviders = vi.fn<() => Promise<ProviderInfo[]>>();

vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    listProviders: (...args: unknown[]) => mockListProviders(...(args as [])),
  };
});

// Default: reject so only FALLBACK_CRUSH_PROVIDER is used
beforeEach(() => {
  mockListProviders.mockRejectedValue(new Error('browser mode'));
});

// Helpers matching the FALLBACK_CRUSH_PROVIDER constants
const DEFAULT_MODEL = 'auto';
const DEFAULT_PROVIDER = 'crush';
const DEFAULT_PERMISSION_MODE = 'default';

describe('SpawnAgentDialog', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SpawnAgentDialog isOpen={false} onClose={vi.fn()} onSpawn={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when isOpen is true', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByText('Deploy New Agent')).toBeInTheDocument();
  });

  it('renders repo path input, task textarea, model select', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByLabelText(/working directory/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/instruction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/intelligence model/i)).toBeInTheDocument();
  });

  it('deploy button is disabled when task is empty', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByRole('button', { name: /initialize/i })).toBeDisabled();
  });

  it('deploy button is enabled when task has content', async () => {
    const user = userEvent.setup();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    expect(screen.getByRole('button', { name: /initialize/i })).toBeEnabled();
  });

  it('calls onSpawn with correct config on deploy', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /initialize/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'Fix bugs',
        cwd: '/my/repo',
        model: DEFAULT_MODEL,
        provider: DEFAULT_PROVIDER,
      })
    );
  });

  it('calls onClose on cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={onClose} onSpawn={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /discard/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose after successful deploy', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={onClose} onSpawn={vi.fn()} />);
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /initialize/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders all model options', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByText('Auto / Default')).toBeInTheDocument();
    expect(screen.getByText('Moonshot Kimi k2 Thinking')).toBeInTheDocument();
  });

  it('auto-generates agent name from repo path folder', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /initialize/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Agent (repo)',
      })
    );
  });

  it('uses "Agent" as name when no repo path', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /initialize/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Agent',
      })
    );
  });

  // ── Permission Mode ──────────────────────────────────────────────

  it('renders permission mode selector', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByLabelText(/permission mode/i)).toBeInTheDocument();
  });

  it('defaults to the provider default permission mode', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    const select = screen.getByLabelText(/permission mode/i) as HTMLSelectElement;
    expect(select.value).toBe(DEFAULT_PERMISSION_MODE);
  });

  it('passes permissionMode in config on deploy', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /initialize/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionMode: DEFAULT_PERMISSION_MODE,
      })
    );
  });

  it('can switch to yolo mode', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'yolo');
    await user.type(screen.getByLabelText(/instruction/i), 'Refactor auth');
    await user.click(screen.getByRole('button', { name: /initialize/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionMode: 'yolo',
      })
    );
  });

  it('can switch to interactive mode', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'default');
    await user.type(screen.getByLabelText(/instruction/i), 'Update styles');
    await user.click(screen.getByRole('button', { name: /initialize/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionMode: 'default',
      })
    );
  });

  it('renders all permission mode options', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByText(/yolo/i)).toBeInTheDocument();
    expect(screen.getByText(/interactive/i)).toBeInTheDocument();
  });

  // ── Recent Directories ────────────────────────────────────────────

  it('shows recent directories dropdown when recentPaths provided', () => {
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        recentPaths={['/projects/alpha', '/projects/beta']}
      />
    );
    const select = screen.getByTestId('recent-dirs');
    expect(select).toBeInTheDocument();
  });

  it('does not show recent directories dropdown when list is empty', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} recentPaths={[]} />);
    expect(screen.queryByTestId('recent-dirs')).not.toBeInTheDocument();
  });

  it('sets repo path when selecting a recent directory', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={onSpawn}
        recentPaths={['/projects/alpha', '/projects/beta']}
      />
    );

    await user.selectOptions(screen.getByTestId('recent-dirs'), '/projects/beta');
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /initialize/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/projects/beta',
        name: 'Agent (beta)',
      })
    );
  });

  // ── Provider dropdown ─────────────────────────────────────────────

  it('shows provider dropdown with multiple providers', async () => {
    const fakeProviders: ProviderInfo[] = [
      {
        id: 'claude',
        name: 'Claude Code',
        models: [{ value: 'sonnet', label: 'Sonnet' }],
        permissionModes: [{ value: 'default', label: 'Interactive', description: '' }],
        defaultModel: 'sonnet',
        defaultPermissionMode: 'default',
      },
      {
        id: 'gemini',
        name: 'Gemini CLI',
        models: [{ value: 'flash', label: 'Flash' }],
        permissionModes: [{ value: 'default', label: 'Interactive', description: '' }],
        defaultModel: 'flash',
        defaultPermissionMode: 'default',
      },
    ];
    mockListProviders.mockResolvedValueOnce(fakeProviders);

    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/provider/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Gemini CLI')).toBeInTheDocument();
  });
});
