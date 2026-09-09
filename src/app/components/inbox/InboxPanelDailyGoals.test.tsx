import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxPanel } from './InboxPanel';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Daily Goal Task',
    notes: '',
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:00Z',
    projectPath: '/repos/alpha',
    projectName: 'alpha',
    ticketId: 't-1',
    assignedAt: '2026-09-08T10:00:00Z',
    dismissedAt: null,
    priority: 'normal',
    dueDate: null,
    dailyGoal: false,
    ...overrides,
  };
}

const mockToggleDailyGoal = vi.fn();
const mockSetDailyGoal = vi.fn();
const mockCaptureTicketAsDailyGoal = vi.fn();
const mockAddInboxItem = vi.fn();

let storeState: Record<string, unknown>;

vi.mock('@/lib/store', () => ({
  useStore: (selector: (state: unknown) => unknown) => selector(storeState),
}));

vi.mock('@/lib/tauri/clipboard', () => ({
  copyToClipboard: vi.fn(async () => true),
}));

describe('InboxPanel - Daily Goals Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = {
      inboxItems: [] as InboxItem[],
      inboxLoading: false,
      inboxError: null,
      inboxOverview: {} as Record<string, ProjectPmOverview>,
      starredProjects: [{ path: '/repos/alpha', name: 'alpha', starredAt: 100 }],
      recentProjects: [],
      rootPath: null,
      pmDraftTickets: [],
      toggleDailyGoal: mockToggleDailyGoal,
      setDailyGoal: mockSetDailyGoal,
      captureTicketAsDailyGoal: mockCaptureTicketAsDailyGoal,
      addInboxItem: mockAddInboxItem,
      updateInboxItem: vi.fn(),
      dismissInboxItem: vi.fn(),
      assignInboxItem: vi.fn(),
      unassignInboxItem: vi.fn(),
      setInboxTicketStatus: vi.fn(),
      attachInboxFile: vi.fn(),
      attachInboxText: vi.fn(),
      detachInboxFile: vi.fn(),
      setSpawnAgentTicketId: vi.fn(),
      overlayStack: { layers: [] as { id: string; kind: string }[] },
      pushOverlay: vi.fn(),
      removeOverlay: vi.fn(),
      ownsEscape: vi.fn(() => false),
    };
  });

  it('renders Tagesziele section at the top of InboxPanel', () => {
    const goal = makeItem({ id: 'g1', title: 'Sprint Goal Alpha', dailyGoal: true });
    storeState.inboxItems = [goal];

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);

    const section = screen.getByTestId('inbox-daily-goals-section');
    expect(section).toBeInTheDocument();
    expect(within(section).getByText('Sprint Goal Alpha')).toBeInTheDocument();
    expect(screen.getByTestId('daily-goals-progress')).toHaveTextContent('0/1 erledigt');
  });

  it('opens daily goals planner when clicking Planen button', async () => {
    const user = userEvent.setup();

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);

    const planBtn = screen.getByRole('button', { name: /Tagesziele planen/i });
    await user.click(planBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByText(/Wähle pro Projekt genau ein Mini-Sprint-Ziel für den Tag/i)
    ).toBeInTheDocument();
  });

  it('sets an inbox item as daily goal when dropped into Tagesziele', () => {
    const item = makeItem({ id: 'unsorted-1', title: 'Plan launch', dailyGoal: false });
    storeState.inboxItems = [item];

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);

    const section = screen.getByTestId('inbox-daily-goals-section');
    const row = screen.getByTestId('inbox-item-unsorted-1');

    const dataStore: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn((k: string, v: string) => {
        dataStore[k] = v;
      }),
      getData: vi.fn((k: string) => dataStore[k] ?? ''),
    };

    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.dragOver(section, { dataTransfer });
    fireEvent.drop(section, { dataTransfer });

    expect(mockSetDailyGoal).toHaveBeenCalledWith('unsorted-1', true);
  });

  it('captures an overview ticket as daily goal when dropped into Tagesziele', () => {
    const assignedItem = makeItem({
      id: 'assigned-1',
      projectPath: '/repos/alpha',
      projectName: 'alpha',
      ticketId: 't-assigned-1',
    });
    storeState.inboxItems = [assignedItem];
    storeState.inboxOverview = {
      '/repos/alpha': {
        projectPath: '/repos/alpha',
        projectName: 'alpha',
        hasDb: true,
        open: 1,
        inProgress: 0,
        inReview: 0,
        done: 0,
        epics: [],
        tickets: [
          {
            id: 't-assigned-1',
            name: 'Assigned Task',
            status: 'open',
            priority: 'normal',
            epicId: 'epic-1',
            epicName: 'Auth',
            updatedAt: '2026-09-08T10:00:00Z',
          },
          {
            id: 't-overview-1',
            name: 'Fix login bug',
            status: 'open',
            priority: 'high',
            epicId: 'epic-1',
            epicName: 'Auth',
            updatedAt: '2026-09-08T10:00:00Z',
          },
        ],
        error: null,
      },
    };

    render(<InboxPanel variant="sidebar" onOpenProject={vi.fn()} />);

    const section = screen.getByTestId('inbox-daily-goals-section');
    const ticketRow = screen.getByTestId('inbox-overview-ticket-t-overview-1');

    const dataStore: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn((k: string, v: string) => {
        dataStore[k] = v;
      }),
      getData: vi.fn((k: string) => dataStore[k] ?? ''),
    };

    fireEvent.dragStart(ticketRow, { dataTransfer });
    fireEvent.dragOver(section, { dataTransfer });
    fireEvent.drop(section, { dataTransfer });

    expect(mockCaptureTicketAsDailyGoal).toHaveBeenCalledWith('/repos/alpha', 't-overview-1');
  });
});
