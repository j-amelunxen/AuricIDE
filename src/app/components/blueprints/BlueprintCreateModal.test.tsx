import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BlueprintCreateModal } from './BlueprintCreateModal';

describe('BlueprintCreateModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <BlueprintCreateModal isOpen={false} onSave={vi.fn()} onClose={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders form when isOpen is true', () => {
    render(<BlueprintCreateModal isOpen={true} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('New Blueprint')).toBeDefined();
    expect(screen.getByPlaceholderText('Blueprint name')).toBeDefined();
  });

  it('Save & Close button is disabled when name is empty', () => {
    render(<BlueprintCreateModal isOpen={true} onSave={vi.fn()} onClose={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Save & Close' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save & Close button is enabled when name is filled', async () => {
    render(<BlueprintCreateModal isOpen={true} onSave={vi.fn()} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Blueprint name'), 'My Blueprint');
    const btn = screen.getByRole('button', { name: 'Save & Close' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onSave with form values on submit', async () => {
    const onSave = vi.fn();
    render(<BlueprintCreateModal isOpen={true} onSave={onSave} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Blueprint name'), 'Test BP');
    await user.type(screen.getByPlaceholderText('React, TypeScript, Node.js'), 'React, Rust');
    await user.type(
      screen.getByPlaceholderText('What does this blueprint achieve?'),
      'Speed up builds'
    );

    await user.click(screen.getByRole('button', { name: 'Save & Close' }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'Test BP',
      techStack: 'React, Rust',
      goal: 'Speed up builds',
      complexity: 'MEDIUM',
      category: 'architectures',
      description: '',
    });
  });

  it('allows selecting complexity', async () => {
    const onSave = vi.fn();
    render(<BlueprintCreateModal isOpen={true} onSave={onSave} onClose={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('Blueprint name'), 'Hard Task');
    const selector = screen.getByTestId('complexity-selector');
    await user.click(within(selector).getByText('Hard'));
    await user.click(screen.getByRole('button', { name: 'Save & Close' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ complexity: 'HARD' }));
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    render(<BlueprintCreateModal isOpen={true} onSave={vi.fn()} onClose={onClose} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows category options', () => {
    render(<BlueprintCreateModal isOpen={true} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Architectures')).toBeDefined();
    expect(screen.getByText('Optimizations')).toBeDefined();
    expect(screen.getByText('UI & Marketing')).toBeDefined();
  });

  it('shows complexity options', () => {
    render(<BlueprintCreateModal isOpen={true} onSave={vi.fn()} onClose={vi.fn()} />);
    const selector = screen.getByTestId('complexity-selector');
    expect(within(selector).getByText('Easy')).toBeDefined();
    expect(within(selector).getByText('Medium')).toBeDefined();
    expect(within(selector).getByText('Hard')).toBeDefined();
  });
});
