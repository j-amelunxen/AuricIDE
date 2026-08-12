import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Schedule } from '@/lib/tauri/schedules';
import { SchedulesSection, type SchedulesSectionProps } from './SchedulesSection';

const NOW = Date.parse('2026-08-12T10:00:00.000Z');

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Security-Scan',
    enabled: true,
    projectPath: null,
    projectName: null,
    specKind: 'every',
    cronExpr: null,
    everyN: 21,
    everyUnit: 'day',
    anchorAt: '2026-08-12 07:00:00',
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: '{}',
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: '2026-09-02 07:00:00',
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
    ...overrides,
  };
}

function renderSection(overrides: Partial<SchedulesSectionProps> = {}) {
  const props: SchedulesSectionProps = {
    schedules: [],
    now: NOW,
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<SchedulesSection {...props} />);
  return props;
}

describe('SchedulesSection', () => {
  // The empty state has to say the one thing that is surprising about this
  // feature: it is not cron, and a closed app misses the moment.
  it('explains the catch-up model when there are no schedules', () => {
    renderSection();
    const empty = screen.getByTestId('schedules-empty').textContent ?? '';
    expect(empty).toContain('nachgeholt');
  });

  it('offers to create one', () => {
    const props = renderSection();
    fireEvent.click(screen.getByTestId('schedule-create'));
    expect(props.onCreate).toHaveBeenCalled();
  });

  it('names the rhythm and the next date in words', () => {
    renderSection({ schedules: [makeSchedule()] });

    expect(screen.getByText('alle 21 Tage · 09:00')).toBeTruthy();
    expect(screen.getByTestId('schedule-next-s1').textContent).toBe('in 21 d');
  });

  it('opens the editor for a row', () => {
    const schedule = makeSchedule();
    const props = renderSection({ schedules: [schedule] });

    fireEvent.click(screen.getByTestId('schedule-edit-s1'));

    expect(props.onEdit).toHaveBeenCalledWith(schedule);
  });

  it('reports a toggle with the new state', () => {
    const schedule = makeSchedule();
    const props = renderSection({ schedules: [schedule] });

    fireEvent.click(screen.getByTestId('schedule-toggle-s1'));

    expect(props.onToggle).toHaveBeenCalledWith(schedule, false);
  });

  // A reminder you switched off is still a decision you made, and one you will
  // want to find again.
  it('keeps a disabled schedule listed, greyed rather than gone', () => {
    renderSection({ schedules: [makeSchedule({ enabled: false })] });

    const row = screen.getByTestId('schedule-row-s1');
    expect(row.dataset.enabled).toBe('false');
    expect(screen.getByTestId('schedule-next-s1').textContent).toBe('aus');
  });

  it('reports a delete request', () => {
    const schedule = makeSchedule();
    const props = renderSection({ schedules: [schedule] });

    fireEvent.click(screen.getByTestId('schedule-delete-s1'));

    expect(props.onDelete).toHaveBeenCalledWith(schedule);
  });

  it('shows which project a schedule belongs to', () => {
    renderSection({
      schedules: [makeSchedule({ projectPath: '/repo/sample', projectName: 'sample-project' })],
    });

    expect(screen.getByText('sample-project')).toBeTruthy();
  });
});
