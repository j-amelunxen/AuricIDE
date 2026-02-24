import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from '@/lib/store';

const mockDialogSave = vi.fn();
const mockDialogOpen = vi.fn();
const mockDialogMessage = vi.fn();
const mockDialogAsk = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => mockDialogSave(...args),
  open: (...args: unknown[]) => mockDialogOpen(...args),
  message: (...args: unknown[]) => mockDialogMessage(...args),
  ask: (...args: unknown[]) => mockDialogAsk(...args),
}));

const mockExportDatabase = vi.fn();
const mockImportDatabase = vi.fn();
vi.mock('@/lib/tauri/db', () => ({
  exportDatabase: (...args: unknown[]) => mockExportDatabase(...args),
  importDatabase: (...args: unknown[]) => mockImportDatabase(...args),
}));

import { SettingsModal } from './SettingsModal';

const DEFAULT_PROMPT =
  'commit and push on the current branch. Do not switch branches. Commit message prefix: {ticket}:';

// ─── Visibility ────────────────────────────────────────────────────────────────

describe('SettingsModal – Visibility', () => {
  it('renders nothing when isOpen=false', () => {
    render(<SettingsModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId('settings-modal')).not.toBeInTheDocument();
  });

  it('renders modal when isOpen=true', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
  });

  it('shows "Settings" heading when open', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});

// ─── Close Behaviors ───────────────────────────────────────────────────────────

describe('SettingsModal – Close Behaviors', () => {
  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    await user.click(screen.getByTestId('settings-modal-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when X button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    await user.click(screen.getByTestId('settings-modal-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose when content area is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose} />);

    await user.click(screen.getByTestId('settings-modal'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ─── Category Navigation ───────────────────────────────────────────────────────

describe('SettingsModal – Category Navigation', () => {
  it('renders all nav items', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('settings-nav-agent')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-commands')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-editor')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav-system')).toBeInTheDocument();
  });

  it('Agent is active by default', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    const agentNav = screen.getByTestId('settings-nav-agent');
    expect(agentNav.className).toMatch(/border-primary/);
  });

  it('clicking Commands nav switches content', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-commands'));
    expect(screen.getByText('Slash Commands')).toBeInTheDocument();
  });

  it('clicking Editor nav switches content', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-editor'));
    expect(screen.getByTestId('deep-nlp-toggle')).toBeInTheDocument();
  });

  it('active nav item gets highlight styling', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-commands'));
    const commandsNav = screen.getByTestId('settings-nav-commands');
    expect(commandsNav.className).toMatch(/border-primary/);
  });
});

// ─── Agent Content (default category) ─────────────────────────────────────────

describe('SettingsModal – Agentic Commit', () => {
  beforeEach(() => {
    useStore.getState().updateAgentSettings({
      agenticCommit: true,
      agenticCommitPrompt: DEFAULT_PROMPT,
    });
  });

  it('renders the agentic commit toggle', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Agentic Commit')).toBeInTheDocument();
  });

  it('renders the prompt input with default value', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    const input = screen.getByDisplayValue(DEFAULT_PROMPT);
    expect(input).toBeInTheDocument();
  });

  it('toggles agenticCommit when checkbox is clicked', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    const checkbox = screen.getByRole('checkbox', { name: /agentic commit/i });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);
    expect(useStore.getState().agentSettings.agenticCommit).toBe(false);
  });

  it('updates prompt when input changes', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    const input = screen.getByDisplayValue(DEFAULT_PROMPT);
    await user.clear(input);
    await user.type(input, 'just commit everything');

    expect(useStore.getState().agentSettings.agenticCommitPrompt).toBe('just commit everything');
  });
});

