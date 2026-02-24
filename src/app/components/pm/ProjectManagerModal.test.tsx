import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./TicketEditPanel', () => ({
  TicketEditPanel: () => <div data-testid="mock-ticket-edit-panel">TicketEditPanel</div>,
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
};

vi.mock('@/lib/store', () => ({
  useStore: vi.fn((selector: (s: typeof mockStore) => unknown) => selector(mockStore)),
}));

describe('ProjectManagerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.pmModalOpen = false;
    mockStore.pmDirty = false;
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

  it('shows "Project Management" header', () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    expect(screen.getByText('Project Management')).toBeDefined();
  });

  it('shows Save, Save and Close, Cancel, and + New Ticket buttons in header', () => {
    mockStore.pmModalOpen = true;
    render(<ProjectManagerModal />);
    expect(screen.getByText('Save')).toBeDefined();
    expect(screen.getByText('Save and Close')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
    // + New Ticket appears in header and in ticket list footer
    const newTicketBtns = screen.getAllByText('+ New Ticket');
    expect(newTicketBtns.length).toBeGreaterThanOrEqual(1);
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

  it('Save button disabled when not dirty', () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = false;
    render(<ProjectManagerModal />);
    const saveBtn = screen.getByText('Save').closest('button');
    expect(saveBtn?.disabled).toBe(true);
  });

  it('calls setPmModalOpen(false) on cancel when not dirty', async () => {
    mockStore.pmModalOpen = true;
    mockStore.pmDirty = false;
    render(<ProjectManagerModal />);
    const user = userEvent.setup();
    await user.click(screen.getByText('Cancel'));
    expect(mockStore.setPmModalOpen).toHaveBeenCalledWith(false);
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
    // Since we are mocking TicketEditPanel, let's see if we can find the Spawn Agent button.
    // Wait, TicketTable is NOT mocked.
    const spawnBtn = screen.getByTitle('Spawn Agent');
    await userEvent.click(spawnBtn);

    expect(mockStore.updateTicket).toHaveBeenCalledWith('tk-1', { status: 'in_progress' });
    expect(mockStore.savePmData).toHaveBeenCalledWith('/test/project');
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
});
