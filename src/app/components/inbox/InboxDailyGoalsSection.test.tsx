import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { InboxDailyGoalsSection } from './InboxDailyGoalsSection';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';

function makeGoal(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: 'goal-1',
    title: 'Finish feature Y',
    notes: '',
    createdAt: '2026-09-08T10:00:00Z',
    updatedAt: '2026-09-08T10:00:00Z',
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    ticketId: 't-1',
    assignedAt: '2026-09-08T10:00:00Z',
    dismissedAt: null,
    priority: 'high',
    dueDate: null,
    dailyGoal: true,
    ...overrides,
  };
}

describe('InboxDailyGoalsSection', () => {
  const defaultProps = {
    goals: [] as InboxItem[],
    overview: {} as Record<string, ProjectPmOverview>,
    starredProjects: [],
    onOpenProject: vi.fn(),
    onHandToAgent: vi.fn(),
    onToggleDailyGoal: vi.fn(),
    onSetStatus: vi.fn(),
    onOpenPlanner: vi.fn(),
  };

  it('renders prompt to plan daily goals when goals list is empty', async () => {
    const user = userEvent.setup();
    const onOpenPlanner = vi.fn();

    render(<InboxDailyGoalsSection {...defaultProps} onOpenPlanner={onOpenPlanner} />);

    expect(screen.getByRole('heading', { name: /Tagesziele/i })).toBeInTheDocument();
    const planBtn = screen.getByRole('button', { name: /Tagesziele planen/i });
    expect(planBtn).toBeInTheDocument();

    await user.click(planBtn);
    expect(onOpenPlanner).toHaveBeenCalled();
  });

  it('renders daily goals with project name, task title, and progress', () => {
    const goal1 = makeGoal({
      id: 'g1',
      title: 'Task 1',
      projectPath: '/repo/a',
      projectName: 'Alpha',
    });
    const goal2 = makeGoal({
      id: 'g2',
      title: 'Task 2',
      projectPath: '/repo/b',
      projectName: 'Beta',
    });

    render(<InboxDailyGoalsSection {...defaultProps} goals={[goal1, goal2]} />);

    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByTestId('daily-goals-progress')).toHaveTextContent('0/2 erledigt');
  });

  it('calls onToggleDailyGoal when removing a goal', async () => {
    const user = userEvent.setup();
    const onToggleDailyGoal = vi.fn();
    const goal = makeGoal({ id: 'g1', title: 'Task 1' });

    render(
      <InboxDailyGoalsSection
        {...defaultProps}
        goals={[goal]}
        onToggleDailyGoal={onToggleDailyGoal}
      />
    );

    const removeBtn = screen.getByRole('button', { name: /Tagesziel entfernen/i });
    await user.click(removeBtn);

    expect(onToggleDailyGoal).toHaveBeenCalledWith('g1');
  });

  it('calls onHandToAgent when hand to agent is clicked', async () => {
    const user = userEvent.setup();
    const onHandToAgent = vi.fn();
    const goal = makeGoal({ id: 'g1', title: 'Task 1' });

    render(
      <InboxDailyGoalsSection {...defaultProps} goals={[goal]} onHandToAgent={onHandToAgent} />
    );

    const agentBtn = screen.getByRole('button', { name: /Hand to agent/i });
    await user.click(agentBtn);

    expect(onHandToAgent).toHaveBeenCalledWith(goal);
  });

  describe('drag and drop', () => {
    function createDataTransfer(data: Record<string, string> = {}) {
      return {
        dropEffect: '',
        effectAllowed: '',
        setData: vi.fn(),
        getData: vi.fn((key: string) => data[key] ?? ''),
      };
    }

    it('highlights drop zone and shows drop cue on dragOver', () => {
      render(<InboxDailyGoalsSection {...defaultProps} />);
      const section = screen.getByTestId('inbox-daily-goals-section');

      expect(screen.queryByTestId('daily-goals-drop-cue')).not.toBeInTheDocument();

      const dataTransfer = createDataTransfer();
      fireEvent.dragOver(section, { dataTransfer });

      expect(screen.getByTestId('daily-goals-drop-cue')).toBeInTheDocument();
      expect(section.className).toContain('border-amber-400');

      fireEvent.dragLeave(section, { relatedTarget: document.body });
      expect(screen.queryByTestId('daily-goals-drop-cue')).not.toBeInTheDocument();
    });

    it('calls onDropTask with inbox-item when dropped', () => {
      const onDropTask = vi.fn();
      render(<InboxDailyGoalsSection {...defaultProps} onDropTask={onDropTask} />);
      const section = screen.getByTestId('inbox-daily-goals-section');

      const dataTransfer = createDataTransfer({
        'application/x-auric-inbox-item': 'task-abc',
      });

      fireEvent.dragOver(section, { dataTransfer });
      fireEvent.drop(section, { dataTransfer });

      expect(onDropTask).toHaveBeenCalledWith({
        type: 'inbox-item',
        id: 'task-abc',
      });
      expect(screen.queryByTestId('daily-goals-drop-cue')).not.toBeInTheDocument();
    });

    it('calls onDropTask with ticket when dropped', () => {
      const onDropTask = vi.fn();
      render(<InboxDailyGoalsSection {...defaultProps} onDropTask={onDropTask} />);
      const section = screen.getByTestId('inbox-daily-goals-section');

      const dataTransfer = createDataTransfer({
        'application/x-auric-inbox-ticket': '/repo/gamma:t-999',
      });

      fireEvent.dragOver(section, { dataTransfer });
      fireEvent.drop(section, { dataTransfer });

      expect(onDropTask).toHaveBeenCalledWith({
        type: 'ticket',
        projectPath: '/repo/gamma',
        ticketId: 't-999',
      });
    });
  });
});
