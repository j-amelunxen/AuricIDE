import { fireEvent, render, screen, within } from '@testing-library/react';
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

const readFileMock = vi.fn(async (_path: string) => 'Guten Tag, anbei das Angebot.');

vi.mock('@/lib/tauri/fs', () => ({
  readFile: (path: string) => readFileMock(path),
}));

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
    priority: 'normal',
    dueDate: null,
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
    onUpdate: vi.fn(),
    onDismiss: vi.fn(),
    onAssign: vi.fn(),
    onUnassign: vi.fn(),
    onOpenProject: vi.fn(),
    onHandToAgent: vi.fn(),
    onAttach: vi.fn(),
    onAttachText: vi.fn(),
    onDetach: vi.fn(),
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
      const { onUpdate } = renderRow();

      await user.dblClick(screen.getByText('Write the report'));
      const input = screen.getByDisplayValue('Write the report');
      await user.clear(input);
      await user.type(input, 'Write the final report{enter}');

      expect(onUpdate).toHaveBeenCalledWith('item-1', { title: 'Write the final report' });
      expect(screen.queryByDisplayValue('Write the final report')).not.toBeInTheDocument();
    });

    it('cancels the edit on Escape without updating', async () => {
      const user = userEvent.setup();
      const { onUpdate } = renderRow();

      await user.dblClick(screen.getByText('Write the report'));
      const input = screen.getByDisplayValue('Write the report');
      await user.type(input, ' more{escape}');

      expect(onUpdate).not.toHaveBeenCalled();
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

    it('copies the title to the clipboard from the copy button next to Assign', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderRow();

      await user.click(screen.getByRole('button', { name: /copy/i }));

      expect(writeText).toHaveBeenCalledWith('Write the report');
    });

    it('includes the notes when copying an item that has them', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderRow({ item: makeItem({ notes: 'Ask the client for the invoice number.' }) });

      await user.click(screen.getByRole('button', { name: /copy/i }));

      expect(writeText).toHaveBeenCalledWith(
        'Write the report\n\nAsk the client for the invoice number.'
      );
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

    it('still shows the stored priority after assign', () => {
      renderRow({ item: assigned, ticketStatus: 'open' });
      expect(screen.getByRole('button', { name: /priority: normal/i })).toBeInTheDocument();
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

  describe('priority and due date', () => {
    it('shows the current priority and lets it be changed', async () => {
      const user = userEvent.setup();
      const { onUpdate } = renderRow({ item: makeItem({ priority: 'high' }) });

      await user.click(screen.getByRole('button', { name: /priority: high/i }));
      await user.click(screen.getByRole('menuitem', { name: /critical/i }));

      expect(onUpdate).toHaveBeenCalledWith('item-1', { priority: 'critical' });
    });

    it('shows a due date and lets it be changed', () => {
      const { onUpdate } = renderRow({ item: makeItem({ dueDate: '2026-08-20' }) });

      expect(screen.getByText('20 Aug')).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: '2026-08-22' } });

      expect(onUpdate).toHaveBeenCalledWith('item-1', { dueDate: '2026-08-22' });
    });

    it('marks an overdue item', () => {
      renderRow({
        item: makeItem({ dueDate: '2025-12-01' }),
        now: new Date('2026-01-01T00:05:00Z').getTime(),
      });
      expect(screen.getByText(/overdue/i)).toBeInTheDocument();
    });
  });

  describe('attachments', () => {
    const shot = {
      id: 'att-1',
      itemId: 'item-1',
      kind: 'image' as const,
      fileName: 'shot.png',
      storedPath: '/tmp/shot.png',
      createdAt: '2026-08-18 00:00:00',
    };
    const clip = {
      id: 'att-2',
      itemId: 'item-1',
      kind: 'video' as const,
      fileName: 'clip.mp4',
      storedPath: '/tmp/clip.mp4',
      createdAt: '2026-08-18 00:00:00',
    };

    it('shows image and video names when the item has attachments', () => {
      renderRow({ item: makeItem({ attachments: [shot, clip] }) });
      expect(screen.getByText('shot.png')).toBeInTheDocument();
      expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    });

    it('removes an attachment from the item', async () => {
      const user = userEvent.setup();
      const { onDetach } = renderRow({ item: makeItem({ attachments: [shot] }) });

      await user.click(screen.getByRole('button', { name: /remove shot.png/i }));

      expect(onDetach).toHaveBeenCalledWith('item-1', 'att-1');
    });

    it('offers an attach control', () => {
      renderRow();
      expect(screen.getByRole('button', { name: /attach image or video/i })).toBeInTheDocument();
    });

    it('opens the attachment on a click, so its content can be read here', async () => {
      const user = userEvent.setup();
      renderRow({ item: makeItem({ attachments: [shot] }) });

      await user.click(screen.getByRole('button', { name: /open shot\.png/i }));

      const sheet = screen.getByRole('dialog');
      expect(sheet).toHaveAccessibleName(/shot\.png/i);
      expect(within(sheet).getByRole('img')).toHaveAttribute('src', '/tmp/shot.png');
    });

    it('reads a stored text attachment when its chip is clicked', async () => {
      const user = userEvent.setup();
      renderRow({
        item: makeItem({
          attachments: [
            {
              id: 'att-9',
              itemId: 'item-1',
              kind: 'text' as const,
              fileName: 'angebot.md',
              storedPath: '/store/item-1/angebot.md',
              createdAt: '2026-01-01 00:00:00',
            },
          ],
        }),
      });

      await user.click(screen.getByRole('button', { name: /open angebot\.md/i }));

      expect(await screen.findByText(/anbei das Angebot/)).toBeInTheDocument();
      expect(readFileMock).toHaveBeenCalledWith('/store/item-1/angebot.md');
    });

    it('removes an attachment without opening it', async () => {
      const user = userEvent.setup();
      const { onDetach } = renderRow({ item: makeItem({ attachments: [shot] }) });

      await user.click(screen.getByRole('button', { name: /remove shot\.png/i }));

      expect(onDetach).toHaveBeenCalledWith('item-1', 'att-1');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('InboxItemRow: attaching a whole text', () => {
  it('hands the pasted mail to onAttachText for this item', async () => {
    const user = userEvent.setup();
    const handlers = renderRow({ item: makeItem({ id: 'item-7' }) });
    const mail = 'Subject: Angebot Dachsanierung\n\nGuten Tag, anbei das Angebot.';

    await user.click(screen.getByRole('button', { name: /attach text/i }));
    await user.click(screen.getByLabelText(/^text$/i));
    await user.paste(mail);
    await user.click(screen.getByRole('button', { name: /^attach$/i }));

    expect(handlers.onAttachText).toHaveBeenCalledWith('item-7', 'angebot-dachsanierung.md', mail);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows an attached text without trying to paint it as an image', () => {
    renderRow({
      item: makeItem({
        attachments: [
          {
            id: 'att-9',
            itemId: 'item-7',
            kind: 'text',
            fileName: 'angebot.md',
            storedPath: '/store/item-7/angebot.md',
            createdAt: '2026-01-01 00:00:00',
          },
        ],
      }),
    });

    expect(screen.getByText('angebot.md')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
