import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Notification } from '@/lib/notifications/types';
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

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    uid: 'n-1',
    createdAt: '2026-08-12 08:00:00',
    projectPath: null,
    projectName: null,
    source: 'system',
    origin: 'Security-Scan',
    kind: 'info',
    severity: 'info',
    title: 'Security-Scan is due',
    body: null,
    actions: [],
    dedupeKey: 'schedule:s1:2026-08-12 08:00:00',
    refKind: null,
    refId: null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

function renderSection(overrides: Partial<SchedulesSectionProps> = {}) {
  const props: SchedulesSectionProps = {
    schedules: [],
    now: NOW,
    starredProjects: [],
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
    expect(screen.getByTestId('schedules-empty').textContent).toBe(
      'No schedules. Reminders only fire while AuricIDE is open — missed ones catch up on launch.'
    );
  });

  it('names the rhythm and the next date in words', () => {
    renderSection({ schedules: [makeSchedule()] });

    expect(screen.getByText('every 21 days · 09:00')).toBeTruthy();
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
    expect(screen.getByTestId('schedule-next-s1').textContent).toBe('off');
    expect(screen.getByLabelText('Turn schedule on')).toBeTruthy();
  });

  it('names toggle and delete in English', () => {
    renderSection({ schedules: [makeSchedule()] });
    expect(screen.getByLabelText('Turn schedule off')).toBeTruthy();
    expect(screen.getByLabelText('Delete schedule')).toBeTruthy();
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

  describe('the project a schedule belongs to', () => {
    it('draws the project tile next to the name', () => {
      renderSection({
        schedules: [makeSchedule({ projectPath: '/repo/sample', projectName: 'sample' })],
      });

      expect(screen.getByTestId('tile-face-/repo/sample')).toBeTruthy();
      expect(screen.getByTestId('schedule-row-s1').textContent).toContain('sample');
    });

    it('draws the mark the project was pinned with', () => {
      renderSection({
        schedules: [makeSchedule({ projectPath: '/repo/sample', projectName: 'sample' })],
        starredProjects: [
          {
            path: '/repo/sample',
            name: 'sample',
            starredAt: 1,
            icon: { kind: 'emoji', value: '🚀' },
          },
        ],
      });

      expect(screen.getByTestId('tile-face-/repo/sample')).toHaveAttribute(
        'data-icon-kind',
        'emoji'
      );
    });

    // An app-wide reminder has no project, so there is no tile to draw — the
    // row must not invent one for the app itself.
    it('draws no tile for an app-wide schedule', () => {
      renderSection({ schedules: [makeSchedule()] });
      expect(screen.queryByTestId(/^tile-face-/)).toBeNull();
    });
  });

  // "Next due" is a promise; "last raised" is the evidence it was kept. A
  // schedule that says "in 21 d" and has never raised anything is the shape a
  // broken reminder takes, and without this line it is indistinguishable from
  // a working one.
  describe('the last notification a schedule raised', () => {
    it('reports how long ago it was', () => {
      renderSection({
        schedules: [makeSchedule()],
        lastRaised: new Map([['s1', makeNotification()]]),
      });

      expect(screen.getByTestId('schedule-last-raised-s1').textContent).toContain('2h');
    });

    it('says so when a schedule has never raised anything', () => {
      renderSection({ schedules: [makeSchedule()] });

      expect(screen.getByTestId('schedule-last-raised-s1').textContent).toContain('never');
    });

    // A run that produced no notification still ran. Saying "never run" about
    // it would send someone looking for a broken schedule that works.
    it('falls back to when the runner last fired it', () => {
      renderSection({
        schedules: [makeSchedule({ lastFiredAt: '2026-08-12 07:00:00' })],
      });

      expect(screen.getByTestId('schedule-last-raised-s1').textContent).toBe('fired 3h');
    });

    it('prefers what it raised over when it fired', () => {
      renderSection({
        schedules: [makeSchedule({ lastFiredAt: '2026-08-12 07:00:00' })],
        lastRaised: new Map([['s1', makeNotification()]]),
      });

      expect(screen.getByTestId('schedule-last-raised-s1').textContent).toBe('raised 2h');
    });
  });

  // Under "All" the same list has to carry every project's triggers at once,
  // so each run of rows says whose it is.
  it('heads a labelled group with its project name', () => {
    renderSection({ schedules: [makeSchedule()], label: 'sample-project' });

    expect(screen.getByTestId('schedules-group-sample-project')).toBeTruthy();
    expect(screen.getByText('sample-project')).toBeTruthy();
  });
});
