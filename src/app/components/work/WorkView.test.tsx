import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { WorkView } from './WorkView';

vi.mock('@/app/components/goals/GoalsModal', () => ({
  GoalsPanel: () => <div data-testid="work-panel-goals">Goals body</div>,
}));
vi.mock('@/app/components/pm/ProjectManagerModal', () => ({
  TicketsPanel: () => <div data-testid="work-panel-tickets">Tickets body</div>,
}));
vi.mock('@/app/components/requirements/RequirementsModal', () => ({
  RequirementsPanel: () => <div data-testid="work-panel-requirements">Requirements body</div>,
}));
vi.mock('@/app/components/goalLines/GoalLinesModal', () => ({
  GoalLinesPanel: () => <div data-testid="work-panel-lines">Lines body</div>,
}));

describe('WorkView', () => {
  beforeEach(() => {
    useStore.setState({ workPlaceOpen: true, workTab: 'goals' });
  });

  it('renders the four place tabs', () => {
    render(<WorkView />);
    expect(screen.getByRole('tab', { name: 'Goals' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tickets' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Requirements' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Lines' })).toBeInTheDocument();
  });

  it('explains the Lines tab as the same goals over time', () => {
    render(<WorkView />);
    const lines = screen.getByRole('tab', { name: 'Lines' });
    expect(lines).toHaveAttribute('title', 'The same goals, seen over time.');
    expect(screen.getByTitle('The same goals, seen over time.')).toBeInTheDocument();
  });

  it('shows the Goals body by default', () => {
    render(<WorkView />);
    expect(screen.getByTestId('work-panel-goals')).toBeInTheDocument();
    expect(screen.queryByTestId('work-panel-tickets')).not.toBeInTheDocument();
  });

  it('switches the hosted body when a tab is selected', async () => {
    const user = userEvent.setup();
    render(<WorkView />);
    await user.click(screen.getByRole('tab', { name: 'Tickets' }));
    expect(useStore.getState().workTab).toBe('tickets');
    expect(screen.getByTestId('work-panel-tickets')).toBeInTheDocument();
    expect(screen.queryByTestId('work-panel-goals')).not.toBeInTheDocument();
  });

  it('is a place, not a dialog', () => {
    render(<WorkView />);
    expect(screen.getByTestId('work-view')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
