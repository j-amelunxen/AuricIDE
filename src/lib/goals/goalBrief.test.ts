import { describe, expect, it } from 'vitest';
import type { PmGoal } from '@/lib/tauri/goals';
import {
  CRITERIA_EXCERPT_CHARS,
  DESCRIPTION_EXCERPT_CHARS,
  excerpt,
  goalBriefSections,
  readFullGoalLine,
} from './goalBrief';

function makeGoal(overrides: Partial<PmGoal> = {}): PmGoal {
  return {
    id: 'g1',
    parentId: null,
    name: 'Ship orchestration',
    description: 'The orchestration layer works end to end',
    successCriteria: '- conductor completes a goal',
    status: 'active',
    priority: 'high',
    goalPrompt: '',
    createdBy: 'ui',
    achievedAt: null,
    sortOrder: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(' ');

describe('excerpt', () => {
  it('keeps text within the limit whole', () => {
    expect(excerpt('short text', 400)).toEqual({ text: 'short text', truncated: false });
  });

  it('cuts at a word boundary and ends with an ellipsis', () => {
    const { text, truncated } = excerpt(words(200), 100);
    expect(truncated).toBe(true);
    expect(text.endsWith('…')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(101);
    expect(text.slice(0, -1)).toMatch(/word\d+$/);
  });

  it('cuts hard when the text has no space near the limit', () => {
    const { text } = excerpt('x'.repeat(500), 100);
    expect(text).toBe(`${'x'.repeat(100)}…`);
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(excerpt('  padded  ', 6)).toEqual({ text: 'padded', truncated: false });
  });
});

describe('readFullGoalLine', () => {
  it('tells the agent to fetch the whole goal once by its id before anything else', () => {
    const line = readFullGoalLine('g-7');
    expect(line).toContain('get_goal (id: "g-7")');
    expect(line).toContain('Before you do anything else');
    expect(line).toContain('whole goal');
  });
});

describe('goalBriefSections', () => {
  it('opens with the read-the-full-goal instruction', () => {
    const [first] = goalBriefSections(makeGoal({ id: 'g-7' }));
    expect(first).toContain('## Read the full goal first');
    expect(first).toContain('get_goal (id: "g-7")');
  });

  it('marks a short description and short criteria as complete', () => {
    const brief = goalBriefSections(makeGoal()).join('\n\n');
    expect(brief).toContain('## Description (complete)\nThe orchestration layer works end to end');
    expect(brief).toContain('## Success criteria (complete)\n- conductor completes a goal');
  });

  it('cuts a long description and says how much is missing', () => {
    const description = words(300);
    const brief = goalBriefSections(makeGoal({ description })).join('\n\n');
    expect(brief).toContain(
      `## Description (excerpt: first ${DESCRIPTION_EXCERPT_CHARS} of ${description.length} characters, the rest is in get_goal)`
    );
    expect(brief).not.toContain(description);
  });

  it('cuts long success criteria and marks them as truncated', () => {
    const successCriteria = words(400);
    const brief = goalBriefSections(makeGoal({ successCriteria })).join('\n\n');
    expect(brief).toContain(
      `## Success criteria (truncated: first ${CRITERIA_EXCERPT_CHARS} of ${successCriteria.length} characters, the rest is in get_goal)`
    );
    expect(brief).not.toContain(successCriteria);
  });

  it('omits empty description and criteria but keeps the instruction', () => {
    const sections = goalBriefSections(makeGoal({ description: ' ', successCriteria: '' }));
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain('get_goal');
  });

  it('does not repeat a description that the goal prompt already carries', () => {
    const text = 'Same words in both fields';
    const brief = goalBriefSections(makeGoal({ description: text, goalPrompt: `${text}\n` }));
    expect(brief.join('\n\n')).not.toContain('## Description');
  });
});
