import type { LlmMessage } from '@/lib/tauri/llm';
import type { PmGoal } from '@/lib/tauri/goals';
import type { PlannerGraph } from './plannerSchema';

/**
 * Prompts for the planner LLM. Strict-JSON-only on purpose: the response is
 * parsed by plannerSchema with field-level validation, so the contract here
 * and the parser must describe the same shape.
 */

const STATION_SCHEMA = `Each station is:
{
  "name": string,                      // short, imperative, <= 40 chars
  "kind": "normal" | "gate" | "human", // gate = approval point; human = only a person can do it (call, email, decision)
  "evidenceKind": "proof" | "judged" | "claim" | "human",
  "predicate": { "type": "undefined" }               // check not yet defined (be honest, use this when unsure)
             | { "type": "human" }                   // a person ticks it off
             | { "type": "file_exists", "glob": string }
             | { "type": "git_touches", "pathPrefix": string }
             | { "type": "judged", "prompt": string } // an LLM will judge completion from evidence
  ,
  "fog": true                          // OPTIONAL: only for steps the author is explicitly unsure about
}
IMPORTANT: evidenceKind and predicate.type are different fields. evidenceKind MUST be exactly one of
"proof", "judged", "claim", or "human": never put "file_exists", "git_touches", or "undefined"
there. Examples: file_exists/git_touches predicates use evidenceKind "proof"; an undefined predicate
uses evidenceKind "claim"; a judged predicate uses evidenceKind "judged".`;

export function buildInitialPrompt(goal: PmGoal, dump: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content: `You turn a rough goal description into a plan of "stations": ordered steps toward the goal.
Rules:
- 3 to 9 stations, ordered from first to last. Do NOT include the goal itself as a station.
- Steps a person must do themselves (calls, emails, sign-offs, decisions) are kind "human" with predicate {"type":"human"} and evidenceKind "human".
- Where the description is explicitly unsure ("maybe", "not sure yet"), set "fog": true: uncertainty goes into the fog, not into the plan.
- Every other station gets the most machine-checkable predicate you can honestly justify; when in doubt use {"type":"undefined"} rather than inventing paths.
${STATION_SCHEMA}
Respond with a SINGLE JSON object: { "stations": [ ... ] }. No prose, no markdown fences.`,
    },
    {
      role: 'user',
      content: `Goal: ${goal.name}
Success criteria: ${goal.successCriteria || '(none written yet)'}

The author's dump:
${dump}`,
    },
  ];
}

export function buildRefinePrompt(graph: PlannerGraph, instruction: string): LlmMessage[] {
  return [
    {
      role: 'system',
      content: `You refine an existing plan of stations by emitting a JSON diff: never a full rewrite, so the plan morphs instead of jumping.
Allowed ops (indexes refer to the CURRENT stations array, 0-based, applied sequentially):
- { "op": "add", "station": <station>, "afterIndex"?: number }
- { "op": "remove", "index": number }
- { "op": "rename", "index": number, "name": string }
- { "op": "move", "index": number, "toIndex": number }
- { "op": "split", "index": number, "into": [string, string] }
- { "op": "set_gate", "index": number, "gate": boolean }
- { "op": "set_evidence", "index": number, "evidenceKind": string, "predicate": <predicate> }
${STATION_SCHEMA}
Respond with a SINGLE JSON object: { "ops": [ ... ] }. Emit the smallest diff that satisfies the instruction. No prose, no markdown fences.`,
    },
    {
      role: 'user',
      content: `Current stations:
${JSON.stringify(graph.stations, null, 2)}

Instruction: ${instruction}`,
    },
  ];
}
