import { isValidSkip, isVerifiedEvidence } from '@/lib/pm/enums';
import type { PmGoal, PmGoalDependency, PmGoalStation } from '@/lib/tauri/goals';
import { describeDependencyBlock } from '../goals/goalDependencyAdapters';
import { getGoalDescendants } from '../goals/goalTreeHelpers';
import type { GoalAgentPurpose } from './conductorGoalAgents';

export interface ExhaustedGoal {
  goalId: string;
  purpose: GoalAgentPurpose;
  attempts: number;
}

export interface RunBlockerInput {
  /** The satisfaction and dependency lines, as the tick builds them. */
  blockers: string[];
  goals: PmGoal[];
  stations: PmGoalStation[];
  goalDependencies: PmGoalDependency[];
  rootId: string;
  /** Goals the run gave up on because their agent attempts are spent. */
  exhausted: ExhaustedGoal[];
}

/** The line `ownGoalBlockers` writes for a station that still blocks, or null. */
function stationBlockerLine(station: PmGoalStation): string | null {
  if (isValidSkip(station)) return null;
  if (station.status !== 'done') return `Station "${station.name}" is ${station.status}`;
  if (!isVerifiedEvidence(station.evidenceKind))
    return `Station "${station.name}": unverified claim`;
  return null;
}

function exhaustedLine(entry: ExhaustedGoal, goals: PmGoal[], stations: PmGoalStation[]): string {
  const name = goals.find((g) => g.id === entry.goalId)?.name ?? entry.goalId;
  const again = 'Starting the run again gives it fresh attempts.';
  if (entry.purpose === 'plan') {
    return `Goal "${name}" is out of attempts: its planning agent ran ${entry.attempts} times and laid out no work. ${again}`;
  }
  const open = stations
    .filter((s) => s.goalId === entry.goalId && stationBlockerLine(s) !== null)
    .map((s) => `"${s.name}"`);
  const count = `${open.length} station${open.length === 1 ? '' : 's'}`;
  return `Goal "${name}" is out of attempts: its agent ran ${entry.attempts} times and left ${count} open (${open.join(', ')}). ${again}`;
}

/** Removes one occurrence of each line in `drop` from `lines`, keeping order. */
function withoutOnce(lines: string[], drop: string[]): string[] {
  const pending = new Map<string, number>();
  for (const line of drop) pending.set(line, (pending.get(line) ?? 0) + 1);
  return lines.filter((line) => {
    const left = pending.get(line) ?? 0;
    if (left === 0) return true;
    pending.set(line, left - 1);
    return false;
  });
}

/**
 * What an unattended run that ends blocked reports. The satisfaction check
 * lists every open station in the whole tree, so a serial mission whose first
 * goal is stuck reported hundreds of lines, and the one that mattered was
 * somewhere in the middle. Here the goal that ran out of attempts comes
 * first, a goal held by a dependency collapses into one line per blocker —
 * its stations, its sub-goal line and its "waits for" line are consequences
 * of that one blocker — and every other line stays as it was.
 *
 * Station lines are matched by text and dropped once per held station: goals
 * of a generated mission share station names, so the same line can belong to
 * a held goal and to one that really is open.
 */
export function summarizeRunBlockers(input: RunBlockerInput): string[] {
  const { goals, stations, goalDependencies, rootId } = input;
  const inTree = [goals.find((g) => g.id === rootId), ...getGoalDescendants(goals, rootId)].filter(
    (g): g is PmGoal => !!g
  );

  const drop: string[] = [];
  const waitingBy = new Map<string, string[]>();
  for (const g of inTree) {
    const reason = describeDependencyBlock(goals, goalDependencies, g.id);
    if (!reason) continue;
    waitingBy.set(reason, [...(waitingBy.get(reason) ?? []), g.name]);
    drop.push(`Goal "${g.name}" ${reason}`);
    if (g.parentId === rootId) drop.push(`Sub-goal "${g.name}" is ${g.status}, not achieved`);
    for (const s of stations) {
      const line = s.goalId === g.id ? stationBlockerLine(s) : null;
      if (line) drop.push(line);
    }
  }

  const waiting = [...waitingBy].map(([reason, names]) =>
    names.length === 1
      ? `Goal "${names[0]}" ${reason}`
      : `${names.length} goals ${reason.replace(/^waits/, 'wait')}`
  );
  return [
    ...input.exhausted.map((e) => exhaustedLine(e, goals, stations)),
    ...withoutOnce(input.blockers, drop),
    ...waiting,
  ];
}
