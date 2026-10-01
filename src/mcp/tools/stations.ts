import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import { assertOneOf, STATION_KINDS } from '../../lib/pm/enums';
import { moveStation, orderedStations } from '../../lib/goals/stationOrder';
import { parsePredicate, parseStoredPredicateJson } from '../../lib/goals/planner/plannerSchema';
import type { PmGoalStation } from '../../lib/tauri/goals';
import { dispatchNotification } from '../notificationsDb';
import { evaluatePredicate } from '../../lib/evidence/predicates';
import { buildServerEvidenceContext, isServerCheckable } from '../stationEvidence';
import { resolveGoalId, resolveTicketId } from './resolve';

export interface StationRow {
  id: string;
  goal_id: string;
  name: string;
  kind: string;
  status: string;
  evidence_kind: string;
  predicate: string;
  evidence_note: string;
  source_context: string;
  ticket_id: string | null;
  lane: number;
  sort_order: number;
  last_checked_at: string | null;
  done_at: string | null;
  created_at: string;
  updated_at: string;
}

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function resolveStationId(db: Database.Database, prefix: string): string {
  const exact = db.prepare('SELECT id FROM pm_goal_stations WHERE id = ?').get(prefix) as
    { id: string } | undefined;
  if (exact) return exact.id;
  const matches = db
    .prepare('SELECT id FROM pm_goal_stations WHERE id LIKE ?')
    .all(`${prefix}%`) as { id: string }[];
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) throw new Error(`Station '${prefix}' not found`);
  throw new Error(`Station prefix '${prefix}' is ambiguous (${matches.length} matches)`);
}

export function listStations(db: Database.Database, goalId: string): StationRow[] {
  return db
    .prepare('SELECT * FROM pm_goal_stations WHERE goal_id = ? ORDER BY sort_order, created_at')
    .all(goalId) as StationRow[];
}

function getStation(db: Database.Database, id: string): StationRow | undefined {
  return db.prepare('SELECT * FROM pm_goal_stations WHERE id = ?').get(id) as
    StationRow | undefined;
}

function parsePredicateParam(raw: string | undefined, field = 'predicate'): string {
  if (!raw) return '{"type":"undefined"}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${field} must be valid JSON, received: ${raw.slice(0, 80)}`);
  }
  // Same field-by-field validation as the planner (type + required fields +
  // no tautological file_exists globs). Incomplete predicates used to slip
  // through and launder a claim into machine "proof".
  const predicate = parsePredicate(field, parsed);
  return JSON.stringify(predicate);
}

/** The stored predicate's type, degrading a corrupt row to "undefined" rather
 * than throwing — used by the human-step guard. */
function predicateTypeOf(raw: string): string {
  try {
    const p = JSON.parse(raw) as { type?: unknown };
    return typeof p.type === 'string' ? p.type : 'undefined';
  } catch {
    return 'undefined';
  }
}

function sourceContextOf(raw: string): PmGoalStation['sourceContext'] | undefined {
  if (!raw || raw === 'null') return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as PmGoalStation['sourceContext'])
      : undefined;
  } catch {
    // Source context is supporting provenance. A corrupt legacy value must not
    // make the station itself unreadable through MCP.
    return undefined;
  }
}

