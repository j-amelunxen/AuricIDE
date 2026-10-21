import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NamePopover, OperationSheet } from './GraphSheets';

const description = (over = {}) => ({
  title: 'Revert “Fix login”?',
  body: 'Revert “Fix login” on main. This creates one new commit on main.',
  confirmLabel: 'Revert',
  destructive: false,
  ...over,
});

describe('OperationSheet', () => {
  it('is a labelled modal dialog that names the real thing in its body', () => {
    render(<OperationSheet description={description()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Revert “Fix login”?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('Revert “Fix login” on main.');
  });

  it('focuses the action for a harmless operation', () => {
    render(<OperationSheet description={description()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Revert' })).toHaveFocus();
  });

  it('focuses Cancel for a destructive one and styles the action as destructive', () => {
    render(
      <OperationSheet
        description={description({ destructive: true, confirmLabel: 'Delete' })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' }).className).toContain('bg-red-700');
  });

  it('clamps a long title to two lines', () => {
    render(<OperationSheet description={description()} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('heading')).toHaveClass('line-clamp-2');
  });

  it('confirms and cancels', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <OperationSheet description={description()} onConfirm={onConfirm} onCancel={onCancel} />
    );
    await user.click(screen.getByRole('button', { name: 'Revert' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

const popover = (over: Partial<React.ComponentProps<typeof NamePopover>> = {}) => ({
  kind: 'branch' as const,
  at: { x: 100, y: 100 },
  subject: 'Fix login (abcdef1)',
  initialName: '',
  taken: new Set<string>(['main']),
  onSubmit: vi.fn(),
  onCancel: vi.fn(),
  ...over,
});

describe('NamePopover', () => {
  it('asks for a branch name and offers to check it out', () => {
    render(<NamePopover {...popover()} />);
    expect(screen.getByRole('dialog', { name: 'New Branch' })).toBeInTheDocument();
    expect(screen.getByText(/Fix login \(abcdef1\)/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Check out after creating' })).toBeChecked();
  });

  it('keeps Create off, with the reason, until the name is usable', async () => {
    const user = userEvent.setup();
    render(<NamePopover {...popover()} />);
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute('title', 'Enter a name.');
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveAccessibleDescription('Enter a name.');
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'my branch');
    expect(screen.getByRole('alert')).toHaveTextContent('Names cannot contain spaces.');
    expect(create).toBeDisabled();
  });

  it('rejects a name that is taken', async () => {
    const user = userEvent.setup();
    render(<NamePopover {...popover()} />);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'main');
    expect(screen.getByRole('alert')).toHaveTextContent('That name is already taken.');
  });

  it('tints the checkbox with the accent', () => {
    render(<NamePopover {...popover()} />);
    expect(screen.getByRole('checkbox')).toHaveClass('accent-primary');
  });

  it('opens upward from the lower half of the window, so a tall popover never clips', () => {
    render(
      <NamePopover {...popover({ kind: 'tag', at: { x: 100, y: window.innerHeight - 40 } })} />
    );
    const style = screen.getByRole('dialog').getAttribute('style') ?? '';
    expect(style).toContain('bottom');
    expect(style).not.toContain('top');
  });

  it('submits the name and the checkout choice on Return', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NamePopover {...popover({ onSubmit })} />);
    await user.click(screen.getByRole('checkbox', { name: 'Check out after creating' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'feature/x{Enter}');
    expect(onSubmit).toHaveBeenCalledWith({ name: 'feature/x', checkout: false, message: '' });
  });

  it('adds an optional message field for tags and no checkbox', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<NamePopover {...popover({ kind: 'tag', onSubmit })} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'v1.0');
    await user.type(screen.getByRole('textbox', { name: 'Message (optional)' }), 'First release');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'v1.0',
      checkout: false,
      message: 'First release',
    });
  });

  it('prefills a rename and waits for a different name', async () => {
    const user = userEvent.setup();
    render(<NamePopover {...popover({ kind: 'rename', initialName: 'old-name' })} />);
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveValue('old-name');
    const rename = screen.getByRole('button', { name: 'Rename' });
    expect(rename).toBeDisabled();
    expect(rename).toHaveAttribute('title', 'Change the name first.');
    expect(input).toHaveAccessibleDescription('Change the name first.');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.type(input, '2');
    expect(rename).toBeEnabled();
  });

  it('closes on Escape and on a click outside', () => {
    const onCancel = vi.fn();
    render(<NamePopover {...popover({ onCancel })} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId('graph-popover-backdrop'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
