import {
  notificationsListLaunchGrants,
  notificationsRevokeLaunchGrant,
  notificationsSaveLaunchGrant,
  type LaunchGrant,
} from '@/lib/tauri/notifications';

export type { LaunchGrant };

/**
 * Jennifer's standing permission for one mission: agent launch requests for
 * goals under this root may start without a click.
 *
 * The grant is a row in the app-global inbox database (`agent_launch_grants`,
 * migration 7), written only through the IDE's Tauri commands behind the
 * switch in the goal panel. Every app instance reads the same rows, and the
 * native claim (`claim_launch_impl`) checks the grant row itself, so a revoke
 * acknowledged in one instance stops the next start in every other one. No
 * MCP tool reads or writes grants.
 *
 * Threat model (decision Jennifer 2026-09-26, note
 * `2026-09-26-09-bedrohungsmodell-und-verzeichnis.md` in the goal-native
 * mission): in scope are races, several instances, failed writes, requests
 * forged through MCP or `notify`, and injected input. A started agent with
 * shell access writing to the SQLite file directly is out of scope on purpose.
 *
 * Save and revoke resolve only after the database acknowledged them and throw
 * otherwise; the UI shows a changed grant only then.
 */

/** Hard ceilings, the same as the table's CHECK constraints. */
export const MAX_GRANT_CONCURRENT = 5;
export const MAX_GRANT_BUDGET = 50;

/** Fired on `window` after this instance saved or revoked a grant. */
export const LAUNCH_GRANTS_CHANGED_EVENT = 'auric:launch-grants-changed';

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LAUNCH_GRANTS_CHANGED_EVENT));
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(1, Math.floor(Number.isFinite(value) ? value : 1)));
}

/** The grants in force, optionally for one project. Throws when unreadable. */
export async function listLaunchGrants(projectPath?: string): Promise<LaunchGrant[]> {
  return notificationsListLaunchGrants(projectPath);
}

/** The grant in force for this mission root in this project, if any. */
export async function grantForRoot(
  projectPath: string,
  rootGoalId: string
): Promise<LaunchGrant | null> {
  const grants = await listLaunchGrants(projectPath);
  return grants.find((g) => g.rootGoalId === rootGoalId) ?? null;
}

/**
 * Creates or replaces the grant for one mission root. UI only: this is the
 * function behind Jennifer's switch. Resolves with the stored row.
 */
export async function saveLaunchGrant(input: {
  projectPath: string;
  rootGoalId: string;
  rootGoalName: string;
  maxConcurrent: number;
  launchBudget: number;
}): Promise<LaunchGrant> {
  if (!input.projectPath.trim() || !input.rootGoalId.trim()) {
    throw new Error('Launch grant needs a project and a root goal');
  }
  const saved = await notificationsSaveLaunchGrant({
    id: crypto.randomUUID(),
    projectPath: input.projectPath,
    rootGoalId: input.rootGoalId,
    rootGoalName: input.rootGoalName,
    maxConcurrent: clamp(input.maxConcurrent, MAX_GRANT_CONCURRENT),
    launchBudget: clamp(input.launchBudget, MAX_GRANT_BUDGET),
  });
  announce();
  return saved;
}

/** Revokes a grant; resolves once the database acknowledged it. */
export async function revokeLaunchGrant(grantId: string): Promise<void> {
  await notificationsRevokeLaunchGrant(grantId);
  announce();
}
