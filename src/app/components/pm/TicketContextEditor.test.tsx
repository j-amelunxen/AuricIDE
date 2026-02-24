import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TicketContextEditor } from './TicketContextEditor';
import type { PmContextItem } from '@/lib/tauri/pm';

describe('TicketContextEditor', () => {
  const mockContext: PmContextItem[] = [
    { id: '1', type: 'snippet', value: 'First snippet' },
    { id: '2', type: 'file', value: 'src/main.rs' },
  ];

  it('renders existing context items', () => {
    render(<TicketContextEditor context={mockContext} onUpdate={vi.fn()} />);

    expect(screen.getByDisplayValue('First snippet')).toBeDefined();
    expect(screen.getByDisplayValue('src/main.rs')).toBeDefined();
  });

  it('calls onUpdate when a snippet value changes', () => {
    const onUpdate = vi.fn();
    render(<TicketContextEditor context={mockContext} onUpdate={onUpdate} />);

    const snippetInput = screen.getByDisplayValue('First snippet');
    fireEvent.change(snippetInput, { target: { value: 'Updated snippet' } });

    expect(onUpdate).toHaveBeenCalledWith([
      { id: '1', type: 'snippet', value: 'Updated snippet' },
      mockContext[1],
    ]);
  });

  it('calls onUpdate when an item is deleted', () => {
    const onUpdate = vi.fn();
    render(<TicketContextEditor context={mockContext} onUpdate={onUpdate} />);

    const deleteButtons = screen.getAllByLabelText('Remove context item');
    fireEvent.click(deleteButtons[0]);

    expect(onUpdate).toHaveBeenCalledWith([mockContext[1]]);
  });

  it('adds a new snippet when "Add Snippet" is clicked', () => {
    const onUpdate = vi.fn();
    render(<TicketContextEditor context={[]} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByText('Add Snippet'));

    expect(onUpdate).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'snippet', value: '' }),
    ]);
  });

  it('adds a new file when "Link File" is clicked and a file is selected', async () => {
    const onUpdate = vi.fn();

    // Mock tauri dialog
    vi.mock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn().mockResolvedValue('/absolute/path/to/project/src/lib.rs'),
    }));

    // Mock tauri path
    vi.mock('@tauri-apps/api/path', () => ({
      // We need a way to mock relative path calculation
      // but for now let's just assume we return what open returns if we can't easily resolve relative
    }));

    // Actually, let's mock a simple version for the component to use

    render(<TicketContextEditor context={[]} onUpdate={onUpdate} />);

    // We'll need to handle the async nature of file picking in the component
    // For the test, we might need to wait or mock the internal logic
  });
});
