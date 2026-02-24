import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImportSpecDialog } from './ImportSpecDialog';

vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    listProviders: vi.fn().mockRejectedValue(new Error('browser mode')),
  };
});

vi.mock('@/lib/pm/importSpecPrompt', () => ({
  buildImportSpecPrompt: vi.fn((text: string) => `MOCK_PROMPT:${text}`),
}));

describe('ImportSpecDialog', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ImportSpecDialog isOpen={false} onClose={vi.fn()} onSpawn={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows heading "Import Project Spec" when open', () => {
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByText('Import Project Spec')).toBeInTheDocument();
  });

  it('renders a textarea for the specification', () => {
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByPlaceholderText(/paste.*spec/i)).toBeInTheDocument();
  });

  it('renders model and permission mode dropdowns', () => {
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByLabelText(/intelligence model/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/permission mode/i)).toBeInTheDocument();
  });

  it('import button is disabled when textarea is empty', () => {
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    expect(screen.getByRole('button', { name: /import/i })).toBeDisabled();
  });

  it('import button is enabled when textarea has content', async () => {
    const user = userEvent.setup();
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={vi.fn()} />);
    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'My spec');
    expect(screen.getByRole('button', { name: /import/i })).toBeEnabled();
  });

  it('spawns agent with headless:true and provider-aware permission mode', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn().mockResolvedValue(undefined);
    render(
      <ImportSpecDialog
        isOpen={true}
        onClose={vi.fn()}
        onSpawn={onSpawn}
        workingDirectory="/my/project"
      />
    );

    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'Build a todo app');
    await user.click(screen.getByRole('button', { name: /import/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Spec Import',
        headless: true,
        permissionMode: 'yolo',
        cwd: '/my/project',
      })
    );
  });

  it('calls buildImportSpecPrompt with the spec text', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn().mockResolvedValue(undefined);
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'Build a todo app');
    await user.click(screen.getByRole('button', { name: /import/i }));

    expect(onSpawn).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'MOCK_PROMPT:Build a todo app',
      })
    );
  });

  it('closes dialog on Escape key', () => {
    const onClose = vi.fn();
    render(<ImportSpecDialog isOpen={true} onClose={onClose} onSpawn={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose after successful import', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSpawn = vi.fn().mockResolvedValue(undefined);
    render(<ImportSpecDialog isOpen={true} onClose={onClose} onSpawn={onSpawn} />);
    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'Build a todo app');
    await user.click(screen.getByRole('button', { name: /import/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('calls onClose when clicking cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ImportSpecDialog isOpen={true} onClose={onClose} onSpawn={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows loading state during import and disables double-click', async () => {
    const user = userEvent.setup();
    let resolveSpawn!: () => void;
    const onSpawn = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSpawn = resolve;
      })
    );
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'Build a todo app');
    await user.click(screen.getByRole('button', { name: /import/i }));

    // Should show loading text and be disabled
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /importing/i })).toBeDisabled();
    });

    // Resolve to clean up
    resolveSpawn();
  });

  it('shows error message when onSpawn fails', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn().mockRejectedValue(new Error('Spawn failed'));
    render(<ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} />);

    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'Build a todo app');
    await user.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Spawn failed');
    });
  });

  it('uses selected permission mode in spawn config', async () => {
    const user = userEvent.setup();
    const onSpawn = vi.fn().mockResolvedValue(undefined);
    render(
      <ImportSpecDialog isOpen={true} onClose={vi.fn()} onSpawn={onSpawn} workingDirectory="/p" />
    );

    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'spec');
    // Change from default "yolo" to "default" (Interactive)
    await user.selectOptions(screen.getByLabelText(/permission mode/i), 'default');
    await user.click(screen.getByRole('button', { name: /import/i }));

    expect(onSpawn).toHaveBeenCalledWith(expect.objectContaining({ permissionMode: 'default' }));
  });

  it('does not call onClose when onSpawn fails', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSpawn = vi.fn().mockRejectedValue(new Error('Spawn failed'));
    render(<ImportSpecDialog isOpen={true} onClose={onClose} onSpawn={onSpawn} />);

    await user.type(screen.getByPlaceholderText(/paste.*spec/i), 'Build a todo app');
    await user.click(screen.getByRole('button', { name: /import/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
