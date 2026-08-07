'use client';

import { useState, useMemo } from 'react';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import { getGoalChildren, getGoalProgress, getRootGoals } from '@/lib/store/goalsSlice';

export const GOAL_STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  draft: { dot: 'bg-gray-400', label: 'Draft', text: 'text-gray-300' },
  active: { dot: 'bg-sky-400', label: 'Active', text: 'text-sky-300' },
  in_progress: { dot: 'bg-amber-400 animate-pulse', label: 'In Progress', text: 'text-amber-300' },
  achieved: { dot: 'bg-green-400', label: 'Achieved', text: 'text-green-300' },
  failed: { dot: 'bg-red-400', label: 'Failed', text: 'text-red-300' },
  archived: { dot: 'bg-gray-600', label: 'Archived', text: 'text-gray-500' },
};

interface GoalTreeProps {
  goals: PmGoal[];
  tickets: PmTicket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Agent count per goal id (running agents working toward the goal). */
  activeAgentsByGoal?: Record<string, number>;
  /** Opens the goal creation dialog; enables the empty-state call to action. */
  onCreate?: () => void;
  /** True while goals are being read — an empty tree is not yet a fact. */
  loading?: boolean;
  /** Why the goals could not be read; shown instead of a false empty state. */
  loadError?: string | null;
}

interface GoalNodeProps extends GoalTreeProps {
  goal: PmGoal;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}

function GoalNode({
  goal,
  depth,
  goals,
  tickets,
  selectedId,
  onSelect,
  activeAgentsByGoal,
  collapsed,
  onToggle,
}: GoalNodeProps) {
  const children = getGoalChildren(goals, goal.id);
  const progress = getGoalProgress(goals, tickets, goal.id);
  const isCollapsed = collapsed.has(goal.id);
  const isSelected = goal.id === selectedId;
  const style = GOAL_STATUS_STYLES[goal.status] ?? GOAL_STATUS_STYLES.draft;
  const percent =
    progress.totalTickets > 0
      ? Math.round((progress.doneTickets / progress.totalTickets) * 100)
      : null;
  const agentCount = activeAgentsByGoal?.[goal.id] ?? 0;

  return (
    <div>
      <div
        data-testid={`goal-node-${goal.id}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(goal.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(goal.id);
          }
        }}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        className={`group flex w-full cursor-pointer items-center gap-2 rounded-lg py-2 pr-3 text-left transition-colors ${
          isSelected ? 'bg-primary/15 ring-1 ring-primary/30' : 'hover:bg-white/5'
        }`}
      >
        {children.length > 0 ? (
          <button
            type="button"
            data-testid={`goal-toggle-${goal.id}`}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand sub-goals' : 'Collapse sub-goals'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(goal.id);
            }}
            className="material-symbols-outlined -ml-1 w-4 shrink-0 cursor-pointer text-sm text-foreground-muted hover:text-foreground"
          >
            {isCollapsed ? 'chevron_right' : 'expand_more'}
          </button>
        ) : (
          <span className="-ml-1 w-4 shrink-0" />
        )}

        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} title={style.label} />

        <span
          className={`flex-1 truncate text-xs ${isSelected ? 'font-semibold text-foreground' : 'text-foreground/90'}`}
        >
          {goal.name}
        </span>

        {agentCount > 0 && (
          <span
            data-testid={`goal-agents-${goal.id}`}
            title={`${agentCount} agent(s) running`}
            className="flex items-center gap-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold text-primary-light"
          >
            <span className="material-symbols-outlined text-[10px]">smart_toy</span>
            {agentCount}
          </span>
        )}

        {(goal.priority === 'critical' || goal.priority === 'high') && (
          <span
            className={`text-[9px] font-bold uppercase ${goal.priority === 'critical' ? 'text-red-400' : 'text-amber-400'}`}
          >
            {goal.priority}
          </span>
        )}

        {percent !== null && (
          <span className="flex w-24 shrink-0 items-center gap-1.5">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <span
                data-testid={`goal-progress-${goal.id}`}
                className={`block h-full rounded-full transition ${percent === 100 ? 'bg-green-400' : 'bg-primary'}`}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="text-[9px] tabular-nums text-foreground-muted">
              {progress.doneTickets}/{progress.totalTickets}
            </span>
          </span>
        )}
      </div>

      {!isCollapsed &&
        children.map((child) => (
          <GoalNode
            key={child.id}
            goal={child}
            depth={depth + 1}
            goals={goals}
            tickets={tickets}
            selectedId={selectedId}
            onSelect={onSelect}
            activeAgentsByGoal={activeAgentsByGoal}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
    </div>
  );
}

export function GoalTree({
  goals,
  tickets,
  selectedId,
  onSelect,
  activeAgentsByGoal,
  onCreate,
  loading = false,
  loadError = null,
}: GoalTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const roots = useMemo(() => getRootGoals(goals), [goals]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // An empty tree means three different things. Saying "no goals yet" while
  // the read is still running — or failed — is the one that makes a user
  // believe their project state is gone.
  if (roots.length === 0 && loadError) {
    return (
      <div
        data-testid="goal-tree-error"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <span className="material-symbols-outlined text-3xl text-red-400/60">error</span>
        <p className="text-xs font-medium text-foreground">Goals could not be read</p>
        <p className="max-w-[260px] text-[10px] leading-relaxed text-foreground-muted">
          {loadError}
        </p>
      </div>
    );
  }

  if (roots.length === 0 && loading) {
    return (
      <div
        data-testid="goal-tree-loading"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-xs text-foreground-muted">Loading goals…</p>
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div
        data-testid="goal-tree-empty"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <span className="material-symbols-outlined text-3xl text-foreground-muted/40">flag</span>
        <p className="text-xs font-medium text-foreground">No goals yet</p>
        <p className="max-w-[260px] text-[10px] leading-relaxed text-foreground-muted">
          A goal describes a target state the conductor can verify: tickets done, requirements
          verified, sub-goals achieved.
        </p>
        {onCreate && (
          <button
            data-testid="goal-tree-empty-create"
            onClick={onCreate}
            className="mt-2 rounded-lg bg-primary/15 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/25 transition-colors"
          >
            Create your first goal
          </button>
        )}
      </div>
    );
  }

  return (
    <div data-testid="goal-tree" className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {roots.map((root) => (
        <GoalNode
          key={root.id}
          goal={root}
          depth={0}
          goals={goals}
          tickets={tickets}
          selectedId={selectedId}
          onSelect={onSelect}
          activeAgentsByGoal={activeAgentsByGoal}
          collapsed={collapsed}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}
