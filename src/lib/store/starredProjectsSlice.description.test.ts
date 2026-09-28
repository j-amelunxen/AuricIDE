import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StarredProject } from '@/lib/tauri/starredProjects';

// Stands in for Rust's `starred_projects_update_settings`: applies the
// tri-state the way the backend does and answers with the stored list.
let stored: StarredProject[] = [];
const invokeMock = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd !== 'starred_projects_update_settings') throw new Error(`unexpected ${cmd}`);
  const { path, settings } = args as { path: string; settings: { description?: string | null } };
  stored = stored.map((p) => {
    if (p.path !== path || settings.description === undefined) return p;
    const { description: _old, ...rest } = p;
    return settings.description === null ? rest : { ...rest, description: settings.description };
  });
  return stored;
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const { useStore } = await import('./index');

const project = (path: string, extra: Partial<StarredProject> = {}): StarredProject => ({
  path,
  name: path.slice(1),
  starredAt: 1,
  ...extra,
});

describe('starred project description over IPC', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    stored = [project('/a', { badge: { text: 'fe', color: 'blue' } }), project('/b')];
    useStore.setState({ starredProjects: stored });
  });

  it('sends the trimmed text and takes the stored list back', async () => {
    useStore.getState().setStarredProjectDescription('/a', '  Customer portal.  ');

    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('starred_projects_update_settings', {
        path: '/a',
        settings: expect.objectContaining({ description: 'Customer portal.' }),
      })
    );
    await vi.waitFor(() =>
      expect(useStore.getState().starredProjects[0].description).toBe('Customer portal.')
    );
    expect(useStore.getState().starredProjects[0].badge).toEqual({ text: 'fe', color: 'blue' });
  });

  it('clears with null, and a blank text clears too', async () => {
    stored = [project('/a', { description: 'old' }), project('/b')];
    useStore.setState({ starredProjects: stored });

    useStore.getState().setStarredProjectDescription('/a', '   ');

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock.mock.calls[0][1]).toMatchObject({ settings: { description: null } });
    await vi.waitFor(() =>
      expect(useStore.getState().starredProjects[0].description).toBeUndefined()
    );
  });

  it('leaves the description alone when another setting is saved', async () => {
    stored = [project('/a', { description: 'keep me' })];
    useStore.setState({ starredProjects: stored });

    useStore.getState().setStarredProjectBadge('/a', { text: 'qa', color: 'red' });

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    const settings = (invokeMock.mock.calls[0][1] as { settings: object }).settings;
    expect(settings).not.toHaveProperty('description');
    expect(useStore.getState().starredProjects[0].description).toBe('keep me');
  });
});
