import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpawnAgentDialog } from './SpawnAgentDialog';
import type { GitRepoRef } from '@/lib/tauri/git';
import type { ProviderInfo } from '@/lib/tauri/providers';
import type { PmGoal } from '@/lib/tauri/goals';
import { useStore } from '@/lib/store';

// Suppress InfoTooltip from rendering buttons inside <label> elements, which
// causes Testing Library's getByLabelText to find multiple associated elements.
vi.mock('@/app/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

const mockListProviders = vi.fn<() => Promise<ProviderInfo[]>>();
const mockProviderPolicy = vi.fn();

vi.mock('@/lib/config/projectConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/config/projectConfig')>();
  return {
    ...actual,
    loadProviderPolicy: (...args: unknown[]) => mockProviderPolicy(...(args as [])),
  };
});

vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    listProviders: (...args: unknown[]) => mockListProviders(...(args as [])),
  };
});

const mockDiscoverGitRepos = vi.fn<(rootPath: string) => Promise<GitRepoRef[]>>();

vi.mock('@/lib/tauri/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/git')>();
  return {
    ...actual,
    discoverGitRepos: (rootPath: string) => mockDiscoverGitRepos(rootPath),
  };
});

function cwdAsRootRepo(rootPath: string): GitRepoRef[] {
  const normalized = rootPath.replace(/\/$/, '');
  return [
    {
      path: normalized,
      relativePath: '',
      name: normalized.split('/').pop() || 'repo',
      kind: 'root',
    },
  ];
}

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

let dragDropHandler: ((event: { payload: DragDropPayload }) => void) | null = null;
type DragDropPayload =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async (handler: (event: { payload: DragDropPayload }) => void) => {
      dragDropHandler = handler;
      return vi.fn();
    }),
  }),
}));

type User = ReturnType<typeof userEvent.setup>;

/** Answers the first-use YOLO elevate question. */
async function answerYoloElevate(user: User, button: string) {
  const dialog = await screen.findByRole('dialog', { name: /act without asking/i });
  await user.click(within(dialog).getByRole('button', { name: button }));
}

// Default: reject so only FALLBACK_CRUSH_PROVIDER is used
beforeEach(() => {
  mockListProviders.mockRejectedValue(new Error('browser mode'));
  mockProviderPolicy.mockResolvedValue({ allow: null, deny: [] });
  mockDiscoverGitRepos.mockImplementation(async (rootPath) => cwdAsRootRepo(rootPath));
  mockInvoke.mockReset();
  dragDropHandler = null;
  localStorage.clear();
  sessionStorage.clear();
  useStore.setState({ overlayStack: { layers: [] } });
});

// Helpers matching the FALLBACK_CRUSH_PROVIDER constants
const DEFAULT_MODEL = 'auto';
const DEFAULT_PROVIDER = 'crush';
const DEFAULT_PERMISSION_MODE = 'default';

