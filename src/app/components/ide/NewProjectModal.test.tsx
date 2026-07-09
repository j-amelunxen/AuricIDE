import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NewProjectModal } from './NewProjectModal';

const openFolderDialog = vi.fn();
vi.mock('@/lib/tauri/fs', () => ({
  openFolderDialog: () => openFolderDialog(),
}));

describe('NewProjectModal', () => {
  beforeEach(() => {
    openFolderDialog.mockReset();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <NewProjectModal isOpen={false} onCreate={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('exposes an accessible dialog', () => {
    render(<NewProjectModal isOpen={true} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /new project/i })).toBeInTheDocument();
  });

  it('disables Create until a name and location are set', async () => {
    openFolderDialog.mockResolvedValue('/Users/j/dev');
    render(<NewProjectModal isOpen={true} onCreate={vi.fn()} onClose={vi.fn()} />);
    const user = userEvent.setup();
    const create = screen.getByRole('button', { name: /create project/i }) as HTMLButtonElement;

    expect(create.disabled).toBe(true);

    await user.type(screen.getByPlaceholderText('my-awesome-project'), 'app');
    expect(create.disabled).toBe(true); // location still missing

    await user.click(screen.getByRole('button', { name: /browse/i }));
    expect(create.disabled).toBe(false);
  });

  it('previews the resulting project path', async () => {
    openFolderDialog.mockResolvedValue('/Users/j/dev');
    render(<NewProjectModal isOpen={true} onCreate={vi.fn()} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('my-awesome-project'), 'app');
    await user.click(screen.getByRole('button', { name: /browse/i }));
    expect(screen.getByTestId('new-project-preview').textContent).toContain('/Users/j/dev/app');
  });

  it('calls onCreate with sanitized options on submit', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    openFolderDialog.mockResolvedValue('/Users/j/dev');
    render(<NewProjectModal isOpen={true} onCreate={onCreate} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('my-awesome-project'), 'my/app');
    await user.click(screen.getByRole('button', { name: /browse/i }));
    await user.click(screen.getByRole('button', { name: /spec-driven/i }));
    await user.click(screen.getByRole('button', { name: /create project/i }));

    expect(onCreate).toHaveBeenCalledWith({
      name: 'myapp',
      parentDir: '/Users/j/dev',
      template: 'spec',
    });
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<NewProjectModal isOpen={true} onCreate={vi.fn()} onClose={onClose} />);
    const user = userEvent.setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
