import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import { assertOneOf, STATION_KINDS } from '../../lib/pm/enums';
import { moveStation, orderedStations } from '../../lib/goals/stationOrder';
import { parsePredicate, parseStoredPredicateJson } from '../../lib/goals/planner/plannerSchema';
import type { PmGoalStation } from '../../lib/tauri/goals';
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
 * Marks a station done ON BEHALF OF AN AGENT. The evidence class is forced
 * to 'claim' — the proof class belongs to the evidence engine, and a human's
 * tick comes through the UI. "Claims drawn as claims" is enforced here at
 * the boundary, not by convention.
 */
export function markStationDone(
  db: Database.Database,
  stationId: string,
  evidenceNote: string
): StationRow {
  const station = getStation(db, stationId);
  if (!station) throw new Error(`Station '${stationId}' not found`);
  // A human step is cleared by a person in the UI, never by an agent claim.
  // This is the gate the satisfaction model leans on: without it an agent
  // could tick "Call the customer" and the conductor would auto-achieve the
  // goal past a step nobody performed.
  if (station.kind === 'human' || predicateTypeOf(station.predicate) === 'human') {
    throw new Error(`Station '${station.name}' is a human step — only a person can mark it done.`);
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

export function registerStationTools(server: FastMCP, db: Database.Database): void {
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
      'Mark a station done with an evidence note. The result is recorded as a CLAIM (drawn hollow on the board) — proof comes from the evidence engine or a human tick, never from an agent assertion.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix)'),
      evidenceNote: z.string().min(1).describe('What you did and where the evidence lives'),
    }),
    execute: async ({ stationId, evidenceNote }) =>
      JSON.stringify(markStationDone(db, resolveStationId(db, stationId), evidenceNote)),
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
