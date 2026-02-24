import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TicketEditPanel } from './TicketEditPanel';
import type { PmTicket, PmEpic, PmTestCase, PmDependency } from '@/lib/tauri/pm';

const setInitialAgentTask = vi.fn();
const setSpawnDialogOpen = vi.fn();
const setSpawnAgentTicketId = vi.fn();
const mockLlmCall = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  __esModule: true,
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  __esModule: true,
  readTextFile: vi.fn(async () => 'mock file content'),
}));

vi.mock('@tauri-apps/api/path', () => ({
  __esModule: true,
  join: vi.fn(async (...args) => args.join('/')),
}));

vi.mock('@/lib/store', () => ({
  useStore: (fn: (state: Record<string, unknown>) => unknown) =>
    fn({
      setInitialAgentTask,
      setSpawnDialogOpen,
      setSpawnAgentTicketId,
      rootPath: '/mock/root',
      pmDirty: true,
    }),
}));

vi.mock('@/lib/hooks/useLLM', () => ({
  useLLM: () => ({
    call: mockLlmCall,
    isLoading: false,
    error: null,
  }),
}));

const makeTicket = (overrides: Partial<PmTicket> = {}): PmTicket => ({
  id: 'tk-1',
  epicId: 'epic-1',
  name: 'Login feature',
  description: 'Implement login flow',
  status: 'open',
  priority: 'normal',
  statusUpdatedAt: '2026-01-01T00:00:00Z',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeEpic = (overrides: Partial<PmEpic> = {}): PmEpic => ({
  id: 'epic-1',
  name: 'Auth Epic',
  description: 'Authentication',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('TicketEditPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps = {
    ticket: null as PmTicket | null,
    epics: [makeEpic(), makeEpic({ id: 'epic-2', name: 'Dashboard Epic' })],
    allTickets: [] as PmTicket[],
    testCases: [] as PmTestCase[],
    dependencies: [] as PmDependency[],
    availableItems: [] as { id: string; type: 'epic' | 'ticket'; name: string; status?: string }[],
    onUpdateTicket: vi.fn(),
    onSave: vi.fn(),
    onSaveAndClose: vi.fn(),
    onCancel: vi.fn(),
    onDeleteTicket: vi.fn(),
    onMoveTicket: vi.fn(),
    onAddTestCase: vi.fn(),
    onUpdateTestCase: vi.fn(),
    onDeleteTestCase: vi.fn(),
    onAddDependency: vi.fn(),
    onRemoveDependency: vi.fn(),
  };

  it('renders "Select a ticket" when ticket is null', () => {
    render(<TicketEditPanel {...defaultProps} />);
    expect(screen.getByText('Select a ticket')).toBeDefined();
  });

  it('renders ticket name in toolbar input', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} />);
    expect(screen.getByDisplayValue('Login feature')).toBeDefined();
  });

  it('renders description in details tab', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} />);
    expect(screen.getByDisplayValue('Implement login flow')).toBeDefined();
  });

  it('shows status pills with correct one highlighted', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket({ status: 'in_progress' })} />);
    const inProgressBtn = screen.getByText('In Progress');
    expect(inProgressBtn.closest('button')?.className).toContain('bg-yellow-500/10');
  });

  it('calls onUpdateTicket when name changes', () => {
    const onUpdateTicket = vi.fn();
    render(
      <TicketEditPanel {...defaultProps} ticket={makeTicket()} onUpdateTicket={onUpdateTicket} />
    );
    const nameInput = screen.getByDisplayValue('Login feature');
    fireEvent.change(nameInput, { target: { value: 'Updated name' } });
    expect(onUpdateTicket).toHaveBeenCalledWith('tk-1', { name: 'Updated name' });
  });

  it('calls onUpdateTicket when status changes', () => {
    const onUpdateTicket = vi.fn();
    render(
      <TicketEditPanel {...defaultProps} ticket={makeTicket()} onUpdateTicket={onUpdateTicket} />
    );
    fireEvent.click(screen.getByText('Done'));
    expect(onUpdateTicket).toHaveBeenCalledWith('tk-1', { status: 'done' });
  });

  it('calls onUpdateTicket when priority changes', () => {
    const onUpdateTicket = vi.fn();
    render(
      <TicketEditPanel {...defaultProps} ticket={makeTicket()} onUpdateTicket={onUpdateTicket} />
    );
    const selector = screen.getByTestId('priority-selector');
    fireEvent.click(within(selector).getByText('High'));
    expect(onUpdateTicket).toHaveBeenCalledWith('tk-1', { priority: 'high' });
  });

  it('calls onUpdateTicket when model power changes', () => {
    const onUpdateTicket = vi.fn();
    render(
      <TicketEditPanel {...defaultProps} ticket={makeTicket()} onUpdateTicket={onUpdateTicket} />
    );
    const selector = screen.getByTestId('model-power-selector');
    fireEvent.click(within(selector).getByText('High'));
    expect(onUpdateTicket).toHaveBeenCalledWith('tk-1', { modelPower: 'high' });
  });

  it('calls onMoveTicket when epic changes', () => {
    const onMoveTicket = vi.fn();
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} onMoveTicket={onMoveTicket} />);
    const epicSelect = screen.getByDisplayValue('Auth Epic');
    fireEvent.change(epicSelect, { target: { value: 'epic-2' } });
    expect(onMoveTicket).toHaveBeenCalledWith('tk-1', 'epic-2');
  });

  it('calls onDeleteTicket when delete icon clicked', () => {
    const onDeleteTicket = vi.fn();
    render(
      <TicketEditPanel {...defaultProps} ticket={makeTicket()} onDeleteTicket={onDeleteTicket} />
    );
    fireEvent.click(screen.getByLabelText('Delete ticket'));
    expect(onDeleteTicket).toHaveBeenCalledWith('tk-1');
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onSave when Save button is clicked', () => {
    const onSave = vi.fn();
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} onSave={onSave} />);
    fireEvent.click(screen.getByText('Save'));
    expect(onSave).toHaveBeenCalled();
  });

  it('calls onSaveAndClose when Save and Close button is clicked', () => {
    const onSaveAndClose = vi.fn();
    render(
      <TicketEditPanel {...defaultProps} ticket={makeTicket()} onSaveAndClose={onSaveAndClose} />
    );
    fireEvent.click(screen.getByText('Save and Close'));
    expect(onSaveAndClose).toHaveBeenCalled();
  });

  it('renders tab bar with Details, Context, Test Cases, Dependencies, Advanced', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} />);
    expect(screen.getByRole('tab', { name: /details/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /context/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /test cases/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /dependencies/i })).toBeDefined();
  });

  it('shows Details tab content by default', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} />);
    expect(screen.getByText('Description')).toBeDefined();
    expect(screen.getByDisplayValue('Implement login flow')).toBeDefined();
  });

  it('switches to Test Cases tab', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} />);
    fireEvent.click(screen.getByRole('tab', { name: /test cases/i }));
    expect(screen.getByText('No test cases')).toBeDefined();
  });

  it('shows tab badges with counts', () => {
    const testCases: PmTestCase[] = [
      {
        id: 'tc-1',
        ticketId: 'tk-1',
        title: 'Test 1',
        body: '',
        sortOrder: 0,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'tc-2',
        ticketId: 'tk-1',
        title: 'Test 2',
        body: '',
        sortOrder: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} testCases={testCases} />);
    const testCasesTab = screen.getByRole('tab', { name: /test cases/i });
    expect(testCasesTab.textContent).toContain('2');
  });

  it('shows created and updated dates in details tab', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} />);
    expect(screen.getByText(/Created:/)).toBeDefined();
    expect(screen.getByText(/Updated:/)).toBeDefined();
  });

  it('calls onUpdateTicket and onSave with in_progress status when Spawn Agent clicked', async () => {
    const onUpdateTicket = vi.fn();
    const onSave = vi.fn();
    render(
      <TicketEditPanel
        {...defaultProps}
        ticket={makeTicket()}
        onUpdateTicket={onUpdateTicket}
        onSave={onSave}
      />
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Spawn Agent'));
    });
    expect(onUpdateTicket).toHaveBeenCalledWith('tk-1', { status: 'in_progress' });
    expect(onSave).toHaveBeenCalled();
  });

  it('calls setInitialAgentTask with correct prompt when Spawn Agent clicked', async () => {
    const ticket = makeTicket({ name: 'Spawn Test', description: 'Spawn Desc' });
    render(<TicketEditPanel {...defaultProps} ticket={ticket} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Spawn Agent'));
    });

    await vi.waitFor(() => {
      expect(setInitialAgentTask).toHaveBeenCalled();
    });
    const prompt = setInitialAgentTask.mock.calls[0][0];
    expect(prompt).toContain('Implementation of ticket: Spawn Test');
    expect(prompt).toContain('Description:\nSpawn Desc');
    expect(setSpawnDialogOpen).toHaveBeenCalledWith(true);
    expect(setSpawnAgentTicketId).toHaveBeenCalledWith('tk-1');
  });

  it('copies prompt to clipboard when Copy Prompt clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const ticket = makeTicket({
      name: 'Test Ticket',
      description: 'Test Description',
    });
    const testCases: PmTestCase[] = [
      {
        id: 'tc-1',
        ticketId: 'tk-1',
        title: 'TC 1',
        body: 'Body 1',
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      },
    ];
    const dependencies: PmDependency[] = [
      {
        id: 'dep-1',
        sourceId: 'tk-1',
        sourceType: 'ticket',
        targetId: 'tk-2',
        targetType: 'ticket',
      },
    ];
    const availableItems = [
      { id: 'tk-2', type: 'ticket' as const, name: 'Auth Ticket', status: 'open' },
      { id: 'tk-1', type: 'ticket' as const, name: 'Test Ticket', status: 'open' },
    ];

    render(
      <TicketEditPanel
        {...defaultProps}
        ticket={ticket}
        testCases={testCases}
        dependencies={dependencies}
        availableItems={availableItems}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Copy Prompt'));
    });

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copiedText = writeText.mock.calls[0][0];
    expect(copiedText).toContain('Implementation of ticket: Test Ticket');
    expect(copiedText).toContain('Description:\nTest Description');
    expect(copiedText).toContain('1. TC 1\nBody 1');
    expect(copiedText).toContain('Dependencies (must be fulfilled before implementation):');
    expect(copiedText).toContain('- [ ] Auth Ticket (ticket)');
  });

  it('shows blocked warning banner when ticket has unfinished dependencies', () => {
    const ticket = makeTicket({ id: 'tk-1' });
    const dependencies: PmDependency[] = [
      {
        id: 'dep-1',
        sourceId: 'tk-1',
        sourceType: 'ticket',
        targetId: 'tk-2',
        targetType: 'ticket',
      },
    ];
    const availableItems = [
      { id: 'tk-2', type: 'ticket' as const, name: 'Blocking Ticket', status: 'open' },
    ];

    render(
      <TicketEditPanel
        {...defaultProps}
        ticket={ticket}
        dependencies={dependencies}
        availableItems={availableItems}
      />
    );

    expect(screen.getByText('This ticket is blocked by unfinished dependencies.')).toBeDefined();
  });

  it('does not show blocked warning banner when dependencies are done', () => {
    const ticket = makeTicket({ id: 'tk-1' });
    const dependencies: PmDependency[] = [
      {
        id: 'dep-1',
        sourceId: 'tk-1',
        sourceType: 'ticket',
        targetId: 'tk-2',
        targetType: 'ticket',
      },
    ];
    const availableItems = [
      { id: 'tk-2', type: 'ticket' as const, name: 'Done Ticket', status: 'done' },
    ];

    render(
      <TicketEditPanel
        {...defaultProps}
        ticket={ticket}
        dependencies={dependencies}
        availableItems={availableItems}
      />
    );

    expect(screen.queryByText('This ticket is blocked by unfinished dependencies.')).toBeNull();
  });

  it('switches to Advanced tab and allows updating working directory', () => {
    const onUpdateTicket = vi.fn();
    const ticket = makeTicket({ workingDirectory: '/old/dir' });
    render(<TicketEditPanel {...defaultProps} ticket={ticket} onUpdateTicket={onUpdateTicket} />);

    fireEvent.click(screen.getByRole('tab', { name: /advanced/i }));

    const input = screen.getByTestId('ticket-working-directory');
    expect(input).toBeDefined();
    fireEvent.change(input, { target: { value: '/new/dir' } });

    expect(onUpdateTicket).toHaveBeenCalledWith('tk-1', { workingDirectory: '/new/dir' });
  });

  it('includes context snippets in prompt', async () => {
    const ticket = makeTicket({
      context: [{ id: 'c1', type: 'snippet', value: 'My custom snippet' }],
    });
    render(<TicketEditPanel {...defaultProps} ticket={ticket} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Spawn Agent'));
    });

    await vi.waitFor(() => {
      expect(setInitialAgentTask).toHaveBeenCalled();
    });
    const prompt = setInitialAgentTask.mock.calls[0][0];
    expect(prompt).toContain('Additional Context:');
    expect(prompt).toContain('--- Snippet ---');
    expect(prompt).toContain('My custom snippet');
  });

  it('includes context files in prompt', async () => {
    const ticket = makeTicket({
      context: [{ id: 'c2', type: 'file', value: 'src/lib.rs' }],
    });
    render(<TicketEditPanel {...defaultProps} ticket={ticket} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Spawn Agent'));
    });

    await vi.waitFor(() => {
      expect(setInitialAgentTask).toHaveBeenCalled();
    });
    const prompt = setInitialAgentTask.mock.calls[0][0];
    expect(prompt).toContain('Additional Context:');
    expect(prompt).toContain('--- File: src/lib.rs ---');
    expect(prompt).toContain('mock file content');
  });

  it('shows Propose Dependencies button in dependencies tab', () => {
    render(<TicketEditPanel {...defaultProps} ticket={makeTicket()} />);
    fireEvent.click(screen.getByRole('tab', { name: /dependencies/i }));
    expect(screen.getByText('Propose Dependencies')).toBeDefined();
  });

  it('proposes dependencies and allows adding them', async () => {
    const onAddDependency = vi.fn();
    const ticket = makeTicket({ id: 'tk-1', epicId: 'epic-1' });
    const otherTicket = makeTicket({ id: 'tk-2', epicId: 'epic-1', name: 'Other Ticket' });
    const allTickets = [ticket, otherTicket];

    mockLlmCall.mockResolvedValue(JSON.stringify([{ id: 'tk-2', reason: 'Because I said so' }]));

    render(
      <TicketEditPanel
        {...defaultProps}
        ticket={ticket}
        allTickets={allTickets}
        onAddDependency={onAddDependency}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /dependencies/i }));

    await act(async () => {
      fireEvent.click(screen.getByText('Propose Dependencies'));
    });

    expect(mockLlmCall).toHaveBeenCalled();
    expect(screen.getByText('Proposed Dependencies')).toBeDefined();
    expect(screen.getByText('Other Ticket')).toBeDefined();
    expect(screen.getByText('Because I said so')).toBeDefined();

    fireEvent.click(screen.getByText('Add Selected (1)'));

    expect(onAddDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'tk-1',
        targetId: 'tk-2',
      })
    );
  });
});
