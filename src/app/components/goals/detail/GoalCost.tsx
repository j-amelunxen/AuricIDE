'use client';

import { useMemo } from 'react';
import { usageForGoalSubtree, type TicketRef } from '@/lib/pm/usage/aggregate';
import type { AgentUsageRow } from '@/lib/tauri/agentUsage';
import type { PmGoal } from '@/lib/tauri/goals';
import { UsageCard } from '@/app/components/pm/cost/UsageCard';

interface GoalCostProps {
  goalId: string;
  goals: readonly PmGoal[];
  tickets: readonly TicketRef[];
  rows: readonly AgentUsageRow[];
}

/** What the goal and everything beneath it cost: its own runs plus its tickets' runs. */
export function GoalCost({ goalId, goals, tickets, rows }: GoalCostProps) {
  const subtreeRows = useMemo(
    () => usageForGoalSubtree(rows, { id: goalId }, goals, tickets),
    [rows, goalId, goals, tickets]
  );
  return <UsageCard rows={subtreeRows} />;
}
