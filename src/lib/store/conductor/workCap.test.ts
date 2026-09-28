import { describe, expect, it } from 'vitest';
import { CONDUCTOR_WORK_CAP_MAX, normalizeConductorWorkCap } from './workCap';

describe('normalizeConductorWorkCap', () => {
  it('keeps a number inside the ceiling', () => {
    expect(normalizeConductorWorkCap(5)).toBe(5);
    expect(normalizeConductorWorkCap(1)).toBe(1);
  });

  it('treats blank, zero, and junk as no limit', () => {
    expect(normalizeConductorWorkCap(null)).toBeNull();
    expect(normalizeConductorWorkCap(undefined)).toBeNull();
    expect(normalizeConductorWorkCap(0)).toBeNull();
    expect(normalizeConductorWorkCap(-3)).toBeNull();
    expect(normalizeConductorWorkCap(Number.NaN)).toBeNull();
  });

  it('cuts a number above the ceiling down to the ceiling', () => {
    expect(normalizeConductorWorkCap(80)).toBe(CONDUCTOR_WORK_CAP_MAX);
    expect(normalizeConductorWorkCap(10.9)).toBe(10);
  });
});
