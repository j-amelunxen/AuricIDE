import { describe, it, expect, beforeEach } from 'vitest';
import {
  supervisorProvidersOf,
  readSupervisorInstructions,
  readAllSupervisorInstructions,
  writeSupervisorInstructions,
} from './supervisorProviders';
import { APP_CONFIG_KEYS, writeAppPref, removeAppPref } from './appConfig';
import { emptySupervisorPolicy, type SupervisorPolicy } from './supervisorPolicy';

describe('supervisorProviders', () => {
  beforeEach(() => {
    removeAppPref(APP_CONFIG_KEYS.supervisorInstructions);
  });

  describe('supervisorProvidersOf', () => {
    it('returns ["claude"] by default when providers is undefined or empty', () => {
      const policy = emptySupervisorPolicy();
      expect(supervisorProvidersOf(policy)).toEqual(['claude']);
    });

    it('returns custom provider when providers is empty but provider is set', () => {
      const policy: SupervisorPolicy = {
        ...emptySupervisorPolicy(),
        supervisor: { provider: 'codex', model: null, chrome: false },
      };
      expect(supervisorProvidersOf(policy)).toEqual(['codex']);
    });

    it('returns list of providers when supervisor.providers is specified', () => {
      const policy: SupervisorPolicy = {
        ...emptySupervisorPolicy(),
        supervisor: {
          provider: 'claude',
          providers: ['claude', 'codex'],
          model: null,
          chrome: false,
        },
      };
      expect(supervisorProvidersOf(policy)).toEqual(['claude', 'codex']);
    });

    it('filters blanks and deduplicates', () => {
      const policy: SupervisorPolicy = {
        ...emptySupervisorPolicy(),
        supervisor: {
          provider: 'claude',
          providers: ['claude', 'codex', 'claude', '  ', ''],
          model: null,
          chrome: false,
        },
      };
      expect(supervisorProvidersOf(policy)).toEqual(['claude', 'codex']);
    });
  });

  describe('read and write supervisor instructions', () => {
    it('returns empty string when no preference is stored', () => {
      expect(readSupervisorInstructions()).toBe('');
      expect(readSupervisorInstructions('claude')).toBe('');
      expect(readSupervisorInstructions('codex')).toBe('');
      expect(readAllSupervisorInstructions()).toEqual({});
    });

    it('handles legacy plain text as claude instructions', () => {
      writeAppPref(APP_CONFIG_KEYS.supervisorInstructions, 'Browser only via Claude in Chrome');
      expect(readSupervisorInstructions('claude')).toBe('Browser only via Claude in Chrome');
      expect(readSupervisorInstructions()).toBe('Browser only via Claude in Chrome');
      expect(readSupervisorInstructions('codex')).toBe('');
      expect(readAllSupervisorInstructions()).toEqual({
        claude: 'Browser only via Claude in Chrome',
      });
    });

    it('reads and writes per-provider instructions as JSON map', () => {
      writeSupervisorInstructions({
        claude: 'Instructions for Claude',
        codex: 'Instructions for Codex',
      });
      expect(readSupervisorInstructions('claude')).toBe('Instructions for Claude');
      expect(readSupervisorInstructions('codex')).toBe('Instructions for Codex');
      expect(readAllSupervisorInstructions()).toEqual({
        claude: 'Instructions for Claude',
        codex: 'Instructions for Codex',
      });
    });

    it('updates single provider instructions with string overload', () => {
      writeSupervisorInstructions('Instructions for Claude', 'claude');
      writeSupervisorInstructions('Instructions for Codex', 'codex');
      expect(readSupervisorInstructions('claude')).toBe('Instructions for Claude');
      expect(readSupervisorInstructions('codex')).toBe('Instructions for Codex');
    });

    it('removes stored preference when all provider instructions are blank', () => {
      writeSupervisorInstructions({ claude: '   ', codex: '' });
      expect(readAllSupervisorInstructions()).toEqual({});
      expect(readSupervisorInstructions()).toBe('');
    });
  });
});
