import type { AgentInfo } from '../../tauri/agents';
import type { SentMessage } from '../../store/agentSlice';
import type { PersistedAgentEvent } from '../../tauri/agentLog';
import type { StreamLine } from './streamCapture';
import type { AgentEvent, AgentEventKind } from './types';

export interface FeedEntry extends AgentEvent {
  agentId: string;
}

/** One agent's output line, placed in the merged stream. */
export interface StreamFeedEntry extends StreamLine {
  agentId: string;
}

/**
 * One row of the activity feed as it is displayed.
 *
 * Carries the agent's name and repo rather than only its id, because the feed
 * has two sources and only one of them can look an id up: live events resolve
 * against the running `agents` array, while stored history routinely comes
 * from agents that have since exited. Resolving identity at merge time is what
 * lets both sit in one list — a row built the other way round would simply not
 * render once its agent was gone.
 */
export interface FeedRow {
  agentId: string;
  agentName: string;
  repoPath?: string;
  kind: AgentEventKind | 'sent';
  label: string;
  path?: string;
  at: number;
  seq?: number;
}

/**
 * Identity of a single row, for reconciling the live and stored copies.
 *
 * A `sent` row's seq comes from its own per-agent counter (see
 * `SentMessage`), which starts at 0 just like `AgentEvent.seq` — so a sent
 * message and an unrelated stored event can legitimately land on the same
 * `(agentId, at, seq)` triple. Prefixing the seq for `sent` rows keeps that
 * pairing from colliding with an event's key, which would otherwise make
 * `mergeFeedRows` mistake the real event for a duplicate of the message and
 * drop it.
 */
function rowKey(row: { agentId: string; at: number; seq?: number; kind?: string }): string {
  const seqPart = row.kind === 'sent' ? `s${row.seq ?? 0}` : `${row.seq ?? 0}`;
  return `${row.agentId}|${row.at}|${seqPart}`;
}

/** Live events, resolved against the running fleet into displayable rows. */
export function toFeedRows(
  agentEvents: Record<string, AgentEvent[]>,
  agents: AgentInfo[]
): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const agent of agents) {
    for (const event of agentEvents[agent.id] ?? []) {
      rows.push({
        agentId: agent.id,
        // An agent whose name has not landed yet still has to be identifiable.
        agentName: agent.name || agent.id,
        repoPath: agent.repoPath,
        kind: event.kind,
        label: event.label,
        path: event.path,
        at: event.at,
        seq: event.seq,
      });
    }
  }
  return rows;
}

/** A user's own messages to a running agent, resolved into displayable rows. */
export function toSentFeedRows(
  sent: Record<string, SentMessage[]>,
  agents: AgentInfo[]
): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const agent of agents) {
    for (const message of sent[agent.id] ?? []) {
      rows.push({
        agentId: agent.id,
        agentName: agent.name || agent.id,
        repoPath: agent.repoPath,
        kind: 'sent',
        label: message.text,
        at: message.at,
        seq: message.seq,
      });
    }
  }
  return rows;
}

/**
 * The activity feed's two sources in one list, newest first.
 *
 * Everything live was also written to disk, so the two overlap by design; the
 * live copy wins, because it is the one whose agent is still around to be
 * acted on. Deduplicating on (agent, timestamp, seq) rather than on the label
 * matters: an agent legitimately repeats an action, and collapsing those would
 * hide real work.
 */
export function mergeFeedRows(
  live: FeedRow[],
  history: PersistedAgentEvent[],
  limit = 1_000
): FeedRow[] {
  const seen = new Set(live.map(rowKey));
  const rows = [...live];
  for (const stored of history) {
    if (seen.has(rowKey(stored))) continue;
    seen.add(rowKey(stored));
    rows.push({
      agentId: stored.agentId,
      agentName: stored.agentName,
      repoPath: stored.repoPath,
      // Stored history is always a real event — 'sent' rows are session-only
      // and never written to disk.
      kind: stored.kind as AgentEventKind,
      label: stored.label,
      path: stored.path,
      at: stored.at,
      seq: stored.seq,
    });
  }
  return rows.sort(newestFirst).slice(0, limit);
}

/**
 * Newest first, `at` then `seq` — the identical ordering rule
 * `mergeActivityFeed` uses, so switching the console's feed between its
 * curated and raw modes never reorders the same moment differently.
 */
function newestFirst(a: { at: number; seq?: number }, b: { at: number; seq?: number }): number {
  return b.at - a.at || (b.seq ?? 0) - (a.seq ?? 0);
}

/**
 * Every tracked agent's events interleaved into one feed, newest first. Two
 * events commonly share the same `at` (one PTY chunk, several matches) — for
 * those, `seq` (monotonic per agent) breaks the tie so the later of the two
 * still sorts above the earlier one. Once both `at` and `seq` tie (only
 * possible across two different agents), the order agents appear in `agents`
 * decides it — `Array.prototype.sort` is a stable sort, so that ordering
 * falls out of build order rather than needing a further tiebreaker.
 */
export function mergeActivityFeed(
  agentEvents: Record<string, AgentEvent[]>,
  agents: AgentInfo[],
  limit = 200
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const agent of agents) {
    for (const event of agentEvents[agent.id] ?? []) {
      entries.push({ ...event, agentId: agent.id });
    }
  }
  return entries.sort(newestFirst).slice(0, limit);
}

/**
 * Every tracked agent's readable output interleaved into one stream, newest
 * first — the feed's "All output" mode.
 *
 * The counterpart to `mergeActivityFeed`: that one shows what agents *did*
 * and holds only lines a provider matcher recognised, which is why it reads
 * as incomplete. This one shows what they *said*, with only redraw chrome
 * and consecutive repeats already dropped upstream.
 */
export function mergeStreamFeed(
  agentStreamLines: Record<string, StreamLine[]>,
  agents: AgentInfo[],
  limit = 1_000
): StreamFeedEntry[] {
  const entries: StreamFeedEntry[] = [];
  for (const agent of agents) {
    for (const line of agentStreamLines[agent.id] ?? []) {
      entries.push({ ...line, agentId: agent.id });
    }
  }
  return entries.sort(newestFirst).slice(0, limit);
}
