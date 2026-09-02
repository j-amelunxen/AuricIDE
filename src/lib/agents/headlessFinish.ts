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

function clipLlm(content: string): string | null {
  let text = content.trim();
  text = text
    .replace(/^```(?:\w+)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
  text = text.replace(/^["“]|["”]$/gu, '').trim();
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return clipFinishSummary(text);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
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
  return clipLlm(response.content);
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
  const extract = deriveFinishSummary(input.logs);
  if (!extract) return null;
  if (!input.llmConfigured || !input.projectPath) return extract;

  const polished = await withTimeout(
    polishWithLlm(extract, input.task, input.projectPath),
    input.llmTimeoutMs ?? FINISH_SUMMARY_LLM_TIMEOUT_MS
  );
  return polished ?? extract;
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
