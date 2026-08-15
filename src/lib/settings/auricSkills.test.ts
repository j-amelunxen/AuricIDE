import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadAuricSkills,
  resolveAuricSkillReference,
  saveAuricSkills,
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
