/**
 * The one decision behind an automatic start under a launch grant.
 *
 * Pure on purpose: the same function is the reference the Lean model
 * `verification/lean/AuricIDE/LaunchGate.lean` is checked against
 * (REQ-LAUNCH-01..03 in the goal-native mission), the pre-filter
 * `grantedAgentLaunches` uses, and the rule the native claim
 * (`claim_launch_impl` in `src-tauri/src/notifications/operations.rs`)
 * enforces atomically (it additionally checks the grant row and the goal
 * tree in project.db). The checks run in a fixed order: grant, claim, budget,
 * slot.
 *
 * There is no clock in the gate: a request that waited before the grant was
 * given starts once it is, capped by limit and budget (decision Jennifer
 * 2026-09-26).
 *
 * Every comparison is written so that an unreadable number (NaN, a missing
 * count read as Infinity) closes the gate instead of opening it.
 */

export type LaunchDecision =
  'start' | 'no-grant' | 'already-claimed' | 'budget-spent' | 'at-capacity';

export interface LaunchGateGrant {
  maxConcurrent: number;
  launchBudget: number;
}

export interface LaunchGateInput {
  /** The grant in force for the request's mission root at this moment, or null. */
  grant: LaunchGateGrant | null;
  /** Read, answered or claimed already, here or in another app instance. */
  alreadyClaimed: boolean;
  /** Automatic starts this grant has paid for. */
  used: number;
  /** Starts under the mission root that run or are not yet resolved. */
  held: number;
}

export function decideLaunch(input: LaunchGateInput): LaunchDecision {
  const { grant } = input;
  if (grant === null) return 'no-grant';
  if (input.alreadyClaimed) return 'already-claimed';
  if (!(input.used < grant.launchBudget)) return 'budget-spent';
  if (!(input.held < grant.maxConcurrent)) return 'at-capacity';
  return 'start';
}
