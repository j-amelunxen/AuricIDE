import type { AgentConfig } from '../tauri/agents';
import { llmCall } from '../tauri/llm';
import type { NotificationInput } from '../tauri/notifications';
import { clipFinishSummary, deriveFinishSummary } from './finishSummary';

/** How long we wait on a configured LLM before using the extracted tail. */
const FINISH_SUMMARY_LLM_TIMEOUT_MS = 4_000;

const LLM_SYSTEM =
  'You write a 1-2 sentence status a person can glance at. No preamble, no quotes, no markdown.';

/**
 * Headless is the signal that nobody is watching the terminal. Conductor
 * tickets also run headless so the verdict is collected on exit — those
 * already have their own inbox rows, and a ping per ticket would bury them.
 */
export function shouldNotifyHeadlessFinish(
  config: Pick<AgentConfig, 'headless' | 'runSource'> | undefined
): boolean {
  return config?.headless === true && config.runSource !== 'conductor';
}

export function headlessFinishNotification(input: {
  agentId: string;
  name: string;
  repoPath?: string | null;
  body: string | null;
}): NotificationInput {
  return {
    source: 'system',
    origin: input.name,
    severity: 'success',
    title: `${input.name} finished`,
    body: input.body,
    projectPath: input.repoPath ?? null,
    projectName: input.repoPath?.split('/').filter(Boolean).pop() ?? null,
    refKind: 'agent',
    refId: input.agentId,
    dedupeKey: `agent:${input.agentId}:done`,
    actions: [
      {
        id: 'logs',
        label: 'Open logs',
        kind: 'open',
        target: { type: 'agent', agentId: input.agentId },
      },
    ],
  };
}

/**
 * Strips code fences, quotes and excess whitespace from a raw LLM reply, then
 * hands the cleaned text to the caller's own length clip. Every summary an
 * LLM is asked to polish gets the same "no preamble, no quotes, no markdown"
 * instruction and needs the same cleanup before it can be trusted — only the
 * length cap differs by caller (a finished-run body clips to
 * `FINISH_SUMMARY_MAX_CHARS`; a lane summary clips shorter).
 */
export function clipLlmReply(content: string, clip: (text: string) => string): string | null {
  let text = content.trim();
  text = text
    .replace(/^```(?:\w+)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  text = text.replace(/^["“]|["”]$/gu, '').trim();
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return clip(text);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

async function polishWithLlm(
  extract: string,
  task: string | undefined,
  projectPath: string
): Promise<string | null> {
  const asked = task?.trim();
  const response = await llmCall({
    projectPath,
    temperature: 0.2,
    maxTokens: 80,
    messages: [
      { role: 'system', content: LLM_SYSTEM },
      {
        role: 'user',
        content: asked
          ? `The agent was asked to:\n${asked}\n\nIts last output was:\n${extract}`
          : `The agent's last output was:\n${extract}`,
      },
    ],
  });
  return clipLlmReply(response.content, clipFinishSummary);
}

/** How long a settled polish is handed to a second caller instead of asking again. */
const FINISH_POLISH_CACHE_TTL_MS = 30_000;

interface FinishPolishCacheEntry {
  promise: Promise<string | null>;
  /** Null while in flight; stamped the moment it settles, so a caller past the TTL asks fresh. */
  settledAt: number | null;
}

const finishPolishCache = new Map<string, FinishPolishCacheEntry>();

/**
 * One model call per distinct (extract, task, project), shared by every
 * caller that asks for it while it is in flight or within the TTL after it
 * settles. `resolveFinishBody` (the headless-finish notification) and a lane
 * summary's `done`/`failed` polish both reach `resolveFinishSummary` for the
 * very same finish in the same tick — without this, one finish became two
 * identical round trips to the model.
 */
function sharedPolishWithLlm(
  extract: string,
  task: string | undefined,
  projectPath: string
): Promise<string | null> {
  const key = `${extract}|${task ?? ''}|${projectPath}`;
  const now = Date.now();
  const cached = finishPolishCache.get(key);
  if (
    cached &&
    (cached.settledAt === null || now - cached.settledAt < FINISH_POLISH_CACHE_TTL_MS)
  ) {
    return cached.promise;
  }

  const promise = polishWithLlm(extract, task, projectPath);
  const entry: FinishPolishCacheEntry = { promise, settledAt: null };
  finishPolishCache.set(key, entry);
  // A separate derived promise, not the one callers await — it must not
  // surface as an unhandled rejection when the shared call fails.
  promise
    .finally(() => {
      entry.settledAt = Date.now();
    })
    .catch(() => {});
  return promise;
}

/** Test-only: clears the shared polish cache so one test's finish cannot dedupe into another's. */
export function __resetFinishPolishCacheForTests(): void {
  finishPolishCache.clear();
}

/**
 * Extract-then-polish for a finished run, reporting whether the polish
 * landed. `resolveFinishBody` only needs the text; a lane summary
 * (`laneSummary.ts`) also records that as its `source`, and cannot recover it
 * from the resolved text alone if a polish ever echoed the extract verbatim.
 */
export async function resolveFinishSummary(input: {
  logs: string[];
  task?: string;
  llmConfigured: boolean;
  projectPath: string | null;
  llmTimeoutMs?: number;
}): Promise<{ text: string; source: 'llm' | 'extract' } | null> {
  const extract = deriveFinishSummary(input.logs);
  if (!extract) return null;
  if (!input.llmConfigured || !input.projectPath) return { text: extract, source: 'extract' };

  const polished = await withTimeout(
    sharedPolishWithLlm(extract, input.task, input.projectPath),
    input.llmTimeoutMs ?? FINISH_SUMMARY_LLM_TIMEOUT_MS
  );
  return polished ? { text: polished, source: 'llm' } : { text: extract, source: 'extract' };
}

/**
 * Body for the finished-row. The agent's last words are the default; a
 * configured LLM may rewrite them into a glanceable status. Failure or
 * slowness falls back to the extract — the ping that the work ended must
 * not wait on a model.
 */
export async function resolveFinishBody(input: {
  logs: string[];
  task?: string;
  llmConfigured: boolean;
  projectPath: string | null;
  llmTimeoutMs?: number;
}): Promise<string | null> {
  const result = await resolveFinishSummary(input);
  return result?.text ?? null;
}

export async function announceHeadlessFinish(input: {
  agentId: string;
  name: string;
  repoPath?: string | null;
  logs: string[];
  task?: string;
  llmConfigured: boolean;
  projectPath: string | null;
  llmTimeoutMs?: number;
  dispatch?: (payload: NotificationInput) => Promise<unknown> | unknown;
}): Promise<void> {
  if (!input.dispatch) return;
  const body = await resolveFinishBody(input);
  await input.dispatch(
    headlessFinishNotification({
      agentId: input.agentId,
      name: input.name,
      repoPath: input.repoPath,
      body,
    })
  );
}
