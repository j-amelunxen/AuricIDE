import type { PmGoal } from '@/lib/tauri/goals';

/**
 * How much of a goal's description travels inside an agent prompt. The prompt
 * is an orientation, not the source: the agent is told to read the whole goal
 * through get_goal, so a long description costs context on every turn and
 * buys nothing.
 */
export const DESCRIPTION_EXCERPT_CHARS = 400;

/** Success criteria get more room: they are what the agent is judged by. */
export const CRITERIA_EXCERPT_CHARS = 600;

/** Below this share of the limit, a word boundary is too far back to cut at. */
const MIN_WORD_CUT_SHARE = 0.8;

export interface Excerpt {
  text: string;
  truncated: boolean;
}

/** Trims `raw` to at most `limit` characters, preferring a word boundary. */
export function excerpt(raw: string, limit: number): Excerpt {
  const text = raw.trim();
  if (text.length <= limit) return { text, truncated: false };
  const hard = text.slice(0, limit);
  const lastSpace = hard.search(/\s\S*$/);
  const cut = lastSpace >= limit * MIN_WORD_CUT_SHARE ? hard.slice(0, lastSpace) : hard;
  return { text: `${cut.trimEnd()}…`, truncated: true };
}

/** The one line that sends an agent to the full goal before it starts. */
export function readFullGoalLine(goalId: string): string {
  return (
    `Before you do anything else, call get_goal (id: "${goalId}") once and read the whole ` +
    'goal: description, success criteria and goal prompt. What follows here is only a short ' +
    'excerpt and may be cut off. Where it and get_goal disagree, get_goal is right.'
  );
}

function excerptSection(title: string, raw: string, limit: number, cutLabel: string): string {
  const total = raw.trim().length;
  const { text, truncated } = excerpt(raw, limit);
  const marker = truncated
    ? `${cutLabel}: first ${limit} of ${total} characters, the rest is in get_goal`
    : 'complete';
  return `## ${title} (${marker})\n${text}`;
}

/**
 * The goal as an agent prompt carries it: the instruction to read the full goal
 * first, then a marked excerpt of the description and the success criteria.
 * A description identical to the goal prompt is left out, since the prompt is
 * already in front of the agent.
 */
export function goalBriefSections(goal: PmGoal): string[] {
  const sections = [`## Read the full goal first\n${readFullGoalLine(goal.id)}`];
  const description = goal.description.trim();
  if (description && description !== goal.goalPrompt.trim()) {
    sections.push(excerptSection('Description', description, DESCRIPTION_EXCERPT_CHARS, 'excerpt'));
  }
  if (goal.successCriteria.trim()) {
    sections.push(
      excerptSection('Success criteria', goal.successCriteria, CRITERIA_EXCERPT_CHARS, 'truncated')
    );
  }
  return sections;
}
