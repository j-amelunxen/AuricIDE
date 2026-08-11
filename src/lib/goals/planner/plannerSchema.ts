import {
  assertOneOf,
  EVIDENCE_KINDS,
  STATION_KINDS,
  STATION_PREDICATE_TYPES,
  type EvidenceKindValue,
  type StationKind,
} from '@/lib/pm/enums';
import type { StationPredicate, StationSourceContext } from '@/lib/tauri/goals';

/**
 * What the planner LLM is allowed to say. Everything that crosses this
 * boundary is validated field by field — the model's bad JSON is a normal
 * event that produces a precise error, never a corrupted plan.
 */
export interface PlannerStation {
  name: string;
  kind: StationKind;
  evidenceKind: EvidenceKindValue;
  predicate: StationPredicate;
  /** Explicitly uncertain steps go into the fog, not into the plan. */
  fog?: boolean;
  /** Optional non-LLM provenance carried into the committed station. */
  sourceContext?: StationSourceContext;
}

export interface PlannerGraph {
  stations: PlannerStation[];
}

/** A refinement round is a structured graph diff, never a full rewrite —
 * the map must morph under iteration, not jump. */
export type PlannerOp =
  | { op: 'add'; station: PlannerStation; afterIndex?: number }
  | { op: 'remove'; index: number }
  | { op: 'rename'; index: number; name: string }
  | { op: 'move'; index: number; toIndex: number }
  | { op: 'split'; index: number; into: [string, string] }
  | { op: 'set_gate'; index: number; gate: boolean }
  | {
      op: 'set_evidence';
      index: number;
      evidenceKind: EvidenceKindValue;
      predicate: StationPredicate;
    };

export const PLANNER_OP_NAMES = [
  'add',
  'remove',
  'rename',
  'move',
  'split',
  'set_gate',
  'set_evidence',
] as const;

/** Pulls the first JSON object/array out of a model response, tolerating
 * markdown fences and prose around it. */
