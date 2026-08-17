import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Schedule } from '@/lib/tauri/schedules';
import { UpcomingStrip, type UpcomingStripProps } from './UpcomingStrip';

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
    anchorAt: '2026-08-12 07:00:00',
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

function renderStrip(overrides: Partial<UpcomingStripProps> = {}) {
  const props: UpcomingStripProps = {
    schedules: [],
    now: NOW,
    starredProjects: [],
    onSelectProject: vi.fn(),
    ...overrides,
  };
  const view = render(<UpcomingStrip {...props} />);
  return { ...props, view };
}

describe('UpcomingStrip', () => {
  // A strip that renders itself empty is a band of nothing between the header
  // and the work — worse than absent, because it looks like a failure.
  it('is absent when nothing is due', () => {
    const { view } = renderStrip();
    expect(view.container.firstChild).toBeNull();
  });

  it('names the schedule and how far off it is', () => {
    renderStrip({ schedules: [makeSchedule()] });

    const chip = screen.getByTestId('upcoming-s1');
    expect(chip.textContent).toContain('Security-Scan');
    expect(chip.textContent).toContain('in 2 h');
  });

  it('draws the project the reminder belongs to', () => {
    renderStrip({
      schedules: [makeSchedule({ projectPath: '/repo/alpha', projectName: 'alpha' })],
    });

    expect(screen.getByTestId('tile-face-/repo/alpha')).toBeTruthy();
    expect(screen.getByTestId('upcoming-s1').textContent).toContain('alpha');
  });

  it('draws no tile for an app-wide reminder', () => {
    renderStrip({ schedules: [makeSchedule()] });
    expect(screen.queryByTestId(/^tile-face-/)).toBeNull();
  });

  // The chip is a pointer, not a decoration: clicking it moves the rail to
  // the project whose reminder is about to fire.
  it('selects the chip’s project', () => {
    const props = renderStrip({
      schedules: [makeSchedule({ projectPath: '/repo/alpha', projectName: 'alpha' })],
    });

    fireEvent.click(screen.getByTestId('upcoming-s1'));

    expect(props.onSelectProject).toHaveBeenCalledWith('/repo/alpha');
  });

  it('selects the app-wide group for a reminder with no project', () => {
    const props = renderStrip({ schedules: [makeSchedule()] });

    fireEvent.click(screen.getByTestId('upcoming-s1'));

    expect(props.onSelectProject).toHaveBeenCalledWith(null);
  });

  it('keeps the order it was handed', () => {
    renderStrip({
      schedules: [
        makeSchedule({ id: 's1', name: 'First' }),
        makeSchedule({ id: 's2', name: 'Second' }),
      ],
    });

    const chips = screen.getAllByTestId(/^upcoming-s/);
    expect(chips.map((chip) => chip.dataset.testid ?? chip.getAttribute('data-testid'))).toEqual([
      'upcoming-s1',
      'upcoming-s2',
    ]);
  });
});
