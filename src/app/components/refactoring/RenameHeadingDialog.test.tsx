import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenameHeadingDialog } from './RenameHeadingDialog';

describe('RenameHeadingDialog', () => {
  it('renders with the old heading title pre-filled', () => {
    render(
      <RenameHeadingDialog
        oldTitle="Introduction"
        referenceCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue('Introduction');
    expect(input).toBeDefined();
  });

  it('exposes an accessible dialog', () => {
    render(
      <RenameHeadingDialog
        oldTitle="Introduction"
        referenceCount={3}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: /rename heading/i })).toBeInTheDocument();
  });

  it('shows reference count', () => {
    render(
      <RenameHeadingDialog
        oldTitle="Setup"
        referenceCount={5}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/5 references/i)).toBeDefined();
  });

  it('calls onConfirm with new title on submit', () => {
    const onConfirm = vi.fn();
    render(
      <RenameHeadingDialog
        oldTitle="Old"
        referenceCount={0}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue('Old');
    fireEvent.change(input, { target: { value: 'New' } });
    fireEvent.click(screen.getByText('Rename'));

    expect(onConfirm).toHaveBeenCalledWith('New');
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <RenameHeadingDialog
        oldTitle="Title"
        referenceCount={0}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('disables rename button when input is empty', () => {
    render(
      <RenameHeadingDialog
        oldTitle="Title"
        referenceCount={0}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByDisplayValue('Title');
    fireEvent.change(input, { target: { value: '' } });

    const btn = screen.getByText('Rename');
    expect(btn.hasAttribute('disabled') || btn.closest('button')?.disabled).toBe(true);
  });

  it('calls onCancel when Escape is pressed', async () => {
    const onCancel = vi.fn();
    render(
      <RenameHeadingDialog
        oldTitle="Title"
        referenceCount={0}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await userEvent.setup().keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(
      <RenameHeadingDialog
        oldTitle="Title"
        referenceCount={0}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not cancel when the dialog itself is clicked', () => {
    const onCancel = vi.fn();
    render(
      <RenameHeadingDialog
        oldTitle="Title"
        referenceCount={0}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('dialog'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('disables rename button when title is unchanged', () => {
    render(
      <RenameHeadingDialog
        oldTitle="Same"
        referenceCount={0}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const btn = screen.getByText('Rename');
    expect(btn.hasAttribute('disabled') || btn.closest('button')?.disabled).toBe(true);
  });
});
