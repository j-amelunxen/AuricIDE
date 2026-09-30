import { useEffect } from 'react';
import { useStore } from '../store';
import { onAgentUsageRecorded } from '../tauri/agentUsage';

/**
 * Keeps the open project's agent usage in step with what the backend records.
 *
 * A full load once the project's database is ready, then one appended row per
 * `agent-usage-recorded` event. The event names its project, so a run that
 * finishes in a project that is no longer open still lands under its own path.
 */
export function useAgentUsageSync(): void {
  const rootPath = useStore((s) => s.rootPath);
  const projectDbInitialized = useStore((s) => s.projectDbInitialized);
  const loadAgentUsage = useStore((s) => s.loadAgentUsage);
  const appendAgentUsage = useStore((s) => s.appendAgentUsage);

  useEffect(() => {
    if (rootPath && projectDbInitialized) void loadAgentUsage(rootPath);
  }, [rootPath, projectDbInitialized, loadAgentUsage]);

  useEffect(
    () => onAgentUsageRecorded(({ projectPath, row }) => appendAgentUsage(projectPath, row)),
    [appendAgentUsage]
  );
}
