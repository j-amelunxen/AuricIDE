import type { PlannerGraph } from '@/lib/goals/planner/plannerSchema';
import type { LlmMessage } from '@/lib/tauri/llm';

export type ProcessActor = 'human' | 'agent' | 'system' | 'unknown';
export type ProcessStationKind = 'normal' | 'gate' | 'human';

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
}

export interface VideoFrame {
  timestampMs: number;
  path: string;
  dataUrl?: string;
}

export interface ExtractedProcessStep {
  title: string;
  description: string;
  actor: ProcessActor;
  stationKind?: ProcessStationKind;
  confidence: number;
  sourceSegmentIds: number[];
  frameTimestampsMs: number[];
}

export interface ExtractedProcess {
  title: string;
  objective: string;
  successCriteria: string;
  summary: string;
  steps: ExtractedProcessStep[];
  ambiguities: string[];
  deferredIdeas: string[];
}

export interface ProcessExtractionInput {
  transcript: TranscriptSegment[];
  frames: VideoFrame[];
  sourceName: string;
}

function timecode(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function buildProcessExtractionMessages(input: ProcessExtractionInput): LlmMessage[] {
  const transcript = input.transcript
    .map(
      (segment, index) =>
        `${index}. [${timecode(segment.startMs)}–${timecode(segment.endMs)}] ${segment.text}`
    )
    .join('\n');
  const frameList = input.frames
    .map((frame) => `- ${timecode(frame.timestampMs)} (${frame.path})`)
    .join('\n');

  return [
    {
      role: 'system',
      content: `You extract a trustworthy, executable process from a narrated screen recording.
Return one JSON object with exactly these fields:
{
  "title": string,
  "objective": string,
  "successCriteria": string,
  "summary": string,
  "steps": [{
    "title": string,
    "description": string,
    "actor": "human" | "agent" | "system" | "unknown",
    "stationKind": "normal" | "gate" | "human",
    "confidence": number between 0 and 1,
    "sourceSegmentIds": number[],
    "frameTimestampsMs": number[]
  }],
  "ambiguities": string[],
  "deferredIdeas": string[]
}
Rules:
- Preserve the order demonstrated by the speaker.
- Later self-corrections replace earlier statements.
- Calls, emails, approvals, sign-offs and decisions are human steps.
- Use stationKind "gate" for a checkpoint that blocks later work until approval or verification.
- Use stationKind "human" when only a person can perform the action.
- Put unclear feedback in ambiguities. Never guess missing actions.
- Put explicitly postponed ideas in deferredIdeas. Never turn them into active steps.
- Ground every step in transcript segment ids and, when useful, frame timestamps.
- Keep step titles short and imperative. Return JSON only.`,
    },
    {
      role: 'user',
      content: `Source: ${input.sourceName}\n\nTranscript:\n${transcript}\n\nAvailable frames:\n${frameList || '(none)'}`,
      ...(input.frames.some((frame) => frame.dataUrl)
        ? {
            parts: [
              { type: 'text' as const, text: 'Use these sampled frames as visual grounding.' },
              ...input.frames.flatMap((frame) =>
                frame.dataUrl
                  ? [
                      { type: 'text' as const, text: `Frame at ${timecode(frame.timestampMs)}` },
                      { type: 'image_url' as const, imageUrl: frame.dataUrl },
                    ]
                  : []
              ),
            ],
          }
        : {}),
    },
  ];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid extracted process: ${key} must be a non-empty string`);
  }
  return value.trim();
}

function stringList(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid extracted process: ${key} must be a string array`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function numberList(source: Record<string, unknown>, key: string): number[] {
  const value = source[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number')) {
    throw new Error(`Invalid extracted process: ${key} must be a number array`);
  }
  return value;
}

function sourceSegmentIds(
  source: Record<string, unknown>,
  index: number,
  transcriptLength?: number
): number[] {
  const values = numberList(source, 'sourceSegmentIds');
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error(
      `Invalid extracted process: steps[${index}].sourceSegmentIds must contain non-negative integers`
    );
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`Invalid extracted process: steps[${index}].sourceSegmentIds must be unique`);
  }
  if (transcriptLength !== undefined && values.some((value) => value >= transcriptLength)) {
    throw new Error(
      `Invalid extracted process: steps[${index}].sourceSegmentIds is outside transcript range`
    );
  }
  return values;
}

