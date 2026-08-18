import { describe, expect, it } from 'vitest';
import { normalizeTicketSkills, prependTicketSkills, ticketSkillPrefix } from './ticketSkills';

describe('normalizeTicketSkills', () => {
  it('drops blanks, trims, and keeps first-seen order', () => {
    expect(normalizeTicketSkills([' /tdd ', '', '/review', '/tdd', '  '])).toEqual([
      '/tdd',
      '/review',
    ]);
  });

  it('adds a leading slash when one is missing', () => {
    expect(normalizeTicketSkills(['tdd', '/review'])).toEqual(['/tdd', '/review']);
  });

  it('treats missing or empty input as no skills', () => {
    expect(normalizeTicketSkills(undefined)).toEqual([]);
    expect(normalizeTicketSkills([])).toEqual([]);
  });
});

describe('ticketSkillPrefix', () => {
  it('joins invocations in one slash-prefixed line', () => {
    expect(ticketSkillPrefix(['/tdd', '/review'])).toBe('/tdd /review');
  });

  it('is empty when nothing is attached', () => {
    expect(ticketSkillPrefix(undefined)).toBe('');
  });
});

describe('prependTicketSkills', () => {
  it('writes the skills in front of the prompt, then a blank line', () => {
    expect(prependTicketSkills(['/tdd', '/review'], 'Implement login')).toBe(
      '/tdd /review\n\nImplement login'
    );
  });

  it('leaves the prompt alone when no skills are attached', () => {
    expect(prependTicketSkills([], 'Implement login')).toBe('Implement login');
    expect(prependTicketSkills(undefined, 'Implement login')).toBe('Implement login');
  });

  it('does not write the same prefix twice', () => {
    const once = prependTicketSkills(['/tdd'], 'Implement login');
    expect(prependTicketSkills(['/tdd'], once)).toBe(once);
  });

  it('sits in front of an existing /goal invocation', () => {
    expect(prependTicketSkills(['/tdd'], '/goal\n\n# Task: login')).toBe(
      '/tdd\n\n/goal\n\n# Task: login'
    );
  });
});
