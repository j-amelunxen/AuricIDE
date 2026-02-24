import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
