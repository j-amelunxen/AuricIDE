import { llmCall } from '../tauri/llm';
import type { LaneSummary } from '../store/laneSummariesSlice';
import { detectAwaitingInput, PROMPT_PATTERNS } from './awaitingInput';
import { clipLlmReply, resolveFinishSummary, withTimeout } from './headlessFinish';
import { promptTailLines } from './permissionMenu';

/** How long we wait on a configured LLM before using the extracted question. */
const LANE_SUMMARY_LLM_TIMEOUT_MS = 4_000;

/** Longest an ask summary may be — the lane rail shows it inline, not wrapped. */
const MAX_ASK_SUMMARY_CHARS = 160;

/** How many trailing lines to scan — wide enough to contain a whole permission menu. */
const ASK_TAIL_LINES = 10;

/** "❯ 1. Yes", "  2. No" — a menu option line, never the question itself. */
const MENU_OPTION_LINE = /^❯?\s*\d+\.\s+/;

const ASK_SYSTEM =
  'In one sentence, what is the agent asking the user to decide? No preamble, no quotes, no markdown.';

function clipAskSummary(text: string): string {
  if (text.length <= MAX_ASK_SUMMARY_CHARS) return text;
  const slice = text.slice(0, MAX_ASK_SUMMARY_CHARS);
  const lastStop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf(' '));
  const trimmed = lastStop > MAX_ASK_SUMMARY_CHARS * 0.4 ? slice.slice(0, lastStop) : slice;
  return `${trimmed.replace(/[\s,;:.-]+$/, '')}…`;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return i;
  }
  return -1;
}

/**
 * What a running agent is asking about, read out of its output tail: the
 * line matching one of `detectAwaitingInput`'s prompt patterns, plus — when
 * one sits right above it — the line it's about (a tool call, or a menu's
 * title line). Menu option rows ("1. Yes") are excluded so the summary never
 * repeats the choices already on screen.
 *
 * A bare numbered menu ("❯ 1. Yes / 2. No") with no prose question above it
 * is itself one of those patterns (`detectAwaitingInput`'s third one), and
 * stripping option rows before searching removes the very line that matched
 * — so the search below can legitimately come up empty even though the tail
 * is a real prompt. That case falls back to naming the line the menu is
 * about ("Permission: <line>") rather than going quiet. True null is
 * reserved for a tail with no prompt signal at all.
 *
 * Detection and extraction do not read identical windows —
 * `detectAwaitingInput` scans the last 5 clean lines, this scans the last
 * `ASK_TAIL_LINES` — so a caller checking on its own, well outside the
 * moment `awaitingInput` actually turned true, can still see null for a
 * question that has since scrolled out of this wider window too.
 */
export function extractAskSummary(chunks: string[]): string | null {
  const lines = promptTailLines(chunks, ASK_TAIL_LINES);
  const menuFreeLines = lines.filter((line) => !MENU_OPTION_LINE.test(line));

  const questionIndex = findLastIndex(menuFreeLines, (line) =>
    PROMPT_PATTERNS.some((pattern) => pattern.test(line))
  );
  if (questionIndex !== -1) {
    const question = menuFreeLines[questionIndex];
    const about = questionIndex > 0 ? menuFreeLines[questionIndex - 1] : null;
    const combined = about ? `${about}: ${question}` : question;
    return clipAskSummary(combined.replace(/\s+/g, ' ').trim());
  }

  if (menuFreeLines.length === 0 || !detectAwaitingInput(chunks)) return null;
  const context = menuFreeLines[menuFreeLines.length - 1];
  return clipAskSummary(`Permission: ${context}`.replace(/\s+/g, ' ').trim());
}

async function polishAskWithLlm(extract: string, projectPath: string): Promise<string | null> {
  const response = await llmCall({
    projectPath,
    temperature: 0.2,
    maxTokens: 60,
    messages: [
      { role: 'system', content: ASK_SYSTEM },
      { role: 'user', content: extract },
    ],
  });
  return clipLlmReply(response.content, clipAskSummary);
}

/**
 * One lane summary for the console rail — the extract shown immediately, an
 * LLM's polish of it if `llmConfigured` and the model answers within the
 * timeout. Never throws: a failing or slow LLM leaves the extract standing.
 * Null only when there is nothing to say (no question in the tail for `ask`;
 * no readable output for `done`/`failed`).
 */
export async function resolveLaneSummary(input: {
  kind: 'ask' | 'done' | 'failed';
  logs: string[];
  task?: string;
  llmConfigured: boolean;
  projectPath: string | null;
  timeoutMs?: number;
  /**
   * A caller that already derived the extract for this transition (to show
   * it immediately, ahead of the polish below) may pass it here instead of
   * having it derived again from `logs`.
   */
  extract?: string;
}): Promise<LaneSummary | null> {
  if (input.kind === 'ask') {
    const extract = input.extract ?? extractAskSummary(input.logs);
    if (!extract) return null;
    if (!input.llmConfigured || !input.projectPath) {
      return { kind: 'ask', text: extract, at: Date.now(), source: 'extract' };
    }

    const polished = await withTimeout(
      polishAskWithLlm(extract, input.projectPath),
      input.timeoutMs ?? LANE_SUMMARY_LLM_TIMEOUT_MS
    );
    return {
      kind: 'ask',
      text: polished ?? extract,
      at: Date.now(),
      source: polished ? 'llm' : 'extract',
    };
  }

  const result = await resolveFinishSummary({
    logs: input.logs,
    task: input.task,
    llmConfigured: input.llmConfigured,
    projectPath: input.projectPath,
    llmTimeoutMs: input.timeoutMs,
    extract: input.extract,
  });
  if (!result) return null;
  return { kind: input.kind, text: result.text, at: Date.now(), source: result.source };
}
