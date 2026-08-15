/**
 * A structured event distilled from an agent's raw PTY output — one entry per
 * tool call, permission prompt, or notable line. This is what turns a wall of
 * terminal text into a feed, a "files touched" list, and a phase.
 */
export type AgentEventKind = 'read' | 'edit' | 'run' | 'ask' | 'done' | 'error' | 'note';

export interface AgentEvent {
  kind: AgentEventKind;
  /**
   * One-line, human-readable, already prefixed with the verb, e.g.
   * "Edited src/x.ts", "Ran pnpm lint", "Permission requested: Bash(pnpm test)".
   */
  label: string;
  /** File path when the event concerns exactly one file (read/edit). */
  path?: string;
  at: number;
  /**
   * Monotonically increasing per extractor instance (i.e. per agent),
   * starting at 0. The tiebreaker for two events stamped with the same `at`
   * — a single PTY chunk commonly produces more than one — so a newest-first
   * feed doesn't reorder same-chunk events chronologically backwards.
   * Optional so hand-built events (mocks, other call sites) stay valid;
   * `createEventExtractor` always sets a real one.
   */
  seq?: number;
}

/**
 * Where an agent is in its work, distilled for a fleet-wide glance. Derived
 * from status, the awaiting-input flag and the newest event — see
 * `deriveAgentPhase`.
 */
export type AgentPhase =
  'starting' | 'reading' | 'planning' | 'editing' | 'running' | 'waiting' | 'done' | 'failed';
