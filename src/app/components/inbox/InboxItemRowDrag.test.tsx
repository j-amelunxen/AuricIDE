import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InboxItemRow } from './InboxItemRow';
import { InboxOverviewTicketRow } from './InboxOverviewTicketRow';
import {
  INBOX_ITEM_DRAG_MIME,
  INBOX_TASK_DRAG_MIME,
  INBOX_TICKET_DRAG_MIME,
} from '@/lib/inbox/inboxDrag';
import type { InboxItem, ProjectTicketDigest } from '@/lib/tauri/inbox';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-dnd-1',
    title: 'Draggable Task',
    notes: '',
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:00Z',
    projectPath: null,
    projectName: null,
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    priority: 'normal',
    dueDate: null,
    dailyGoal: false,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<ProjectTicketDigest> = {}): ProjectTicketDigest {
  return {
    id: 'ticket-dnd-1',
    name: 'Overview Ticket',
    status: 'open',
    priority: 'normal',
    epicId: 'epic-1',
    epicName: 'Core',
    updatedAt: '2026-09-08T10:00:00Z',
    ...overrides,
  };
}

function createDataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((key: string, val: string) => {
      store[key] = val;
    }),
    getData: vi.fn((key: string) => store[key] ?? ''),
    store,
  };
}

describe('InboxItemRow - Drag and Drop', () => {
  const defaultRowProps = {
    item: makeItem(),
    ticketStatus: 'unknown' as const,
    now: Date.now(),
    starredProjects: [],
    projectOptions: [],
    overview: {},
    onUpdate: vi.fn(),
    onDismiss: vi.fn(),
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onOpenProject: vi.fn(),
    onHandToAgent: vi.fn(),
    onAttach: vi.fn(),
    onAttachText: vi.fn(),
    onDetach: vi.fn(),
    onSetStatus: vi.fn(),
  };

  it('renders with draggable=true and sets drag data on dragStart', () => {
    render(<InboxItemRow {...defaultRowProps} />);
    const row = screen.getByTestId('inbox-item-item-dnd-1');

    expect(row).toHaveAttribute('draggable', 'true');

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });

    expect(dataTransfer.store[INBOX_ITEM_DRAG_MIME]).toBe('item-dnd-1');
    expect(dataTransfer.store[INBOX_TASK_DRAG_MIME]).toBe(
      JSON.stringify({ type: 'inbox-item', id: 'item-dnd-1' })
    );

    // Opacity reduced while dragging
    expect(row.className).toContain('opacity-40');

    // Restores opacity on dragEnd
    fireEvent.dragEnd(row);
    expect(row.className).not.toContain('opacity-40');
  });

  it('is not draggable while editing title', async () => {
    const user = userEvent.setup();
    render(<InboxItemRow {...defaultRowProps} />);
    const titleBtn = screen.getByText('Draggable Task');

    await user.dblClick(titleBtn);

    const row = screen.getByTestId('inbox-item-item-dnd-1');
    expect(row).toHaveAttribute('draggable', 'false');
  });
});

describe('InboxOverviewTicketRow - Drag and Drop', () => {
  it('renders with draggable=true and sets ticket drag data on dragStart', () => {
    render(
      <InboxOverviewTicketRow
        ticket={makeTicket()}
        projectPath="/repos/alpha"
        onSetStatus={vi.fn()}
      />
    );
    const row = screen.getByTestId('inbox-overview-ticket-ticket-dnd-1');

    expect(row).toHaveAttribute('draggable', 'true');

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });

    expect(dataTransfer.store[INBOX_TICKET_DRAG_MIME]).toBe('/repos/alpha:ticket-dnd-1');
    expect(dataTransfer.store[INBOX_TASK_DRAG_MIME]).toBe(
      JSON.stringify({ type: 'ticket', projectPath: '/repos/alpha', ticketId: 'ticket-dnd-1' })
    );

    expect(row.className).toContain('opacity-40');

    fireEvent.dragEnd(row);
    expect(row.className).not.toContain('opacity-40');
  });
});
