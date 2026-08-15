import type { AgentEvent } from '../types';
import { extractPath, truncateLabel } from './shared';
import type { LineMatcher } from './index';

/** `⏺ Read(src/lib/example.ts)`, `⏺ Bash(pnpm lint)`, … — the TUI's tool-call line. */
const TOOL_LINE =
  /^⏺\s+(Read|Write|Update|Edit|Create|Bash|Glob|Grep|Search|Task|WebFetch)\((.*)\)\s*$/;

/** `⎿  Updated 3 lines`, `⎿  Error: …` — the result line under a tool call. */
const RESULT_LINE = /^⎿\s*(.*)$/;

/** A generic `⏺` line with prose instead of a `Tool(arg)` call. */
const NOTE_LINE = /^⏺\s+(.+)$/;

const RESULT_FAILURE = /\berror\b|\bfailed\b/i;

const ASK_PATTERNS = [
  /\bdo you want to\b.*\?/i, // "Do you want to proceed?" / "…make this edit…?"
  /^❯?\s*\d+\.\s+(yes|no)\b/i, // "❯ 1. Yes" selection menus
];

const EDIT_TOOLS = new Set(['Write', 'Update', 'Edit', 'Create']);
const SEARCH_TOOLS = new Set(['Glob', 'Grep', 'Search']);

function eventForToolLine(name: string, arg: string): Omit<AgentEvent, 'at'> {
  if (name === 'Read') {
    const path = extractPath(arg) ?? arg.trim();
    return { kind: 'read', label: `Read ${path}`, path };
  }
  if (EDIT_TOOLS.has(name)) {
    const path = extractPath(arg) ?? arg.trim();
    return { kind: 'edit', label: `Edited ${path}`, path };
  }
  if (name === 'Bash') {
    return { kind: 'run', label: `Ran ${arg.trim()}` };
  }
  if (SEARCH_TOOLS.has(name)) {
    return { kind: 'read', label: `Searched ${arg.trim()}` };
  }
  if (name === 'Task') {
    return { kind: 'run', label: `Started task: ${arg.trim()}` };
  }
  // WebFetch
  return { kind: 'read', label: `Fetched ${arg.trim()}` };
}

/**
 * Claude Code's TUI has one wrinkle a stateless matcher can't handle alone: a
 * permission menu ("Do you want to proceed?") names the file or command it is
 * asking about nowhere on its own lines — that context is the tool-call line
 * printed just above it. So this matcher is a small factory holding exactly
 * that one piece of memory, created fresh per agent by `resolveMatcher`.
 */
export function createClaudeMatcher(): LineMatcher {
  let lastToolCall: string | null = null;

  return (line: string): Omit<AgentEvent, 'at'> | null => {
    if (ASK_PATTERNS.some((pattern) => pattern.test(line))) {
      const question = line.trim();
      return {
        kind: 'ask',
        label: `Permission requested: ${lastToolCall ?? question}`,
      };
    }

    const tool = TOOL_LINE.exec(line);
    if (tool) {
      const [, name, arg] = tool;
      lastToolCall = `${name}(${arg})`;
      return eventForToolLine(name, arg);
    }

    const result = RESULT_LINE.exec(line);
    if (result) {
      const body = result[1].trim();
      if (RESULT_FAILURE.test(body)) {
        return { kind: 'error', label: body || 'Failed' };
      }
      return null;
    }

    const note = NOTE_LINE.exec(line);
    if (note) {
      const prose = note[1].trim();
      if (/\p{L}/u.test(prose)) {
        return { kind: 'note', label: truncateLabel(prose) };
      }
      return null;
    }

    return null;
  };
}
