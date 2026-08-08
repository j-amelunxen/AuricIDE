import { describe, expect, it } from 'vitest';
import { formatAgentDuration } from './duration';

describe('formatAgentDuration', () => {
  it('counts in seconds while an agent is fresh', () => {
    // Seconds matter here: the difference between "thinking" and "stuck" is
    // often the first half-minute.
    expect(formatAgentDuration(3_000)).toBe('3s');
    expect(formatAgentDuration(59_000)).toBe('59s');
  });

  it('switches to whole minutes past a minute', () => {
    expect(formatAgentDuration(60_000)).toBe('1m');
    expect(formatAgentDuration(90_000)).toBe('1m');
    expect(formatAgentDuration(59 * 60_000)).toBe('59m');
  });

  it('shows hours with their minutes', () => {
    expect(formatAgentDuration(60 * 60_000)).toBe('1h 0m');
    expect(formatAgentDuration(75 * 60_000)).toBe('1h 15m');
  });

  it('drops to days once it has been running that long', () => {
    expect(formatAgentDuration(25 * 60 * 60_000)).toBe('1d 1h');
  });

  it('never reports a negative age from a clock skew', () => {
    expect(formatAgentDuration(-5_000)).toBe('0s');
  });

  it('reads as just-started at zero', () => {
    expect(formatAgentDuration(0)).toBe('0s');
  });
});