describe('SpawnAgentDialog – remembered launch choices', () => {
  it('starts from the previous launch instead of factory defaults', async () => {
    localStorage.setItem(
      'auric.agent-spawn-defaults',
      JSON.stringify({
        providerId: DEFAULT_PROVIDER,
        model: 'moonshotai/kimi-k2-thinking',
        permissionMode: 'yolo',
        headless: true,
      })
    );
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/model/i)).toHaveValue('moonshotai/kimi-k2-thinking');
    });
    expect(screen.getByLabelText(/permission mode/i)).toHaveValue('yolo');
    expect(screen.getByLabelText(/headless mode/i)).toBeChecked();
  });

  it('falls back to the provider default when the saved model vanished', async () => {
    // A renamed or retired model must not resurrect from storage.
    localStorage.setItem(
      'auric.agent-spawn-defaults',
      JSON.stringify({
        providerId: DEFAULT_PROVIDER,
        model: 'no-longer-offered',
        permissionMode: 'yolo',
        headless: false,
      })
    );
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/permission mode/i)).toHaveValue('yolo');
    });
    expect(screen.getByLabelText(/model/i)).toHaveValue(DEFAULT_MODEL);
  });

  it('remembers the choices made on launch', async () => {
    const user = userEvent.setup();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'yolo');
    await user.type(screen.getByLabelText(/what should it do/i), 'Do the thing');
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    await answerYoloElevate(user, 'Continue');

    const saved = JSON.parse(localStorage.getItem('auric.agent-spawn-defaults')!);
    expect(saved.permissionMode).toBe('yolo');
    expect(saved.providerId).toBe(DEFAULT_PROVIDER);
  });

  it('loads and saves remembered choices for the target working directory', async () => {
    localStorage.setItem(
      'auric.agent-spawn-defaults',
      JSON.stringify({
        version: 1,
        byWorkingDirectory: {
          '/work/frontend': {
            providerId: DEFAULT_PROVIDER,
            model: 'moonshotai/kimi-k2-thinking',
            permissionMode: 'yolo',
            headless: true,
          },
        },
      })
    );
    const user = userEvent.setup();
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        initialRepoPath="/work/frontend"
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/model/i)).toHaveValue('moonshotai/kimi-k2-thinking');
    });
    expect(screen.getByLabelText(/permission mode/i)).toHaveValue('yolo');

    await user.type(screen.getByLabelText(/what should it do/i), 'Do the thing');
    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'default');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    const saved = JSON.parse(localStorage.getItem('auric.agent-spawn-defaults')!);
    expect(saved.byWorkingDirectory['/work/frontend'].providerId).toBe(DEFAULT_PROVIDER);
  });
});

describe('SpawnAgentDialog – launch presets', () => {
  const rememberCrushYolo = () =>
    localStorage.setItem(
      'auric.agent-spawn-defaults',
      JSON.stringify({
        providerId: DEFAULT_PROVIDER,
        model: 'moonshotai/kimi-k2-thinking',
        permissionMode: 'yolo',
        headless: false,
      })
    );

  it('applies the preset over the remembered choices', async () => {
    rememberCrushYolo();
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        presetDefaults={{ providerId: DEFAULT_PROVIDER, model: DEFAULT_MODEL }}
      />
    );

    await waitFor(() => expect(screen.getByLabelText(/model/i)).toHaveValue(DEFAULT_MODEL));
  });

  it('keeps the remembered choices for what the preset leaves open', async () => {
    rememberCrushYolo();
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        presetDefaults={{ providerId: DEFAULT_PROVIDER }}
      />
    );

    await waitFor(() => expect(screen.getByLabelText(/permission mode/i)).toHaveValue('yolo'));
    expect(screen.getByLabelText(/model/i)).toHaveValue('moonshotai/kimi-k2-thinking');
  });

  it('degrades to the provider default when the preset names a retired model', async () => {
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        presetDefaults={{ providerId: DEFAULT_PROVIDER, model: 'no-longer-offered' }}
      />
    );

    await waitFor(() => expect(screen.getByLabelText(/model/i)).toHaveValue(DEFAULT_MODEL));
  });

  it('degrades to clean defaults when the preset names an unknown provider', async () => {
    rememberCrushYolo();
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        presetDefaults={{ providerId: 'retired-provider', model: 'whatever' }}
      />
    );

    await waitFor(() => expect(screen.getByLabelText(/model/i)).toHaveValue(DEFAULT_MODEL));
    expect(screen.getByLabelText(/permission mode/i)).toHaveValue(DEFAULT_PERMISSION_MODE);
  });

  // A project's opinion about one recurring task must not become the baseline
  // for every hand-written launch everywhere.
  it('does not rewrite the remembered defaults when launching from a preset', async () => {
    const user = userEvent.setup();
    rememberCrushYolo();
    const before = localStorage.getItem('auric.agent-spawn-defaults');
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        presetDefaults={{ providerId: DEFAULT_PROVIDER, model: DEFAULT_MODEL }}
      />
    );

    await user.type(screen.getByLabelText(/what should it do/i), 'Write the post');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(localStorage.getItem('auric.agent-spawn-defaults')).toBe(before);
  });
});