describe('SettingsModal – Ticket Pattern', () => {
  beforeEach(() => {
    useStore.getState().updateAgentSettings({
      agenticCommit: true,
      agenticCommitPrompt: DEFAULT_PROMPT,
      branchTicketPattern: '([A-Z]+-\\d+)',
    });
  });

  it('renders the ticket pattern input', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('ticket-pattern-input')).toBeInTheDocument();
  });

  it('displays the current pattern value', () => {
    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    const input = screen.getByTestId('ticket-pattern-input');
    expect(input).toHaveValue('([A-Z]+-\\d+)');
  });

  it('updates branchTicketPattern in store when changed', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    const input = screen.getByTestId('ticket-pattern-input');
    await user.clear(input);
    await user.type(input, '(\\d+)');

    expect(useStore.getState().agentSettings.branchTicketPattern).toBe('(\\d+)');
  });

  it('shows live preview when branch info is available', () => {
    useStore.setState({
      branchInfo: {
        name: 'feature/AB-1234-your-ticket-text',
        ahead: 0,
        behind: 0,
        isDetached: false,
      },
    });

    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    const preview = screen.getByTestId('ticket-preview');
    expect(preview).toHaveTextContent('AB-1234');
    expect(preview).toHaveTextContent('feature/AB-1234-your-ticket-text');
  });

  it('shows "(no match)" in preview when pattern does not match', () => {
    useStore.setState({ branchInfo: { name: 'main', ahead: 0, behind: 0, isDetached: false } });

    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    const preview = screen.getByTestId('ticket-preview');
    expect(preview).toHaveTextContent('(no match)');
  });

  it('hides preview when no branch info is available', () => {
    useStore.setState({ branchInfo: null });

    render(<SettingsModal isOpen={true} onClose={() => {}} />);
    expect(screen.queryByTestId('ticket-preview')).not.toBeInTheDocument();
  });
});

// ─── Commands Content ──────────────────────────────────────────────────────────

describe('SettingsModal – Slash Commands', () => {
  beforeEach(() => {
    useStore.setState({ customSlashCommands: [] });
  });

  it('renders the slash commands section after nav click', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-commands'));
    expect(screen.getByText('Slash Commands')).toBeInTheDocument();
  });

  it('shows empty state when no custom commands', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-commands'));
    expect(screen.getByText(/no custom commands/i)).toBeInTheDocument();
  });

  it('displays existing custom commands', async () => {
    const user = userEvent.setup();
    useStore.setState({
      customSlashCommands: [{ trigger: 'myblock', label: 'My Block', template: '## My Block' }],
    });
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-commands'));
    expect(screen.getByText('My Block')).toBeInTheDocument();
    expect(screen.getByText('/myblock')).toBeInTheDocument();
  });

  it('adds a new custom command via the form', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-commands'));

    await user.type(screen.getByTestId('slash-trigger-input'), 'test');
    await user.type(screen.getByTestId('slash-label-input'), 'Test Block');
    await user.type(screen.getByTestId('slash-template-input'), '## Test');
    await user.click(screen.getByTestId('slash-add-button'));

    expect(useStore.getState().customSlashCommands).toHaveLength(1);
    expect(useStore.getState().customSlashCommands[0].trigger).toBe('test');
  });

  it('removes a custom command when delete button is clicked', async () => {
    const user = userEvent.setup();
    useStore.setState({
      customSlashCommands: [{ trigger: 'myblock', label: 'My Block', template: '## My Block' }],
    });
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-commands'));
    await user.click(screen.getByTestId('slash-delete-myblock'));
    expect(useStore.getState().customSlashCommands).toHaveLength(0);
  });
});

// ─── Editor Content ────────────────────────────────────────────────────────────

describe('SettingsModal – Editor', () => {
  it('shows deep-nlp-toggle after nav click', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-editor'));
    expect(screen.getByTestId('deep-nlp-toggle')).toBeInTheDocument();
  });

  it('shows lint-toggle after nav click', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-editor'));
    expect(screen.getByTestId('lint-toggle')).toBeInTheDocument();
  });

  it('toggles deep NLP setting in store', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-editor'));
    const toggle = screen.getByTestId('deep-nlp-toggle');
    const initial = useStore.getState().enableDeepNlp;
    await user.click(toggle);
    expect(useStore.getState().enableDeepNlp).toBe(!initial);
  });

  it('toggles lint setting in store', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-editor'));
    const toggle = screen.getByTestId('lint-toggle');
    const initial = useStore.getState().lintConfig.enabled;
    await user.click(toggle);
    expect(useStore.getState().lintConfig.enabled).toBe(!initial);
  });
});

