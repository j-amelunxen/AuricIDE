import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxItemRow, type InboxItemRowProps } from './InboxItemRow';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';
import type { ProjectPickerOption } from '@/lib/projects/projectOptions';

const storeState = {
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

vi.mock('@/lib/store', () => ({
  useStore: Object.assign((selector: (s: typeof storeState) => unknown) => selector(storeState), {
    getState: () => storeState,
  }),
}));

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

const projectOptions: ProjectPickerOption[] = [
  { path: '/repos/alpha', name: 'alpha', starred: true },
  { path: '/repos/beta', name: 'beta', starred: false },
];

const now = new Date('2026-01-01T00:05:00Z').getTime();

function renderRow(overrides: Partial<React.ComponentProps<typeof InboxItemRow>> = {}) {
  const handlers = {
    onUpdateTitle: vi.fn(),
    onDismiss: vi.fn(),
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onOpenProject: vi.fn(),
    onHandToAgent: vi.fn(),
  };
  const props: React.ComponentProps<typeof InboxItemRow> = {
    item: makeItem(),
    ticketStatus: 'unknown',
    now,
    starredProjects: [],
    projectOptions,
    overview: {},
    ...handlers,
    ...overrides,
  };
  const result = render(<InboxItemRow {...props} />);
  return { ...result, ...handlers };
}

describe('InboxItemRow', () => {
  beforeEach(() => {
    storeState.overlayStack = { layers: [] };
  });

  it('renders the title', () => {
    renderRow();
    expect(screen.getByText('Write the report')).toBeInTheDocument();
  });

  describe('inline title editing', () => {
    it('enters edit mode on double-click and commits on Enter', async () => {
      const user = userEvent.setup();
      const { onUpdateTitle } = renderRow();

      await user.dblClick(screen.getByText('Write the report'));
      const input = screen.getByDisplayValue('Write the report');
      await user.clear(input);
      await user.type(input, 'Write the final report{enter}');

      expect(onUpdateTitle).toHaveBeenCalledWith('item-1', 'Write the final report');
      expect(screen.queryByDisplayValue('Write the final report')).not.toBeInTheDocument();
    });

    it('cancels the edit on Escape without updating', async () => {
      const user = userEvent.setup();
      const { onUpdateTitle } = renderRow();

      await user.dblClick(screen.getByText('Write the report'));
      const input = screen.getByDisplayValue('Write the report');
      await user.type(input, ' more{escape}');

      expect(onUpdateTitle).not.toHaveBeenCalled();
      expect(screen.getByText('Write the report')).toBeInTheDocument();
    });
  });

  describe('an unsorted (unassigned) item', () => {
    it('offers an Assign control and no project chrome', () => {
      renderRow();
      expect(screen.getByRole('button', { name: /assign/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /open project/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /hand to agent/i })).not.toBeInTheDocument();
    });

    it('keeps the Assign button and the rename trigger keyboard-focusable', () => {
      renderRow();
      expect(screen.getByRole('button', { name: /assign/i })).toHaveClass(
        'focus-visible:outline-2'
      );
      expect(screen.getByText('Write the report')).toHaveClass('focus-visible:outline-2');
    });

    it('assigns straight to a project with no epics', async () => {
      const user = userEvent.setup();
      const { onAssign } = renderRow();

      await user.click(screen.getByRole('button', { name: /assign/i }));
      const menu = screen.getByRole('menu');
      await user.click(within(menu).getByRole('menuitem', { name: 'alpha' }));

      expect(onAssign).toHaveBeenCalledWith({ itemId: 'item-1', projectPath: '/repos/alpha' });
    });

    it('shows a project tile mark, not a generic icon, in the assign menu', async () => {
      const user = userEvent.setup();
      renderRow();

      await user.click(screen.getByRole('button', { name: /assign/i }));

      const item = screen.getByRole('menuitem', { name: 'alpha' });
      // ProjectTileFace renders its own box — an icon glyph would carry a
      // data-icon attribute instead.
      expect(item.querySelector('[data-icon]')).not.toBeInTheDocument();
    });

    it('says so when no project can be assigned to', async () => {
      const user = userEvent.setup();
      renderRow({ projectOptions: [] });

      await user.click(screen.getByRole('button', { name: /assign/i }));

      expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    });

    it('opens an epic sub-menu for a project that has epics', async () => {
      const user = userEvent.setup();
      const overview: Record<string, ProjectPmOverview> = {
        '/repos/alpha': {
          projectPath: '/repos/alpha',
          projectName: 'alpha',
          hasDb: true,
          open: 1,
          inProgress: 0,
          inReview: 0,
          done: 0,
          epics: [{ id: 'epic-1', name: 'Backend' }],
          tickets: [],
          error: null,
        },
      };
      const { onAssign } = renderRow({ overview });

      await user.click(screen.getByRole('button', { name: /assign/i }));
      await user.click(screen.getByRole('menuitem', { name: 'alpha' }));

      const epicMenu = screen.getByRole('menu');
      await user.click(within(epicMenu).getByRole('menuitem', { name: 'Backend' }));

      expect(onAssign).toHaveBeenCalledWith({
        itemId: 'item-1',
        projectPath: '/repos/alpha',
        epicId: 'epic-1',
      });
    });

    it('assigns to the default Inbox epic from the epic sub-menu', async () => {
      const user = userEvent.setup();
      const overview: Record<string, ProjectPmOverview> = {
        '/repos/alpha': {
          projectPath: '/repos/alpha',
          projectName: 'alpha',
          hasDb: true,
          open: 1,
          inProgress: 0,
          inReview: 0,
          done: 0,
          epics: [{ id: 'epic-1', name: 'Backend' }],
          tickets: [],
          error: null,
        },
      };
      const { onAssign } = renderRow({ overview });

      await user.click(screen.getByRole('button', { name: /assign/i }));
      await user.click(screen.getByRole('menuitem', { name: 'alpha' }));
      const epicMenu = screen.getByRole('menu');
      await user.click(within(epicMenu).getByRole('menuitem', { name: /inbox/i }));

      expect(onAssign).toHaveBeenCalledWith({ itemId: 'item-1', projectPath: '/repos/alpha' });
    });

    it('calls onDismiss when the dismiss button is clicked', async () => {
      const user = userEvent.setup();
      const { onDismiss } = renderRow();

      await user.click(screen.getByRole('button', { name: /dismiss/i }));

      expect(onDismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }));
    });
  });

  describe('an assigned item', () => {
    const assigned = makeItem({
      projectPath: '/repos/alpha',
      projectName: 'alpha',
      ticketId: 'ticket-1',
      assignedAt: '2026-01-01 00:00:00',
    });

    it('shows the project mark, name and a status chip instead of Assign', () => {
      renderRow({ item: assigned, ticketStatus: 'in_progress' });

      expect(screen.queryByRole('button', { name: /^assign/i })).not.toBeInTheDocument();
      expect(screen.getByText('alpha')).toBeInTheDocument();
      expect(screen.getByText('IP')).toBeInTheDocument();
    });

    it('calls onOpenProject with the project path', async () => {
      const user = userEvent.setup();
      const { onOpenProject } = renderRow({ item: assigned, ticketStatus: 'open' });

      await user.click(screen.getByRole('button', { name: /open project/i }));

      expect(onOpenProject).toHaveBeenCalledWith('/repos/alpha');
    });

    it('calls onHandToAgent with the item', async () => {
      const user = userEvent.setup();
      const { onHandToAgent } = renderRow({ item: assigned, ticketStatus: 'open' });

      await user.click(screen.getByRole('button', { name: /hand to agent/i }));

      expect(onHandToAgent).toHaveBeenCalledWith(assigned);
    });

    it('calls onUnassign from the overflow menu', async () => {
      const user = userEvent.setup();
      const { onUnassign } = renderRow({ item: assigned, ticketStatus: 'open' });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await user.click(screen.getByRole('menuitem', { name: /unassign/i }));

      expect(onUnassign).toHaveBeenCalledWith(assigned);
    });

    it('shows an unknown status distinctly when the overview has not loaded', () => {
      renderRow({ item: assigned, ticketStatus: 'unknown' });
      expect(screen.getByText(/unknown/i)).toBeInTheDocument();
    });

    it('falls back to Unknown for a status the vocabulary does not recognise', () => {
      // A status string the project db never should have written (an old
      // schema, a hand-edited row) must not render as a blank chip.
      renderRow({
        item: assigned,
        ticketStatus: 'blocked' as unknown as InboxItemRowProps['ticketStatus'],
      });
      expect(screen.getByText('Unknown')).toBeInTheDocument();
    });
  });
});