export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/g, '');
  const start = cleaned.search(/[[{]/);
  if (start === -1) {
    throw new Error(`No JSON found in planner response: "${raw.slice(0, 120)}"`);
  }
  const closer = cleaned[start] === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(closer);
  if (end <= start) {
    throw new Error(`Unterminated JSON in planner response: "${raw.slice(0, 120)}"`);
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Planner response is not valid JSON: ${(e as Error).message}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Strict, field-by-field predicate validation, shared with the MCP station
 * boundary so an agent-authored predicate is checked exactly as tightly as a
 * planner-authored one — a `type` that is on the allowlist is not enough. */
export function parsePredicate(field: string, raw: unknown): StationPredicate {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    throw new Error(`Invalid ${field}: expected an object with a "type" string`);
  }
  const type = assertOneOf(`${field}.type`, raw.type, STATION_PREDICATE_TYPES);
  switch (type) {
    case 'ticket_done':
      if (typeof raw.ticketId !== 'string' || !raw.ticketId) {
        throw new Error(`Invalid ${field}: ticket_done requires a ticketId string`);
      }
      return { type, ticketId: raw.ticketId };
    case 'requirement_verified':
      if (typeof raw.requirementId !== 'string' || !raw.requirementId) {
        throw new Error(`Invalid ${field}: requirement_verified requires a requirementId string`);
      }
      return { type, requirementId: raw.requirementId };
    case 'file_exists':
      if (typeof raw.glob !== 'string' || !raw.glob) {
        throw new Error(`Invalid ${field}: file_exists requires a glob string`);
      }
      return { type, glob: raw.glob };
    case 'git_touches':
      if (typeof raw.pathPrefix !== 'string' || !raw.pathPrefix) {
        throw new Error(`Invalid ${field}: git_touches requires a pathPrefix string`);
      }
      return {
        type,
        pathPrefix: raw.pathPrefix,
        ...(typeof raw.sinceIso === 'string' ? { sinceIso: raw.sinceIso } : {}),
      };
    case 'judged':
      if (typeof raw.prompt !== 'string' || !raw.prompt) {
        throw new Error(`Invalid ${field}: judged requires a prompt string`);
      }
      return { type, prompt: raw.prompt };
    default:
      return { type };
  }
}

function parseStation(field: string, raw: unknown): PlannerStation {
  if (!isRecord(raw)) throw new Error(`Invalid ${field}: expected an object`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new Error(`Invalid ${field}.name: expected a non-empty string`);
  }
  const kind = assertOneOf(
    `${field}.kind`,
    typeof raw.kind === 'string' ? raw.kind : 'normal',
    STATION_KINDS
  );
  const evidenceKind = assertOneOf(
    `${field}.evidenceKind`,
    typeof raw.evidenceKind === 'string' ? raw.evidenceKind : 'claim',
    EVIDENCE_KINDS
  );
  const predicate = parsePredicate(
    `${field}.predicate`,
    raw.predicate ?? { type: kind === 'human' ? 'human' : 'undefined' }
  );
  return {
    name: raw.name.trim(),
    kind,
    evidenceKind,
    predicate,
    ...(raw.fog === true ? { fog: true } : {}),
  };
}

export function parsePlannerGraph(raw: string): PlannerGraph {
  const json = extractJson(raw);
  const root = isRecord(json) ? json : { stations: json };
  if (!Array.isArray(root.stations)) {
    throw new Error('Invalid planner graph: expected { "stations": [...] }');
  }
  if (root.stations.length === 0) {
    throw new Error('Invalid planner graph: stations must not be empty');
  }
  return { stations: root.stations.map((s, i) => parseStation(`stations[${i}]`, s)) };
}

export function parsePlannerOps(raw: string): PlannerOp[] {
  const json = extractJson(raw);
  const list = isRecord(json) && Array.isArray(json.ops) ? json.ops : json;
  if (!Array.isArray(list)) {
    throw new Error('Invalid planner ops: expected an array (or { "ops": [...] })');
  }
  return list.map((entry, i): PlannerOp => {
    const field = `ops[${i}]`;
    if (!isRecord(entry) || typeof entry.op !== 'string') {
      throw new Error(`Invalid ${field}: expected an object with an "op" string`);
    }
    const op = assertOneOf(`${field}.op`, entry.op, PLANNER_OP_NAMES);
    const index = (key = 'index'): number => {
      const v = entry[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
        throw new Error(`Invalid ${field}.${key}: expected a non-negative integer`);
      }
      return v;
    };
    switch (op) {
      case 'add':
        return {
          op,
          station: parseStation(`${field}.station`, entry.station),
          ...(entry.afterIndex !== undefined ? { afterIndex: index('afterIndex') } : {}),
        };
      case 'remove':
        return { op, index: index() };
      case 'rename':
        if (typeof entry.name !== 'string' || !entry.name.trim()) {
          throw new Error(`Invalid ${field}.name: expected a non-empty string`);
        }
        return { op, index: index(), name: entry.name.trim() };
      case 'move':
        return { op, index: index(), toIndex: index('toIndex') };
      case 'split': {
        const into = entry.into;
        if (
          !Array.isArray(into) ||
          into.length !== 2 ||
          into.some((n) => typeof n !== 'string' || !n.trim())
        ) {
          throw new Error(`Invalid ${field}.into: expected two non-empty names`);
        }
        return { op, index: index(), into: [into[0].trim(), into[1].trim()] };
      }
      case 'set_gate':
        if (typeof entry.gate !== 'boolean') {
          throw new Error(`Invalid ${field}.gate: expected a boolean`);
        }
        return { op, index: index(), gate: entry.gate };
      case 'set_evidence':
        return {
          op,
          index: index(),
          evidenceKind: assertOneOf(
            `${field}.evidenceKind`,
            typeof entry.evidenceKind === 'string' ? entry.evidenceKind : '',
            EVIDENCE_KINDS
          ),
          predicate: parsePredicate(`${field}.predicate`, entry.predicate),
        };
    }
  });
}
