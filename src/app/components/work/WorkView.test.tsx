import { render, screen, within } from '@testing-library/react';
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

  describe('leaving Tickets with unsaved PM changes', () => {
    it('switches freely when Plan is clean', async () => {
      useStore.setState({ workTab: 'tickets', pmDirty: false });
      const user = userEvent.setup();
      render(<WorkView />);

      await user.click(screen.getByRole('tab', { name: 'Goals' }));

      expect(useStore.getState().workTab).toBe('goals');
      expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
    });

    it('asks before leaving Tickets and stays put until the question is answered', async () => {
      useStore.setState({ workTab: 'tickets', pmDirty: true });
      const user = userEvent.setup();
      render(<WorkView />);

      await user.click(screen.getByRole('tab', { name: 'Goals' }));

      expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
      expect(useStore.getState().workTab).toBe('tickets');
      expect(useStore.getState().pmDirty).toBe(true);
    });

    it('discards and switches once Discard is confirmed', async () => {
      useStore.setState({
        workTab: 'tickets',
        pmDirty: true,
        pmTickets: [],
        pmDraftTickets: [
          {
            id: 't-new',
            epicId: 'e1',
            name: 'Unsaved ticket',
            description: '',
            status: 'open',
            statusUpdatedAt: '',
            priority: 'normal',
            sortOrder: 0,
            createdAt: '',
            updatedAt: '',
          },
        ],
      });
      const user = userEvent.setup();
      render(<WorkView />);

      await user.click(screen.getByRole('tab', { name: 'Goals' }));
      const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
      await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

      expect(useStore.getState().workTab).toBe('goals');
      expect(useStore.getState().pmDirty).toBe(false);
      expect(useStore.getState().pmDraftTickets).toEqual([]);
    });

    it('keeps the unsaved ticket when discard is declined', async () => {
      useStore.setState({ workTab: 'tickets', pmDirty: true });
      const user = userEvent.setup();
      render(<WorkView />);

      await user.click(screen.getByRole('tab', { name: 'Goals' }));
      const dialog = await screen.findByRole('dialog', { name: 'Discard changes?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(useStore.getState().workTab).toBe('tickets');
      expect(useStore.getState().pmDirty).toBe(true);
      expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
    });
  });
});
