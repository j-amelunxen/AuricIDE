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
  /** Stable UI identity for an uncommitted draft; never becomes a station id. */
  draftId?: string;
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
      assertSpecificGlob(raw.glob, field);
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

/**
 * A file_exists glob must name something concrete. A pattern made only of
 * wildcards and slashes matches every path — the exact shape that turns an
 * agent claim into a passing machine check.
 */
export function assertSpecificGlob(glob: string, field = 'predicate'): void {
  const literal = glob.replace(/[*?/]/g, '');
  if (literal.length === 0) {
    throw new Error(
      `${field}.glob "${glob}" matches every path — name a concrete file or directory.`
    );
  }
}

/**
 * Read-path counterpart to {@link parsePredicate}: never throws. Incomplete,
 * unknown, or tautological predicates degrade to `{ type: 'undefined' }` so a
 * corrupt stored row cannot launder into machine "proof". Write paths still
 * use {@link parsePredicate} and reject bad input loudly.
 */
export function parseStoredPredicate(raw: unknown): StationPredicate {
  try {
    return parsePredicate('predicate', raw);
  } catch {
    return { type: 'undefined' };
  }
}

/** Like {@link parseStoredPredicate}, but starts from a stored JSON string. */
export function parseStoredPredicateJson(json: string): StationPredicate {
  try {
    return parseStoredPredicate(JSON.parse(json) as unknown);
  } catch {
    return { type: 'undefined' };
  }
}

function parseEvidenceKind(
  field: string,
  raw: unknown,
  predicate: StationPredicate
): EvidenceKindValue {
  const value = typeof raw === 'string' ? raw : 'claim';
  if ((EVIDENCE_KINDS as readonly string[]).includes(value)) {
    return value as EvidenceKindValue;
  }

  // Some models copy the predicate type into evidenceKind. Repair only when
  // both fields name the exact same predicate, so a typo or contradictory
  // response still fails at this boundary.
  if (value === predicate.type) {
    switch (predicate.type) {
      case 'ticket_done':
      case 'requirement_verified':
      case 'file_exists':
      case 'git_touches':
        return 'proof';
      case 'undefined':
        return 'claim';
    }
  }

  return assertOneOf(field, value, EVIDENCE_KINDS);
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
  const predicate = parsePredicate(
    `${field}.predicate`,
    raw.predicate ?? { type: kind === 'human' ? 'human' : 'undefined' }
  );
  const evidenceKind = parseEvidenceKind(`${field}.evidenceKind`, raw.evidenceKind, predicate);
  return {
    name: raw.name.trim(),
    kind,
    evidenceKind,
    predicate,
    ...(raw.fog === true ? { fog: true } : {}),
  };
}

function logParseFailure(phase: 'initial' | 'refinement', raw: string, error: unknown): void {
  console.error(`[Planner] Failed to parse ${phase} proposal`, {
    response: raw,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function parsePlannerGraph(raw: string): PlannerGraph {
  try {
    return parsePlannerGraphStrict(raw);
  } catch (error) {
    logParseFailure('initial', raw, error);
    throw error;
  }
}

function parsePlannerGraphStrict(raw: string): PlannerGraph {
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
  try {
    return parsePlannerOpsStrict(raw);
  } catch (error) {
    logParseFailure('refinement', raw, error);
    throw error;
  }
}

function parsePlannerOpsStrict(raw: string): PlannerOp[] {
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
      case 'set_evidence': {
        const predicate = parsePredicate(`${field}.predicate`, entry.predicate);
        return {
          op,
          index: index(),
          evidenceKind: parseEvidenceKind(
            `${field}.evidenceKind`,
            entry.evidenceKind ?? '',
            predicate
          ),
          predicate,
        };
      }
    }
  });
}
