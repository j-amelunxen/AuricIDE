/**
 * Ask a model how one conflict should be resolved, and read its answer
 * strictly. The proposal is only ever shown next to the conflict; the human
 * accepts it or not. Anything that is not exactly the JSON we asked for is
 * refused with a reason, never repaired.
 */
import { isMarkerLine, type ConflictSegment } from './conflictModel';

/** Lines of surrounding file shown to the model on each side of the conflict. */
export const PROPOSAL_CONTEXT_LINES = 15;
const RATIONALE_MAX = 300;

export type ProposalConfidence = 'high' | 'medium' | 'low';

export type ProposalResult =
  | { ok: true; lines: string[]; rationale: string; confidence: ProposalConfidence }
  | { ok: false; reason: string };

export interface ProposalPromptInput {
  /** Repo-relative path of the conflicted file. */
  filePath: string;
  oursLabel: string;
  theirsLabel: string;
  conflict: ConflictSegment;
  /** File lines before the conflict, in order. Only the last 15 are used. */
  before: readonly string[];
  /** File lines after the conflict, in order. Only the first 15 are used. */
  after: readonly string[];
  /** Subjects of the commits that changed each side since the merge base. */
  intent?: { ours: readonly string[]; theirs: readonly string[] };
}

function block(lines: readonly string[]): string {
  return lines.length === 0 ? '(empty)' : lines.join('\n');
}

/** One line per side that has commits; nothing when neither does. */
function intentLines(input: ProposalPromptInput): string[] {
  const sides = [
    [input.oursLabel, input.intent?.ours ?? []],
    [input.theirsLabel, input.intent?.theirs ?? []],
  ] as const;
  const lines = sides
    .filter(([, subjects]) => subjects.length > 0)
    .map(
      ([label, subjects]) =>
        `Side "${label}" changed this region in: ${subjects.map((s) => `"${s}"`).join('; ')}.`
    );
  return lines.length === 0
    ? []
    : ['', 'Why each side looks like this, from its commits:', ...lines];
}

export function buildProposalPrompt(input: ProposalPromptInput): string {
  const { filePath, oursLabel, theirsLabel, conflict } = input;
  const before = input.before.slice(-PROPOSAL_CONTEXT_LINES);
  const after = input.after.slice(0, PROPOSAL_CONTEXT_LINES);
  const base =
    conflict.base === null
      ? 'There is no common ancestor: both sides added this region independently.'
      : `Original (common ancestor):\n<<<BASE\n${block(conflict.base)}\nBASE>>>`;

  return [
    `You are resolving one git merge conflict in ${filePath}.`,
    `Branch "${oursLabel}" is being merged with branch "${theirsLabel}".`,
    'Work out what each side intended and write the region so that both intents hold.',
    'If the sides cannot both hold, keep the one that fits the surrounding code and say why.',
    ...intentLines(input),
    '',
    `Context before the conflict:\n<<<BEFORE\n${block(before)}\nBEFORE>>>`,
    '',
    base,
    '',
    `Side "${oursLabel}":\n<<<OURS\n${block(conflict.ours)}\nOURS>>>`,
    '',
    `Side "${theirsLabel}":\n<<<THEIRS\n${block(conflict.theirs)}\nTHEIRS>>>`,
    '',
    `Context after the conflict:\n<<<AFTER\n${block(after)}\nAFTER>>>`,
    '',
    'Answer with JSON only, no prose, in exactly this shape:',
    '{"resolution": "<the lines that replace the conflict, joined with \\n>", "rationale": "<one sentence>", "confidence": "high" | "medium" | "low"}',
    'The resolution replaces only the conflict region, not the context. It must not contain conflict markers.',
  ].join('\n');
}

const FENCE = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/;
const CONFIDENCES: readonly string[] = ['high', 'medium', 'low'];

function unfence(raw: string): string {
  const trimmed = raw.trim();
  return FENCE.exec(trimmed)?.[1] ?? trimmed;
}

function fail(reason: string): ProposalResult {
  return { ok: false, reason };
}

/**
 * Strict reader for the model's answer. `conflict` is needed for one rule:
 * an empty resolution is only believable when one side was empty too.
 */
export function parseProposal(raw: string, conflict: ConflictSegment): ProposalResult {
  let value: unknown;
  try {
    value = JSON.parse(unfence(raw));
  } catch {
    return fail('The answer was not valid JSON.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('The answer was not a JSON object.');
  }
  const { resolution, rationale, confidence } = value as Record<string, unknown>;
  if (typeof resolution !== 'string') return fail('The answer had no resolution text.');
  if (typeof rationale !== 'string') return fail('The answer had no rationale.');
  if (typeof confidence !== 'string' || !CONFIDENCES.includes(confidence)) {
    return fail('The answer had no valid confidence (high, medium or low).');
  }
  const text = resolution.endsWith('\n') ? resolution.slice(0, -1) : resolution;
  const lines = text === '' ? [] : text.split('\n').map((l) => l.replace(/\r$/, ''));
  // Stricter than the file check: a lone ======= in a proposal is a half-done
  // merge, unless one of the sides really has that line.
  const sides = new Set([...conflict.ours, ...(conflict.base ?? []), ...conflict.theirs]);
  if (lines.some((l) => isMarkerLine(l) && !sides.has(l))) {
    return fail('The proposal still contains a conflict marker.');
  }
  if (lines.length === 0 && conflict.ours.length > 0 && conflict.theirs.length > 0) {
    return fail('The proposal was empty although both sides have content.');
  }
  return {
    ok: true,
    lines,
    rationale: rationale.trim().slice(0, RATIONALE_MAX),
    confidence: confidence as ProposalConfidence,
  };
}

/** Builds the prompt, asks once, parses strictly. A thrown error becomes a reason. */
export async function proposeResolution(
  input: ProposalPromptInput & { askLlm: (prompt: string) => Promise<string> }
): Promise<ProposalResult> {
  let raw: string;
  try {
    raw = await input.askLlm(buildProposalPrompt(input));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail(`The model could not be asked: ${detail}`);
  }
  return parseProposal(raw, input.conflict);
}