function frameTimestamps(source: Record<string, unknown>, index: number): number[] {
  const value = source.frameTimestampsMs;
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item) || item < 0)
  ) {
    throw new Error(
      `Invalid extracted process: steps[${index}].frameTimestampsMs must contain finite non-negative numbers`
    );
  }
  return [...new Set(value)];
}

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object found in process analysis');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new Error(`Process analysis is not valid JSON: ${(error as Error).message}`);
  }
}

export function parseExtractedProcess(
  raw: string,
  bounds: { transcriptLength?: number } = {}
): ExtractedProcess {
  const root = record(extractJson(raw));
  if (!root) throw new Error('Invalid extracted process: expected an object');
  if (!Array.isArray(root.steps) || root.steps.length === 0) {
    throw new Error('Invalid extracted process: steps must not be empty');
  }

  const actors: ProcessActor[] = ['human', 'agent', 'system', 'unknown'];
  const steps = root.steps.map((value, index): ExtractedProcessStep => {
    const step = record(value);
    if (!step) throw new Error(`Invalid extracted process: steps[${index}] must be an object`);
    const actor = step.actor;
    if (typeof actor !== 'string' || !actors.includes(actor as ProcessActor)) {
      throw new Error(`Invalid extracted process: steps[${index}].actor is unsupported`);
    }
    const confidence = typeof step.confidence === 'number' ? step.confidence : 0.5;
    const stationKinds: ProcessStationKind[] = ['normal', 'gate', 'human'];
    const stationKind =
      typeof step.stationKind === 'string' &&
      stationKinds.includes(step.stationKind as ProcessStationKind)
        ? (step.stationKind as ProcessStationKind)
        : actor === 'human'
          ? 'human'
          : 'normal';
    return {
      title: requiredString(step, 'title'),
      description: typeof step.description === 'string' ? step.description.trim() : '',
      actor: actor as ProcessActor,
      stationKind,
      confidence: Math.max(0, Math.min(1, confidence)),
      sourceSegmentIds: sourceSegmentIds(step, index, bounds.transcriptLength),
      frameTimestampsMs: frameTimestamps(step, index),
    };
  });

  return {
    title: requiredString(root, 'title'),
    objective: requiredString(root, 'objective'),
    successCriteria: requiredString(root, 'successCriteria'),
    summary: typeof root.summary === 'string' ? root.summary.trim() : '',
    steps,
    ambiguities: stringList(root, 'ambiguities'),
    deferredIdeas: stringList(root, 'deferredIdeas'),
  };
}

export function processToPlannerGraph(process: ExtractedProcess): PlannerGraph {
  return {
    stations: process.steps.map((step) => {
      if (step.stationKind === 'gate') {
        const humanGate = step.actor === 'human';
        return {
          name: step.title,
          kind: 'gate',
          evidenceKind: humanGate ? 'human' : 'claim',
          predicate: humanGate ? { type: 'human' } : { type: 'undefined' },
        };
      }
      if (step.actor === 'human' || step.stationKind === 'human') {
        return {
          name: step.title,
          kind: 'human',
          evidenceKind: 'human',
          predicate: { type: 'human' },
        };
      }
      return {
        name: step.title,
        kind: 'normal',
        evidenceKind: 'claim',
        predicate: { type: 'undefined' },
        ...(step.actor === 'unknown' || step.confidence < 0.6 ? { fog: true } : {}),
      };
    }),
  };
}
