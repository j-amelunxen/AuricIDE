import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxPanel } from './InboxPanel';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';

const updateInboxItemMock = vi.fn();
const dismissInboxItemMock = vi.fn();
const assignInboxItemMock = vi.fn();
const unassignInboxItemMock = vi.fn();

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Write the report',
    notes: '',
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    projectPath: null,
    projectName: null,
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

const defaultStoreState = {
  inboxItems: [] as InboxItem[],
  inboxLoading: false,
  inboxError: null as string | null,
  inboxOverview: {} as Record<string, ProjectPmOverview>,
  starredProjects: [] as { path: string; name: string; starredAt: number }[],
  recentProjects: [] as { path: string; name: string; openedAt: number }[],
  rootPath: null as string | null,
  addInboxItem: vi.fn(async (title: string) => makeItem({ title })),
  updateInboxItem: (id: string, patch: { title?: string; notes?: string }) =>
    updateInboxItemMock(id, patch),
  dismissInboxItem: (id: string) => dismissInboxItemMock(id),
  assignInboxItem: (request: unknown) => assignInboxItemMock(request),
  unassignInboxItem: (id: string) => unassignInboxItemMock(id),
  setSpawnAgentTicketId: vi.fn(),
  setSpawnAgentGoalId: vi.fn(),
  setInitialAgentTask: vi.fn(),
  setSpawnAgentPreset: vi.fn(),
  setSpawnAgentRepoPath: vi.fn(),
  setSpawnDialogOpen: vi.fn(),
  overlayStack: { layers: [] as { id: string; kind: string }[] },
  pushOverlay: (entry: { id: string; kind: string }) => {
    if (storeState.overlayStack.layers.some((layer) => layer.id === entry.id)) return;
    storeState.overlayStack = { layers: [...storeState.overlayStack.layers, entry] };
  },
  removeOverlay: (id: string) => {
    storeState.overlayStack = {
      layers: storeState.overlayStack.layers.filter((layer) => layer.id !== id),
    };
  },
  ownsEscape: (id: string) => storeState.overlayStack.layers.at(-1)?.id === id,
};

let storeState = { ...defaultStoreState };

