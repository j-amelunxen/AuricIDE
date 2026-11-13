import { parseUtcStamp } from '@/lib/time/utcStamp';
import type { PmRequirement } from './types';

/** A verification older than this no longer counts as proof; the MCP `stale` filter uses it too. */
export const REQUIREMENT_STALE_DAYS = 30;
const STALE_MS = REQUIREMENT_STALE_DAYS * 24 * 60 * 60 * 1000;

/**
 * How fresh the last verification is: `never` without one, else `fresh` or
 * `stale`. The stamp is UTC; read as local time it would age by the offset.
 */
export function verificationFreshness(
  requirement: Pick<PmRequirement, 'lastVerifiedAt'>,
  now: number = Date.now()
): 'never' | 'fresh' | 'stale' {
  if (requirement.lastVerifiedAt === null) return 'never';
  const verified = parseUtcStamp(requirement.lastVerifiedAt);
  return verified !== null && now - verified <= STALE_MS ? 'fresh' : 'stale';
}

/**
 * Where the invariants a project holds itself to stand: of the live ones
 * (active, implemented, verified), how many still need proof (never verified
 * since they changed, or verified too long ago) and how many hold.
 */
export function requirementProof(
  requirements: readonly PmRequirement[],
  now: number = Date.now()
): { relevant: number; stale: number; unverified: number; needProof: number; held: number } {
  const relevant = requirements.filter(
    (r) => r.status === 'active' || r.status === 'implemented' || r.status === 'verified'
  );
  const unverified = relevant.filter((r) => r.status !== 'verified').length;
  const stale = relevant.filter(
    (r) => r.status === 'verified' && verificationFreshness(r, now) === 'stale'
  ).length;
  const needProof = stale + unverified;
  return {
    relevant: relevant.length,
    stale,
    unverified,
    needProof,
    held: relevant.length - needProof,
  };
}
