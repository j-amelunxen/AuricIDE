import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectGroup } from '@/lib/notifications/commandCenter';
import type { Notification } from '@/lib/notifications/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { ProjectDetail, type ProjectDetailProps } from './ProjectDetail';

const occurrences = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauri/schedules', () => ({ schedulesOccurrences: occurrences }));

// Wednesday 2026-08-12, 10:00 UTC.
const NOW = Date.parse('2026-08-12T10:00:00.000Z');

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 's1',
    name: 'Deploy site',
    enabled: true,
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    specKind: 'every',
    cronExpr: null,
    everyN: 1,
    everyUnit: 'day',
    anchorAt: null,
    timeOfDay: '09:00',
    timezone: 'Europe/Berlin',
    catchUp: 'coalesce',
    payload: '{}',
    lastFiredAt: null,
    lastCheckedAt: null,
    nextDueAt: '2026-08-12 12:00:00',
    createdAt: '2026-08-01 00:00:00',
    updatedAt: '2026-08-01 00:00:00',
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification>): Notification {
  return {
    id: 1,
    uid: 'n-1',
    createdAt: '2026-08-12 07:00:00',
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    source: 'system',
    origin: null,
    kind: 'info',
    severity: 'info',
    title: 'Fired',
    body: null,
    actions: [],
    dedupeKey: null,
    refKind: null,
    refId: null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

function makeGroup(schedules: Schedule[], path: string, label: string): ProjectGroup {
  return {
    key: path,
    path,
    label,
    notifications: [],
    unread: 0,
    openQuestions: 0,
    schedules,
    nextDueAt: null,
  };
}

const alpha = makeSchedule();
const beta = makeSchedule({
  id: 's2',
  name: 'Backup db',
  projectPath: '/repo/beta',
  projectName: 'beta',
});

function renderDetail(overrides: Partial<ProjectDetailProps> = {}) {
  const props: ProjectDetailProps = {
    group: null,
    groups: [makeGroup([alpha], '/repo/alpha', 'alpha'), makeGroup([beta], '/repo/beta', 'beta')],
    notifications: [],
    totals: { unread: 0, openQuestions: 0 },
    status: 'idle',
    now: NOW,
    starredProjects: [],
    lastRaised: new Map(),
    parseActions: () => [],
    onOpen: vi.fn(),
    onAction: vi.fn(),
    onNewSchedule: vi.fn(),
    onEditSchedule: vi.fn(),
    onToggleSchedule: vi.fn(),
    onDeleteSchedule: vi.fn(),
    onMarkAllRead: vi.fn(),
    onClear: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<ProjectDetail {...props} />);
  return props;
}

const futureRun = `s1@${Date.parse('2026-08-13T07:00:00Z')}`;

beforeEach(() => {
  localStorage.clear();
  occurrences.mockReset();
  occurrences.mockImplementation(async (schedules: Schedule[]) =>
    schedules.map((s) => ({
      scheduleId: s.id,
      at: s.id === 's1' ? ['2026-08-13 07:00:00'] : ['2026-08-14 07:00:00'],
      truncated: false,
    }))
  );
});

describe('schedule view modes', () => {
  it('shows the list by default and never asks the backend for occurrences', () => {
    renderDetail();
    expect(screen.getByTestId('schedules-group-alpha')).toBeTruthy();
    expect(screen.queryByTestId('schedules-calendar')).toBeNull();
    expect(screen.getByTestId('schedule-view-list').getAttribute('aria-checked')).toBe('true');
    expect(occurrences).not.toHaveBeenCalled();
  });

  it('puts the switch in the heading beside "All projects"', () => {
    renderDetail();
    const heading = screen.getByTestId('command-center-detail-heading');
    expect(heading.contains(screen.getByTestId('schedule-view-switch'))).toBe(true);
  });

  it('remembers the chosen view', () => {
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-timeline'));
    expect(localStorage.getItem('auric.command-center.schedule-view')).toBe('timeline');
  });

  it('opens on the remembered view', () => {
    localStorage.setItem('auric.command-center.schedule-view', 'calendar');
    renderDetail();
    expect(screen.getByTestId('schedules-calendar')).toBeTruthy();
  });

  it('keeps the inbox below whatever view is chosen', () => {
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    expect(screen.getByTestId('command-center-triggers')).toBeTruthy();
    expect(screen.queryByTestId('schedules-group-alpha')).toBeNull();
  });
});

describe('calendar view', () => {
  it('asks the backend for the enabled schedules of the selection only', async () => {
    renderDetail({ group: makeGroup([alpha], '/repo/alpha', 'alpha') });
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    await waitFor(() => expect(occurrences).toHaveBeenCalled());
    const asked = occurrences.mock.calls[0][0] as Schedule[];
    expect(asked.map((s) => s.id)).toEqual(['s1']);
  });

  it('does not ask for disabled schedules', async () => {
    renderDetail({
      groups: [makeGroup([makeSchedule({ enabled: false })], '/repo/alpha', 'alpha')],
    });
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    await Promise.resolve();
    expect(occurrences).not.toHaveBeenCalled();
  });

  it('places a due run in the week that holds it and opens the editor on click', async () => {
    const props = renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    const chip = await screen.findByTestId(`calendar-run-${futureRun}`);
    expect(chip.getAttribute('data-state')).toBe('upcoming');
    fireEvent.click(chip);
    expect(props.onEditSchedule).toHaveBeenCalledWith(alpha);
  });

  it('shows a past run as fired, and as failed only for severity error', async () => {
    renderDetail({
      notifications: [
        makeNotification({ uid: 'a', dedupeKey: 'schedule:s1:2026-08-11 07:00:00' }),
        makeNotification({
          uid: 'b',
          dedupeKey: 'schedule:s1:2026-08-12 07:00:00',
          severity: 'error',
        }),
      ],
    });
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    const fired = await screen.findByTestId(
      `calendar-run-s1@${Date.parse('2026-08-11T07:00:00Z')}`
    );
    const failed = screen.getByTestId(`calendar-run-s1@${Date.parse('2026-08-12T07:00:00Z')}`);
    expect(fired.getAttribute('data-state')).toBe('fired');
    expect(failed.getAttribute('data-state')).toBe('failed');
  });

  it('states what failed means', async () => {
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    expect(screen.getByTestId('schedule-run-legend').textContent).toContain(
      'failed = run reported an error'
    );
  });

  it('moves between weeks and asks again for the new window', async () => {
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    await screen.findByTestId(`calendar-run-${futureRun}`);
    fireEvent.click(screen.getByTestId('calendar-next'));
    await waitFor(() => expect(occurrences.mock.calls.length).toBeGreaterThan(1));
    expect(screen.queryByTestId(`calendar-run-${futureRun}`)).toBeNull();
    fireEvent.click(screen.getByTestId('calendar-today'));
    await screen.findByTestId(`calendar-run-${futureRun}`);
  });

  it('folds a crowded hour into +N and expands it', async () => {
    occurrences.mockImplementation(async (schedules: Schedule[]) =>
      schedules.map((s) => ({ scheduleId: s.id, at: ['2026-08-13 07:00:00'], truncated: false }))
    );
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => makeSchedule({ id, name: `Job ${id}` }));
    renderDetail({ groups: [makeGroup(many, '/repo/alpha', 'alpha')] });
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    const more = await screen.findByText('+2');
    expect(screen.queryAllByTestId(/^calendar-run-/)).toHaveLength(3);
    fireEvent.click(more);
    expect(screen.queryAllByTestId(/^calendar-run-/)).toHaveLength(5);
  });

  it('says so when runs were cut and when the future could not be computed', async () => {
    occurrences.mockResolvedValueOnce([{ scheduleId: 's1', at: [], truncated: true }]);
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    await screen.findByTestId('schedule-runs-truncated');
  });

  it('reports a backend failure instead of drawing an empty future as calm', async () => {
    occurrences.mockRejectedValue(new Error('no ipc'));
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    await screen.findByTestId('schedule-runs-future-failed');
  });
});

describe('timeline view', () => {
  it('draws one lane per project by default', async () => {
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-timeline'));
    await screen.findByTestId(`timeline-run-${futureRun}`);
    expect(screen.getByTestId('timeline-lane-/repo/alpha')).toBeTruthy();
    expect(screen.getByTestId('timeline-lane-/repo/beta')).toBeTruthy();
    expect(screen.queryByTestId('timeline-lane-s1')).toBeNull();
  });

  it('switches to one lane per schedule', async () => {
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-timeline'));
    fireEvent.click(screen.getByTestId('timeline-lanes-schedule'));
    expect(screen.getByTestId('timeline-lane-s1')).toBeTruthy();
    expect(screen.getByTestId('timeline-lane-s2')).toBeTruthy();
    expect(screen.queryByTestId('timeline-lane-/repo/alpha')).toBeNull();
  });

  it('applies the project filter: a selected project shows only its own lane', async () => {
    renderDetail({ group: makeGroup([alpha], '/repo/alpha', 'alpha') });
    fireEvent.click(screen.getByTestId('schedule-view-timeline'));
    await screen.findByTestId(`timeline-run-${futureRun}`);
    expect(screen.queryByTestId('timeline-lane-/repo/beta')).toBeNull();
  });

  it('merges a dense run of dots into one counted cluster', async () => {
    occurrences.mockImplementation(async (schedules: Schedule[]) =>
      schedules.map((s) => ({
        scheduleId: s.id,
        at: Array.from({ length: 20 }, (_, i) => `2026-08-13 07:${String(i).padStart(2, '0')}:00`),
        truncated: false,
      }))
    );
    renderDetail({ groups: [makeGroup([alpha], '/repo/alpha', 'alpha')] });
    fireEvent.click(screen.getByTestId('schedule-view-timeline'));
    const dot = await screen.findByTestId(`timeline-run-s1@${Date.parse('2026-08-13T07:00:00Z')}`);
    expect(dot.getAttribute('data-count')).toBe('20');
  });

  it('marks now on the axis and offers three zoom levels', () => {
    renderDetail();
    fireEvent.click(screen.getByTestId('schedule-view-timeline'));
    expect(screen.getByTestId('timeline-now')).toBeTruthy();
    fireEvent.click(screen.getByTestId('timeline-zoom-24h'));
    expect(screen.getByTestId('timeline-zoom-24h').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('timeline-zoom-30d')).toBeTruthy();
  });
});

describe('with nothing to draw', () => {
  it('falls back to the list wording when there are no schedules', () => {
    renderDetail({ groups: [] });
    fireEvent.click(screen.getByTestId('schedule-view-calendar'));
    expect(screen.getByTestId('schedules-empty')).toBeTruthy();
  });
});