// ─── System Content ────────────────────────────────────────────────────────────

describe('SettingsModal – System', () => {
  it('renders Database Management section after nav click', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-system'));
    expect(screen.getByText('Database Management')).toBeInTheDocument();
  });

  it('renders Export and Import buttons', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-system'));
    expect(screen.getByText('Export Database')).toBeInTheDocument();
    expect(screen.getByText('Import Database')).toBeInTheDocument();
  });

  it('shows system info section', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByTestId('settings-nav-system'));
    expect(screen.getByText('System Info')).toBeInTheDocument();
    expect(screen.getByText('Core Version')).toBeInTheDocument();
    expect(screen.getByText('0.1.0-alpha')).toBeInTheDocument();
  });
});

// ─── Database export/import integrity ──────────────────────────────────────────

describe('SettingsModal – Database export/import', () => {
  const mockSavePmData = vi.fn(() => Promise.resolve());
  const mockLoadPmData = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.clearAllMocks();
    mockExportDatabase.mockResolvedValue(undefined);
    mockImportDatabase.mockResolvedValue(undefined);
    mockDialogMessage.mockResolvedValue(undefined);
    useStore.setState({
      rootPath: '/test/project',
      pmDirty: false,
      savePmData: mockSavePmData,
      loadPmData: mockLoadPmData,
    });
  });

  it('saves dirty PM data before exporting database', async () => {
    useStore.setState({ pmDirty: true });
    mockDialogSave.mockResolvedValue('/tmp/backup.db');

    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await user.click(screen.getByTestId('settings-nav-system'));
    await user.click(screen.getByText('Export Database'));

    // savePmData must be called BEFORE exportDatabase
    expect(mockSavePmData).toHaveBeenCalledWith('/test/project');
    expect(mockExportDatabase).toHaveBeenCalledWith('/test/project', '/tmp/backup.db');

    const saveOrder = mockSavePmData.mock.invocationCallOrder[0];
    const exportOrder = mockExportDatabase.mock.invocationCallOrder[0];
    expect(saveOrder).toBeLessThan(exportOrder);
  });

  it('does not save PM data before export when not dirty', async () => {
    useStore.setState({ pmDirty: false });
    mockDialogSave.mockResolvedValue('/tmp/backup.db');

    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await user.click(screen.getByTestId('settings-nav-system'));
    await user.click(screen.getByText('Export Database'));

    expect(mockSavePmData).not.toHaveBeenCalled();
    expect(mockExportDatabase).toHaveBeenCalledWith('/test/project', '/tmp/backup.db');
  });

  it('reloads PM data after importing database', async () => {
    mockDialogOpen.mockResolvedValue('/tmp/backup.db');

    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await user.click(screen.getByTestId('settings-nav-system'));
    await user.click(screen.getByText('Import Database'));

    expect(mockImportDatabase).toHaveBeenCalledWith('/test/project', '/tmp/backup.db');
    expect(mockLoadPmData).toHaveBeenCalledWith('/test/project');
  });

  it('clears PM data after confirmation', async () => {
    const mockClearPmData = vi.fn(() => Promise.resolve());
    useStore.setState({ clearPmData: mockClearPmData });
    mockDialogAsk.mockResolvedValue(true);

    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await user.click(screen.getByTestId('settings-nav-system'));
    await user.click(screen.getByTestId('clear-pm-button'));

    expect(mockDialogAsk).toHaveBeenCalled();
    expect(mockClearPmData).toHaveBeenCalledWith('/test/project');
    expect(mockDialogMessage).toHaveBeenCalledWith(
      expect.stringContaining('cleared successfully'),
      expect.any(Object)
    );
  });

  it('does not clear PM data if not confirmed', async () => {
    const mockClearPmData = vi.fn(() => Promise.resolve());
    useStore.setState({ clearPmData: mockClearPmData });
    mockDialogAsk.mockResolvedValue(false);

    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await user.click(screen.getByTestId('settings-nav-system'));
    await user.click(screen.getByTestId('clear-pm-button'));

    expect(mockDialogAsk).toHaveBeenCalled();
    expect(mockClearPmData).not.toHaveBeenCalled();
  });
});
