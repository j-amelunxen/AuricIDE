'use client';

import { useEffect, useRef, useState } from 'react';
import type { PmGoal } from '@/lib/tauri/goals';
import { normalizeBundle } from '@/lib/goals/goalDependencies';
import type { GoalDependencyResult } from '@/lib/store/goalsSlice';

export interface GoalBundleFieldProps {
  goal: PmGoal;
  siblingBundleLabels: string[];
  onSetBundle: (goalId: string, bundle: string | null) => GoalDependencyResult;
  onError: (message: string) => void;
  labelCls: string;
  inputCls: string;
}

/**
 * The bundle input, on its own: siblings with the same trimmed label close
 * together. Tracks whether the field is being typed in so an external bundle
 * change (an MCP agent, another session) is picked up live instead of being
 * overwritten by a stale draft the next time the field is blurred.
 */
export function GoalBundleField({
  goal,
  siblingBundleLabels,
  onSetBundle,
  onError,
  labelCls,
  inputCls,
}: GoalBundleFieldProps) {
  const [bundleDraft, setBundleDraft] = useState(goal.bundle ?? '');
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setBundleDraft(goal.bundle ?? '');
  }, [goal.bundle]);

  const commitBundle = () => {
    editingRef.current = false;
    if (normalizeBundle(bundleDraft) === normalizeBundle(goal.bundle)) return;
    const result = onSetBundle(goal.id, bundleDraft);
    if (!result.ok) {
      onError(result.error.message);
      setBundleDraft(goal.bundle ?? '');
    }
  };

  return (
    <div className="mt-3">
      <label htmlFor="goal-bundle-input" className={labelCls}>
        Bundle
      </label>
      <input
        id="goal-bundle-input"
        data-testid="goal-bundle-input"
        list="goal-bundle-labels"
        value={bundleDraft}
        onFocus={() => {
          editingRef.current = true;
        }}
        onChange={(e) => setBundleDraft(e.target.value)}
        onBlur={commitBundle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        placeholder="No bundle — closes on its own"
        className={inputCls}
      />
      <datalist id="goal-bundle-labels">
        {siblingBundleLabels.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      <p className="mt-1 text-[9px] leading-snug text-foreground-muted">
        Siblings with the same bundle name only achieve together.
      </p>
    </div>
  );
}
