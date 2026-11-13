import type { AgentUsageRow } from '../pm/usage/types';
import { invoke } from './invoke';
import { subscribeToTauriEvent } from './subscribe';

export const AGENT_USAGE_RECORDED_EVENT = 'agent-usage-recorded';

export interface AgentUsageRecorded {
  projectPath: string;
  row: AgentUsageRow;
}

/** Every recorded run of the project, newest first. */
export async function agentUsageLoad(projectPath: string): Promise<AgentUsageRow[]> {
  return await invoke<AgentUsageRow[]>('agent_usage_load', { projectPath });
}

/** What one "Recalculate pricing" pass did (`agent_usage::reprice::RepriceReport`). */
export interface RepriceReport {
  /** Runs booked from a transcript or rollout that still had no price. */
  unpriced: number;
  repriced: number;
  /** The price list still does not know one of their models. */
  stillUnpriced: number;
  /** The transcript is gone, or the provider no longer says where to look. */
  missingEvidence: number;
  /** The transcript no longer adds up to the booked tokens; left as booked. */
  changedEvidence: number;
  unpricedModels: string[];
}

/** Prices the project's unpriced runs with the price list as it is on disk now. */
export async function agentUsageReprice(projectPath: string): Promise<RepriceReport> {
  return await invoke<RepriceReport>('agent_usage_reprice', { projectPath });
}

/** Fires after Rust stored a run, so the open project can append without a reload. */
export function onAgentUsageRecorded(callback: (event: AgentUsageRecorded) => void): () => void {
  return subscribeToTauriEvent(
    AGENT_USAGE_RECORDED_EVENT,
    callback,
    '[Browser mode] Agent usage listener not available'
  );
}
