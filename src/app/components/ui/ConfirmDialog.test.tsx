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

  it('renders outside its parent, so no modal can stack over it', () => {
    // Callers live inside modals that own high stacking contexts. Rendered in
    // place, the question could be painted behind the thing it interrupts —
    // and a question nobody can see is answered by nobody.
    const { container } = render(
      <div className="fixed inset-0 z-[400]">
        <ConfirmDialog {...baseProps} />
      </div>
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('fires onCancel from the cancel button and on Escape', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('keeps Escape from reaching window listeners behind it', () => {
    // Callers such as the agent terminal listen for Escape on window to close
    // themselves. If that listener also sees this key, the thing that asked
    // the question disappears with the question.
    const onWindowEscape = vi.fn();
    window.addEventListener('keydown', onWindowEscape);
    render(<ConfirmDialog {...baseProps} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onWindowEscape).not.toHaveBeenCalled();
    window.removeEventListener('keydown', onWindowEscape);
  });
});
