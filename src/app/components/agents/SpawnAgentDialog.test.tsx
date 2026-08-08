import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByText('New Agent')).toBeInTheDocument();
  });

  it('exposes an accessible dialog', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /new agent/i })).toBeInTheDocument();
  });

  it('renders repo path input, task textarea, model select', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByLabelText(/working directory/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/instruction/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
  });

  it('renders a dropdown chevron affordance next to the model select', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    const modelSelect = screen.getByLabelText(/model/i);
    const chevron = modelSelect.parentElement?.querySelector('[aria-hidden="true"]');
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveTextContent('expand_more');
  });

  it('deploy button is enabled even when task is empty', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByRole('button', { name: /start agent/i })).toBeEnabled();
  });

  it('deploy button is enabled when task has content', async () => {
    const user = userEvent.setup();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    expect(screen.getByRole('button', { name: /start agent/i })).toBeEnabled();
  });

  it('deploys with a "wait" task when the instruction is left empty', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ task: 'wait' }));
  });

  it('deploys with a "wait" task when the instruction is only whitespace', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);
    await user.type(screen.getByLabelText(/instruction/i), '   ');
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ task: 'wait' }));
  });

  it('calls onSpawn with correct config on deploy', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

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
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose after successful deploy', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={onClose} onSpawn={vi.fn()} />);
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders all model options', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByText('Auto / Default')).toBeInTheDocument();
    expect(screen.getByText('Moonshot Kimi k2 Thinking')).toBeInTheDocument();
  });

  it('names the agent after the instruction, not after the repo', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    await user.type(screen.getByLabelText(/instruction/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    // Naming every agent after its repo made a fleet of five unreadable.
    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fix bugs' }));
  });

  it('falls back to the repo folder when deployed without an instruction', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ name: 'Agent (repo)' }));
  });

  it('falls back to a plain name without repo or instruction', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ name: 'Agent' }));
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
    await user.click(screen.getByRole('button', { name: /start agent/i }));

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
    await user.click(screen.getByRole('button', { name: /start agent/i }));

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
    await user.click(screen.getByRole('button', { name: /start agent/i }));

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
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/projects/beta',
        name: 'Fix bugs',
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

describe('SpawnAgentDialog keyboard and prompt recall', () => {
  function open(overrides: Record<string, unknown> = {}) {
    const onSpawn = vi.fn();
    const onClose = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={onClose} onSpawn={onSpawn} {...overrides} />);
    return { onSpawn, onClose, task: screen.getByLabelText(/instruction/i) };
  }

  it('puts the cursor in the instruction field on open', () => {
    const { task } = open();
    expect(task).toHaveFocus();
  });

  it('places the caret after prefilled text so it can be extended', () => {
    const { task } = open({ initialTask: 'Fix the parser' });
    expect((task as HTMLTextAreaElement).selectionStart).toBe('Fix the parser'.length);
  });

  it('starts the agent on Cmd+Enter', async () => {
    const user = userEvent.setup();
    const { onSpawn, task } = open();
    await user.type(task, 'ship it');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ task: 'ship it' }));
  });

  it('starts the agent on Ctrl+Enter', async () => {
    const user = userEvent.setup();
    const { onSpawn, task } = open();
    await user.type(task, 'ship it');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ task: 'ship it' }));
  });

  it('leaves a plain Enter to insert a newline', async () => {
    const user = userEvent.setup();
    const { onSpawn, task } = open();
    await user.type(task, 'line one{Enter}line two');
    expect(onSpawn).not.toHaveBeenCalled();
    expect(task).toHaveValue('line one\nline two');
  });

  it('hints at prompt recall only when history exists', () => {
    const { unmount } = render(
      <SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />
    );
    expect(screen.queryByTestId('prompt-history-hint')).not.toBeInTheDocument();
    unmount();

    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        promptHistory={['previous prompt']}
      />
    );
    expect(screen.getByTestId('prompt-history-hint')).toBeInTheDocument();
  });

  it('recalls the previous prompt with ArrowUp in an empty field', async () => {
    const user = userEvent.setup();
    const { task } = open({ promptHistory: ['newest prompt', 'older prompt'] });
    await user.type(task, '{ArrowUp}');
    expect(task).toHaveValue('newest prompt');
  });

  it('walks further back through history with repeated ArrowUp', async () => {
    const user = userEvent.setup();
    const { task } = open({ promptHistory: ['newest prompt', 'older prompt'] });
    await user.type(task, '{ArrowUp}{ArrowUp}');
    expect(task).toHaveValue('older prompt');
  });

  it('stops at the oldest prompt', async () => {
    const user = userEvent.setup();
    const { task } = open({ promptHistory: ['newest prompt', 'older prompt'] });
    await user.type(task, '{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(task).toHaveValue('older prompt');
  });

  it('walks forward again with ArrowDown and back to an empty field', async () => {
    const user = userEvent.setup();
    const { task } = open({ promptHistory: ['newest prompt', 'older prompt'] });
    await user.type(task, '{ArrowUp}{ArrowUp}{ArrowDown}');
    expect(task).toHaveValue('newest prompt');
    await user.type(task, '{ArrowDown}');
    expect(task).toHaveValue('');
  });

  it('does not hijack ArrowUp while text is being edited', async () => {
    const user = userEvent.setup();
    const { task } = open({ promptHistory: ['newest prompt'] });
    await user.type(task, 'my own text{ArrowUp}');
    expect(task).toHaveValue('my own text');
  });

  it('leaves history navigation once the recalled prompt is edited', async () => {
    const user = userEvent.setup();
    const { task } = open({ promptHistory: ['newest prompt', 'older prompt'] });
    await user.type(task, '{ArrowUp}');
    await user.type(task, '!');
    await user.type(task, '{ArrowUp}');
    expect(task).toHaveValue('newest prompt!');
  });

  it('does nothing on ArrowUp without any history', async () => {
    const user = userEvent.setup();
    const { task } = open();
    await user.type(task, '{ArrowUp}');
    expect(task).toHaveValue('');
  });
});
