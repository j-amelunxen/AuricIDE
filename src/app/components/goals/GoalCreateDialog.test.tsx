import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GoalCreateDialog } from './GoalCreateDialog';

describe('GoalCreateDialog', () => {
  const defaultProps = {
    isOpen: true,
    goals: [],
    defaultParentId: null,
    onSave: vi.fn(),
    onClose: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<GoalCreateDialog {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('exposes an accessible dialog', () => {
    render(<GoalCreateDialog {...defaultProps} />);
    expect(screen.getByRole('dialog', { name: /new goal/i })).toBeInTheDocument();
  });
});