describe('SpawnAgentDialog', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SpawnAgentDialog isOpen={false} onClose={vi.fn()} onSpawn={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog when isOpen is true', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByText('Start agent')).toBeInTheDocument();
  });

  it('exposes an accessible dialog', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /start agent/i })).toBeInTheDocument();
  });

  it('renders repo path input, task textarea, model select', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByLabelText(/working directory/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what should it do/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
  });

  it('renders a dropdown chevron affordance next to the model select', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    const modelSelect = screen.getByLabelText(/model/i);
    // The select is `appearance-none`, so the chevron is the only thing saying
    // "this opens". It has to sit in the select's own wrapper, be the downward
    // chevron, actually draw (a missing glyph renders an empty box), and stay
    // decorative — the select already carries the accessible name.
    const chevron = modelSelect.parentElement?.querySelector('[data-icon="expand_more"]');
    expect(chevron).not.toBeNull();
    expect(chevron!.querySelector('path, line, circle, rect')).not.toBeNull();
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
  });

  it('disables Start Agent when the instruction is empty', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByRole('button', { name: /start agent/i })).toBeDisabled();
  });

  it('disables Start Agent when the instruction is only whitespace', async () => {
    const user = userEvent.setup();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    await user.type(screen.getByLabelText(/what should it do/i), '   ');
    expect(screen.getByRole('button', { name: /start agent/i })).toBeDisabled();
  });

  it('enables Start Agent after typing an instruction', async () => {
    const user = userEvent.setup();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByRole('button', { name: /start agent/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
    expect(screen.getByRole('button', { name: /start agent/i })).toBeEnabled();
  });

  it('refuses to spawn when Start Agent is clicked with an empty instruction', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('spawns with the trimmed instruction, never a wait fallback', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/what should it do/i), '  Fix bugs  ');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledTimes(1);
    expect(onSpawn.mock.calls[0][0].task).toBe('Fix bugs');
    expect(onSpawn.mock.calls[0][0].task).not.toBe('wait');
  });

  it('calls onSpawn with correct config on deploy', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'Fix bugs',
        cwd: '/my/repo',
        model: DEFAULT_MODEL,
        provider: DEFAULT_PROVIDER,
      })
    );
    expect(onSpawn.mock.calls[0][0].useWorktree).toBeUndefined();
  });

  it('passes useWorktree when the new git worktree box is checked', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
    await user.click(screen.getByLabelText(/new git worktree/i));
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ useWorktree: true }));
  });

  it('disables the worktree checkbox until a working directory is set', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByLabelText(/new git worktree/i)).toBeDisabled();
  });

  it('asks which repo to check out when the working directory is not itself a git repo', async () => {
    mockDiscoverGitRepos.mockResolvedValue([
      { path: '/ws/api', relativePath: 'api', name: 'api', kind: 'nested' },
      { path: '/ws/web', relativePath: 'web', name: 'web', kind: 'submodule' },
    ]);
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/ws');
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
    await user.click(screen.getByLabelText(/new git worktree/i));

    const picker = await screen.findByLabelText(/git repository/i);
    expect(picker).toBeInTheDocument();
    await user.selectOptions(picker, '/ws/api');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        useWorktree: true,
        cwd: '/ws',
        worktreeRepoPath: '/ws/api',
      })
    );
  });

  it('does not spawn a worktree until a nested repo is chosen', async () => {
    mockDiscoverGitRepos.mockResolvedValue([
      { path: '/ws/api', relativePath: 'api', name: 'api', kind: 'nested' },
      { path: '/ws/web', relativePath: 'web', name: 'web', kind: 'nested' },
    ]);
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/ws');
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
    await user.click(screen.getByLabelText(/new git worktree/i));
    await screen.findByLabelText(/git repository/i);

    expect(screen.getByRole('button', { name: /start agent/i })).toBeDisabled();
    expect(onSpawn).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /start agent/i })).toBeInTheDocument();
  });

  it('does not ask which repo when the working directory itself is a git repo', async () => {
    mockDiscoverGitRepos.mockResolvedValue([
      { path: '/my/repo', relativePath: '', name: 'repo', kind: 'root' },
      { path: '/my/repo/vendor/lib', relativePath: 'vendor/lib', name: 'lib', kind: 'submodule' },
    ]);
    const user = userEvent.setup();
    render(
      <SpawnAgentDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={vi.fn()}
        initialRepoPath="/my/repo"
      />
    );

    await user.click(screen.getByLabelText(/new git worktree/i));
    await waitFor(() => expect(mockDiscoverGitRepos).toHaveBeenCalledWith('/my/repo'));
    expect(screen.queryByLabelText(/git repository/i)).not.toBeInTheDocument();
  });

  it('says so when a worktree is requested from a folder with no git repo', async () => {
    mockDiscoverGitRepos.mockResolvedValue([]);
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/empty');
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
    await user.click(screen.getByLabelText(/new git worktree/i));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a git repository/i);
    expect(screen.getByRole('button', { name: /start agent/i })).toBeDisabled();
    expect(onSpawn).not.toHaveBeenCalled();
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
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
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
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    // Naming every agent after its repo made a fleet of five unreadable.
    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fix bugs' }));
  });

  it('does not spawn from an empty instruction even when a repo is set', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByLabelText(/working directory/i), '/my/repo');
    expect(screen.getByRole('button', { name: /start agent/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).not.toHaveBeenCalled();
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

    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
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
    await user.type(screen.getByLabelText(/what should it do/i), 'Refactor auth');
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    await answerYoloElevate(user, 'Continue');

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
    await user.type(screen.getByLabelText(/what should it do/i), 'Update styles');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionMode: 'default',
      })
    );
  });

  it('renders all permission mode options', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByText('Act without asking')).toBeInTheDocument();
    expect(screen.getByText(/interactive/i)).toBeInTheDocument();
  });

  it('maps a provider yolo label to Act without asking', async () => {
    mockListProviders.mockResolvedValueOnce([
      {
        id: 'crush',
        name: 'Crush',
        models: [{ value: 'auto', label: 'Auto / Default' }],
        permissionModes: [
          { value: 'yolo', label: 'YOLO (Autonomous)', description: 'Skip permission prompts' },
          { value: 'default', label: 'Interactive', description: 'Ask for permissions' },
        ],
        defaultModel: 'auto',
        defaultPermissionMode: 'default',
      },
    ]);

    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Act without asking')).toBeInTheDocument();
    });
    expect(screen.queryByText('YOLO (Autonomous)')).not.toBeInTheDocument();
  });

  it('labels the goal binding For goal', () => {
    const goals: PmGoal[] = [
      {
        id: 'g1',
        parentId: null,
        name: 'Ship launch',
        description: '',
        successCriteria: '',
        status: 'active',
        priority: 'normal',
        goalPrompt: '',
        createdBy: 'ui',
        achievedAt: null,
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      },
    ];
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} goals={goals} />);
    expect(screen.getByLabelText(/for goal/i)).toBeInTheDocument();
    expect(screen.queryByText(/serves goal/i)).not.toBeInTheDocument();
  });

  it('registers as the spawn overlay so Escape closes it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={onClose} onSpawn={vi.fn()} />);

    expect(useStore.getState().overlayStack.layers.at(-1)?.id).toBe('spawn');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
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
    await user.type(screen.getByLabelText(/what should it do/i), 'Fix bugs');
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
    return { onSpawn, onClose, task: screen.getByLabelText(/what should it do/i) };
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

  it('does not spawn on Cmd+Enter when the instruction is empty', async () => {
    const user = userEvent.setup();
    const { onSpawn, task } = open();
    expect(task).toHaveValue('');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('does not spawn on Ctrl+Enter when the instruction is empty', async () => {
    const user = userEvent.setup();
    const { onSpawn, task } = open();
    expect(task).toHaveValue('');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSpawn).not.toHaveBeenCalled();
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

describe('SpawnAgentDialog – YOLO elevate confirm', () => {
  async function startWithYolo(user: User, onSpawn = vi.fn(), onClose = vi.fn()) {
    render(<SpawnAgentDialog isOpen={true} onClose={onClose} onSpawn={onSpawn} />);
    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'yolo');
    await user.type(screen.getByLabelText(/what should it do/i), 'Ship the feature');
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    return { onSpawn, onClose };
  }

  it('asks the first time yolo is started in this session', async () => {
    const user = userEvent.setup();
    const { onSpawn } = await startWithYolo(user);

    const question = await screen.findByRole('dialog', { name: /act without asking/i });
    expect(question).toHaveTextContent(/edit files and run commands without asking/i);
    expect(screen.getByRole('button', { name: 'Continue' }).className).toMatch(/amber/);
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it('does not spawn and stays on the start dialog when the question is cancelled', async () => {
    const user = userEvent.setup();
    const { onSpawn, onClose } = await startWithYolo(user);

    await answerYoloElevate(user, 'Cancel');

    expect(onSpawn).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /start agent/i })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /act without asking/i })).not.toBeInTheDocument();
  });

  it('spawns with yolo once the question is confirmed', async () => {
    const user = userEvent.setup();
    const { onSpawn } = await startWithYolo(user);

    await answerYoloElevate(user, 'Continue');

    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' }));
  });

  it('does not ask again for yolo in the same session', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    const onClose = vi.fn();
    const { unmount } = render(
      <SpawnAgentDialog isOpen={true} onClose={onClose} onSpawn={onSpawn} />
    );
    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'yolo');
    await user.type(screen.getByLabelText(/what should it do/i), 'Ship the feature');
    await user.click(screen.getByRole('button', { name: /start agent/i }));
    await answerYoloElevate(user, 'Continue');
    expect(onSpawn).toHaveBeenCalledTimes(1);
    unmount();

    const onSpawnAgain = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawnAgain} />);
    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'yolo');
    await user.type(screen.getByLabelText(/what should it do/i), 'Do it again');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(screen.queryByRole('dialog', { name: /act without asking/i })).not.toBeInTheDocument();
    expect(onSpawnAgain).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'yolo' }));
  });

  it('never asks when starting in interactive mode', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'default');
    await user.type(screen.getByLabelText(/what should it do/i), 'Ask me first');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(screen.queryByRole('dialog', { name: /act without asking/i })).not.toBeInTheDocument();
    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'default' }));
  });
});

