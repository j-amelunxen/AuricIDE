import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import { useStore } from '@/lib/store';

const listProjectSkills = vi.fn();

vi.mock('@/lib/tauri/projectSkills', () => ({
  listProjectSkills: (...args: unknown[]) => listProjectSkills(...args),
}));

import { useProjectSkills } from './useProjectSkills';

function skill(path: string): ProjectSkill {
  return {
    invocation: `/${path}`,
    name: path,
    description: null,
    source: 'skill',
    scope: 'project',
    path: `/repo/.claude/skills/${path}/SKILL.md`,
    sourceId: 'claude',
  };
}

beforeEach(() => {
  listProjectSkills.mockReset();
  useStore.setState({ rootPath: '/tmp/open-project' });
});

describe('useProjectSkills', () => {
  it('lists the open project when no path is given', async () => {
    listProjectSkills.mockResolvedValue([skill('from-root')]);
    const { result } = renderHook(() => useProjectSkills());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(listProjectSkills).toHaveBeenCalledWith('/tmp/open-project', expect.any(Array));
    expect(result.current.discovered.map((entry) => entry.invocation)).toEqual(['/from-root']);
  });

  it('lists the given working directory instead of the open project', async () => {
    listProjectSkills.mockResolvedValue([skill('from-cwd')]);
    const { result } = renderHook(() => useProjectSkills('/tmp/other-repo'));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(listProjectSkills).toHaveBeenCalledWith('/tmp/other-repo', expect.any(Array));
    expect(result.current.discovered.map((entry) => entry.invocation)).toEqual(['/from-cwd']);
  });

  it('falls back to the open project when the override is blank', async () => {
    listProjectSkills.mockResolvedValue([skill('from-root')]);
    const { result } = renderHook(() => useProjectSkills('   '));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(listProjectSkills).toHaveBeenCalledWith('/tmp/open-project', expect.any(Array));
  });
});
