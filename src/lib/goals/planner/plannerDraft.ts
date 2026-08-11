import { dbDelete, dbGet, dbSet } from '@/lib/tauri/db';
import type { PlannerGraph } from './plannerSchema';

/**
 * Draft persistence in the project kv store: a draft survives an app
 * restart, and because it lives in its own namespace it structurally cannot
 * leak onto the board — only "Start this line" writes stations.
 */
const NAMESPACE = 'goal_line_planner';

export interface PlannerRevision {
  instruction: string;
  at: string;
}

export interface PlannerDraft {
  graph: PlannerGraph;
  revisions: PlannerRevision[];
}

export async function loadPlannerDraft(
  projectPath: string,
  goalId: string
): Promise<PlannerDraft | null> {
  const raw = await dbGet(projectPath, NAMESPACE, goalId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlannerDraft;
    if (!parsed.graph || !Array.isArray(parsed.graph.stations)) return null;
    return { graph: parsed.graph, revisions: parsed.revisions ?? [] };
  } catch {
    // A corrupt draft is discarded rather than crashing the planner — the
    // dump that produced it is one paste away.
    return null;
  }
}

export async function savePlannerDraft(
  projectPath: string,
  goalId: string,
  draft: PlannerDraft
): Promise<void> {
  await dbSet(projectPath, NAMESPACE, goalId, JSON.stringify(draft));
}

export async function deletePlannerDraft(projectPath: string, goalId: string): Promise<void> {
  await dbDelete(projectPath, NAMESPACE, goalId);
}
