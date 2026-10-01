import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { isVerifiedEvidence } from '../../lib/pm/enums';
import { GOAL_WORK_MODE_SETTINGS, resolveGoalWorkMode } from '../../lib/goals/workMode';
import { normalizeMissionPath } from '../../lib/missions/missionPath';
import { decideGoalCompletion, type GoalCompletion } from '../../lib/goals/goalCompletion';
import {
  bundleHold,
  bundleMembers,
  goalBlockers,
  introducedDependencyErrors,
  normalizeBundle,
  siblingWaves,
  type DependencyGoal,
  type GoalBlocker,
  type GoalDependencyEdge,
} from '../../lib/goals/goalDependencies';
import { createTicket, type CreateTicketParams, type Ticket } from './tickets';
import { insertGoalStatusHistory } from './history';

export interface GoalRow {
  id: string;
  parent_id: string | null;
  name: string;
  description: string;
  success_criteria: string;
  status: string;
  priority: string;
  goal_prompt: string;
  /** `auto` | `stations` | `tickets`, resolved by `resolveGoalWorkMode`. */
  work_mode: string;
  /** A root goal's mission folder, relative to the project (`normalizeMissionPath`). */
  mission_path: string | null;
  /** Sibling grouping label (`normalizeBundle`): members close together. */
  bundle: string | null;
  created_by: string;
  achieved_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GoalRunRow {
  id: string;
  goal_id: string;
  agent_id: string;
  ticket_id: string | null;
  prompt: string;
  model: string;
  provider: string;
  source: string;
  outcome: string;
  summary: string;
  started_at: string;
  finished_at: string | null;
}

interface TicketSummaryRow {
  id: string;
  name: string;
  status: string;
  priority: string;
}

export interface GoalTreeNode extends GoalRow {
  children: GoalTreeNode[];
  tickets: TicketSummaryRow[];
  dependsOn: string[];
  blockedBy: GoalBlocker[];
}

export interface GoalPlanWorkPackage {
  goal: {
    name: string;
    description?: string;
    successCriteria?: string;
    priority?: string;
    goalPrompt?: string;
  };
  ticket: Omit<CreateTicketParams, 'epicId' | 'goalId'>;
}

export interface MaterializedGoalPackage {
  goal: GoalRow;
  ticket: Ticket;
}

export interface DecomposeGoalChild {
  name: string;
  description?: string;
  successCriteria?: string;
  priority?: string;
  goalPrompt?: string;
  /** A local label, usable by another child's `dependsOn` within the same call. */
  key?: string;
  /** Sibling key from this call, or an existing goal id / unique id prefix / exact sibling name. */
  dependsOn?: string[];
  bundle?: string;
}

export interface GoalDependencyEdgeRow {
  id: string;
  goalId: string;
  dependsOnGoalId: string;
  createdAt: string;
}

const now = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function listGoals(
  db: Database.Database,
  filters?: { status?: string; parentId?: string }
): GoalRow[] {
  let sql = 'SELECT * FROM pm_goals WHERE 1=1';
  const params: string[] = [];
  if (filters?.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.parentId) {
    sql += ' AND parent_id = ?';
    params.push(filters.parentId);
  }
  sql += ' ORDER BY sort_order, created_at';
  return db.prepare(sql).all(...params) as GoalRow[];
}

export function getGoal(db: Database.Database, id: string): GoalRow | null {
  return (db.prepare('SELECT * FROM pm_goals WHERE id = ?').get(id) as GoalRow | undefined) ?? null;
}

/** Direct children of `parentId` (root goals for `null`), excluding `excludeId`. */
function siblingsOf(db: Database.Database, parentId: string | null, excludeId?: string): GoalRow[] {
  const rows = (
    parentId === null
      ? db.prepare('SELECT * FROM pm_goals WHERE parent_id IS NULL').all()
      : db.prepare('SELECT * FROM pm_goals WHERE parent_id = ?').all(parentId)
  ) as GoalRow[];
  return excludeId ? rows.filter((g) => g.id !== excludeId) : rows;
}

function checkedWorkMode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!(GOAL_WORK_MODE_SETTINGS as readonly string[]).includes(value)) {
    throw new Error(
      `Unknown work mode '${value}'; use one of ${GOAL_WORK_MODE_SETTINGS.join(', ')}`
    );
  }
  return value;
}

/** A mission belongs to the whole tree, so only its root may point at it. */
function checkMissionOnRoot(parentId: string | null, missionPath: string | null): void {
  if (parentId !== null && missionPath !== null) {
    throw new Error(
      'Only a root goal can point at a mission folder; clear missionPath (null) or keep the goal at the root'
    );
  }
}