/** StationRow (snake_case, predicate as string) → the shared domain shape. */
export function stationRowToDomain(row: StationRow): PmGoalStation {
  const predicate = parseStoredPredicateJson(row.predicate);
  const sourceContext = sourceContextOf(row.source_context);
  return {
    id: row.id,
    goalId: row.goal_id,
    name: row.name,
    kind: row.kind as PmGoalStation['kind'],
    status: row.status as PmGoalStation['status'],
    evidenceKind: row.evidence_kind as PmGoalStation['evidenceKind'],
    predicate,
    evidenceNote: row.evidence_note,
    ...(sourceContext ? { sourceContext } : {}),
    ticketId: row.ticket_id,
    lane: row.lane,
    sortOrder: row.sort_order,
    lastCheckedAt: row.last_checked_at,
    doneAt: row.done_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface StationSpec {
  name: string;
  kind?: string;
  predicate?: string;
  ticketId?: string;
}

interface ValidatedStation {
  name: string;
  kind: string;
  evidenceKind: string;
  predicate: string;
  ticketId: string | null;
}

/** Kind and predicate rules shared by create_station and create_stations. `field`
 * prefixes every error, so a batch names the entry that failed. */
function validateStation(spec: StationSpec, field: string): Omit<ValidatedStation, 'ticketId'> {
  const kind = assertOneOf(`${field}kind`, spec.kind ?? 'normal', STATION_KINDS);
  // Invariant: a human step always carries the human predicate, whatever an
  // agent passed. Otherwise create_station(kind:'human', predicate:file_exists)
  // would mint a "person only" station the evidence engine happily clears.
  const predicate =
    kind === 'human'
      ? '{"type":"human"}'
      : parsePredicateParam(spec.predicate, `${field}predicate`);
  return { name: spec.name, kind, evidenceKind: kind === 'human' ? 'human' : 'claim', predicate };
}

/** Inserts validated stations as one contiguous block (after `afterStationId`,
 * else at the end) and renumbers the line so orders stay dense. */
function insertStations(
  db: Database.Database,
  goalId: string,
  stations: ValidatedStation[],
  afterStationId?: string
): string[] {
  const existing = listStations(db, goalId);
  let insertAt = existing.length;
  if (afterStationId) {
    const after = existing.findIndex((s) => s.id === afterStationId);
    if (after === -1) throw new Error(`Station '${afterStationId}' not found on this goal`);
    insertAt = after + 1;
  }
  const insert = db.prepare(
    `INSERT INTO pm_goal_stations
     (id, goal_id, name, kind, status, evidence_kind, predicate, evidence_note, ticket_id,
      lane, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planned', ?, ?, '', ?, 0, ?, ?, ?)`
  );
  const ts = now();
  const ids = stations.map((s, i) => {
    const id = crypto.randomUUID();
    insert.run(
      id,
      goalId,
      s.name,
      s.kind,
      s.evidenceKind,
      s.predicate,
      s.ticketId,
      insertAt + i,
      ts,
      ts
    );
    return id;
  });
  const renumber = db.prepare('UPDATE pm_goal_stations SET sort_order = ? WHERE id = ?');
  [
    ...existing.slice(0, insertAt).map((r) => r.id),
    ...ids,
    ...existing.slice(insertAt).map((r) => r.id),
  ].forEach((id, i) => renumber.run(i, id));
  return ids;
}

export function createStation(
  db: Database.Database,
  params: StationSpec & { goalId: string; afterStationId?: string }
): StationRow {
  const station = { ...validateStation(params, ''), ticketId: params.ticketId ?? null };
  const [id] = insertStations(db, params.goalId, [station], params.afterStationId);
  return getStation(db, id)!;
}

/**
 * Creates many stations in one call, all or nothing: every entry is validated
 * exactly like create_station before anything is written, and the inserts run
 * in one transaction, so a database failure halfway rolls back the rows before it.
 */
export function createStations(
  db: Database.Database,
  params: { goalId: string; stations: StationSpec[]; afterStationId?: string }
): StationRow[] {
  if (params.stations.length === 0) throw new Error('stations must contain at least one entry');
  const validated = params.stations.map((spec, i) => {
    const field = `stations[${i}].`;
    let ticketId: string | null = null;
    if (spec.ticketId) {
      try {
        ticketId = resolveTicketId(db, spec.ticketId);
      } catch (err) {
        throw new Error(`${field}ticketId: ${(err as Error).message}`);
      }
    }
    return { ...validateStation(spec, field), ticketId };
  });
  const ids = db.transaction(() =>
    insertStations(db, params.goalId, validated, params.afterStationId)
  )();
  return ids.map((id) => getStation(db, id)!);
}

/**
 * Marks a station done ON BEHALF OF AN AGENT. Where the station's predicate can
 * be decided here (a file, a ticket, a requirement), it is decided now: a pass
 * is recorded as proof, a fail is refused and the station stays open. An
 * agent's word alone is never proof, and a machine check is never left to a
 * model. Everything else (judged, git, no predicate) is recorded as a 'claim'
 * for the evidence engine or the judge — "claims drawn as claims" is enforced
 * here at the boundary, not by convention.
 */
export async function markStationDone(
  db: Database.Database,
  stationId: string,
  evidenceNote: string,
  projectRoot: string
): Promise<StationRow> {
  const station = getStation(db, stationId);
  if (!station) throw new Error(`Station '${stationId}' not found`);
  // A human step is cleared by a person in the UI, never by an agent claim.
  // This is the gate the satisfaction model leans on: without it an agent
  // could tick "Call the customer" and the conductor would auto-achieve the
  // goal past a step nobody performed.
  if (station.kind === 'human' || predicateTypeOf(station.predicate) === 'human') {
    throw new Error(`Station '${station.name}' is a human step — only a person can mark it done.`);
  }
  const predicate = stationRowToDomain(station).predicate;
  if (isServerCheckable(predicate)) {
    const result = await evaluatePredicate(predicate, buildServerEvidenceContext(db, projectRoot));
    if (result && !result.pass) {
      throw new Error(
        `Station '${station.name}' is not done yet: ${result.detail}. ` +
          'Fix that, then call mark_station_done again.'
      );
    }
    if (result) {
      const ts = now();
      db.prepare(
        `UPDATE pm_goal_stations
         SET status = 'done', evidence_kind = 'proof', evidence_note = ?,
             last_checked_at = ?, done_at = COALESCE(done_at, ?), updated_at = ?
         WHERE id = ?`
      ).run(`${result.detail} — ${evidenceNote}`, result.checkedAt, ts, ts, stationId);
      return getStation(db, stationId)!;
    }
  }
  const ts = now();
  // last_checked_at = NULL marks this a FRESH claim the judge has not ruled on
  // yet, so a re-claim after a reopen is judged anew instead of being skipped.
  db.prepare(
    `UPDATE pm_goal_stations
     SET status = 'done', evidence_kind = 'claim', evidence_note = ?,
         last_checked_at = NULL, done_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(evidenceNote, ts, ts, stationId);
  return getStation(db, stationId)!;
}

/**
 * Records that an agent decided not to do a station, with the reason. The goal
 * can still be achieved: a skip is a decision, and the board shows it as one
 * ("2 skipped") rather than as done. Gates and human steps cannot be skipped,
 * since the review and a person are the ones who clear those.
 */
export function skipStation(db: Database.Database, stationId: string, reason: string): StationRow {
  const station = getStation(db, stationId);
  if (!station) throw new Error(`Station '${stationId}' not found`);
  if (reason.trim() === '') {
    throw new Error(`Station '${station.name}': a skip needs a reason that says why.`);
  }
  if (station.kind === 'gate') {
    throw new Error(
      `Station '${station.name}' is a gate — the review decides it. Run it and call mark_station_done.`
    );
  }
  if (station.kind === 'human') {
    throw new Error(`Station '${station.name}' is a human step — only a person can settle it.`);
  }
  if (station.status === 'done') {
    throw new Error(`Station '${station.name}' is already done — it cannot be skipped.`);
  }
  db.prepare(
    `UPDATE pm_goal_stations
     SET status = 'skipped', evidence_kind = 'claim', evidence_note = ?,
         last_checked_at = NULL, done_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(reason.trim(), now(), stationId);
  return getStation(db, stationId)!;
}

/** Where a hand-over notification belongs: the project this server is bound to. */
export interface HumanCheckScope {
  projectPath?: string;
  projectName?: string;
}

/**
 * An unattended agent that reaches a human station hands it over instead of
 * waiting for a person nobody told. The steps are stored on the station, so
 * they sit where the person ticks it off, and one warning per station lands in
 * the inbox (a repeat replaces it). The station stays open: only a person
 * clears it (`markStationDone` refuses human steps for the same reason).
 * Without an inbox the steps are still stored, and the result says nobody was
 * told rather than pretending.
 */
export function requestHumanCheck(
  db: Database.Database,
  inbox: Database.Database | null,
  stationId: string,
  instructions: string,
  scope: HumanCheckScope
): { station: StationRow; notified: boolean } {
  const station = getStation(db, stationId);
  if (!station) throw new Error(`Station '${stationId}' not found`);
  if (station.kind !== 'human') {
    throw new Error(
      `Station '${station.name}' is not a human step — do it yourself and call mark_station_done.`
    );
  }
  if (station.status === 'done') {
    throw new Error(`Station '${station.name}' is already done — a person ticked it off.`);
  }
  db.prepare('UPDATE pm_goal_stations SET evidence_note = ?, updated_at = ? WHERE id = ?').run(
    instructions,
    now(),
    stationId
  );
  if (inbox) {
    dispatchNotification(inbox, {
      projectPath: scope.projectPath ?? null,
      projectName: scope.projectName ?? null,
      source: 'agent',
      severity: 'warn',
      title: station.name,
      body: instructions,
      refKind: 'goal',
      refId: station.goal_id,
      dedupeKey: `station:${stationId}:human-check`,
      actions: [
        {
          id: 'open',
          label: 'Open goal',
          kind: 'open',
          target: { type: 'goal', goalId: station.goal_id },
        },
      ],
    });
  }
  return { station: getStation(db, stationId)!, notified: inbox !== null };
}

export function reorderStation(
  db: Database.Database,
  stationId: string,
  toIndex: number
): StationRow[] {
  const station = getStation(db, stationId);
  if (!station) throw new Error(`Station '${stationId}' not found`);
  // The reorder invariants live in stationOrder (shared with the frontend):
  // done work stays put, the terminus is not a row and cannot move.
  const domain = listStations(db, station.goal_id).map(stationRowToDomain);
  const moved = moveStation(domain, station.goal_id, stationId, toIndex);
  const update = db.prepare(
    'UPDATE pm_goal_stations SET sort_order = ?, updated_at = ? WHERE id = ?'
  );
  const ts = now();
  for (const s of orderedStations(moved, station.goal_id)) {
    update.run(s.sortOrder, ts, s.id);
  }
  return listStations(db, station.goal_id);
}

export function updateStation(
  db: Database.Database,
  stationId: string,
  params: { name?: string; kind?: string; predicate?: string; ticketId?: string }
): StationRow {
  const id = resolveStationId(db, stationId);
  const station = getStation(db, id);
  if (!station) throw new Error(`Station '${stationId}' not found`);
  const finalKind = params.kind ?? station.kind;
  const finalPredicate =
    finalKind === 'human'
      ? '{"type":"human"}'
      : params.predicate !== undefined
        ? parsePredicateParam(params.predicate)
        : station.predicate;
  const ticketId = params.ticketId ? resolveTicketId(db, params.ticketId) : station.ticket_id;
  db.prepare(
    'UPDATE pm_goal_stations SET name = ?, kind = ?, predicate = ?, ticket_id = ?, updated_at = ? WHERE id = ?'
  ).run(params.name ?? station.name, finalKind, finalPredicate, ticketId, now(), id);
  return getStation(db, id)!;
}

/** The per-station fields, shared by create_station and each create_stations entry. */
const stationFields = {
  name: z.string().min(1).describe('Short imperative step name'),
  kind: z.enum(STATION_KINDS).optional().describe('normal | gate | human (default normal)'),
  predicate: z
    .string()
    .optional()
    .describe(
      'JSON predicate, e.g. {"type":"file_exists","glob":"docs/*.md"}. Defaults to {"type":"undefined"} — an honest "check to be defined".'
    ),
  ticketId: z
    .string()
    .optional()
    .describe('Ticket ID or unique prefix of a ticket this station wraps'),
};

export function registerStationTools(
  server: FastMCP,
  db: Database.Database,
  projectRoot: string,
  humanChecks: { inbox: Database.Database | null; scope: HumanCheckScope } = {
    inbox: null,
    scope: {},
  }
): void {
  server.addTool({
    name: 'list_stations',
    description:
      'List the stations of a goal line, in order. Stations are the steps of a goal: done|planned|fog, with a machine-checkable predicate where one exists.',
    parameters: z.object({
      goalId: z.string().describe('Goal ID (UUID or unique prefix)'),
    }),
    execute: async ({ goalId }) => JSON.stringify(listStations(db, resolveGoalId(db, goalId))),
  });

  server.addTool({
    name: 'create_station',
    description:
      'Add a station to a goal line. kind "human" marks a step only a person can clear (a call, an email, a sign-off).',
    parameters: z.object({
      goalId: z.string().describe('Goal ID (UUID or unique prefix)'),
      ...stationFields,
      afterStationId: z.string().optional().describe('Insert after this station'),
    }),
    execute: async ({ goalId, name, kind, predicate, ticketId, afterStationId }) =>
      JSON.stringify(
        createStation(db, {
          goalId: resolveGoalId(db, goalId),
          name,
          kind,
          predicate,
          ticketId: ticketId ? resolveTicketId(db, ticketId) : undefined,
          afterStationId: afterStationId ? resolveStationId(db, afterStationId) : undefined,
        })
      ),
  });

  server.addTool({
    name: 'create_stations',
    description:
      'Add several stations to a goal line in one call, in the given order. Each entry is validated exactly like create_station; if any entry is invalid, nothing is created and the error names the entry (stations[i]).',
    parameters: z.object({
      goalId: z.string().describe('Goal ID (UUID or unique prefix)'),
      stations: z.array(z.object(stationFields)).min(1).describe('Stations to append, in order'),
      afterStationId: z
        .string()
        .optional()
        .describe('Insert the whole block after this station instead of at the end'),
    }),
    execute: async ({ goalId, stations, afterStationId }) =>
      JSON.stringify(
        createStations(db, {
          goalId: resolveGoalId(db, goalId),
          stations,
          afterStationId: afterStationId ? resolveStationId(db, afterStationId) : undefined,
        })
      ),
  });

  server.addTool({
    name: 'update_station',
    description:
      'Update a station name, kind, predicate, or linked ticket. Cannot set status — use mark_station_done, which records the result as a claim.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix)'),
      name: z.string().min(1).optional(),
      kind: z.enum(STATION_KINDS).optional(),
      predicate: z.string().optional().describe('JSON predicate'),
      ticketId: z.string().optional().describe('Ticket ID or unique prefix to link'),
    }),
    execute: async ({ stationId, name, kind, predicate, ticketId }) =>
      JSON.stringify(updateStation(db, stationId, { name, kind, predicate, ticketId })),
  });

  server.addTool({
    name: 'delete_station',
    description: 'Delete a station from its goal line.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix)'),
    }),
    execute: async ({ stationId }) => {
      const id = resolveStationId(db, stationId);
      db.prepare('DELETE FROM pm_goal_stations WHERE id = ?').run(id);
      return JSON.stringify({ deleted: id });
    },
  });

  server.addTool({
    name: 'mark_station_done',
    description:
      'Mark a station done with an evidence note. A station with a file, ticket or requirement check is checked right now: if it holds, the station is recorded as PROOF; if not, the call fails with the reason and the station stays open. Any other station is recorded as a CLAIM (drawn hollow on the board) for the evidence engine or the judge — never as proof on your word alone.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix)'),
      evidenceNote: z.string().min(1).describe('What you did and where the evidence lives'),
    }),
    execute: async ({ stationId, evidenceNote }) =>
      JSON.stringify(
        await markStationDone(db, resolveStationId(db, stationId), evidenceNote, projectRoot)
      ),
  });

  server.addTool({
    name: 'skip_station',
    description:
      'Skip a station by decision, with the reason (blocked, not needed, ruled out earlier). The goal can still be achieved and the board shows the station as skipped, not done, so say plainly why. Not for gates or human steps, and not a way to avoid work you can do.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix)'),
      reason: z
        .string()
        .min(1)
        .describe('Why this station is not being done, and where it is written down'),
    }),
    execute: async ({ stationId, reason }) =>
      JSON.stringify(skipStation(db, resolveStationId(db, stationId), reason)),
  });

  server.addTool({
    name: 'request_human_check',
    description:
      'Hand a human station over to the person when nobody is watching you. Stores your note on ' +
      'the station and raises one inbox warning for it, titled with the station name (so name ' +
      'the station as the action, e.g. "Pick the free mailing plan"). The station stays open ' +
      'until a person ticks it off. Afterwards, continue with the next station — do not wait.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix) of a human station'),
      instructions: z
        .string()
        .min(1)
        .describe(
          'A short, self-contained note the person can act on from a phone: 3 to 6 plain ' +
            'sentences, at most 600 characters. Start with the action or result; for a decision ' +
            'give the options, what each means, your recommendation and how to answer. Put every ' +
            'fact in the note; never ask the person to open a file, note or video, and no paths or IDs.'
        ),
    }),
    execute: async ({ stationId, instructions }) =>
      JSON.stringify(
        requestHumanCheck(
          db,
          humanChecks.inbox,
          resolveStationId(db, stationId),
          instructions,
          humanChecks.scope
        )
      ),
  });

  server.addTool({
    name: 'reorder_station',
    description:
      'Move a station to an index within its line. Clamped so nothing pending lands before done work.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix)'),
      toIndex: z.number().int().min(0).describe('Target index, 0-based'),
    }),
    execute: async ({ stationId, toIndex }) =>
      JSON.stringify(reorderStation(db, resolveStationId(db, stationId), toIndex)),
  });
}
