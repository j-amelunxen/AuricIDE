import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/hooks/useProjectSkills', () => ({
  useProjectSkills: () => ({ discovered: [], ready: true }),
}));

vi.mock('./MetricsView', () => ({
  MetricsView: () => <div data-testid="metrics-view">Metrics panel</div>,
}));

// Stands in for the real panel, but keeps the one wire this file tests: the
// delete button the panel renders and the handler the modal hands it.
vi.mock('./TicketEditPanel', () => ({
  TicketEditPanel: ({
    ticket,
    onDeleteTicket,
    onSave,
  }: {
    ticket: { id: string } | null;
    onDeleteTicket: (id: string) => void;
    onSave?: () => void | Promise<void>;
  }) => (
    <div data-testid="mock-ticket-edit-panel">
      {ticket && (
        <>
          <button
            type="button"
            aria-label="Delete ticket"
            onClick={() => onDeleteTicket(ticket.id)}
          >
            Delete ticket
          </button>
          <button type="button" data-testid="ticket-panel-save" onClick={() => void onSave?.()}>
            Save
          </button>
        </>
      )}
    </div>
  ),
}));

import { ProjectManagerModal } from './ProjectManagerModal';

const mockStore: Record<string, unknown> = {
  pmModalOpen: false,
  pmDirty: false,
  pmDraftEpics: [],
  pmDraftTickets: [],
  pmDraftTestCases: [],
  pmDraftDependencies: [],
  pmSelectedEpicId: null,
  pmSelectedTicketId: null,
  rootPath: '/test/project',
  setPmModalOpen: vi.fn(),
  loadPmData: vi.fn(),
  savePmData: vi.fn(),
  discardPmChanges: vi.fn(),
  addEpic: vi.fn(),
  updateEpic: vi.fn(),
  deleteEpic: vi.fn(),
  addTicket: vi.fn(),
  updateTicket: vi.fn(),
  deleteTicket: vi.fn(),
  moveTicket: vi.fn(),
  reorderTickets: vi.fn(),
  reorderEpics: vi.fn(),
  addTestCase: vi.fn(),
  updateTestCase: vi.fn(),
  deleteTestCase: vi.fn(),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  setPmSelectedEpicId: vi.fn(),
  setPmSelectedTicketId: vi.fn(),
  setSpawnDialogOpen: vi.fn(),
  setInitialAgentTask: vi.fn(),
  setSpawnAgentTicketId: vi.fn(),
  refreshPmData: vi.fn(),
  archiveDoneTickets: vi.fn(),
  setImportSpecDialogOpen: vi.fn(),
  overlayStack: { layers: [] as { id: string; kind: string }[] },
  pushOverlay: (entry: { id: string; kind: string }) => {
    const stack = mockStore.overlayStack as { layers: { id: string; kind: string }[] };
    if (stack.layers.some((layer) => layer.id === entry.id)) return;
    mockStore.overlayStack = { layers: [...stack.layers, entry] };
  },
  removeOverlay: (id: string) => {
    const stack = mockStore.overlayStack as { layers: { id: string }[] };
    mockStore.overlayStack = { layers: stack.layers.filter((layer) => layer.id !== id) };
  },
  ownsEscape: (id: string) => {
    const stack = mockStore.overlayStack as { layers: { id: string }[] };
    return stack.layers.at(-1)?.id === id;
  },
};

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(
    vi.fn((selector: (s: typeof mockStore) => unknown) => selector(mockStore)),
    { getState: () => mockStore }
  ),
}));