/**
 * Resolves one `dependsOn` reference in the order the contract specifies: an
 * exact goal id, then a decompose-local key (when a `keyMap` is given), then
 * an exact name among `siblings`, then a unique id prefix. Name comes before
 * prefix on purpose — a sibling named like the start of some unrelated goal's
 * id (e.g. "cafe", "2026") must resolve to that sibling, not to whichever
 * goal happens to share the prefix. Throws a message naming the ref on an
 * unknown or ambiguous match.
 */
function resolveDependencyRef(
  db: Database.Database,
  ref: string,
  siblings: readonly GoalRow[],
  keyMap?: ReadonlyMap<string, string>
): string {
  const exact = db.prepare('SELECT id FROM pm_goals WHERE id = ?').get(ref) as
    { id: string } | undefined;
  if (exact) return exact.id;

  if (keyMap?.has(ref)) return keyMap.get(ref) as string;

  const byName = siblings.filter((s) => s.name === ref);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) {
    throw new Error(
      `Ambiguous dependsOn reference '${ref}': ${byName.length} siblings named '${ref}'`
    );
  }

  if (ref.length >= 4) {
    const rows = db.prepare("SELECT id FROM pm_goals WHERE id LIKE ? || '%'").all(ref) as {
      id: string;
    }[];
    if (rows.length === 1) return rows[0].id;
    if (rows.length > 1) {
      throw new Error(
        `Ambiguous dependsOn reference '${ref}': matches ${rows.length} goals by id prefix`
      );
    }
  }

  throw new Error(
    `Unknown dependsOn reference '${ref}': no such goal id, id prefix, or sibling name`
  );
}

function toEdge(row: { goal_id: string; depends_on_goal_id: string }): GoalDependencyEdge {
  return { goalId: row.goal_id, dependsOnGoalId: row.depends_on_goal_id };
}

function toEdgeRow(row: {
  id: string;
  goal_id: string;
  depends_on_goal_id: string;
  created_at: string;
}): GoalDependencyEdgeRow {
  return {
    id: row.id,
    goalId: row.goal_id,
    dependsOnGoalId: row.depends_on_goal_id,
    createdAt: row.created_at,
  };
}

function allDependencyGoals(db: Database.Database): DependencyGoal[] {
  const rows = db.prepare('SELECT id, parent_id, status, bundle FROM pm_goals').all() as Array<{
    id: string;
    parent_id: string | null;
    status: string;
    bundle: string | null;
  }>;
  return rows.map(
    (r) =>
      ({ id: r.id, parentId: r.parent_id, status: r.status, bundle: r.bundle }) as DependencyGoal
  );
}

function allEdgeRowsRaw(
  db: Database.Database
): Array<{ id: string; goal_id: string; depends_on_goal_id: string; created_at: string }> {
  return db.prepare('SELECT * FROM pm_goal_dependencies ORDER BY created_at, id').all() as Array<{
    id: string;
    goal_id: string;
    depends_on_goal_id: string;
    created_at: string;
  }>;
}

/**
 * The full dependency graph, in the shape `goalDependencies.ts` consumes.
 * Shared with `tasks.ts` so `fetchNextUnblockedTask` can filter on it without
 * duplicating how the graph is loaded from SQLite.
 */
export function loadDependencyGraph(db: Database.Database): {
  goals: DependencyGoal[];
  edges: GoalDependencyEdge[];
} {
  return { goals: allDependencyGoals(db), edges: allEdgeRowsRaw(db).map(toEdge) };
}

/**
 * Validates `newEdges` against the full existing edge set before inserting
 * them, inside the caller's transaction. Rejects only on an error the new
 * edges introduce (`introducedDependencyErrors`) — a pre-existing bad row
 * elsewhere in the table must never block an unrelated, valid edge. Throws
 * with the first introduced rejection's message (it names the goal ids, and
 * for a cycle, the loop) and inserts nothing on failure. `created_at` has no
 * SQL default (migration 23), so it is stamped here, like the UI does.
 */
function insertEdgesValidated(
  db: Database.Database,
  newEdges: readonly GoalDependencyEdge[]
): void {
  if (newEdges.length === 0) return;
  const existing = allEdgeRowsRaw(db).map(toEdge);
  const goals = allDependencyGoals(db);
  const errors = introducedDependencyErrors(
    { goals, edges: existing },
    { goals, edges: [...existing, ...newEdges] }
  );
  if (errors.length > 0) throw new Error(errors[0].message);

  const insert = db.prepare(
    `INSERT INTO pm_goal_dependencies (id, goal_id, depends_on_goal_id, created_at)
     VALUES (?, ?, ?, ?)`
  );
  const createdAt = new Date().toISOString();
  for (const edge of newEdges) {
    insert.run(crypto.randomUUID(), edge.goalId, edge.dependsOnGoalId, createdAt);
  }
}

