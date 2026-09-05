import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModalShell } from './ModalShell';

describe('ModalShell', () => {
  it('renders children and accessible dialog with title', () => {
    render(
      <ModalShell id="test-modal" title="Test Dialog" onClose={() => {}}>
        <div>Modal Content</div>
      </ModalShell>
    );

    expect(screen.getByRole('dialog', { name: 'Test Dialog' })).toBeInTheDocument();
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
  });

  it('renders accessible dialog with aria-label when title is omitted', () => {
    render(
      <ModalShell id="test-modal" ariaLabel="Custom Label" onClose={() => {}}>
        <div>Content Without Title</div>
      </ModalShell>
    );

    expect(screen.getByRole('dialog', { name: 'Custom Label' })).toBeInTheDocument();
    expect(screen.getByText('Content Without Title')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalShell id="test-modal" title="Backdrop Test" onClose={onClose}>
        <div>Content</div>
      </ModalShell>
    );

    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when dialog container is clicked', () => {
    const onClose = vi.fn();
    render(
      <ModalShell id="test-modal" title="Content Click Test" onClose={onClose}>
        <button>Inside Button</button>
      </ModalShell>
    );

    fireEvent.click(screen.getByText('Inside Button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <ModalShell id="test-modal" title="Escape Test" onClose={onClose}>
        <div>Content</div>
      </ModalShell>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('applies custom className and backdropClassName', () => {
    const { container } = render(
      <ModalShell
        id="test-modal"
        title="Class Test"
        className="w-96 custom-dialog"
        backdropClassName="custom-backdrop"
        onClose={() => {}}
      >
        <div>Content</div>
      </ModalShell>
    );

    expect(container.firstChild).toHaveClass('custom-backdrop');
    const dialog = screen.getByRole('dialog', { name: 'Class Test' });
    expect(dialog).toHaveClass('w-96');
    expect(dialog).toHaveClass('custom-dialog');
  });
});
