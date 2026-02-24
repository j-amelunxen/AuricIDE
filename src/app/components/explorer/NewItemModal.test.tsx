import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewItemModal } from './NewItemModal';

describe('NewItemModal', () => {
  it('shows "New Folder" title when type is folder', () => {
    render(<NewItemModal type="folder" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('New Folder')).toBeInTheDocument();
  });

  it('shows "New File" title when type is file', () => {
    render(<NewItemModal type="file" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('New File')).toBeInTheDocument();
  });

  it('calls onConfirm with entered name when OK is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NewItemModal type="file" onConfirm={onConfirm} onCancel={() => {}} />);

    await user.type(screen.getByRole('textbox'), 'hello.ts');
    await user.click(screen.getByRole('button', { name: /ok/i }));

    expect(onConfirm).toHaveBeenCalledWith('hello.ts');
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<NewItemModal type="folder" onConfirm={() => {}} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('disables OK button when input is empty', () => {
    render(<NewItemModal type="file" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: /ok/i })).toBeDisabled();
  });

  it('enables OK button when input has a value', async () => {
    const user = userEvent.setup();
    render(<NewItemModal type="folder" onConfirm={() => {}} onCancel={() => {}} />);

    await user.type(screen.getByRole('textbox'), 'my-folder');
    expect(screen.getByRole('button', { name: /ok/i })).not.toBeDisabled();
  });

  it('submits on Enter key press', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<NewItemModal type="file" onConfirm={onConfirm} onCancel={() => {}} />);

    await user.type(screen.getByRole('textbox'), 'index.ts');
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledWith('index.ts');
  });
});
