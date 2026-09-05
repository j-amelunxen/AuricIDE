import type { AgentInfo } from '../tauri/agents';
import type { AgentColor } from './colors';
import { describeRightNow } from './consoleActivity';
import {
  consoleAgentState,
  consoleStateLabel,
  CONSOLE_STATE_RANK,
  type ConsoleAgentState,
} from './consoleState';
import { formatAgentDuration } from './duration';
import type { FeedRow } from './events/feed';
import type { AgentEvent, AgentEventKind } from './events/types';
import { agentMonogram } from './naming';
import { streamColorFor } from './streamColors';

/**
 * How much visual weight a feed row gets — the console's message hierarchy.
 * A question shouts, an outcome is a headline, prose reads like a message, a
 * tool call is a quiet system line, and the user's own send is the one
 * bubble.
 */
export type FeedTier = 'mention' | 'outcome' | 'prose' | 'system' | 'you';

const TIER_BY_KIND: Record<AgentEventKind | 'sent', FeedTier> = {
  ask: 'mention',
  done: 'outcome',
  error: 'outcome',
  note: 'prose',
  read: 'system',
  edit: 'system',
  run: 'system',
  sent: 'you',
};

export function feedTier(kind: AgentEventKind | 'sent'): FeedTier {
  return TIER_BY_KIND[kind];
}

/**
 * A run of consecutive same-sender rows re-headers itself after this much
 * silence, so a header reappears once the conversation has clearly moved on
 * rather than staying attached to a run from long ago.
 */
export const SENDER_RUN_MAX_GAP_MS = 5 * 60_000;

/** One sender's consecutive rows in the oldest-first feed, under one header. */
export interface FeedGroup {
  agentId: string;
  agentName: string;
  repoPath?: string;
  /** The first row's timestamp — when this run of activity began. */
  at: number;
  rows: FeedRow[];
}

/**
 * A new array, sorted oldest first — the inverse of `feed.ts`'s
 * `newestFirst`. Returns a fresh array rather than sorting in place: the
 * feed keeps its own newest-first copy for the merge step, and this view is
 * derived from it on every render.
 */
export function oldestFirst<T extends { at: number; seq?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.at - b.at || (a.seq ?? 0) - (b.seq ?? 0));
}

/**
 * Collapses an oldest-first feed into sender runs: consecutive rows from the
 * same agent share one header. A run also breaks after
 * `SENDER_RUN_MAX_GAP_MS` of silence, so a header reappears once a pause
 * makes the earlier one feel stale, even if nobody else spoke in between.
 */
export function groupBySender(rowsOldestFirst: FeedRow[]): FeedGroup[] {
  const groups: FeedGroup[] = [];
  for (const row of rowsOldestFirst) {
    const current = groups[groups.length - 1];
    const lastRow = current?.rows[current.rows.length - 1];
    const continuesRun =
      current !== undefined &&
      current.agentId === row.agentId &&
      lastRow !== undefined &&
      row.at - lastRow.at <= SENDER_RUN_MAX_GAP_MS;

    if (continuesRun && current) {
      current.rows.push(row);
    } else {
      groups.push({
        agentId: row.agentId,
        agentName: row.agentName,
        repoPath: row.repoPath,
        at: row.at,
        rows: [row],
      });
    }
  }
  return groups;
}

/**
 * Whether a row survives a muted lane's fold into the All-lanes feed. An
 * unmuted lane shows everything; a muted one still lets through what a human
 * cannot afford to miss — a question aimed at them, and how the run ended.
 */
export function isVisibleUnderMute(row: FeedRow, mutedAgentIds: readonly string[]): boolean {
  if (!mutedAgentIds.includes(row.agentId)) return true;
  const tier = feedTier(row.kind);
  return tier === 'mention' || tier === 'outcome';
}

/**
 * How many of an agent's events are unread. No seen mark at all means the
 * lane has never been opened, so everything counts.
 */
export function laneUnread(events: readonly AgentEvent[], seenAt: number | undefined): number {
  if (seenAt === undefined) return events.length;
  return events.filter((event) => event.at > seenAt).length;
}

/** One agent's row in the console's lane rail — its live summary. */
export interface Lane {
  agentId: string;
  agentName: string;
  repoPath?: string;
  projectLabel: string;
  monogram: string;
  color: string;
  state: ConsoleAgentState;
  phaseLabel: string;
  rightNow: string;
  unread: number;
  hasQuestion: boolean;
  muted: boolean;
  running: boolean;
}

/** Bucket agents with no repo path fall into, matching the rest of the fleet UI. */
const UNKNOWN_PROJECT_LABEL = 'Unknown';

/** The rail's lanes, one per tracked agent, sorted most actionable first. */
export function buildLanes(input: {
  agents: AgentInfo[];
  agentEvents: Record<string, AgentEvent[]>;
  agentColors: Record<string, AgentColor>;
  reviewedAgentIds: readonly string[];
  mutedAgentIds: readonly string[];
  laneSeenAt: Record<string, number>;
  now: number;
}): Lane[] {
  const { agents, agentEvents, agentColors, reviewedAgentIds, mutedAgentIds, laneSeenAt, now } =
    input;

  const lanes = agents.map((agent) => {
    const events = agentEvents[agent.id] ?? [];
    const reviewed = reviewedAgentIds.includes(agent.id);
    const state = consoleAgentState(agent, reviewed, now);
    const lastEvent = events[events.length - 1];
    const quietFor =
      agent.lastActivityAt !== undefined
        ? formatAgentDuration(now - agent.lastActivityAt)
        : undefined;

    const lane: Lane = {
      agentId: agent.id,
      agentName: agent.name || agent.id,
      repoPath: agent.repoPath,
      projectLabel: agent.repoPath?.split('/').pop() || UNKNOWN_PROJECT_LABEL,
      monogram: agentMonogram(agent.name),
      color: streamColorFor(agent.id, agentColors[agent.id]),
      state,
      phaseLabel: consoleStateLabel(state, reviewed),
      rightNow: describeRightNow({
        state,
        lastEvent,
        currentActivity: agent.currentActivity,
        quietFor,
      }),
      unread: laneUnread(events, laneSeenAt[agent.id]),
      hasQuestion: state === 'yours',
      muted: mutedAgentIds.includes(agent.id),
      running: agent.status === 'running',
    };
    return lane;
  });

  return lanes.sort(
    (a, b) =>
      CONSOLE_STATE_RANK[a.state] - CONSOLE_STATE_RANK[b.state] ||
      a.agentName.localeCompare(b.agentName)
  );
}

/** How close to the bottom counts as "close enough to keep following". */
export const FOLLOW_SLACK_PX = 24;

/**
 * Whether a scrolled pane is close enough to its bottom that new rows should
 * keep it pinned there. Follow is a range rather than an exact match: a pane
 * whose content just grew by a pixel of padding must not read as "scrolled
 * away" the moment a fresh row lands.
 */
export function isNearBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number
): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= FOLLOW_SLACK_PX;
}
