import { beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import {
  EMPTY_SUPERVISOR_PRESETS,
  loadSupervisorPresets,
  parseSupervisorPresets,
  saveSupervisorPresets,
} from './supervisorPresets';

describe('supervisor presets', () => {
  beforeEach(() => localStorage.clear());

  it('reads nothing as empty, and a broken value as empty', () => {
    expect(parseSupervisorPresets(null)).toEqual(EMPTY_SUPERVISOR_PRESETS);
    expect(parseSupervisorPresets('{not json')).toEqual(EMPTY_SUPERVISOR_PRESETS);
    expect(parseSupervisorPresets('[1,2]')).toEqual(EMPTY_SUPERVISOR_PRESETS);
  });

  it('keeps model and Auric link, drops what Rust decides for a supervisor', () => {
    const parsed = parseSupervisorPresets(
      JSON.stringify({
        skills: [
          {
            id: 'a',
            label: 'Status round',
            prompt: 'Ask every project for its build status',
            model: 'haiku',
            providerId: 'codex',
            permissionMode: 'bypassPermissions',
            auricSkillId: 'lib-1',
          },
          { id: '', label: 'no id', prompt: 'x' },
          { label: 'no id at all', prompt: 'x' },
          'junk',
        ],
        wheelSlots: ['a', null, 7],
      })
    );
    expect(parsed.skills).toEqual([
      {
        id: 'a',
        label: 'Status round',
        prompt: 'Ask every project for its build status',
        model: 'haiku',
        auricSkillId: 'lib-1',
      },
    ]);
    expect(parsed.wheelSlots).toEqual(['a', null, null]);
  });

  it('round-trips through the app preference', () => {
    saveSupervisorPresets({
      skills: [{ id: 's', label: 'Ping', prompt: 'ping', permissionMode: 'acceptEdits' }],
      wheelSlots: ['s'],
    });
    expect(localStorage.getItem(APP_CONFIG_KEYS.supervisorQuickAccess)).not.toContain(
      'acceptEdits'
    );
    expect(loadSupervisorPresets()).toEqual({
      skills: [{ id: 's', label: 'Ping', prompt: 'ping' }],
      wheelSlots: ['s'],
    });
  });
  it('keeps a skill shortcut, and drops a blank one', () => {
    const parsed = parseSupervisorPresets(
      JSON.stringify({
        skills: [
          { id: 'a', label: 'A', prompt: 'a', shortcut: 'Control+Alt+KeyV' },
          { id: 'b', label: 'B', prompt: 'b', shortcut: '  ' },
        ],
      })
    );
    expect(parsed.skills[0].shortcut).toBe('Control+Alt+KeyV');
    expect(parsed.skills[1]).not.toHaveProperty('shortcut');
  });
});
