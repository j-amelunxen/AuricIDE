import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxCaptureOverlay } from './InboxCaptureOverlay';
import type { InboxItem } from '@/lib/tauri/inbox';

const addInboxItemMock = vi.fn<(title: string, notes?: string) => Promise<InboxItem | null>>();
const setInboxCaptureOpenMock = vi.fn();

const storeState = {
  inboxCaptureOpen: true,
  setInboxCaptureOpen: (open: boolean) => setInboxCaptureOpenMock(open),
  addInboxItem: (title: string, notes?: string) => addInboxItemMock(title, notes),
  attachInboxFile: vi.fn(async () => null),
  inboxError: null as string | null,
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

function makeItem(title: string): InboxItem {
  return {
    id: 'new-item',
    title,
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
  };
}

describe('InboxCaptureOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.inboxCaptureOpen = true;
    storeState.inboxError = null;
    storeState.overlayStack = { layers: [] };
    addInboxItemMock.mockImplementation(async (title) => makeItem(title));
  });

  it('renders nothing when closed', () => {
    storeState.inboxCaptureOpen = false;
    render(<InboxCaptureOverlay />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a centered dialog with one input when open', () => {
    render(<InboxCaptureOverlay />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/capture a task/i)).toBeInTheDocument();
  });

  it('adds the task and closes on plain Enter', async () => {
    const user = userEvent.setup();
    render(<InboxCaptureOverlay />);

    await user.type(screen.getByPlaceholderText(/capture a task/i), 'Buy milk{enter}');

    expect(addInboxItemMock).toHaveBeenCalledWith('Buy milk', undefined);
    expect(setInboxCaptureOpenMock).toHaveBeenCalledWith(false);
  });

  it('adds the task and stays open on Shift+Enter, clearing the input', async () => {
    const user = userEvent.setup();
    render(<InboxCaptureOverlay />);
    const input = screen.getByPlaceholderText(/capture a task/i) as HTMLInputElement;

    await user.type(input, 'Buy milk{Shift>}{enter}{/Shift}');

    expect(addInboxItemMock).toHaveBeenCalledWith('Buy milk', undefined);
    expect(setInboxCaptureOpenMock).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('does nothing on Enter with an empty input', async () => {
    const user = userEvent.setup();
    render(<InboxCaptureOverlay />);

    await user.type(screen.getByPlaceholderText(/capture a task/i), '{enter}');

    expect(addInboxItemMock).not.toHaveBeenCalled();
    expect(setInboxCaptureOpenMock).not.toHaveBeenCalled();
  });

  it('closes on Escape without adding', async () => {
    const user = userEvent.setup();
    render(<InboxCaptureOverlay />);

    await user.type(screen.getByPlaceholderText(/capture a task/i), 'Buy milk');
    await user.keyboard('{Escape}');

    expect(addInboxItemMock).not.toHaveBeenCalled();
    expect(setInboxCaptureOpenMock).toHaveBeenCalledWith(false);
  });

  it('shows a persistent kbd hint for each mode', () => {
    render(<InboxCaptureOverlay />);
    expect(screen.getByText('Add and close')).toBeInTheDocument();
    expect(screen.getByText('Add and keep capturing')).toBeInTheDocument();
  });

  describe('a failed capture', () => {
    beforeEach(() => {
      addInboxItemMock.mockImplementation(async () => {
        storeState.inboxError = 'disk full';
        return null;
      });
    });

    it('keeps the dialog open and the typed text on plain Enter', async () => {
      const user = userEvent.setup();
      render(<InboxCaptureOverlay />);
      const input = screen.getByPlaceholderText(/capture a task/i) as HTMLInputElement;

      await user.type(input, 'Buy milk{enter}');

      expect(setInboxCaptureOpenMock).not.toHaveBeenCalled();
      expect(input.value).toBe('Buy milk');
    });

    it('keeps the typed text on Shift+Enter too', async () => {
      const user = userEvent.setup();
      render(<InboxCaptureOverlay />);
      const input = screen.getByPlaceholderText(/capture a task/i) as HTMLInputElement;

      await user.type(input, 'Buy milk{Shift>}{enter}{/Shift}');

      expect(input.value).toBe('Buy milk');
    });

    it('shows the inbox error inline as an alert', async () => {
      const user = userEvent.setup();
      render(<InboxCaptureOverlay />);

      await user.type(screen.getByPlaceholderText(/capture a task/i), 'Buy milk{enter}');

      expect(screen.getByRole('alert')).toHaveTextContent('disk full');
    });
  });
});
