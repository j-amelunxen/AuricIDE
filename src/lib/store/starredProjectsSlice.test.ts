import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { useStore } from './index';

const mockStorage: Record<string, string> = {};

beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => mockStorage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      mockStorage[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete mockStorage[key];
    }),
    clear: vi.fn(() => {
      Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('starredProjectsSlice', () => {
  beforeEach(() => {
    useStore.setState({ starredProjects: [], recentProjects: [] });
  });

  it('starts with an empty list', () => {
    expect(useStore.getState().starredProjects).toEqual([]);
  });

  it('stars a project and derives its name', () => {
    useStore.getState().addStarredProject('/Users/jen/apps');
    const [first] = useStore.getState().starredProjects;
    expect(first.path).toBe('/Users/jen/apps');
    expect(first.name).toBe('apps');
    expect(first.starredAt).toBeGreaterThan(0);
  });

  it('is idempotent — starring an already-starred project does not duplicate it', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().addStarredProject('/a');
    expect(useStore.getState().starredProjects).toHaveLength(1);
  });

  it('unstars a project', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().removeStarredProject('/a');
    expect(useStore.getState().starredProjects).toHaveLength(0);
  });

  it('toggles a project on and off', () => {
    useStore.getState().toggleStarredProject('/a');
    expect(useStore.getState().isProjectStarred('/a')).toBe(true);
    useStore.getState().toggleStarredProject('/a');
    expect(useStore.getState().isProjectStarred('/a')).toBe(false);
  });

  // The locality invariant: Quick Access must NOT reorder by recency.
  it('keeps stable insertion order regardless of which project was opened last', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().addStarredProject('/b');
    // Re-opening A must not move B — opening touches recents, not stars.
    useStore.getState().addRecentProject('/a');
    // Re-starring A is a no-op and must not move it either.
    useStore.getState().addStarredProject('/a');
    expect(useStore.getState().starredProjects.map((s) => s.path)).toEqual(['/a', '/b']);
  });

  it('appends new stars to the end, keeping the array in star order', () => {
    useStore.getState().addStarredProject('/a');
    useStore.getState().addStarredProject('/b');
    useStore.getState().addStarredProject('/c');
    expect(useStore.getState().starredProjects.map((s) => s.path)).toEqual(['/a', '/b', '/c']);
  });

  it('says so when Quick Access is full instead of dropping the request', () => {
    useStore.setState({
      toasts: [],
      starredProjects: Array.from({ length: 50 }, (_, i) => ({
        path: `/p${i}`,
        name: `p${i}`,
        starredAt: i,
      })),
    });
    useStore.getState().addStarredProject('/one-too-many');
    expect(useStore.getState().starredProjects).toHaveLength(50);
    const [toast] = useStore.getState().toasts;
    expect(toast.variant).toBe('error');
    expect(toast.message).toMatch(/full/i);
  });

  it('persists to localStorage on star and unstar', () => {
    useStore.getState().addStarredProject('/a');
    expect(JSON.parse(mockStorage['auric-starred-projects'])).toHaveLength(1);
    useStore.getState().removeStarredProject('/a');
    expect(JSON.parse(mockStorage['auric-starred-projects'])).toHaveLength(0);
  });

  it('loads starred projects from localStorage', () => {
    mockStorage['auric-starred-projects'] = JSON.stringify([
      { path: '/x', name: 'x', starredAt: 1 },
      { path: '/y', name: 'y', starredAt: 2 },
    ]);
    useStore.getState().loadStarredProjects();
    expect(useStore.getState().starredProjects.map((s) => s.path)).toEqual(['/x', '/y']);
  });

  it('handles corrupted localStorage data gracefully', () => {
    mockStorage['auric-starred-projects'] = 'not-json';
    useStore.getState().loadStarredProjects();
    expect(useStore.getState().starredProjects).toEqual([]);
  });

  describe('per-project settings', () => {
    const glyph = { kind: 'glyph', value: 'rocket_launch' } as const;
    const blogartikel = { id: 's1', label: 'Blogartikel', prompt: '/blogartikel' };

    beforeEach(() => {
      useStore.setState({
        starredProjects: [
          { path: '/a', name: 'a', starredAt: 1 },
          { path: '/b', name: 'b', starredAt: 2 },
        ],
      });
    });

    it('stores an icon and skills against one project only', () => {
      useStore
        .getState()
        .updateStarredProjectSettings('/b', { icon: glyph, skills: [blogartikel] });
      const [a, b] = useStore.getState().starredProjects;
      expect(a.icon).toBeUndefined();
      expect(a.skills).toBeUndefined();
      expect(b.icon).toEqual(glyph);
      expect(b.skills).toEqual([blogartikel]);
    });

    it('refuses to write settings for a project that is not starred', () => {
      useStore.getState().updateStarredProjectSettings('/nope', { skills: [blogartikel] });
      expect(useStore.getState().starredProjects.map((p) => p.path)).toEqual(['/a', '/b']);
    });

    it('persists the settings to localStorage', () => {
      useStore.getState().updateStarredProjectSettings('/a', { icon: glyph, skills: [] });
      const stored = JSON.parse(mockStorage['auric-starred-projects']);
      expect(stored[0].icon).toEqual(glyph);
    });

    // The whole record is mirrored verbatim, so a rebuilt object would drop
    // anything a newer build wrote. Spread, never reconstruct.
    it('preserves fields it does not know about', () => {
      mockStorage['auric-starred-projects'] = JSON.stringify([
        { path: '/a', name: 'a', starredAt: 1, futureField: 'keep me' },
      ]);
      useStore.getState().loadStarredProjects();
      useStore.getState().updateStarredProjectSettings('/a', { icon: glyph, skills: [] });
      const [stored] = JSON.parse(mockStorage['auric-starred-projects']);
      expect(stored.futureField).toBe('keep me');
      expect(stored.icon).toEqual(glyph);
    });

    it('changes the icon without disturbing the skills', () => {
      useStore.getState().setStarredProjectSkills('/a', [blogartikel]);
      useStore.getState().setStarredProjectIcon('/a', glyph);
      const [a] = useStore.getState().starredProjects;
      expect(a.skills).toEqual([blogartikel]);
      expect(a.icon).toEqual(glyph);
    });

    it('changes the skills without disturbing the icon', () => {
      useStore.getState().setStarredProjectIcon('/a', glyph);
      useStore.getState().setStarredProjectSkills('/a', [blogartikel]);
      const [a] = useStore.getState().starredProjects;
      expect(a.icon).toEqual(glyph);
      expect(a.skills).toEqual([blogartikel]);
    });

    it('clears the icon back to the generated tile', () => {
      useStore.getState().setStarredProjectIcon('/a', glyph);
      useStore.getState().setStarredProjectIcon('/a', undefined);
      expect(useStore.getState().starredProjects[0].icon).toBeUndefined();
    });

    it('drops the settings with the project when it is unstarred', () => {
      useStore.getState().setStarredProjectSkills('/a', [blogartikel]);
      useStore.getState().removeStarredProject('/a');
      useStore.getState().addStarredProject('/a');
      expect(useStore.getState().starredProjects[0].skills).toBeUndefined();
    });

    it('stores a skill combo against one project only', () => {
      const combo = {
        id: 'c1',
        label: 'Draft and polish',
        steps: [
          { id: 's1', label: 'Finalize', prompt: '/sig-blog-finalize' },
          { id: 's2', label: 'Rewrite', prompt: 'rewrite so it does not sound so shit' },
        ],
      };
      useStore.getState().setStarredProjectCombos('/a', [combo]);
      const [a, b] = useStore.getState().starredProjects;
      expect(a.combos).toEqual([combo]);
      expect(b.combos).toBeUndefined();
    });

    it('changes the combos without disturbing the icon or the skills', () => {
      const combo = {
        id: 'c1',
        label: 'Draft and polish',
        steps: [blogartikel, { id: 's2', label: 'Rewrite', prompt: '/rewrite' }],
      };
      useStore.getState().setStarredProjectIcon('/a', glyph);
      useStore.getState().setStarredProjectSkills('/a', [blogartikel]);
      useStore.getState().setStarredProjectCombos('/a', [combo]);
      const [a] = useStore.getState().starredProjects;
      expect(a.icon).toEqual(glyph);
      expect(a.skills).toEqual([blogartikel]);
      expect(a.combos).toEqual([combo]);
    });

    it('keeps combos when only the icon changes', () => {
      const combo = {
        id: 'c1',
        label: 'Draft and polish',
        steps: [blogartikel, { id: 's2', label: 'Rewrite', prompt: '/rewrite' }],
      };
      useStore.getState().setStarredProjectCombos('/a', [combo]);
      useStore.getState().setStarredProjectIcon('/a', glyph);
      expect(useStore.getState().starredProjects[0].combos).toEqual([combo]);
    });

    it('pins a skill to a wheel slot without disturbing the skill list', () => {
      useStore.getState().setStarredProjectSkills('/a', [blogartikel]);
      useStore.getState().setStarredProjectWheelSlots('/a', [null, 's1']);
      const [a] = useStore.getState().starredProjects;
      expect(a.skills).toEqual([blogartikel]);
      expect(a.wheelSlots?.[1]).toBe('s1');
    });

    it('clears a wheel slot whose skill was removed', () => {
      useStore.getState().setStarredProjectSkills('/a', [blogartikel]);
      useStore.getState().setStarredProjectWheelSlots('/a', ['s1']);
      useStore.getState().setStarredProjectSkills('/a', []);
      expect(useStore.getState().starredProjects[0].wheelSlots?.every((id) => id === null)).toBe(
        true
      );
    });

    it('keeps wheel slots when only the icon changes', () => {
      useStore.getState().setStarredProjectSkills('/a', [blogartikel]);
      useStore.getState().setStarredProjectWheelSlots('/a', ['s1']);
      useStore.getState().setStarredProjectIcon('/a', glyph);
      expect(useStore.getState().starredProjects[0].wheelSlots?.[0]).toBe('s1');
    });
  });
});
