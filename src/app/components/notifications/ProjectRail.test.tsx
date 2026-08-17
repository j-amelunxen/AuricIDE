import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ProjectGroup } from '@/lib/notifications/commandCenter';
import type { Notification } from '@/lib/notifications/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { ProjectRail, type ProjectRailProps } from './ProjectRail';

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
    createdAt: '2026-08-12 07:00:00',
    updatedAt: '2026-08-12 07:00:00',
    ...overrides,
  };
}

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    uid: 'n-1',
    createdAt: '2026-08-12 09:00:00',
    projectPath: '/repo/alpha',
    projectName: 'alpha',
    source: 'system',
    origin: null,
    kind: 'info',
    severity: 'info',
    title: 'Something happened',
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

function makeGroup(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    key: '/repo/alpha',
    path: '/repo/alpha',
    label: 'alpha',
    notifications: [],
    unread: 0,
    openQuestions: 0,
    schedules: [],
    nextDueAt: null,
    ...overrides,
  };
}

function renderRail(overrides: Partial<ProjectRailProps> = {}) {
  const props: ProjectRailProps = {
    groups: [],
    selectedKey: null,
    totals: { unread: 0, openQuestions: 0, schedules: 0 },
    now: NOW,
    starredProjects: [],
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<ProjectRail {...props} />);
  return props;
}

describe('ProjectRail', () => {
  it('leads with an All row that carries the whole scope', () => {
    renderRail({
      groups: [makeGroup()],
      totals: { unread: 12, openQuestions: 2, schedules: 5 },
    });

    const all = screen.getByTestId('command-center-project-all');
    expect(all.textContent).toContain('All');
    expect(all.textContent).toContain('12');
    expect(all.textContent).toContain('2');
  });

  it('is a listbox whose selected row says so', () => {
    renderRail({ groups: [makeGroup()], selectedKey: '/repo/alpha' });

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByTestId('command-center-project-/repo/alpha')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('command-center-project-all')).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('marks All as selected when nothing is picked', () => {
    renderRail({ groups: [makeGroup()], selectedKey: null });

    expect(screen.getByTestId('command-center-project-all')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('reports the picked project by path', () => {
    const props = renderRail({ groups: [makeGroup()] });

    fireEvent.click(screen.getByTestId('command-center-project-/repo/alpha'));

    expect(props.onSelect).toHaveBeenCalledWith('/repo/alpha');
  });

  it('reports All as undefined, never as a path', () => {
    const props = renderRail({ groups: [makeGroup()], selectedKey: '/repo/alpha' });

    fireEvent.click(screen.getByTestId('command-center-project-all'));

    expect(props.onSelect).toHaveBeenCalledWith(undefined);
  });

  it('reports the app-wide group as null', () => {
    const props = renderRail({
      groups: [makeGroup({ key: '__app__', path: null, label: 'App' })],
    });

    fireEvent.click(screen.getByTestId('command-center-project-__app__'));

    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  // I1: the pills describe the project, not whatever the detail pane is
  // currently filtered to.
  it('carries a row’s unread, open questions, schedules and next due', () => {
    renderRail({
      groups: [
        makeGroup({
          notifications: [makeNotification()],
          unread: 3,
          openQuestions: 1,
          schedules: [makeSchedule({ projectPath: '/repo/alpha' })],
          nextDueAt: '2026-08-12 12:00:00',
        }),
      ],
    });

    const row = screen.getByTestId('command-center-project-/repo/alpha');
    expect(screen.getByTestId('rail-unread-/repo/alpha').textContent).toBe('3');
    expect(screen.getByTestId('rail-questions-/repo/alpha').textContent).toBe('1');
    expect(row.textContent).toContain('1 schedule');
    expect(row.textContent).toContain('in 2 h');
  });

  it('draws the mark a pinned project carries', () => {
    renderRail({
      groups: [makeGroup()],
      starredProjects: [
        { path: '/repo/alpha', name: 'alpha', starredAt: 1, icon: { kind: 'emoji', value: '🚀' } },
      ],
    });

    expect(screen.getByTestId('tile-face-/repo/alpha')).toHaveAttribute('data-icon-kind', 'emoji');
  });

  // An idle starred project is in the rail so that "+ New schedule" for it is
  // one click — but it must not shout, or the rail stops ranking anything.
  it('keeps an empty project quiet: no pills, no counts', () => {
    renderRail({ groups: [makeGroup()] });

    expect(screen.queryByTestId('rail-unread-/repo/alpha')).toBeNull();
    expect(screen.queryByTestId('rail-questions-/repo/alpha')).toBeNull();
    expect(screen.getByTestId('command-center-project-/repo/alpha').dataset.quiet).toBe('true');
  });

  describe('keyboard', () => {
    // Selection is a prop, so the walk is checked the way the Command Center
    // performs it: report, re-render with the answer, step again.
    it('moves the selection down and up through the rows', () => {
      const onSelect = vi.fn();
      const groups = [
        makeGroup(),
        makeGroup({ key: '/repo/beta', path: '/repo/beta', label: 'beta' }),
      ];
      const props: ProjectRailProps = {
        groups,
        selectedKey: null,
        totals: { unread: 0, openQuestions: 0, schedules: 0 },
        now: NOW,
        starredProjects: [],
        onSelect,
      };
      const { rerender } = render(<ProjectRail {...props} />);

      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
      expect(onSelect).toHaveBeenLastCalledWith('/repo/alpha');

      rerender(<ProjectRail {...props} selectedKey="/repo/alpha" />);
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
      expect(onSelect).toHaveBeenLastCalledWith('/repo/beta');

      rerender(<ProjectRail {...props} selectedKey="/repo/beta" />);
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });
      expect(onSelect).toHaveBeenLastCalledWith('/repo/alpha');
    });

    it('stops at the bottom rather than wrapping', () => {
      const props = renderRail({ groups: [makeGroup()], selectedKey: '/repo/alpha' });

      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });

      expect(props.onSelect).not.toHaveBeenCalled();
    });

    it('stops at the ends rather than wrapping', () => {
      const props = renderRail({ groups: [makeGroup()], selectedKey: null });

      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowUp' });

      expect(props.onSelect).not.toHaveBeenCalled();
    });

    it('leaves other keys alone', () => {
      const props = renderRail({ groups: [makeGroup()] });

      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'a' });

      expect(props.onSelect).not.toHaveBeenCalled();
    });
  });
});
