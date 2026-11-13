import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLAUDE_SKILL_SOURCE,
  enabledSkillSources,
  loadSkillSources,
  saveSkillSources,
  type SkillSourceRule,
} from './skillSources';

const custom: SkillSourceRule = {
  id: 'my-agent',
  label: 'My Agent',
  commandsDir: '.myagent/prompts',
  extension: 'md',
  enabled: true,
};

describe('skill sources', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts from the Claude convention', () => {
    expect(loadSkillSources()).toEqual([CLAUDE_SKILL_SOURCE]);
  });

  it('round-trips a custom source', () => {
    saveSkillSources([CLAUDE_SKILL_SOURCE, custom]);
    expect(loadSkillSources()).toEqual([CLAUDE_SKILL_SOURCE, custom]);
  });

  it('keeps a disabled source rather than forgetting it', () => {
    saveSkillSources([{ ...CLAUDE_SKILL_SOURCE, enabled: false }]);
    const [loaded] = loadSkillSources();
    expect(loaded.id).toBe('claude');
    expect(loaded.enabled).toBe(false);
  });

  it('falls back to Claude for unreadable storage', () => {
    localStorage.setItem(APP_CONFIG_KEYS.skillSources, '{not json');
    expect(loadSkillSources()).toEqual([CLAUDE_SKILL_SOURCE]);
  });

  it('falls back to Claude when every stored rule lost its shape', () => {
    localStorage.setItem(APP_CONFIG_KEYS.skillSources, JSON.stringify([{ id: 42 }, 'nope']));
    expect(loadSkillSources()).toEqual([CLAUDE_SKILL_SOURCE]);
  });

  it('drops a malformed rule but keeps the sound ones', () => {
    localStorage.setItem(APP_CONFIG_KEYS.skillSources, JSON.stringify([custom, { id: 42 }]));
    expect(loadSkillSources()).toEqual([custom]);
  });

  it('hands the scanner only the enabled sources', () => {
    expect(enabledSkillSources([custom, { ...CLAUDE_SKILL_SOURCE, enabled: false }])).toEqual([
      custom,
    ]);
  });
});
