import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxCapture } from './InboxCapture';
import type { InboxItem } from '@/lib/tauri/inbox';

const addInboxItemMock = vi.fn<(title: string, notes?: string) => Promise<InboxItem | null>>();

const storeState = {
  addInboxItem: (title: string, notes?: string) => addInboxItemMock(title, notes),
  inboxError: null as string | null,
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
  };
}

describe('InboxCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.inboxError = null;
    addInboxItemMock.mockImplementation(async (title) => makeItem(title));
  });

  it('shows the capture placeholder', () => {
    render(<InboxCapture />);
    expect(screen.getByPlaceholderText(/capture a task/i)).toBeInTheDocument();
  });

  it('captures a trimmed title on Enter', async () => {
    const user = userEvent.setup();
    render(<InboxCapture />);

    await user.type(screen.getByPlaceholderText(/capture a task/i), '  Write the report  {enter}');

    expect(addInboxItemMock).toHaveBeenCalledWith('Write the report', undefined);
  });

  it('does nothing on Enter with an empty input', async () => {
    const user = userEvent.setup();
    render(<InboxCapture />);

    await user.type(screen.getByPlaceholderText(/capture a task/i), '{enter}');

    expect(addInboxItemMock).not.toHaveBeenCalled();
  });

  it('does nothing on Enter with only whitespace', async () => {
    const user = userEvent.setup();
    render(<InboxCapture />);

    await user.type(screen.getByPlaceholderText(/capture a task/i), '   {enter}');

    expect(addInboxItemMock).not.toHaveBeenCalled();
  });

  it('clears the input and keeps focus after a successful capture', async () => {
    const user = userEvent.setup();
    render(<InboxCapture />);
    const input = screen.getByPlaceholderText(/capture a task/i) as HTMLInputElement;

    await user.type(input, 'Buy milk{enter}');

    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('calls onCaptured with the created item', async () => {
    const user = userEvent.setup();
    const onCaptured = vi.fn();
    render(<InboxCapture onCaptured={onCaptured} />);

    await user.type(screen.getByPlaceholderText(/capture a task/i), 'Buy milk{enter}');

    expect(onCaptured).toHaveBeenCalledWith(makeItem('Buy milk'));
  });

  it('blurs the input on Escape', async () => {
    const user = userEvent.setup();
    render(<InboxCapture />);
    const input = screen.getByPlaceholderText(/capture a task/i);

    await user.click(input);
    expect(document.activeElement).toBe(input);
    await user.keyboard('{Escape}');

    expect(document.activeElement).not.toBe(input);
  });

  it('focuses the input on mount when autoFocus is set', () => {
    render(<InboxCapture autoFocus />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/capture a task/i));
  });

  it('shows a persistent kbd hint', () => {
    render(<InboxCapture />);
    expect(screen.getByText('⏎')).toBeInTheDocument();
    expect(screen.getByText('Add')).toBeInTheDocument();
  });

  describe('a failed capture', () => {
    beforeEach(() => {
      addInboxItemMock.mockImplementation(async () => {
        storeState.inboxError = 'disk full';
        return null;
      });
    });

    it('keeps the typed text instead of clearing it', async () => {
      const user = userEvent.setup();
      render(<InboxCapture />);
      const input = screen.getByPlaceholderText(/capture a task/i) as HTMLInputElement;

      await user.type(input, 'Buy milk{enter}');

      expect(input.value).toBe('Buy milk');
    });

    it('shows the inbox error inline as an alert', async () => {
      const user = userEvent.setup();
      render(<InboxCapture />);

      await user.type(screen.getByPlaceholderText(/capture a task/i), 'Buy milk{enter}');

      expect(screen.getByRole('alert')).toHaveTextContent('disk full');
    });

    it('does not call onCaptured', async () => {
      const user = userEvent.setup();
      const onCaptured = vi.fn();
      render(<InboxCapture onCaptured={onCaptured} />);

      await user.type(screen.getByPlaceholderText(/capture a task/i), 'Buy milk{enter}');

      expect(onCaptured).not.toHaveBeenCalled();
    });

    it('clears the error once the user edits the text again', async () => {
      const user = userEvent.setup();
      render(<InboxCapture />);
      const input = screen.getByPlaceholderText(/capture a task/i);

      await user.type(input, 'Buy milk{enter}');
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await user.type(input, '!');

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
