import { useEffect, useState } from 'react';
import { enabledSkillSources, loadSkillSources } from '@/lib/settings/skillSources';
import { listProjectSkills, type ProjectSkill } from '@/lib/tauri/projectSkills';
import { useStore } from '@/lib/store';

/**
 * The skill catalogue for a working directory (project-scoped first, then the
 * user's). Empty when no path is known; the picker then still accepts typed
 * invocations. Pass a path to list the skills the agent will actually see —
 * spawn's working directory, not necessarily the open project.
 */
export function useProjectSkills(projectPath?: string | null): {
  discovered: ProjectSkill[];
  ready: boolean;
} {
  const rootPath = useStore((s) => s.rootPath);
  const path = (projectPath && projectPath.trim()) || rootPath;
  const [loaded, setLoaded] = useState<{ path: string; skills: ProjectSkill[] } | null>(null);

  useEffect(() => {
    if (!path) return;
    const requested = path;
    let cancelled = false;
    void listProjectSkills(requested, enabledSkillSources(loadSkillSources())).then((found) => {
      if (cancelled) return;
      setLoaded({ path: requested, skills: found });
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path) return { discovered: [], ready: true };
  if (loaded?.path !== path) return { discovered: [], ready: false };
  return { discovered: loaded.skills, ready: true };
}
