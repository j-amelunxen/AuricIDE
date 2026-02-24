import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DependencyProposalModal } from './DependencyProposalModal';

describe('DependencyProposalModal', () => {
  const mockSuggestions = [
    { id: 't2', name: 'Database schema', reason: 'Needed for users' },
    { id: 't3', name: 'API setup', reason: 'Endpoint for login' },
  ];

  it('renders suggestions and allows selection', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const onToggle = vi.fn();

    render(
      <DependencyProposalModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        suggestions={mockSuggestions}
        selectedIds={['t2', 't3']}
        onToggleSuggestion={onToggle}
        isLoading={false}
      />
    );

    expect(screen.getByText('Proposed Dependencies')).toBeTruthy();
    expect(screen.getByText('Database schema')).toBeTruthy();
    expect(screen.getByText('Needed for users')).toBeTruthy();
    expect(screen.getByText('API setup')).toBeTruthy();

    const confirmBtn = screen.getByRole('button', { name: /add selected/i });
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalled();
  });

  it('renders empty state when no suggestions', () => {
    render(
      <DependencyProposalModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        suggestions={[]}
        selectedIds={[]}
        onToggleSuggestion={vi.fn()}
        isLoading={false}
      />
    );

    expect(screen.getByText('No potential dependencies found.')).toBeTruthy();
  });

  it('renders loading state', () => {
    render(
      <DependencyProposalModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        suggestions={[]}
        selectedIds={[]}
        onToggleSuggestion={vi.fn()}
        isLoading={true}
      />
    );

    expect(screen.getByText('Analyzing dependencies...')).toBeTruthy();
  });
});