describe('SpawnAgentDialog – the project provider policy', () => {
  const provider = (id: string, name: string): ProviderInfo => ({
    id,
    name,
    models: [{ value: `${id}-model`, label: `${id} model` }],
    permissionModes: [{ value: 'default', label: 'Interactive', description: 'Ask' }],
    defaultModel: `${id}-model`,
    defaultPermissionMode: 'default',
  });

  it('leaves a denied provider out of the picker', async () => {
    mockListProviders.mockResolvedValue([
      provider('claude', 'Claude Code'),
      provider('opencode', 'opencode'),
      provider('grok', 'Grok'),
    ]);
    mockProviderPolicy.mockResolvedValue({ allow: null, deny: ['grok'] });

    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    const picker = await screen.findByLabelText(/provider/i);
    await waitFor(() => expect(within(picker).getByText('Claude Code')).toBeInTheDocument());
    expect(within(picker).queryByText('Grok')).not.toBeInTheDocument();
  });

  it('degrades to a permitted provider when the remembered one is denied', async () => {
    // The remembered launch choice must not resurrect a provider the project
    // has since locked out.
    localStorage.setItem(
      'auric.agent-spawn-defaults',
      JSON.stringify({
        providerId: 'grok',
        model: 'grok-model',
        permissionMode: 'default',
        headless: false,
      })
    );
    mockListProviders.mockResolvedValue([
      provider('claude', 'Claude Code'),
      provider('opencode', 'opencode'),
      provider('grok', 'Grok'),
    ]);
    mockProviderPolicy.mockResolvedValue({ allow: null, deny: ['grok'] });

    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    await waitFor(() => expect(screen.getByLabelText(/provider/i)).toHaveValue('claude'));
    expect(screen.getByLabelText(/model/i)).toHaveValue('claude-model');
  });

  it('says so and refuses to deploy when the policy permits nothing', async () => {
    // An empty picker with no explanation reads as a bug, and the setting that
    // caused it is two screens away.
    mockListProviders.mockResolvedValue([provider('claude', 'Claude Code')]);
    mockProviderPolicy.mockResolvedValue({ allow: null, deny: ['claude'] });

    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);

    expect(await screen.findByText(/permits no agent provider/i)).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText(/what should it do/i), 'Try anyway');
    expect(screen.getByRole('button', { name: /start agent/i })).toBeDisabled();
  });
});

