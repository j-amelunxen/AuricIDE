import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  const baseProps = {
    title: 'Delete scratch?',
    message: 'This removes "scratch-1.md" permanently.',
    confirmLabel: 'Delete',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders title, message and an accessible dialog', () => {
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Delete scratch?')).toBeInTheDocument();
    expect(screen.getByText('This removes "scratch-1.md" permanently.')).toBeInTheDocument();
  });

  it('fires onConfirm from the confirm button', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('fires onCancel from the cancel button and on Escape', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
