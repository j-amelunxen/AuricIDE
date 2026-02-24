import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchServerBlueprints,
  pushToServer,
  syncWithServer,
} from './serverSync';
import type { Blueprint } from '../tauri/blueprints';

function makeBlueprint(overrides: Partial<Blueprint> = {}): Blueprint {
  return {
    id: 'bp1',
    name: 'Test Blueprint',
    techStack: 'React, TypeScript',
    goal: 'Build a test app',
    complexity: 'MEDIUM',
    category: 'architectures',
    description: '# Test',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('serverSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchServerBlueprints', () => {
    it('returns blueprints from server', async () => {
      const bp = makeBlueprint({ id: 'server1' });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => [bp],
      } as Response);

      const result = await fetchServerBlueprints('https://example.com');
      expect(result).toEqual([bp]);
      expect(fetch).toHaveBeenCalledWith('https://example.com/api/blueprints', expect.any(Object));
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      await expect(fetchServerBlueprints('https://example.com')).rejects.toThrow('Server returned 500');
    });

    it('throws on network error (unreachable)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await expect(fetchServerBlueprints('https://example.com')).rejects.toThrow('Network error');
    });
  });

  describe('pushToServer', () => {
    it('POSTs blueprints to server', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
      } as Response);

      const blueprints = [makeBlueprint()];
      await pushToServer('https://example.com', blueprints);

      expect(fetchSpy).toHaveBeenCalledWith('https://example.com/api/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blueprints),
      });
    });

    it('throws on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
      } as Response);

      await expect(pushToServer('https://example.com', [])).rejects.toThrow('Server returned 400');
    });
  });

  describe('syncWithServer', () => {
    it('returns server-only blueprints in addedLocally', async () => {
      const serverBp = makeBlueprint({ id: 'server-only' });
      const localBp = makeBlueprint({ id: 'local-only' });

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => [serverBp] } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const result = await syncWithServer('https://example.com', [localBp]);

      expect(result.addedLocally).toEqual([serverBp]);
      expect(result.pushedToServer).toEqual([localBp]);
    });

    it('returns local-only blueprints in pushedToServer and calls POST', async () => {
      const localBp = makeBlueprint({ id: 'local-only' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const result = await syncWithServer('https://example.com', [localBp]);

      expect(result.pushedToServer).toEqual([localBp]);
      expect(result.addedLocally).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    });

    it('skips POST when there is nothing to push', async () => {
      const sharedBp = makeBlueprint({ id: 'shared' });
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true, json: async () => [sharedBp] } as Response);

      const result = await syncWithServer('https://example.com', [sharedBp]);

      expect(result.addedLocally).toEqual([]);
      expect(result.pushedToServer).toEqual([]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('excludes shared IDs from both lists', async () => {
      const shared = makeBlueprint({ id: 'shared' });
      const serverExtra = makeBlueprint({ id: 'server-extra' });
      const localExtra = makeBlueprint({ id: 'local-extra' });

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [shared, serverExtra],
        } as Response)
        .mockResolvedValueOnce({ ok: true } as Response);

      const result = await syncWithServer('https://example.com', [shared, localExtra]);

      expect(result.addedLocally).toEqual([serverExtra]);
      expect(result.pushedToServer).toEqual([localExtra]);
    });

    it('throws when server is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(syncWithServer('https://example.com', [])).rejects.toThrow('Failed to fetch');
    });
  });
});