describe('SpawnAgentDialog – image attachments', () => {
  function dropNativeFile(target: HTMLElement, path: string) {
    const file = new File([new Uint8Array([137, 80, 78, 71])], path.split('/').pop()!, {
      type: 'image/png',
    });
    Object.defineProperty(file, 'path', { value: path });
    fireEvent.drop(target, {
      dataTransfer: {
        types: ['Files'],
        files: [file],
      },
    });
  }

  it('shows a dropped file as a chip and sends its path with the prompt', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    dropNativeFile(screen.getByRole('dialog'), '/Users/jen/Desktop/shot.png');

    expect(screen.getByText('shot.png')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/what should it do/i), 'What is in this screenshot?');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'What is in this screenshot?\n\n/Users/jen/Desktop/shot.png',
        historyPrompt: 'What is in this screenshot?',
      })
    );
  });

  it('attaches a file dropped onto the dialog via the native webview event', async () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    dialog.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 500,
        bottom: 500,
        width: 500,
        height: 500,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;
    const previousHitTest = document.elementFromPoint;
    document.elementFromPoint = () => dialog;

    try {
      await waitFor(() => expect(dragDropHandler).not.toBeNull());
      act(() => {
        dragDropHandler!({
          payload: { type: 'drop', paths: ['/tmp/my shot.png'], position: { x: 80, y: 80 } },
        });
      });

      expect(screen.getByText('my shot.png')).toBeInTheDocument();
    } finally {
      document.elementFromPoint = previousHitTest;
    }
  });

  it('saves a pasted screenshot and attaches the cache path', async () => {
    mockInvoke.mockResolvedValue('/cache/screenshot_1.png');
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    const file = new File([new Uint8Array([137, 80, 78, 71])], 'clip.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      },
    });
    screen.getByLabelText(/what should it do/i).dispatchEvent(event);

    expect(await screen.findByText('screenshot_1.png')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/what should it do/i), 'Describe this');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'Describe this\n\n/cache/screenshot_1.png',
        historyPrompt: 'Describe this',
      })
    );
  });

  it('removes an attached file before spawn so it is not sent', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn();
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    dropNativeFile(screen.getByRole('dialog'), '/tmp/shot.png');
    await user.click(screen.getByRole('button', { name: 'Remove shot.png' }));
    expect(screen.queryByText('shot.png')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/what should it do/i), 'Just text');
    await user.click(screen.getByRole('button', { name: /start agent/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'Just text',
      })
    );
    expect(onSpawn.mock.calls[0][0].historyPrompt).toBeUndefined();
  });

  it('does not attach the same path twice', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    dropNativeFile(dialog, '/tmp/shot.png');
    dropNativeFile(dialog, '/tmp/shot.png');
    expect(screen.getAllByText('shot.png')).toHaveLength(1);
  });

  it('highlights the dialog while a file is dragged over it', () => {
    render(<SpawnAgentDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.dragOver(dialog, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByTestId('spawn-drop-overlay')).toBeInTheDocument();
  });
});
