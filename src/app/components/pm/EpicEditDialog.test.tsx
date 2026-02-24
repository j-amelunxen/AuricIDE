import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EpicEditDialog } from './EpicEditDialog';
import type { PmEpic } from '@/lib/tauri/pm';

const makeEpic = (overrides: Partial<PmEpic> = {}): PmEpic => ({
  id: 'epic-1',
  name: 'Auth System',
  description: 'Authentication and authorization',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('EpicEditDialog', () => {
  const defaultProps = {
    isOpen: true,
    epic: null as PmEpic | null,
    onSave: vi.fn(),
    onSaveAndClose: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<EpicEditDialog {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows "New Epic" when epic is null', () => {
    render(<EpicEditDialog {...defaultProps} epic={null} />);
    expect(screen.getByText('New Epic')).toBeDefined();
  });

  it('shows "Edit Epic" when epic is provided', () => {
    render(<EpicEditDialog {...defaultProps} epic={makeEpic()} />);
    expect(screen.getByText('Edit Epic')).toBeDefined();
  });

  it('pre-fills name and description from epic prop', () => {
    render(<EpicEditDialog {...defaultProps} epic={makeEpic()} />);
    expect(screen.getByDisplayValue('Auth System')).toBeDefined();
    expect(screen.getByDisplayValue('Authentication and authorization')).toBeDefined();
  });

  it('save button disabled when name is empty', () => {
    render(<EpicEditDialog {...defaultProps} epic={null} />);

    const saveBtn = screen.getByText('Save');
    expect(saveBtn.closest('button')?.disabled).toBe(true);
  });

  it('calls onSave with name and description when Save is clicked', () => {
    const onSave = vi.fn();
    render(<EpicEditDialog {...defaultProps} onSave={onSave} />);

    const nameInput = screen.getByPlaceholderText('Epic name');
    const descInput = screen.getByPlaceholderText('What is this epic about?');

    fireEvent.change(nameInput, { target: { value: 'New Epic Name' } });
    fireEvent.change(descInput, { target: { value: 'Some description' } });
    fireEvent.click(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith('New Epic Name', 'Some description');
  });

  it('calls onSaveAndClose with name and description when Save and Close is clicked', () => {
    const onSaveAndClose = vi.fn();
    render(<EpicEditDialog {...defaultProps} onSaveAndClose={onSaveAndClose} />);

    const nameInput = screen.getByPlaceholderText('Epic name');
    const descInput = screen.getByPlaceholderText('What is this epic about?');

    fireEvent.change(nameInput, { target: { value: 'New Epic Name' } });
    fireEvent.change(descInput, { target: { value: 'Some description' } });
    fireEvent.click(screen.getByText('Save and Close'));

    expect(onSaveAndClose).toHaveBeenCalledWith('New Epic Name', 'Some description');
  });

  it('calls onClose on cancel', () => {
    const onClose = vi.fn();
    render(<EpicEditDialog {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
