import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InboxDailyGoalsPlanner } from './InboxDailyGoalsPlanner';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';
import type { ProjectPickerOption } from '@/lib/projects/projectOptions';

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'item-1',
    title: 'Task 1',
    notes: '',
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:00Z',
    projectPath: '/repo/alpha',
    projectName: 'Alpha',
    ticketId: null,
    assignedAt: null,
    dismissedAt: null,
    priority: 'normal',
    dueDate: null,
    dailyGoal: false,
    ...overrides,
  };
}

describe('InboxDailyGoalsPlanner', () => {
  const mockProjects: ProjectPickerOption[] = [
    { path: '/repo/alpha', name: 'Alpha', icon: null },
    { path: '/repo/beta', name: 'Beta', icon: null },
  ];

  const mockOverview: Record<string, ProjectPmOverview> = {
    '/repo/alpha': {
      projectPath: '/repo/alpha',
      projectName: 'Alpha',
      hasDb: true,
      open: 1,
      inProgress: 0,
      inReview: 0,
      done: 0,
      epics: [],
      tickets: [
        {
          id: 't-101',
          name: 'Fix Auth bug',
          status: 'open',
          priority: 'high',
          epicId: 'ep-1',
          epicName: 'Security',
          updatedAt: '2026-09-08T10:00:00Z',
        },
      ],
      error: null,
    },
  };

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    projects: mockProjects,
    inboxItems: [] as InboxItem[],
    overview: mockOverview,
    onToggleDailyGoal: vi.fn(),
    onCaptureTicketAsDailyGoal: vi.fn(),
    onCreateAndSetDailyGoal: vi.fn(),
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<InboxDailyGoalsPlanner {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with projects when isOpen is true', () => {
    render(<InboxDailyGoalsPlanner {...defaultProps} />);
    expect(screen.getByText(/Tagesziele planen/i)).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows existing daily goal and allows removing it', async () => {
    const user = userEvent.setup();
    const onToggleDailyGoal = vi.fn();
    const goal = makeItem({
      id: 'g-alpha',
      projectPath: '/repo/alpha',
      dailyGoal: true,
      title: 'Sprint Goal Alpha',
    });

    render(
      <InboxDailyGoalsPlanner
        {...defaultProps}
        inboxItems={[goal]}
        onToggleDailyGoal={onToggleDailyGoal}
      />
    );

    expect(screen.getByText('Sprint Goal Alpha')).toBeInTheDocument();
    const removeBtn = screen.getByRole('button', { name: /Tagesziel entfernen/i });
    await user.click(removeBtn);

    expect(onToggleDailyGoal).toHaveBeenCalledWith('g-alpha');
  });

  it('allows picking an existing ticket as daily goal', async () => {
    const user = userEvent.setup();
    const onCaptureTicketAsDailyGoal = vi.fn();

    render(
      <InboxDailyGoalsPlanner
        {...defaultProps}
        onCaptureTicketAsDailyGoal={onCaptureTicketAsDailyGoal}
      />
    );

    const ticketButton = screen.getByText('Fix Auth bug');
    await user.click(ticketButton);

    expect(onCaptureTicketAsDailyGoal).toHaveBeenCalledWith('/repo/alpha', 't-101');
  });

  it('allows creating a new daily goal inline for a project', async () => {
    const user = userEvent.setup();
    const onCreateAndSetDailyGoal = vi.fn();

    render(
      <InboxDailyGoalsPlanner {...defaultProps} onCreateAndSetDailyGoal={onCreateAndSetDailyGoal} />
    );

    const input = screen.getByPlaceholderText(/Neues Tagesziel für Beta/i);
    await user.type(input, 'New Beta Feature{Enter}');

    expect(onCreateAndSetDailyGoal).toHaveBeenCalledWith('New Beta Feature', '/repo/beta');
  });

  it('calls onClose when Fertig is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<InboxDailyGoalsPlanner {...defaultProps} onClose={onClose} />);

    const fertigBtn = screen.getByRole('button', { name: /Fertig/i });
    await user.click(fertigBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