function dedupeEdges(edges: readonly GoalDependencyEdge[]): GoalDependencyEdge[] {
  const seen = new Set<string>();
  const result: GoalDependencyEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.goalId}\u0000${edge.dependsOnGoalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

export interface CreateGoalParams {
  name: string;
  parentId?: string;
  description?: string;
  successCriteria?: string;
  status?: string;
  priority?: string;
  goalPrompt?: string;
  sortOrder?: number;
  workMode?: string;
  missionPath?: string | null;
  bundle?: string | null;
  /** Sibling goal ids, id prefixes, or exact sibling names to wait for. */
  dependsOn?: string[];
}

interface PreparedGoalCreation {
  workMode: string;
  missionPath: string | null;
  bundle: string | null;
  /** Existing siblings, for resolving `dependsOn` by exact name. */
  siblings: GoalRow[];
}

/** Validates placement (parent exists, mission-on-root) and normalizes the fields that need it. */
function prepareGoalCreation(
  db: Database.Database,
  params: Pick<CreateGoalParams, 'parentId' | 'workMode' | 'missionPath' | 'bundle'>
): PreparedGoalCreation {
  if (params.parentId && !getGoal(db, params.parentId)) {
    throw new Error(`Parent goal '${params.parentId}' not found`);
  }
  const missionPath = normalizeMissionPath(params.missionPath);
  checkMissionOnRoot(params.parentId ?? null, missionPath);
  return {
    workMode: checkedWorkMode(params.workMode) ?? 'auto',
    missionPath,
    bundle: normalizeBundle(params.bundle),
    siblings: siblingsOf(db, params.parentId ?? null),
  };
}

/** Resolves and inserts a new goal's `dependsOn` refs; a no-op when there are none. */
function insertGoalDependsOn(
  db: Database.Database,
  goalId: string,
  dependsOn: string[] | undefined,
  siblings: readonly GoalRow[]
): void {
  if (!dependsOn || dependsOn.length === 0) return;
  const edges = dependsOn.map((ref) => ({
    goalId,
    dependsOnGoalId: resolveDependencyRef(db, ref, siblings),
  }));
  insertEdgesValidated(db, edges);
}

export function createGoal(
  db: Database.Database,
  params: CreateGoalParams,
  createdBy: string
): GoalRow {
  const run = db.transaction(() => {
    const { workMode, missionPath, bundle, siblings } = prepareGoalCreation(db, params);

    const id = crypto.randomUUID();
    const ts = now();
    db.prepare(
      `INSERT INTO pm_goals (id, parent_id, name, description, success_criteria, status, priority, goal_prompt, created_by, achieved_at, sort_order, created_at, updated_at, work_mode, mission_path, bundle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.parentId ?? null,
      params.name,
      params.description ?? '',
      params.successCriteria ?? '',
      params.status ?? 'draft',
      params.priority ?? 'normal',
      params.goalPrompt ?? '',
      createdBy,
      params.sortOrder ?? 0,
      ts,
      ts,
      workMode,
      missionPath,
      bundle
    );
    insertGoalStatusHistory(db, id, null, params.status ?? 'draft', 'mcp');
    insertGoalDependsOn(db, id, params.dependsOn, siblings);

    return getGoal(db, id) as GoalRow;
  });
  return run();
}

export type GoalUpdateFields = Partial<{
  name: string;
  parentId: string | null;
  description: string;
  successCriteria: string;
  status: string;
  priority: string;
  goalPrompt: string;
  sortOrder: number;
  workMode: string;
  missionPath: string | null;
  bundle: string | null;
}>;

/**
 * Validates a mission-path/parentId change (mission-on-root) and returns
 * `updates` with `missionPath` normalized, when either was provided.
 */
function withValidatedMissionPath(
  db: Database.Database,
  id: string,
  updates: GoalUpdateFields
): GoalUpdateFields {
  if (updates.missionPath === undefined && updates.parentId === undefined) return updates;
  const existing = getGoal(db, id);
  if (!existing) throw new Error(`Goal '${id}' not found`);
  const missionPath =
    updates.missionPath !== undefined
      ? normalizeMissionPath(updates.missionPath)
      : existing.mission_path;
  checkMissionOnRoot(
    updates.parentId !== undefined ? updates.parentId : existing.parent_id,
    missionPath
  );
  return updates.missionPath !== undefined ? { ...updates, missionPath } : updates;
}

const GOAL_UPDATE_FIELD_MAP: Record<string, string> = {
  name: 'name',
  parentId: 'parent_id',
  description: 'description',
  successCriteria: 'success_criteria',
  status: 'status',
  priority: 'priority',
  goalPrompt: 'goal_prompt',
  sortOrder: 'sort_order',
  workMode: 'work_mode',
  missionPath: 'mission_path',
  bundle: 'bundle',
};

/** The `SET` clauses and bound values for `updates`, or `null` when there is nothing to set. */
function buildGoalUpdateSql(
  updates: GoalUpdateFields,
  id: string
): { setClauses: string[]; values: unknown[] } | null {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    const col = GOAL_UPDATE_FIELD_MAP[key];
    if (col && value !== undefined) {
      setClauses.push(`${col} = ?`);
      values.push(value);
    }
  }

  // Transitioning into 'achieved' stamps achieved_at; leaving it clears it.
  if (updates.status === 'achieved') {
    setClauses.push("achieved_at = datetime('now')");
  } else if (updates.status !== undefined) {
    setClauses.push('achieved_at = NULL');
  }

  if (setClauses.length === 0) return null;
  setClauses.push("updated_at = datetime('now')");
  values.push(id);
  return { setClauses, values };
}

/**
 * bundle/parentId can turn an existing, previously-fine edge into a
 * same-bundle, ancestor or descendant violation (or a cycle) — so the caller
 * snapshots the graph first (`loadDependencyGraph`) and passes it here after
 * the write. Same rule as `insertEdgesValidated`: reject only what THIS
 * update introduces.
 */
function assertNoIntroducedDependencyErrors(
  db: Database.Database,
  before: { goals: DependencyGoal[]; edges: GoalDependencyEdge[] }
): void {
  const errors = introducedDependencyErrors(before, loadDependencyGraph(db));
  if (errors.length > 0) throw new Error(errors[0].message);
}

/**
 * A bundle only becomes achieved together (see evaluateGoal's bundle hold):
 * rejects marking `id` achieved while another member hasn't met its own
 * conditions yet, naming which ones are still missing.
 */
function assertBundleReadyToAchieve(db: Database.Database, id: string): void {
  const current = getGoal(db, id) as GoalRow;
  const { goals: dependencyGoals } = loadDependencyGraph(db);
  const waitingMembers = bundleHold(
    dependencyGoals,
    id,
    (memberId) => subtreeSnapshot(db, memberId).blockers.length === 0
  );
  if (waitingMembers.length === 0) return;
  const label = normalizeBundle(current.bundle) ?? '';
  const names = waitingMembers.map((memberId) => getGoal(db, memberId)?.name ?? memberId);
  throw new Error(
    `Cannot mark goal achieved: bundle "${label}" is still waiting for ${names.join(', ')}`
  );
}

export function updateGoal(db: Database.Database, id: string, updates: GoalUpdateFields): GoalRow {
  checkedWorkMode(updates.workMode);
  updates = withValidatedMissionPath(db, id, updates);
  if (updates.bundle !== undefined) {
    updates = { ...updates, bundle: normalizeBundle(updates.bundle) };
  }

  const sql = buildGoalUpdateSql(updates, id);
  if (!sql) {
    const existing = getGoal(db, id);
    if (!existing) throw new Error(`Goal '${id}' not found`);
    return existing;
  }

  db.transaction(() => {
    const before = getGoal(db, id);
    const beforeGraph =
      updates.bundle !== undefined || updates.parentId !== undefined
        ? loadDependencyGraph(db)
        : null;

    db.prepare(`UPDATE pm_goals SET ${sql.setClauses.join(', ')} WHERE id = ?`).run(...sql.values);
    // Re-setting the current status is not an event.
    if (before && updates.status !== undefined && updates.status !== before.status) {
      insertGoalStatusHistory(db, id, before.status, updates.status, 'mcp');
    }

    if (beforeGraph) assertNoIntroducedDependencyErrors(db, beforeGraph);
    if (updates.status === 'achieved') assertBundleReadyToAchieve(db, id);
  })();

  const result = getGoal(db, id);
  if (!result) throw new Error(`Goal '${id}' not found after update`);
  return result;
}

export function deleteGoal(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM pm_goals WHERE id = ?').run(id).changes > 0;
}

export function decomposeGoal(
  db: Database.Database,
  parentId: string,
  children: DecomposeGoalChild[],
  createdBy: string,
  mode: 'parallel' | 'serial' = 'parallel'
): GoalRow[] {
  if (!getGoal(db, parentId)) throw new Error(`Goal '${parentId}' not found`);
  const run = db.transaction(() => {
    const existingSiblings = siblingsOf(db, parentId);
    // One past the highest existing sortOrder, not the sibling count — the
    // two diverge as soon as a sibling was reordered or created with a gap.
    const baseSortOrder =
      existingSiblings.length === 0
        ? 0
        : Math.max(...existingSiblings.map((s) => s.sort_order)) + 1;
    const keyMap = new Map<string, string>();

    const created: GoalRow[] = children.map((child, index) => {
      const goal = createGoal(
        db,
        {
          name: child.name,
          description: child.description,
          successCriteria: child.successCriteria,
          priority: child.priority,
          goalPrompt: child.goalPrompt,
          parentId,
          status: 'active',
          sortOrder: baseSortOrder + index,
          bundle: child.bundle,
        },
        createdBy
      );
      if (child.key) {
        if (keyMap.has(child.key)) throw new Error(`Duplicate decompose_goal key '${child.key}'`);
        keyMap.set(child.key, goal.id);
      }
      return goal;
    });

    const siblingsForNames = [...existingSiblings, ...created];
    const newEdges: GoalDependencyEdge[] = [];
    children.forEach((child, index) => {
      for (const ref of child.dependsOn ?? []) {
        newEdges.push({
          goalId: created[index].id,
          dependsOnGoalId: resolveDependencyRef(db, ref, siblingsForNames, keyMap),
        });
      }
      if (mode === 'serial' && index > 0) {
        newEdges.push({ goalId: created[index].id, dependsOnGoalId: created[index - 1].id });
      }
    });
    insertEdgesValidated(db, dedupeEdges(newEdges));

    return created.map((g) => getGoal(db, g.id) as GoalRow);
  });
  return run();
}

export function materializeGoalPlan(
  db: Database.Database,
  parentId: string,
  epicId: string,
  workPackages: GoalPlanWorkPackage[],
  createdBy: string
): MaterializedGoalPackage[] {
  if (workPackages.length === 0) throw new Error('At least one work package is required');
  const requestedNames = new Set<string>();
  for (const { goal } of workPackages) {
    if (requestedNames.has(goal.name)) {
      throw new Error(`Duplicate child goal name '${goal.name}' in work packages`);
    }
    requestedNames.add(goal.name);
  }

  const materialize = db.transaction(() => {
    if (!getGoal(db, parentId)) throw new Error(`Parent goal '${parentId}' not found`);
    const epic = db.prepare('SELECT id FROM pm_epics WHERE id = ?').get(epicId);
    if (!epic) throw new Error(`Epic '${epicId}' not found`);

    return workPackages.map(({ goal: goalFields, ticket: ticketFields }) => {
      const matchingGoals = db
        .prepare(
          `SELECT * FROM pm_goals
           WHERE parent_id = ? AND name = ?
           ORDER BY created_at, id`
        )
        .all(parentId, goalFields.name) as GoalRow[];
      if (matchingGoals.length > 1) {
        throw new Error(
          `Ambiguous child goal name '${goalFields.name}': ${matchingGoals.length} direct children match`
        );
      }

      const goal =
        matchingGoals[0] ??
        createGoal(db, { ...goalFields, parentId, status: 'active' }, createdBy);
      const matchingTickets = db
        .prepare(
          `SELECT * FROM pm_tickets
           WHERE goal_id = ? AND name = ?
           ORDER BY created_at, id`
        )
        .all(goal.id, ticketFields.name) as Ticket[];
      if (matchingTickets.length > 1) {
        throw new Error(
          `Ambiguous ticket name '${ticketFields.name}': ${matchingTickets.length} tickets match child '${goalFields.name}'`
        );
      }
      const existingTicket = matchingTickets[0];
      const ticket =
        existingTicket ??
        createTicket(db, {
          ...ticketFields,
          epicId,
          goalId: goal.id,
        });
      return { goal, ticket };
    });
  });

  return materialize();
}

function ticketsForGoal(db: Database.Database, goalId: string): TicketSummaryRow[] {
  return db
    .prepare(
      'SELECT id, name, status, priority FROM pm_tickets WHERE goal_id = ? ORDER BY sort_order'
    )
    .all(goalId) as TicketSummaryRow[];
}

export function goalDependsOnIds(db: Database.Database, goalId: string): string[] {
  const rows = db
    .prepare(
      'SELECT depends_on_goal_id FROM pm_goal_dependencies WHERE goal_id = ? ORDER BY created_at, id'
    )
    .all(goalId) as Array<{ depends_on_goal_id: string }>;
  return rows.map((r) => r.depends_on_goal_id);
}

export function goalBlockedByInfo(db: Database.Database, goalId: string): GoalBlocker[] {
  const { goals, edges } = loadDependencyGraph(db);
  return goalBlockers(goals, edges, goalId);
}

export function getGoalTree(db: Database.Database, rootId?: string): GoalTreeNode[] {
  const all = listGoals(db);
  const byParent = new Map<string | null, GoalRow[]>();
  for (const goal of all) {
    const key = goal.parent_id;
    const bucket = byParent.get(key) ?? [];
    bucket.push(goal);
    byParent.set(key, bucket);
  }

  const build = (goal: GoalRow, seen: Set<string>): GoalTreeNode => {
    seen.add(goal.id);
    const childRows = (byParent.get(goal.id) ?? []).filter((c) => !seen.has(c.id));
    return {
      ...goal,
      tickets: ticketsForGoal(db, goal.id),
      dependsOn: goalDependsOnIds(db, goal.id),
      blockedBy: goalBlockedByInfo(db, goal.id),
      children: childRows.map((c) => build(c, seen)),
    };
  };

  const seen = new Set<string>();
  const roots = rootId ? all.filter((g) => g.id === rootId) : (byParent.get(null) ?? []);
  return roots.map((r) => build(r, seen));
}

export function linkTicketToGoal(
  db: Database.Database,
  ticketId: string,
  goalId: string | null
): { linked: boolean } {
  const changes = db
    .prepare("UPDATE pm_tickets SET goal_id = ?, updated_at = datetime('now') WHERE id = ?")
    .run(goalId, ticketId).changes;
  if (changes === 0) throw new Error(`Ticket '${ticketId}' not found`);
  return { linked: true };
}

export function linkRequirementToGoal(
  db: Database.Database,
  goalId: string,
  requirementId: string
): { linked: true } {
  db.prepare(
    'INSERT OR IGNORE INTO pm_goal_requirement_links (id, goal_id, requirement_id) VALUES (?, ?, ?)'
  ).run(crypto.randomUUID(), goalId, requirementId);
  return { linked: true };
}

export function recordGoalRun(
  db: Database.Database,
  params: {
    goalId: string;
    agentId: string;
    prompt: string;
    ticketId?: string;
    model?: string;
    provider?: string;
    source?: string;
  }
): GoalRunRow {
  const goal = getGoal(db, params.goalId);
  if (!goal) throw new Error(`Goal '${params.goalId}' not found`);
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO pm_goal_runs (id, goal_id, agent_id, ticket_id, prompt, model, provider, source, outcome, summary, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', '', datetime('now'))`
  ).run(
    id,
    params.goalId,
    params.agentId,
    params.ticketId ?? null,
    params.prompt,
    params.model ?? '',
    params.provider ?? '',
    params.source ?? 'mcp'
  );
  // Launching work moves an idle goal into in_progress
  const moved = db
    .prepare(
      `UPDATE pm_goals SET status = 'in_progress', updated_at = datetime('now')
       WHERE id = ? AND status IN ('draft', 'active')`
    )
    .run(params.goalId);
  if (moved.changes > 0) {
    insertGoalStatusHistory(db, params.goalId, goal.status, 'in_progress', 'mcp');
  }
  return db.prepare('SELECT * FROM pm_goal_runs WHERE id = ?').get(id) as GoalRunRow;
}

export function completeGoalRun(
  db: Database.Database,
  runId: string,
  outcome: string,
  summary?: string
): GoalRunRow {
  const changes = db
    .prepare(
      `UPDATE pm_goal_runs SET outcome = ?, summary = COALESCE(?, summary), finished_at = datetime('now') WHERE id = ?`
    )
    .run(outcome, summary ?? null, runId).changes;
  if (changes === 0) throw new Error(`Goal run '${runId}' not found`);
  return db.prepare('SELECT * FROM pm_goal_runs WHERE id = ?').get(runId) as GoalRunRow;
}

export function listGoalRuns(db: Database.Database, goalId: string): GoalRunRow[] {
  return db
    .prepare('SELECT * FROM pm_goal_runs WHERE goal_id = ? ORDER BY started_at DESC, id')
    .all(goalId) as GoalRunRow[];
}

export function addGoalDependency(
  db: Database.Database,
  goalId: string,
  dependsOnGoalId: string
): GoalDependencyEdgeRow {
  const run = db.transaction(() => {
    const existingRow = allEdgeRowsRaw(db).find(
      (r) => r.goal_id === goalId && r.depends_on_goal_id === dependsOnGoalId
    );
    if (existingRow) return toEdgeRow(existingRow);

    // Shares its validation (introduced-errors only) and created_at stamping
    // with create_goal/decompose_goal's edges — one rule for how an edge
    // enters the table, whichever tool called it.
    insertEdgesValidated(db, [{ goalId, dependsOnGoalId }]);
    return toEdgeRow(
      db
        .prepare('SELECT * FROM pm_goal_dependencies WHERE goal_id = ? AND depends_on_goal_id = ?')
        .get(goalId, dependsOnGoalId) as {
        id: string;
        goal_id: string;
        depends_on_goal_id: string;
        created_at: string;
      }
    );
  });
  return run();
}

export function removeGoalDependency(
  db: Database.Database,
  goalId: string,
  dependsOnGoalId: string
): { removed: boolean } {
  const changes = db
    .prepare('DELETE FROM pm_goal_dependencies WHERE goal_id = ? AND depends_on_goal_id = ?')
    .run(goalId, dependsOnGoalId).changes;
  return { removed: changes > 0 };
}

export interface ListGoalDependenciesResult {
  edges: GoalDependencyEdgeRow[];
  bundles: { label: string; memberIds: string[] }[];
  blocked: { goalId: string; blockers: GoalBlocker[] }[];
  /** Topological waves under `parentId` (`siblingWaves`); only present with `parentId`. */
  waves?: string[][];
}

/** Bundles among `rows`, grouped by (parentId, normalized label). */
function bundlesAmong(rows: readonly GoalRow[]): { label: string; memberIds: string[] }[] {
  const byKey = new Map<string, { label: string; memberIds: string[] }>();
  for (const goal of rows) {
    const label = normalizeBundle(goal.bundle);
    if (label === null) continue;
    const key = `${goal.parent_id ?? ''}\u0000${label}`;
    const bucket = byKey.get(key) ?? { label, memberIds: [] };
    bucket.memberIds.push(goal.id);
    byKey.set(key, bucket);
  }
  return [...byKey.values()];
}

/**
 * Inspects the dependency graph, scoped by `goalId` or `parentId` (mutually
 * exclusive; neither means "everything"). Waves are only meaningful — and
 * only computed — for one parent's children (`siblingWaves`); there is no way
 * to get the top-level (root) waves through this scope, since a null parentId
 * cannot be distinguished from "no scope" here (see the contract).
 */
export function listGoalDependencies(
  db: Database.Database,
  scope: { goalId?: string; parentId?: string }
): ListGoalDependenciesResult {
  const { goals, edges } = loadDependencyGraph(db);
  const allEdgeRows = allEdgeRowsRaw(db);
  const allGoalRows = listGoals(db);

  if (scope.parentId) {
    if (!getGoal(db, scope.parentId)) throw new Error(`Goal '${scope.parentId}' not found`);
    const children = siblingsOf(db, scope.parentId);
    const childIds = new Set(children.map((c) => c.id));
    const scopedEdgeRows = allEdgeRows.filter((e) => childIds.has(e.goal_id));
    const blocked = children
      .map((c) => ({ goalId: c.id, blockers: goalBlockers(goals, edges, c.id) }))
      .filter((b) => b.blockers.length > 0);
    return {
      edges: scopedEdgeRows.map(toEdgeRow),
      bundles: bundlesAmong(children),
      blocked,
      waves: siblingWaves(goals, edges, scope.parentId),
    };
  }

  if (scope.goalId) {
    if (!getGoal(db, scope.goalId)) throw new Error(`Goal '${scope.goalId}' not found`);
    const touching = allEdgeRows.filter(
      (e) => e.goal_id === scope.goalId || e.depends_on_goal_id === scope.goalId
    );
    const memberIds = new Set(bundleMembers(goals, scope.goalId));
    const blockers = goalBlockers(goals, edges, scope.goalId);
    return {
      edges: touching.map(toEdgeRow),
      bundles: bundlesAmong(allGoalRows.filter((g) => memberIds.has(g.id))),
      blocked: blockers.length > 0 ? [{ goalId: scope.goalId, blockers }] : [],
    };
  }

  const blocked = allGoalRows
    .map((g) => ({ goalId: g.id, blockers: goalBlockers(goals, edges, g.id) }))
    .filter((b) => b.blockers.length > 0);
  return {
    edges: allEdgeRows.map(toEdgeRow),
    bundles: bundlesAmong(allGoalRows),
    blocked,
  };
}

export function descendantIds(db: Database.Database, goalId: string): string[] {
  // Recursive CTE walks the subtree in one query; cycle-safe via UNION dedup.
  const rows = db
    .prepare(
      `WITH RECURSIVE subtree(id) AS (
         SELECT id FROM pm_goals WHERE id = ?
         UNION
         SELECT g.id FROM pm_goals g JOIN subtree s ON g.parent_id = s.id
       )
       SELECT id FROM subtree`
    )
    .all(goalId) as { id: string }[];
  return rows.map((r) => r.id);
}

interface SubtreeSnapshot {
  blockers: string[];
  tickets: { status: string }[];
  stations: { status: string }[];
}

/**
 * The blockers a single goal's own subtree has — tickets, linked
 * requirements, stations and child goals — with no bundle logic. Used both as
 * `evaluateGoal`'s own result and, per bundle member, as `bundleHold`'s
 * "is this member satisfied on its own" check.
 */
function subtreeSnapshot(db: Database.Database, goalId: string): SubtreeSnapshot {
  const blockers: string[] = [];
  const subtree = descendantIds(db, goalId);
  const placeholders = subtree.map(() => '?').join(',');

  const tickets = db
    .prepare(`SELECT id, name, status FROM pm_tickets WHERE goal_id IN (${placeholders})`)
    .all(...subtree) as { id: string; name: string; status: string }[];
  for (const t of tickets) {
    if (t.status === 'discarded') continue;
    if (t.status !== 'done') blockers.push(`Ticket ${t.id} "${t.name}" is ${t.status}`);
  }

  const reqs = db
    .prepare(
      `SELECT r.req_id, r.status FROM pm_goal_requirement_links l
       JOIN pm_requirements r ON r.id = l.requirement_id WHERE l.goal_id = ?`
    )
    .all(goalId) as { req_id: string; status: string }[];
  for (const r of reqs) {
    if (r.status !== 'verified') {
      blockers.push(`Requirement ${r.req_id} is ${r.status}, not verified`);
    }
  }

  // SQL twin of getGoalSatisfaction (src/lib/store/goals/goalSatisfaction.ts) — the two
  // must stay in lockstep, or the UI and agents calling evaluate_goal will
  // disagree about whether a goal is done. Stations are part of the check:
  // an open human station must block auto-achievement here exactly as in TS.
  const stations = db
    .prepare(
      `SELECT name, status, evidence_kind FROM pm_goal_stations WHERE goal_id IN (${placeholders})`
    )
    .all(...subtree) as { name: string; status: string; evidence_kind: string }[];
  for (const s of stations) {
    if (s.status !== 'done') {
      blockers.push(`Station "${s.name}" is ${s.status}`);
    } else if (!isVerifiedEvidence(s.evidence_kind)) {
      // Lockstep twin of getGoalSatisfaction: a claimed-but-unverified station
      // blocks exactly like a pending one until the judge promotes it.
      blockers.push(`Station "${s.name}": unverified claim`);
    }
  }

  const children = db
    .prepare('SELECT name, status FROM pm_goals WHERE parent_id = ?')
    .all(goalId) as { name: string; status: string }[];
  for (const c of children) {
    if (c.status !== 'achieved') {
      blockers.push(`Sub-goal "${c.name}" is ${c.status}, not achieved`);
    }
  }

  // A goal with nothing attached is vacuously "true" but not meaningfully
  // achieved — refuse to report it as satisfied.
  if (tickets.length === 0 && reqs.length === 0 && children.length === 0 && stations.length === 0) {
    blockers.push(
      'This goal has no attached tickets, linked requirements, child goals, or goal-line stations. Add work before running the conductor.'
    );
  }

  return { blockers, tickets, stations };
}

/**
 * The mode a goal is worked in, resolved from its setting and what its subtree
 * has attached. Same inputs as `evaluateGoal`'s `workMode`, so a launch prompt
 * and an evaluation never disagree.
 */
export function goalWorkMode(db: Database.Database, goalId: string) {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`Goal '${goalId}' not found`);
  const { tickets, stations } = subtreeSnapshot(db, goalId);
  return resolveGoalWorkMode(goal.work_mode, {
    hasTickets: tickets.some((t) => t.status !== 'discarded'),
    hasStations: stations.length > 0,
  });
}

export function evaluateGoal(
  db: Database.Database,
  goalId: string
): {
  satisfied: boolean;
  blockers: string[];
  progress: { totalTickets: number; doneTickets: number };
  workMode: { mode: string; setting: string; reason: string };
  /** The completion transition (`decideGoalCompletion`), same as the UI's. */
  completion: GoalCompletion;
} {
  const goal = getGoal(db, goalId);
  if (!goal) throw new Error(`Goal '${goalId}' not found`);

  const snapshot = subtreeSnapshot(db, goalId);
  const blockers = [...snapshot.blockers];

  // Bundle hold twin of getGoalSatisfaction/bundleHold: a member only counts
  // as achieved once every other member of its bundle is satisfied on its
  // own (no bundle recursion). `bundleHold` is a no-op for a goal with no
  // bundle, so this is safe to call unconditionally.
  const { goals: dependencyGoals } = loadDependencyGraph(db);
  const waitingMembers = bundleHold(
    dependencyGoals,
    goalId,
    (id) => subtreeSnapshot(db, id).blockers.length === 0
  );
  if (waitingMembers.length > 0) {
    const label = normalizeBundle(goal.bundle) ?? '';
    for (const memberId of waitingMembers) {
      const member = getGoal(db, memberId);
      blockers.push(`Bundle "${label}": waiting for ${member?.name ?? memberId}`);
    }
  }

  const liveTickets = snapshot.tickets.filter((t) => t.status !== 'discarded');
  const workMode = resolveGoalWorkMode(goal.work_mode, {
    hasTickets: liveTickets.length > 0,
    hasStations: snapshot.stations.length > 0,
  });
  const satisfaction = { satisfied: blockers.length === 0, blockers };

  return {
    ...satisfaction,
    progress: {
      totalTickets: liveTickets.length,
      doneTickets: snapshot.tickets.filter((t) => t.status === 'done').length,
    },
    workMode,
    completion: decideGoalCompletion({
      satisfaction,
      workMode,
      hasStations: snapshot.stations.length > 0,
    }),
  };
}
