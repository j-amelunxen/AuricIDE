'use client';

import { useStore } from '@/lib/store';
import { getStaleRequirements, getUnverifiedRequirements } from '@/lib/store/requirementsSlice';

const STALE_DAYS = 30;

/**
 * Ambient verification light for the status bar: green while every active
 * invariant is freshly proven, amber the moment a proof goes stale or an
 * invariant lacks one. Hidden until the project declares requirements, so
 * the bar stays quiet on projects that don't use them.
 */
export function TruthsLight() {
  const requirements = useStore((s) => s.requirementsDraft);
  const rootPath = useStore((s) => s.rootPath);
  const setRequirementsModalOpen = useStore((s) => s.setRequirementsModalOpen);
  const loadRequirements = useStore((s) => s.loadRequirements);

  const relevant = requirements.filter(
    (r) => r.status === 'active' || r.status === 'implemented' || r.status === 'verified'
  );
  if (relevant.length === 0) return null;

  const staleCount = getStaleRequirements(relevant, STALE_DAYS).length;
  const unverifiedCount = getUnverifiedRequirements(relevant).length;
  const needProof = staleCount + unverifiedCount;
  const held = relevant.length - needProof;

  const handleClick = () => {
    setRequirementsModalOpen(true);
    if (rootPath) void loadRequirements(rootPath);
  };

  return (
    <button
      data-testid="truths-light"
      aria-label="Requirements verification status"
      onClick={handleClick}
      title={
        needProof > 0
          ? `${needProof} invariant(s) stale or unverified — open Requirements`
          : 'Every invariant is freshly proven'
      }
      className="flex items-center gap-1.5 hover:text-foreground transition-colors"
    >
      <span
        data-testid="truths-light-dot"
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${
          needProof > 0
            ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]'
            : 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
        }`}
      />
      <span className={needProof > 0 ? 'text-amber-300' : undefined}>
        {needProof > 0 ? `${needProof} need proof` : `${held}/${relevant.length} truths held`}
      </span>
    </button>
  );
}
