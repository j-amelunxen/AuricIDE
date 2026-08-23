import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxAttachmentSheet } from './InboxAttachmentSheet';
import type { InboxAttachment } from '@/lib/tauri/inbox';

const readFileMock = vi.fn(async (_path: string) => 'body');

vi.mock('@/lib/tauri/fs', () => ({
  readFile: (path: string) => readFileMock(path),
}));

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

function attachment(overrides: Partial<InboxAttachment> = {}): InboxAttachment {
  return {
    id: 'att-1',
    itemId: 'item-1',
    kind: 'text',
    fileName: 'angebot.md',
    storedPath: '/store/item-1/angebot.md',
    createdAt: '2026-01-01 00:00:00',
    ...overrides,
  };
}

describe('InboxAttachmentSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.overlayStack = { layers: [] };
    readFileMock.mockResolvedValue('body');
  });

  it('shows the text a pasted mail was stored as', async () => {
    readFileMock.mockResolvedValue('Subject: Angebot\n\nGuten Tag, anbei das Angebot.');
    render(<InboxAttachmentSheet attachment={attachment()} onClose={vi.fn()} />);

    expect(await screen.findByText(/anbei das Angebot/)).toBeInTheDocument();
    expect(readFileMock).toHaveBeenCalledWith('/store/item-1/angebot.md');
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/angebot\.md/i);
  });

  it('says so when the stored file cannot be read, and never shows the raw error', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT: no such file or directory, open ...'));
    render(<InboxAttachmentSheet attachment={attachment()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't be read/i);
    expect(screen.queryByText(/ENOENT/)).not.toBeInTheDocument();
  });

  it('paints an image attachment instead of reading it as text', async () => {
    render(
      <InboxAttachmentSheet
        attachment={attachment({ kind: 'image', fileName: 'shot.png', storedPath: '/s/shot.png' })}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', '/s/shot.png'));
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('plays a video attachment with controls', async () => {
    const { container } = render(
      <InboxAttachmentSheet
        attachment={attachment({ kind: 'video', fileName: 'clip.mp4', storedPath: '/s/clip.mp4' })}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(container.querySelector('video')).not.toBeNull());
    const video = container.querySelector('video');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('src', '/s/clip.mp4');
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('closes on the close button and on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<InboxAttachmentSheet attachment={attachment()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
