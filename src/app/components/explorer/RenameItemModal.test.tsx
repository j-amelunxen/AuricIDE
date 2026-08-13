import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RenameItemModal } from './RenameItemModal';

describe('RenameItemModal', () => {
  it('shows "Rename File" title for files', () => {
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Rename File')).toBeInTheDocument();
  });

  it('shows "Rename Folder" title for directories', () => {
    render(
      <RenameItemModal oldName="docs" isDirectory={true} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByText('Rename Folder')).toBeInTheDocument();
  });

  it('exposes an accessible dialog', () => {
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole('dialog', { name: /rename file/i })).toBeInTheDocument();
  });

  it('pre-fills the input with the current name', () => {
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole('textbox')).toHaveValue('notes.md');
  });

  it('calls onConfirm with the new name when Rename is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'renamed.md');
    await user.click(screen.getByRole('button', { name: /rename/i }));

    expect(onConfirm).toHaveBeenCalledWith('renamed.md');
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalled();
  });

  it('disables the Rename button when the name is unchanged', () => {
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /rename/i })).toBeDisabled();
  });

  it('disables the Rename button when the name is cleared', async () => {
    const user = userEvent.setup();
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    await user.clear(screen.getByRole('textbox'));
    expect(screen.getByRole('button', { name: /rename/i })).toBeDisabled();
  });

  it('submits on Enter key press', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'renamed.md');
    await user.keyboard('{Enter}');

    expect(onConfirm).toHaveBeenCalledWith('renamed.md');
  });

  it('cancels on Escape key press', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    await user.type(screen.getByRole('textbox'), '{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when the backdrop is clicked', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed on the window', () => {
    const onCancel = vi.fn();
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('selects only the base name (not the extension) for files on mount', () => {
    render(
      <RenameItemModal
        oldName="notes.md"
        isDirectory={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  });

  it('selects the entire name for directories on mount', () => {
    render(
      <RenameItemModal oldName="docs" isDirectory={true} onConfirm={() => {}} onCancel={() => {}} />
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
  });
});