vi.mock('@/lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}));

function makeOverview(overrides: Partial<ProjectPmOverview> = {}): ProjectPmOverview {
  return {
    projectPath: '/repos/alpha',
    projectName: 'alpha',
    hasDb: true,
    open: 1,
    inProgress: 2,
    inReview: 0,
    done: 3,
    epics: [],
    tickets: [],
    error: null,
    ...overrides,
  };
}

describe('InboxPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = { ...defaultStoreState, overlayStack: { layers: [] } };
  });

  it('shows the calm empty state with nothing captured', () => {
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByTestId('inbox-empty')).toBeInTheDocument();
  });

  it('renders the header count for the whole inbox', () => {
    storeState.inboxItems = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByTestId('inbox-count')).toHaveTextContent('2');
  });

  it('lists unsorted items under Unsorted', () => {
    storeState.inboxItems = [makeItem({ id: 'a', title: 'Call the vet' })];
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByText('Unsorted')).toBeInTheDocument();
    expect(screen.getByText('Call the vet')).toBeInTheDocument();
  });

  it('groups assigned items by project with counts from the overview', () => {
    storeState.inboxItems = [
      makeItem({
        id: 'a',
        title: 'Fix the bug',
        projectPath: '/repos/alpha',
        projectName: 'alpha',
        ticketId: 't1',
        assignedAt: '2026-01-01 00:00:00',
      }),
    ];
    storeState.inboxOverview = { '/repos/alpha': makeOverview() };

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);

    expect(screen.getByText('By project')).toBeInTheDocument();
    const group = screen.getByTestId('inbox-group-/repos/alpha');
    expect(within(group).getByText(/1 open/i)).toBeInTheDocument();
    expect(within(group).getByText(/2 in progress/i)).toBeInTheDocument();
  });

  it("shows 'not opened yet' for a project without a database", () => {
    storeState.inboxItems = [
      makeItem({
        id: 'a',
        projectPath: '/repos/alpha',
        projectName: 'alpha',
        ticketId: 't1',
        assignedAt: '2026-01-01 00:00:00',
      }),
    ];
    storeState.inboxOverview = { '/repos/alpha': makeOverview({ hasDb: false }) };

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);

    expect(screen.getByText(/not opened yet/i)).toBeInTheDocument();
  });

  it('shows a muted error line for a project overview that failed to read', () => {
    storeState.inboxItems = [
      makeItem({
        id: 'a',
        projectPath: '/repos/alpha',
        projectName: 'alpha',
        ticketId: 't1',
        assignedAt: '2026-01-01 00:00:00',
      }),
    ];
    storeState.inboxOverview = {
      '/repos/alpha': makeOverview({ error: 'unreadable schema' }),
    };

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);

    expect(screen.getByText(/couldn't read/i)).toBeInTheDocument();
  });

  it('shows a skeleton only while loading with nothing yet shown', () => {
    storeState.inboxLoading = true;
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByTestId('inbox-loading')).toBeInTheDocument();
  });

  it('does not show the loading skeleton once items are present', () => {
    storeState.inboxLoading = true;
    storeState.inboxItems = [makeItem()];
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.queryByTestId('inbox-loading')).not.toBeInTheDocument();
  });

  it('shows an inline error line when the inbox failed to load', () => {
    storeState.inboxError = 'disk full';
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByText(/disk full/i)).toBeInTheDocument();
  });

  it('opens a project when its group header is clicked', async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    storeState.inboxItems = [
      makeItem({
        id: 'a',
        projectPath: '/repos/alpha',
        projectName: 'alpha',
        ticketId: 't1',
        assignedAt: '2026-01-01 00:00:00',
      }),
    ];
    storeState.inboxOverview = { '/repos/alpha': makeOverview() };

    render(<InboxPanel variant="sidebar" onOpenProject={onOpenProject} />);
    await user.click(screen.getByTestId('inbox-group-open-/repos/alpha'));

    expect(onOpenProject).toHaveBeenCalledWith('/repos/alpha');
  });

  it('collapses and expands a project group', async () => {
    const user = userEvent.setup();
    storeState.inboxItems = [
      makeItem({
        id: 'a',
        title: 'Fix the bug',
        projectPath: '/repos/alpha',
        projectName: 'alpha',
        ticketId: 't1',
        assignedAt: '2026-01-01 00:00:00',
      }),
    ];
    storeState.inboxOverview = { '/repos/alpha': makeOverview() };

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByText('Fix the bug')).toBeInTheDocument();

    await user.click(screen.getByTestId('inbox-group-collapse-/repos/alpha'));
    expect(screen.queryByText('Fix the bug')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('inbox-group-collapse-/repos/alpha'));
    expect(screen.getByText('Fix the bug')).toBeInTheDocument();
  });

  it('dismisses a bare unsorted item without asking', async () => {
    const user = userEvent.setup();
    storeState.inboxItems = [makeItem({ id: 'a', title: 'Buy milk' })];

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(dismissInboxItemMock).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms before dismissing an item that carries notes', async () => {
    const user = userEvent.setup();
    storeState.inboxItems = [makeItem({ id: 'a', title: 'Buy milk', notes: 'oat milk please' })];

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dismissInboxItemMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: /dismiss/i }));
    expect(dismissInboxItemMock).toHaveBeenCalledWith('a');
  });

  it('assigns an unsorted item to a project', async () => {
    const user = userEvent.setup();
    storeState.inboxItems = [makeItem({ id: 'a', title: 'Buy milk' })];
    storeState.starredProjects = [{ path: '/repos/alpha', name: 'alpha', starredAt: 1 }];

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /assign/i }));
    await user.click(screen.getByRole('menuitem', { name: 'alpha' }));

    expect(assignInboxItemMock).toHaveBeenCalledWith({ itemId: 'a', projectPath: '/repos/alpha' });
  });

  it('confirms before unassigning an item', async () => {
    const user = userEvent.setup();
    storeState.inboxItems = [
      makeItem({
        id: 'a',
        title: 'Fix the bug',
        projectPath: '/repos/alpha',
        projectName: 'alpha',
        ticketId: 't1',
        assignedAt: '2026-01-01 00:00:00',
      }),
    ];
    storeState.inboxOverview = { '/repos/alpha': makeOverview() };

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await user.click(screen.getByRole('menuitem', { name: /unassign/i }));

    const dialog = await screen.findByRole('dialog');
    expect(unassignInboxItemMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /unassign/i }));

    expect(unassignInboxItemMock).toHaveBeenCalledWith('a');
  });

  it('hides the capture bar when hideCapture is set', () => {
    storeState.inboxItems = [makeItem()];
    render(<InboxPanel variant="wide" hideCapture onOpenProject={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/capture a task/i)).not.toBeInTheDocument();
  });

  it('shows the capture bar by default', () => {
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByPlaceholderText(/capture a task/i)).toBeInTheDocument();
  });

  it('renders nothing on the wide start-screen variant while still loading', () => {
    // Nothing is known yet either way — a loading skeleton on the splash
    // screen is exactly the noise this gate exists to prevent.
    storeState.inboxLoading = true;
    const { container } = render(<InboxPanel variant="wide" hideCapture onOpenProject={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on the wide start-screen variant when the inbox is empty', () => {
    const { container } = render(<InboxPanel variant="wide" hideCapture onOpenProject={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still shows the calm empty state on the sidebar variant', () => {
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    expect(screen.getByTestId('inbox-empty')).toBeInTheDocument();
  });

  it('does not throw when the backend hands back a null item list', () => {
    // Mirrors what a generic `invoke` mock (or a browser-mode fallback) can
    // leave in the store: `loadInbox` assigns the IPC result verbatim, and a
    // mock that resolves `null` for every command is common enough elsewhere
    // in this suite that the panel has to survive it, not just the real app.
    storeState.inboxItems = null as unknown as InboxItem[];
    expect(() => render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />)).not.toThrow();
  });

  it('renders the wide summary once the inbox has an item', () => {
    storeState.inboxItems = [makeItem({ id: 'a', title: 'Buy milk' })];
    render(<InboxPanel variant="wide" hideCapture onOpenProject={vi.fn()} />);
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it('gives the wide variant the same glass material as the project switcher below the hero', () => {
    storeState.inboxItems = [makeItem({ id: 'a', title: 'Buy milk' })];
    render(<InboxPanel variant="wide" hideCapture onOpenProject={vi.fn()} />);
    const panel = screen.getByTestId('inbox-panel');
    expect(panel).toHaveClass('glass-card', 'rounded-2xl');
    expect(panel).not.toHaveClass('h-full');
  });

  it('keeps the sidebar variant filling its panel height, flat (no glass card)', () => {
    storeState.inboxItems = [makeItem({ id: 'a', title: 'Buy milk' })];
    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);
    const panel = screen.getByTestId('inbox-panel');
    expect(panel).toHaveClass('h-full');
    expect(panel).not.toHaveClass('glass-card');
  });
});
