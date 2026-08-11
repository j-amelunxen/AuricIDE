import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScratchPanel } from './ScratchPanel';

describe('ScratchPanel', () => {
  const scratches = [
    { name: 'scratch-2.md', path: '/data/scratches/scratch-2.md' },
    { name: 'scratch-1.md', path: '/data/scratches/scratch-1.md' },
  ];

  const baseProps = {
    scratches,
    activeTabId: null as string | null,
    onCreate: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDeleteAll: vi.fn(),
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the list on mount so it is fresh every time the panel opens', () => {
    render(<ScratchPanel {...baseProps} />);
    expect(baseProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('lists scratches and opens one on click', () => {
    render(<ScratchPanel {...baseProps} />);
    fireEvent.click(screen.getByText('scratch-1.md'));
    expect(baseProps.onOpen).toHaveBeenCalledWith('/data/scratches/scratch-1.md');
  });

  it('creates a new scratch from the header button', () => {
    render(<ScratchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'New scratch file' }));
    expect(baseProps.onCreate).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state with a create CTA when there are no scratches', () => {
    render(<ScratchPanel {...baseProps} scratches={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'New Scratch File' }));
    expect(baseProps.onCreate).toHaveBeenCalledTimes(1);
  });

  it('deletes a scratch only after confirmation', () => {
    render(<ScratchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete scratch-1.md' }));
    expect(baseProps.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(baseProps.onDelete).toHaveBeenCalledWith('/data/scratches/scratch-1.md');
  });

  it('does not delete when the confirmation is cancelled', () => {
    render(<ScratchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete scratch-1.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(baseProps.onDelete).not.toHaveBeenCalled();
  });

  it('cleans up all scratches only after confirmation, naming the count', () => {
    render(<ScratchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all scratch files' }));
    expect(screen.getByText(/2 scratch files/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete All' }));
    expect(baseProps.onDeleteAll).toHaveBeenCalledTimes(1);
  });

  it('renames a scratch inline via Enter', () => {
    render(<ScratchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename scratch-1.md' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'api-notes' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(baseProps.onRename).toHaveBeenCalledWith('/data/scratches/scratch-1.md', 'api-notes');
  });

  it('abandons an inline rename on Escape', () => {
    render(<ScratchPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename scratch-1.md' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'whatever' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(baseProps.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('marks the scratch belonging to the active tab', () => {
    render(<ScratchPanel {...baseProps} activeTabId="/data/scratches/scratch-2.md" />);
    const row = screen.getByText('scratch-2.md').closest('[data-active]');
    expect(row).toHaveAttribute('data-active', 'true');
  });
});
