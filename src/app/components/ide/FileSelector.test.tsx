import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { FileSelector } from './FileSelector';
import { useStore } from '@/lib/store';
import { defaultCommands } from '@/lib/commands/registry';

describe('FileSelector', () => {
  const mockFiles = [
    { path: '/root/src/index.ts', extension: 'ts', line_count: 100 },
    { path: '/root/src/main.rs', extension: 'rs', line_count: 600 },
    { path: '/root/README.md', extension: 'md', line_count: 50 },
  ];

  afterEach(() => {
    useStore.setState({ toasts: [], overlayStack: { layers: [] } });
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <FileSelector files={mockFiles} isOpen={false} onClose={() => {}} rootPath="/root" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders files list when open', () => {
    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('main.rs')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
  });

  it('names the job Copy file list, not Advanced File Selection', () => {
    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    expect(screen.getByRole('dialog', { name: 'Copy file list' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Copy file list' })).toBeInTheDocument();
    expect(screen.queryByText(/advanced file selection/i)).not.toBeInTheDocument();
  });

  it('labels the command catalogue Copy File List', () => {
    const cmd = defaultCommands.find((c) => c.id === 'file.advanced-selection');
    expect(cmd?.label).toBe('Copy File List');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<FileSelector files={mockFiles} isOpen={true} onClose={onClose} rootPath="/root" />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when a confirm layer is on the stack', () => {
    const onClose = vi.fn();
    render(<FileSelector files={mockFiles} isOpen={true} onClose={onClose} rootPath="/root" />);
    useStore.getState().pushOverlay({ id: 'confirm', kind: 'confirm' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('filters by extension', () => {
    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    const extInput = screen.getByPlaceholderText('e.g. ts, rs');
    fireEvent.change(extInput, { target: { value: 'rs' } });

    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    expect(screen.getByText('main.rs')).toBeInTheDocument();
  });

  it('filters by min lines', () => {
    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    const minLinesInput = screen.getByPlaceholderText('0');
    fireEvent.change(minLinesInput, { target: { value: '500' } });

    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    expect(screen.getByText('main.rs')).toBeInTheDocument();
  });

  it('copies to clipboard', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    const copyButton = screen.getByText('Copy List to Clipboard');
    fireEvent.click(copyButton);

    const expected = ['/root/src/index.ts', '/root/src/main.rs', '/root/README.md'].join('\n');
    expect(writeTextMock).toHaveBeenCalledWith(expected);
  });

  it('shows a success toast after copying the file list', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    fireEvent.click(screen.getByText('Copy List to Clipboard'));

    await waitFor(() => {
      expect(useStore.getState().toasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: 'File list copied', variant: 'success' }),
        ])
      );
    });
  });

  it('shows an error toast when the clipboard write fails', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      },
    });

    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    fireEvent.click(screen.getByText('Copy List to Clipboard'));

    await waitFor(() => {
      expect(useStore.getState().toasts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Could not copy file list',
            variant: 'error',
          }),
        ])
      );
    });
  });

  it('shows an error toast when the clipboard is unavailable', () => {
    Object.assign(navigator, { clipboard: undefined });

    render(<FileSelector files={mockFiles} isOpen={true} onClose={() => {}} rootPath="/root" />);
    fireEvent.click(screen.getByText('Copy List to Clipboard'));

    expect(useStore.getState().toasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Clipboard is unavailable in this context',
          variant: 'error',
        }),
      ])
    );
  });
});