describe('ProjectManagerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.pmModalOpen = false;
    mockStore.pmDirty = false;
    mockStore.pmDraftEpics = [];
    mockStore.pmDraftTickets = [];
    mockStore.pmDraftTestCases = [];
    mockStore.pmSelectedEpicId = null;
    mockStore.pmSelectedTicketId = null;
    mockStore.overlayStack = { layers: [] };
  });

  it('renders nothing when pmModalOpen is false', () => {
    const { container } = render(<ProjectManagerModal />);
    expect(container.innerHTML).toBe('');
  });

  it('renders modal when pmModalOpen is true', () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    expect(screen.getByText('Project Management')).toBeDefined();
  });

  it('sizes ticket columns to the work pane, not the window', () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    // Viewport breakpoints never see the agents bar. Container queries do:
    // epics + list go compact below @4xl so the detail is not clipped.
    expect(screen.getByTestId('tickets-columns')).toHaveClass('@container');
    expect(screen.getByTestId('tickets-epics-col')).toHaveClass('w-40', '@4xl:w-[220px]');
    expect(screen.getByTestId('tickets-list-col')).toHaveClass('w-52', '@4xl:w-[280px]');
    expect(screen.getByTestId('tickets-detail-col')).toHaveClass('min-w-0', 'flex-1');
  });

  it('exposes an accessible dialog when open', () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    expect(screen.getByRole('dialog', { name: /project management/i })).toBeInTheDocument();
  });

  it('shows "Project Management" header', () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    expect(screen.getByText('Project Management')).toBeDefined();
  });

  it('shows Save, Save and Close, Close, and + New Ticket buttons in header', () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    const header = screen.getByRole('dialog', { name: /project management/i });
    expect(within(header).getByRole('button', { name: /^Save$/ })).toBeDefined();
    expect(within(header).getByRole('button', { name: 'Save and Close' })).toBeDefined();
    expect(within(header).getByRole('button', { name: /^Close$/ })).toBeDefined();
    // + New Ticket appears in header and in ticket list footer
    const newTicketBtns = screen.getAllByText('+ New Ticket');
    expect(newTicketBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('switches to the Metrics tab and hides the ticket columns', async () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    expect(screen.getByTestId('tickets-columns')).toBeDefined();
    expect(screen.queryByTestId('metrics-view')).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Metrics' }));

    expect(screen.getByTestId('metrics-view')).toBeDefined();
    expect(screen.queryByTestId('tickets-columns')).toBeNull();
  });

  it('shows the persist chip only while Plan is dirty', () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = false;
    const { rerender } = render(<ProjectManagerModal />);
    expect(screen.queryByTestId('persist-chip')).toBeNull();

    mockStore.pmDirty = true;
    rerender(<ProjectManagerModal />);
    expect(screen.getByTestId('persist-chip')).toHaveTextContent('Unsaved · ⌘S');
  });

  it('Save and Close button disabled when not dirty', () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = false;
    render(<ProjectManagerModal />);
    const saveCloseBtn = screen.getByText('Save and Close').closest('button');
    expect(saveCloseBtn?.disabled).toBe(true);
  });

  it('calls savePmData and closes on "Save and Close" click when dirty', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = true;
    mockStore.rootPath = '/test/project';
    render(<ProjectManagerModal />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Save and Close'));
    expect(mockStore.savePmData).toHaveBeenCalledWith('/test/project');
    expect(mockStore.setPmModalOpen).toHaveBeenCalledWith(false);
  });

  it('keeps the modal open when the save fails', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = true;
    mockStore.rootPath = '/test/project';
    mockStore.savePmData = vi.fn().mockRejectedValue(new Error('database is locked'));
    render(<ProjectManagerModal />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Save and Close'));
    expect(mockStore.savePmData).toHaveBeenCalledWith('/test/project');
    // Closing here is how unsaved work disappears — the store already toasted.
    expect(mockStore.setPmModalOpen).not.toHaveBeenCalledWith(false);
  });

  it('Save button disabled when not dirty', () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = false;
    render(<ProjectManagerModal />);
    const saveBtn = screen.getByText('Save').closest('button');
    expect(saveBtn?.disabled).toBe(true);
  });

  it('calls setPmModalOpen(false) on Close when not dirty', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = false;
    render(<ProjectManagerModal />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Close$/ }));
    expect(mockStore.setPmModalOpen).toHaveBeenCalledWith(false);
  });

  it('ticket panel Save persists without closing Plan', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = true;
    mockStore.rootPath = '/test/project';
    mockStore.pmDraftTickets = [
      {
        id: 'tk-1',
        name: 'Test Ticket',
        status: 'open',
        epicId: 'e1',
        description: '',
        createdAt: '',
        updatedAt: '',
      },
    ];
    mockStore.pmSelectedTicketId = 'tk-1';
    render(<ProjectManagerModal />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('ticket-panel-save'));
    expect(mockStore.savePmData).toHaveBeenCalledWith('/test/project');
    expect(mockStore.setPmModalOpen).not.toHaveBeenCalledWith(false);
  });

  it('discards unsaved changes only after the question is answered', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = true;
    render(<ProjectManagerModal />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Close$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
    expect(mockStore.discardPmChanges).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(mockStore.discardPmChanges).toHaveBeenCalled();
      expect(mockStore.setPmModalOpen).toHaveBeenCalledWith(false);
    });
  });

  it('keeps unsaved changes when the discard is declined', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = true;
    render(<ProjectManagerModal />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^Close$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument()
    );
    expect(mockStore.discardPmChanges).not.toHaveBeenCalled();
    expect(mockStore.setPmModalOpen).not.toHaveBeenCalledWith(false);
  });

  it('saves on Cmd+S when dirty', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = true;
    mockStore.rootPath = '/test/project';
    render(<ProjectManagerModal />);

    // Simulate Cmd+S (Meta+S)
    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(mockStore.savePmData).toHaveBeenCalledWith('/test/project');
  });

  it('does not save on Cmd+S when not dirty', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = false;
    mockStore.rootPath = '/test/project';
    render(<ProjectManagerModal />);

    const event = new KeyboardEvent('keydown', {
      key: 's',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(mockStore.savePmData).not.toHaveBeenCalled();
  });

  it('automatically saves and resets dirty state when spawning an agent from the table', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = true;
    mockStore.rootPath = '/test/project';
    mockStore.pmDraftTickets = [
      {
        id: 'tk-1',
        name: 'Test Ticket',
        status: 'open',
        epicId: 'e1',
        description: '',
        createdAt: '',
        updatedAt: '',
      },
    ];
    render(<ProjectManagerModal />);

    // In a real scenario, TicketTable would call onUpdateTicket and onSave.
    // Since we are mocking TicketEditPanel, let's see if we can find the Start agent button.
    // Wait, TicketTable is NOT mocked.
    const spawnBtn = screen.getByTitle('Start agent');
    await userEvent.click(spawnBtn);

    expect(mockStore.updateTicket).toHaveBeenCalledWith('tk-1', { status: 'in_progress' });
    expect(mockStore.savePmData).toHaveBeenCalledWith('/test/project');
  });

  // --- Destructive deletes ---

  function seedEpicWithTickets(ticketCount: number, testCasesPerTicket = 0) {
    mockStore.pmModalOpen = true;
    mockStore.pmDraftEpics = [
      {
        id: 'ep-1',
        name: 'Checkout',
        description: '',
        sortOrder: 0,
        createdAt: '',
        updatedAt: '',
      },
    ];
    const tickets = Array.from({ length: ticketCount }, (_, i) => ({
      id: `tk-${i}`,
      name: `Ticket ${i}`,
      status: 'open',
      epicId: 'ep-1',
      description: '',
      createdAt: '',
      updatedAt: '',
    }));
    mockStore.pmDraftTickets = tickets;
    mockStore.pmDraftTestCases = tickets.flatMap((t) =>
      Array.from({ length: testCasesPerTicket }, (_, j) => ({
        id: `${t.id}-tc-${j}`,
        ticketId: t.id,
        title: 'tc',
        body: '',
        sortOrder: j,
        createdAt: '',
        updatedAt: '',
      }))
    );
  }

  describe('deleting an epic', () => {
    it('does not delete the epic while the confirmation is still open', async () => {
      seedEpicWithTickets(2);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete epic ep-1'));

      await screen.findByRole('dialog', { name: 'Delete this epic?' });
      expect(mockStore.deleteEpic).not.toHaveBeenCalled();
    });

    it('names the cascade — how many tickets and test cases go with the epic', async () => {
      seedEpicWithTickets(12, 2);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete epic ep-1'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this epic?' });

      expect(dialog.textContent).toContain('12 tickets');
      expect(dialog.textContent).toContain('24 test cases');
    });

    it('uses singular wording for a single ticket and a single test case', async () => {
      seedEpicWithTickets(1, 1);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete epic ep-1'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this epic?' });

      expect(dialog.textContent).toContain('its 1 ticket,');
      expect(dialog.textContent).toContain('1 test case.');
    });

    it('reads plainly when the epic has no tickets at all', async () => {
      seedEpicWithTickets(0);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete epic ep-1'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this epic?' });

      expect(dialog.textContent).toContain('This deletes the epic. It has no tickets.');
    });

    it('deletes the epic once the delete is confirmed', async () => {
      seedEpicWithTickets(2);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete epic ep-1'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this epic?' });
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(mockStore.deleteEpic).toHaveBeenCalledWith('ep-1'));
    });

    it('keeps the epic when the delete is declined', async () => {
      seedEpicWithTickets(2);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete epic ep-1'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this epic?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Delete this epic?' })).not.toBeInTheDocument()
      );
      expect(mockStore.deleteEpic).not.toHaveBeenCalled();
    });
  });

  describe('deleting a ticket', () => {
    function seedSelectedTicket(testCaseCount: number) {
      seedEpicWithTickets(1, testCaseCount);
      mockStore.pmSelectedTicketId = 'tk-0';
    }

    it('does not delete the ticket while the confirmation is still open', async () => {
      seedSelectedTicket(3);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete ticket'));

      await screen.findByRole('dialog', { name: 'Delete this ticket?' });
      expect(mockStore.deleteTicket).not.toHaveBeenCalled();
      expect(mockStore.setPmSelectedTicketId).not.toHaveBeenCalledWith(null);
    });

    it('names the test cases that go with the ticket', async () => {
      seedSelectedTicket(3);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete ticket'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this ticket?' });

      expect(dialog.textContent).toContain('3 test cases');
    });

    it('reads plainly when the ticket has no test cases', async () => {
      seedSelectedTicket(0);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete ticket'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this ticket?' });

      expect(dialog.textContent).toContain('This deletes the ticket. It has no test cases.');
    });

    it('deletes the ticket and clears the selection once confirmed', async () => {
      seedSelectedTicket(3);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete ticket'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this ticket?' });
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mockStore.deleteTicket).toHaveBeenCalledWith('tk-0');
        expect(mockStore.setPmSelectedTicketId).toHaveBeenCalledWith(null);
      });
    });

    it('keeps the ticket when the delete is declined', async () => {
      seedSelectedTicket(3);
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Delete ticket'));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this ticket?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Delete this ticket?' })
        ).not.toBeInTheDocument()
      );
      expect(mockStore.deleteTicket).not.toHaveBeenCalled();
      expect(mockStore.setPmSelectedTicketId).not.toHaveBeenCalledWith(null);
    });
  });

  // --- Polling (refreshPmData) ---

  describe('polling', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('calls refreshPmData every 30s when modal is open', () => {
      vi.useFakeTimers();
      mockStore.pmModalOpen = true;
      render(<ProjectManagerModal />);

      // Not called immediately
      expect(mockStore.refreshPmData).not.toHaveBeenCalled();

      // Called after 30s
      vi.advanceTimersByTime(30_000);
      expect(mockStore.refreshPmData).toHaveBeenCalledTimes(1);
      expect(mockStore.refreshPmData).toHaveBeenCalledWith('/test/project');

      // Called again after another 30s
      vi.advanceTimersByTime(30_000);
      expect(mockStore.refreshPmData).toHaveBeenCalledTimes(2);
    });

    it('clears interval on unmount', () => {
      vi.useFakeTimers();
      mockStore.pmModalOpen = true;
      const { unmount } = render(<ProjectManagerModal />);

      vi.advanceTimersByTime(30_000);
      expect(mockStore.refreshPmData).toHaveBeenCalledTimes(1);

      unmount();

      vi.advanceTimersByTime(30_000);
      expect(mockStore.refreshPmData).toHaveBeenCalledTimes(1); // not called again
    });

    it('does not poll when modal is closed', () => {
      vi.useFakeTimers();
      mockStore.pmModalOpen = false;
      render(<ProjectManagerModal />);

      vi.advanceTimersByTime(60_000);
      expect(mockStore.refreshPmData).not.toHaveBeenCalled();
    });
  });

  // Escape belongs to the top layer. A nested create/edit dialog must take
  // the key; Plan staying put is the whole point of this gate.
  describe('Escape while a nested dialog is open', () => {
    it('closes New Ticket and leaves Plan open', async () => {
      mockStore.pmModalOpen = true;
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getAllByText('+ New Ticket')[0]);
      expect(screen.getByRole('dialog', { name: /new ticket/i })).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog', { name: /new ticket/i })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: /project management/i })).toBeInTheDocument();
      expect(mockStore.setPmModalOpen).not.toHaveBeenCalledWith(false);
    });

    it('closes New Epic and leaves Plan open', async () => {
      mockStore.pmModalOpen = true;
      render(<ProjectManagerModal />);
      const user = userEvent.setup();

      await user.click(screen.getByLabelText('Add epic'));
      expect(screen.getByRole('dialog', { name: /new epic/i })).toBeInTheDocument();

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog', { name: /new epic/i })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: /project management/i })).toBeInTheDocument();
      expect(mockStore.setPmModalOpen).not.toHaveBeenCalledWith(false);
    });
  });

  it('Create epic from New Ticket closes the ticket dialog and opens New Epic', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDraftEpics = [];
    render(<ProjectManagerModal />);
    const user = userEvent.setup();

    await user.click(screen.getAllByText('+ New Ticket')[0]);
    expect(screen.getByRole('dialog', { name: /new ticket/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create epic' }));

    expect(screen.queryByRole('dialog', { name: /new ticket/i })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /new epic/i })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /project management/i })).toBeInTheDocument();
  });
});
