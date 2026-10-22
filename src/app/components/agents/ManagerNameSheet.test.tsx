import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { ManagerNameSheet } from './ManagerNameSheet';

const existing = [
  { key: 'release-desk', name: 'Release Desk', archivedAt: null },
  { key: 'old-desk', name: 'Old Desk', archivedAt: '2026-10-01T00:00:00Z' },
];

function open(over: Partial<React.ComponentProps<typeof ManagerNameSheet>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <ManagerNameSheet
      title="Promote to Project Manager"
      confirmLabel="Promote"
      initialName=""
      addressFor={(name) => name.trim().toLowerCase().replace(/\s+/g, '-')}
      managers={existing}
      onSubmit={onSubmit}
      onClose={onClose}
      {...over}
    />
  );
  return { onSubmit, onClose };
}

const typeName = (value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value } });

describe('ManagerNameSheet', () => {
  beforeEach(() => {
    useStore.setState({ toasts: [] });
  });

  it('is a labelled dialog with the name field focused', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Promote to Project Manager' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
  });

  it('disables the button with the reason visible while the name is empty', () => {
    open();
    expect(screen.getByRole('button', { name: 'Promote' })).toBeDisabled();
    expect(screen.getByText(/needs 1 to 40 characters/)).toBeInTheDocument();
  });

  it('follows the typed name with the address line', () => {
    open();
    typeName('Inbox Triage');
    expect(screen.getByText('Address: inbox-triage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promote' })).toBeEnabled();
  });

  it('refuses a name another active manager has, ignoring case, and says why', () => {
    open();
    typeName('  release DESK ');
    expect(screen.getByRole('button', { name: 'Promote' })).toBeDisabled();
    expect(screen.getByText('A Project Manager with this name exists.')).toBeInTheDocument();
  });

  it('lets an archived manager’s name be used again', () => {
    open();
    typeName('Old Desk');
    expect(screen.getByRole('button', { name: 'Promote' })).toBeEnabled();
  });

  it('lets a rename keep its own name', () => {
    open({ initialName: 'Release Desk', exceptKey: 'release-desk', confirmLabel: 'Rename' });
    expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled();
  });

  it('refuses to submit while something else blocks it, and shows that reason', () => {
    open({ initialName: 'Fresh Name', blockedReason: 'The registry could not be read.' });
    expect(screen.getByRole('button', { name: 'Promote' })).toBeDisabled();
    expect(screen.getByText('The registry could not be read.')).toBeInTheDocument();
  });

  it('submits the trimmed name on Enter and closes when it worked', async () => {
    const { onSubmit, onClose } = open({ initialName: '  Fresh Name ' });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith('Fresh Name');
  });

  it('keeps the sheet open and names the problem when Rust refuses the name', async () => {
    const { onClose } = open({
      initialName: 'Fresh Name',
      onSubmit: vi.fn().mockRejectedValue("A Project Manager named 'Fresh Name' already exists."),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports any other refusal as a toast and keeps the sheet open', async () => {
    const { onClose } = open({
      initialName: 'Fresh Name',
      onSubmit: vi
        .fn()
        .mockRejectedValue(new Error("The supervisor run folder 'x' no longer exists.")),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    await waitFor(() => expect(useStore.getState().toasts).toHaveLength(1));
    expect(useStore.getState().toasts[0]).toMatchObject({ variant: 'error' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Cancel', () => {
    const { onClose } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
