import { z } from 'zod';
import type { FastMCP } from 'fastmcp';
import type Database from 'better-sqlite3';
import { assertOneOf, STATION_KINDS } from '../../lib/pm/enums';
import { moveStation, orderedStations } from '../../lib/goals/stationOrder';
import { parsePredicate } from '../../lib/goals/planner/plannerSchema';
import type { PmGoalStation, StationPredicate } from '../../lib/tauri/goals';
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
    | { id: string }
    | undefined;
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
    | StationRow
    | undefined;
}

function parsePredicateParam(raw: string | undefined): string {
  if (!raw) return '{"type":"undefined"}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`predicate must be valid JSON, received: ${raw.slice(0, 80)}`);
  }
  // The same strict, field-by-field validation the planner uses. An
  // allowlisted `type` is not enough: a git_touches without a pathPrefix or a
  // file_exists without a glob used to slip through here and then match the
  // whole repo, laundering a claim into machine "proof".
  const predicate = parsePredicate('predicate', parsed);
  assertSpecificGlob(predicate);
  return JSON.stringify(predicate);
}

/** A file_exists glob must name something concrete. A pattern made only of
 * wildcards and slashes matches every path, which is the exact shape that
 * turns an agent claim into a passing machine check. */
function assertSpecificGlob(predicate: StationPredicate): void {
  if (predicate.type === 'file_exists') {
    const literal = predicate.glob.replace(/[*?/]/g, '');
    if (literal.length === 0) {
      throw new Error(
        `predicate.glob "${predicate.glob}" matches every path — name a concrete file or directory.`
      );
    }
  }
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
function rowToDomain(row: StationRow): PmGoalStation {
  let predicate: StationPredicate = { type: 'undefined' };
  try {
    predicate = JSON.parse(row.predicate) as StationPredicate;
  } catch {
    // corrupt predicate degrades to "check to be defined"
  }
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

export function createStation(
  db: Database.Database,
  params: {
    goalId: string;
    name: string;
    kind?: string;
    predicate?: string;
    ticketId?: string;
    afterStationId?: string;
  }
): StationRow {
  const kind = assertOneOf('kind', params.kind ?? 'normal', STATION_KINDS);
  // Invariant: a human step always carries the human predicate, whatever an
  // agent passed. Otherwise create_station(kind:'human', predicate:file_exists)
  // would mint a "person only" station the evidence engine happily clears.
  const predicate = kind === 'human' ? '{"type":"human"}' : parsePredicateParam(params.predicate);
  const evidenceKind = kind === 'human' ? 'human' : 'claim';
  const existing = listStations(db, params.goalId);
  let sortOrder = existing.length;
  if (params.afterStationId) {
    const after = existing.findIndex((s) => s.id === params.afterStationId);
    if (after === -1) throw new Error(`Station '${params.afterStationId}' not found on this goal`);
    sortOrder = after + 1;
  }
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO pm_goal_stations
     (id, goal_id, name, kind, status, evidence_kind, predicate, evidence_note, ticket_id,
      lane, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planned', ?, ?, '', ?, 0, ?, ?, ?)`
  ).run(
    id,
    params.goalId,
    params.name,
    kind,
    evidenceKind,
    predicate,
    params.ticketId ?? null,
    sortOrder,
    ts,
    ts
  );
  // Renumber everything after the insertion point so orders stay dense.
  const rows = listStations(db, params.goalId);
  const renumber = db.prepare('UPDATE pm_goal_stations SET sort_order = ? WHERE id = ?');
  rows
    .sort((a, b) => a.sort_order - b.sort_order || (a.id === id ? -1 : 0))
    .forEach((row, i) => renumber.run(i, row.id));
  return getStation(db, id)!;
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
  const domain = listStations(db, station.goal_id).map(rowToDomain);
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
      name: z.string().min(1).describe('Short imperative step name'),
      kind: z.enum(STATION_KINDS).optional().describe('normal | gate | human (default normal)'),
      predicate: z
        .string()
        .optional()
        .describe(
          'JSON predicate, e.g. {"type":"file_exists","glob":"docs/*.md"}. Defaults to {"type":"undefined"} — an honest "check to be defined".'
        ),
      ticketId: z.string().optional().describe('Link a ticket this station wraps'),
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
    name: 'update_station',
    description:
      'Update a station name, kind, or predicate. Cannot set status — use mark_station_done, which records the result as a claim.',
    parameters: z.object({
      stationId: z.string().describe('Station ID (UUID or unique prefix)'),
      name: z.string().min(1).optional(),
      kind: z.enum(STATION_KINDS).optional(),
      predicate: z.string().optional().describe('JSON predicate'),
    }),
    execute: async ({ stationId, name, kind, predicate }) => {
      const id = resolveStationId(db, stationId);
      const station = getStation(db, id);
      if (!station) return JSON.stringify({ error: 'Station not found' });
      const finalKind = kind ?? station.kind;
      // Same human invariant as create_station: a human step keeps the human
      // predicate no matter what predicate the caller supplies.
      const finalPredicate =
        finalKind === 'human'
          ? '{"type":"human"}'
          : predicate !== undefined
            ? parsePredicateParam(predicate)
            : station.predicate;
      db.prepare(
        'UPDATE pm_goal_stations SET name = ?, kind = ?, predicate = ?, updated_at = ? WHERE id = ?'
      ).run(name ?? station.name, finalKind, finalPredicate, now(), id);
      return JSON.stringify(getStation(db, id));
    },
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
