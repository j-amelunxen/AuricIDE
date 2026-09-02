import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AURIC_SKILLS_KIND,
  AURIC_SKILLS_SCHEMA_VERSION,
  loadAuricSkills,
  mergeAuricSkills,
  parseAuricSkillsJson,
  resolveAuricSkillReference,
  saveAuricSkills,
  serializeAuricSkills,
  type AuricSkillDefinition,
} from './auricSkills';

const review: AuricSkillDefinition = {
  id: 'review',
  name: 'Code Review',
  description: 'Reviews a change before handoff.',
  prompt: 'Inspect the current change and report concrete findings.',
};

describe('Auric skill library', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
    });
  });

  it('stores prompt skills once at application level', () => {
    saveAuricSkills([review]);
    expect(loadAuricSkills()).toEqual([review]);
  });

  it('ignores malformed stored entries without losing valid skills', () => {
    localStorage.setItem('auric.prompt-skills', JSON.stringify([review, { id: 4, prompt: null }]));
    expect(loadAuricSkills()).toEqual([review]);
  });

  it('resolves a project reference to the latest global name and prompt', () => {
    const resolved = resolveAuricSkillReference(
      {
        id: 'project-preset',
        label: 'Old name',
        prompt: 'Old prompt',
        auricSkillId: review.id,
      },
      [review]
    );

    expect(resolved).toMatchObject({
      label: 'Code Review',
      prompt: 'Inspect the current change and report concrete findings.',
      auricSkillId: 'review',
    });
  });

  it('keeps the project snapshot when its global definition was deleted', () => {
    const snapshot = {
      id: 'project-preset',
      label: 'Code Review',
      prompt: 'Fallback prompt',
      auricSkillId: 'missing',
    };
    expect(resolveAuricSkillReference(snapshot, [])).toEqual(snapshot);
  });
});

describe('Auric skill JSON transfer', () => {
  const review: AuricSkillDefinition = {
    id: 'review',
    name: 'Code Review',
    description: 'Reviews a change before handoff.',
    prompt: 'Inspect the current change and report concrete findings.',
  };
  const ship: AuricSkillDefinition = {
    id: 'ship',
    name: 'Ship it',
    prompt: 'Prepare the change for merge.',
  };

  it('serialises the library as a versioned envelope', () => {
    const parsed: unknown = JSON.parse(serializeAuricSkills([review, ship]));
    expect(parsed).toEqual({
      kind: AURIC_SKILLS_KIND,
      schemaVersion: AURIC_SKILLS_SCHEMA_VERSION,
      skills: [review, ship],
    });
  });

  it('omits blank descriptions and incomplete drafts from the export', () => {
    const parsed: unknown = JSON.parse(
      serializeAuricSkills([
        { ...review, description: '  ' },
        { id: 'draft', name: '', prompt: '' },
      ])
    );
    expect(parsed).toEqual({
      kind: AURIC_SKILLS_KIND,
      schemaVersion: AURIC_SKILLS_SCHEMA_VERSION,
      skills: [{ id: 'review', name: 'Code Review', prompt: review.prompt }],
    });
  });

  it('round-trips a serialised library', () => {
    expect(parseAuricSkillsJson(serializeAuricSkills([review, ship]))).toEqual({
      ok: true,
      skills: [review, ship],
    });
  });

  it('accepts a bare array so a hand-written file still imports', () => {
    expect(parseAuricSkillsJson(JSON.stringify([review]))).toEqual({
      ok: true,
      skills: [review],
    });
  });

  it('accepts a single skill object', () => {
    expect(parseAuricSkillsJson(JSON.stringify(ship))).toEqual({
      ok: true,
      skills: [ship],
    });
  });

  it('rejects invalid JSON', () => {
    const result = parseAuricSkillsJson('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid json/i);
  });

  it('rejects a theme JSON file rather than treating it as one skill', () => {
    const result = parseAuricSkillsJson(
      JSON.stringify({
        schemaVersion: 1,
        id: 'rose',
        name: 'Rose',
        prompt: 'not a skill field that matters',
        tokens: { primary: '#ff4d6d' },
      })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not an auric skills file/i);
  });

  it('rejects an envelope with the wrong kind', () => {
    const result = parseAuricSkillsJson(
      JSON.stringify({ kind: 'theme', schemaVersion: 1, skills: [review] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not an auric skills file/i);
  });

  it('rejects an unsupported schema version', () => {
    const result = parseAuricSkillsJson(
      JSON.stringify({ kind: AURIC_SKILLS_KIND, schemaVersion: 2, skills: [review] })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/schema version/i);
  });

  it('rejects a file whose entries are all malformed', () => {
    const result = parseAuricSkillsJson(JSON.stringify([{ id: 4, prompt: null }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no valid skills/i);
  });

  it('keeps valid skills and drops malformed ones from a mixed file', () => {
    expect(parseAuricSkillsJson(JSON.stringify([review, { id: 4, prompt: null }]))).toEqual({
      ok: true,
      skills: [review],
    });
  });

  it('accepts an empty library envelope', () => {
    expect(
      parseAuricSkillsJson(
        JSON.stringify({
          kind: AURIC_SKILLS_KIND,
          schemaVersion: AURIC_SKILLS_SCHEMA_VERSION,
          skills: [],
        })
      )
    ).toEqual({ ok: true, skills: [] });
  });

  it('strips unknown fields so imported junk is not persisted', () => {
    const result = parseAuricSkillsJson(
      JSON.stringify({ ...review, extra: 'nope', description: '  keep me  ' })
    );
    expect(result).toEqual({
      ok: true,
      skills: [{ ...review, description: 'keep me' }],
    });
  });

  it('merges incoming skills by id: updates matches and appends new ones', () => {
    const updatedReview = { ...review, prompt: 'Be stricter.' };
    expect(mergeAuricSkills([review], [updatedReview, ship])).toEqual({
      skills: [updatedReview, ship],
      added: 1,
      updated: 1,
    });
  });

  it('leaves the current library unchanged when the import is empty', () => {
    expect(mergeAuricSkills([review], [])).toEqual({
      skills: [review],
      added: 0,
      updated: 0,
    });
  });
});
