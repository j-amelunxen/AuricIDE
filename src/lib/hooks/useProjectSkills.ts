import { useEffect, useState } from 'react';
import { enabledSkillSources, loadSkillSources } from '@/lib/settings/skillSources';
import { listProjectSkills, type ProjectSkill } from '@/lib/tauri/projectSkills';
import { useStore } from '@/lib/store';

/**
 * The project's skill catalogue (project-scoped first, then the user's).
 * Empty when no project is open; the picker then still accepts typed invocations.
 */
export function useProjectSkills(): { discovered: ProjectSkill[]; ready: boolean } {
  const rootPath = useStore((s) => s.rootPath);
  const [loaded, setLoaded] = useState<{ path: string; skills: ProjectSkill[] } | null>(null);

  useEffect(() => {
    if (!rootPath) return;
    const path = rootPath;
    let cancelled = false;
    void listProjectSkills(path, enabledSkillSources(loadSkillSources())).then((found) => {
      if (cancelled) return;
      setLoaded({ path, skills: found });
    });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  if (!rootPath) return { discovered: [], ready: true };
  if (loaded?.path !== rootPath) return { discovered: [], ready: false };
  return { discovered: loaded.skills, ready: true };
}
