import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBarClock } from './StatusBarClock';
import { STATUS_BAR_CLOCK_STORAGE_KEY } from '@/lib/settings/statusBarClock';

describe('StatusBarClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T09:41:00'));
  });

  afterEach(() => {
    localStorage.removeItem(STATUS_BAR_CLOCK_STORAGE_KEY);
    vi.useRealTimers();
  });

  it('renders the current time by default', () => {
    render(<StatusBarClock />);
    expect(screen.getByTestId('status-bar-clock')).toHaveTextContent('09:41');
  });

  it('updates once a minute passes', () => {
    render(<StatusBarClock />);
    expect(screen.getByTestId('status-bar-clock')).toHaveTextContent('09:41');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId('status-bar-clock')).toHaveTextContent('09:42');
  });

  it('renders nothing when the setting is switched off', () => {
    localStorage.setItem(STATUS_BAR_CLOCK_STORAGE_KEY, 'false');
    render(<StatusBarClock />);
    expect(screen.queryByTestId('status-bar-clock')).not.toBeInTheDocument();
  });
});
