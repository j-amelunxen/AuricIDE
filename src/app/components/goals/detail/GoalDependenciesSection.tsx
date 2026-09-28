'use client';

import { useMemo, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { PmGoal, PmGoalDependency } from '@/lib/tauri/goals';
import { normalizeBundle } from '@/lib/goals/goalDependencies';
import { getGoalBlockers, type GoalDependencyResult } from '@/lib/store/goalsSlice';
import { GoalBundleField } from './GoalBundleField';

export interface GoalDependenciesSectionProps {
  goal: PmGoal;
  goals: PmGoal[];
  dependencies: PmGoalDependency[];
  onAddDependency: (goalId: string, dependsOnGoalId: string) => GoalDependencyResult;
  onRemoveDependency: (goalId: string, dependsOnGoalId: string) => void;
  onSetBundle: (goalId: string, bundle: string | null) => GoalDependencyResult;
  onError: (message: string) => void;
  labelCls: string;
  inputCls: string;
}

/**
 * "Waits for" edges and the bundle label, both scoped to siblings — the same
 * scope the plan graph draws. A dependency edge onto a non-sibling goal is
 * technically valid (only an ancestor or descendant is rejected), but a
 * cross-branch wait has no place to show up in the sub-goal plan, so the
 * picker only offers what the graph can actually draw.
 */
// code-gate: complexity-parameter-count - forwards goal/goals/dependencies plus the callback set both the chips and the bundle field need; bagging them into one object would relocate, not remove, the coupling
export function GoalDependenciesSection({
  goal,
  goals,
  dependencies,
  onAddDependency,
  onRemoveDependency,
  onSetBundle,
  onError,
  labelCls,
  inputCls,
}: GoalDependenciesSectionProps) {
  const [addPickerValue, setAddPickerValue] = useState('');

  const siblings = useMemo(
    () => goals.filter((g) => g.parentId === goal.parentId && g.id !== goal.id),
    [goals, goal.parentId, goal.id]
  );

  const waitsFor = useMemo(
    () =>
      dependencies
        .filter((d) => d.goalId === goal.id)
        .map((d) => goals.find((g) => g.id === d.dependsOnGoalId))
        .filter((g): g is PmGoal => g !== undefined),
    [dependencies, goals, goal.id]
  );

  const addableSiblings = useMemo(() => {
    const waited = new Set(waitsFor.map((g) => g.id));
    return siblings.filter((g) => !waited.has(g.id));
  }, [siblings, waitsFor]);

  const siblingBundleLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const sibling of siblings) {
      const label = normalizeBundle(sibling.bundle);
      if (label) labels.add(label);
    }
    return [...labels];
  }, [siblings]);

  const isBlocked = getGoalBlockers(goals, dependencies, goal.id).length > 0;

  const handleAdd = (dependsOnGoalId: string) => {
    setAddPickerValue('');
    const result = onAddDependency(goal.id, dependsOnGoalId);
    if (!result.ok) onError(result.error.message);
  };

  return (
    <div>
      <label className={labelCls}>Dependencies</label>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {waitsFor.length === 0 ? (
          <span className="text-[10px] text-foreground-muted">Runs in parallel with siblings.</span>
        ) : (
          waitsFor.map((target) => (
            <span
              key={target.id}
              data-testid={`goal-depends-chip-${target.id}`}
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
                isBlocked ? 'bg-amber-500/15 text-amber-300' : 'bg-white/10 text-foreground/80'
              }`}
            >
              waits for {target.name}
              <button
                data-testid={`goal-depends-unlink-${target.id}`}
                onClick={() => onRemoveDependency(goal.id, target.id)}
                className="text-[10px] opacity-60 hover:opacity-100"
                title="Remove dependency"
              >
                <AuricIcon name="close" />
              </button>
            </span>
          ))
        )}
      </div>

      {addableSiblings.length > 0 && (
        <select
          data-testid="goal-depends-picker"
          value={addPickerValue}
          onChange={(e) => {
            if (e.target.value) handleAdd(e.target.value);
          }}
          className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-foreground-muted outline-none"
        >
          <option value="" className="bg-background-dark">
            + Wait for sibling…
          </option>
          {addableSiblings.map((sibling) => (
            <option key={sibling.id} value={sibling.id} className="bg-background-dark">
              {sibling.name}
            </option>
          ))}
        </select>
      )}

      <GoalBundleField
        goal={goal}
        siblingBundleLabels={siblingBundleLabels}
        onSetBundle={onSetBundle}
        onError={onError}
        labelCls={labelCls}
        inputCls={inputCls}
      />
    </div>
  );
}
