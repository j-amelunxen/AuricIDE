import type { AttentionReason } from '../agents/attention';
import { agentAttention, sortByUrgency, withReviewFlags } from '../agents/attention';
import type { GoalLinesInput, LineStation } from './goalLinesLayout';
import { buildGoalLines } from './goalLinesLayout';

/**
 * One entry in the "For you" queue — the single ranked list of everything on
 * the board that needs a human right now. The agent portion reuses the fleet
 * panel's one definition of "needs attention" (attention.ts); this module
 * only adds the board-level reasons agents cannot carry: an approval gate,
 * a line with ready work that nobody is working, and a human station whose
 * agent work before it is done (an unattended agent hands those over and
 * moves on, so they collect here rather than in a terminal nobody reads).
 */
export type ForYouItem =
  | {
      kind: 'agent';
      reason: AttentionReason;
      agentId: string;
      goalId: string | null;
      label: string;
    }
  | { kind: 'approval'; ticketId: string; goalId: string | null; label: string }
  | { kind: 'unclaimed'; goalId: string; label: string }
  | { kind: 'human-station'; stationId: string; goalId: string; label: string };

export interface ForYouInput extends GoalLinesInput {
  reviewedAgentIds: readonly string[];
}

const AGENT_LABEL: Record<AttentionReason, (name: string) => string> = {
  error: (name) => `${name} failed`,
  'needs-input': (name) => `${name} needs input`,
  stalled: (name) => `${name} stalled?`,
};

/**
 * The queue, most urgent first: failures, then prompts, then approvals,
 * unclaimed lines and human stations, then stalls. Stalls rank below the board items on
 * purpose — waiting is normal, silence is a question; an approval is a
 * definite ask.
 */
export function buildForYouQueue(input: ForYouInput): ForYouItem[] {
  const { agents, tickets, reviewedAgentIds, now } = input;

  const ticketGoal = new Map(tickets.map((t) => [t.id, t.goalId ?? null]));
  const goalOfAgent = (agent: {
    spawnedByGoalId?: string;
    spawnedByTicketId?: string;
  }): string | null =>
    agent.spawnedByGoalId ??
    (agent.spawnedByTicketId ? (ticketGoal.get(agent.spawnedByTicketId) ?? null) : null);

  const flagged = withReviewFlags(agents, reviewedAgentIds);
  const urgent = sortByUrgency(flagged, now);
  const agentItems = urgent.map((agent): ForYouItem & { kind: 'agent' } => {
    const reason = agentAttention(agent, now)!;
    return {
      kind: 'agent',
      reason,
      agentId: agent.id,
      goalId: goalOfAgent(agent),
      label: AGENT_LABEL[reason](agent.name),
    };
  });
  const hardAgentItems = agentItems.filter((i) => i.reason !== 'stalled');
  const stalledItems = agentItems.filter((i) => i.reason === 'stalled');

  // Board items derive from the same layout the board draws — the queue can
  // never disagree with the map about what is ready or unclaimed.
  // A goal that already has an agent item is not listed as unclaimed on top:
  // the failure/prompt IS the reason nobody is working it — one problem,
  // one row.
  const goalsWithAgentItems = new Set(
    agentItems.map((i) => i.goalId).filter((id): id is string => id !== null)
  );
  const lines = buildGoalLines(input);
  const approvals: ForYouItem[] = [];
  const unclaimed: ForYouItem[] = [];
  const humanStations: ForYouItem[] = [];
  for (const line of lines) {
    const waiting = humanStationsDue(line.stations);
    for (const station of waiting) {
      humanStations.push({
        kind: 'human-station',
        stationId: station.id,
        goalId: line.goalId,
        label: `"${station.label}" needs you`,
      });
    }
    const readyStations = line.stations.filter(
      (s) => s.state === 'planned' && s.ticketId !== undefined
    );
    for (const station of readyStations) {
      if (station.kind === 'gate') {
        approvals.push({
          kind: 'approval',
          ticketId: station.ticketId!,
          goalId: line.goalId,
          label: `"${station.label}" needs approval`,
        });
      }
    }
    const hasRunningAgent = line.stations.some((s) => s.agentIds.length > 0);
    // A front that only a person can clear is listed above, not as unclaimed.
    const agentFront = line.now !== null && line.now.kind !== 'human';
    const hasReadyWork = readyStations.length > 0 || agentFront;
    if (!hasRunningAgent && hasReadyWork && !goalsWithAgentItems.has(line.goalId)) {
      unclaimed.push({
        kind: 'unclaimed',
        goalId: line.goalId,
        label: `"${line.name}" ready, no agent`,
      });
    }
  }

  return [...hardAgentItems, ...approvals, ...unclaimed, ...humanStations, ...stalledItems];
}

/** Open human stations with no open agent station before them on the line. */
function humanStationsDue(stations: readonly LineStation[]): LineStation[] {
  const due: LineStation[] = [];
  for (const station of stations) {
    if (station.state === 'done' || station.state === 'skipped') continue;
    if (station.kind === 'human') due.push(station);
    else if (station.kind === 'normal') break;
  }
  return due;
}
