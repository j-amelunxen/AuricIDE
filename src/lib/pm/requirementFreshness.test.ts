import { describe, expect, it } from 'vitest';
import { formatUtcStamp } from '@/lib/time/utcStamp';
import type { PmRequirement } from './types';
import {
  REQUIREMENT_STALE_DAYS,
  requirementProof,
  verificationFreshness,
} from './requirementFreshness';

const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const DAY = 86_400_000;
const daysAgo = (days: number) => formatUtcStamp(NOW - days * DAY);

function requirement(status: PmRequirement['status'], lastVerifiedAt: string | null) {
  return { status, lastVerifiedAt } as PmRequirement;
}

describe('verificationFreshness', () => {
  it('is never, fresh up to the window, then stale', () => {
    expect(verificationFreshness({ lastVerifiedAt: null }, NOW)).toBe('never');
    expect(verificationFreshness({ lastVerifiedAt: daysAgo(REQUIREMENT_STALE_DAYS) }, NOW)).toBe(
      'fresh'
    );
    expect(
      verificationFreshness({ lastVerifiedAt: daysAgo(REQUIREMENT_STALE_DAYS + 0.01) }, NOW)
    ).toBe('stale');
  });

  // The stored stamp is UTC without a zone. Read as local time, a
  // verification made minutes before the window closed would flip early or
  // late by the machine's offset.
  it('reads the stamp as UTC whatever the machine zone', () => {
    const justInside = formatUtcStamp(NOW - REQUIREMENT_STALE_DAYS * DAY + 60_000);
    expect(verificationFreshness({ lastVerifiedAt: justInside }, NOW)).toBe('fresh');
  });

  it('counts an unreadable stamp as stale rather than fresh', () => {
    expect(verificationFreshness({ lastVerifiedAt: 'yesterday' }, NOW)).toBe('stale');
  });
});

describe('requirementProof', () => {
  it('counts live requirements that still need proof and those that hold', () => {
    const proof = requirementProof(
      [
        requirement('active', null),
        requirement('implemented', daysAgo(1)),
        requirement('verified', daysAgo(1)),
        requirement('verified', daysAgo(REQUIREMENT_STALE_DAYS + 1)),
        requirement('draft', null),
        requirement('deprecated', daysAgo(400)),
      ],
      NOW
    );
    expect(proof).toEqual({ relevant: 4, unverified: 2, stale: 1, needProof: 3, held: 1 });
  });
});
