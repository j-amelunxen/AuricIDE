import { useEffect } from 'react';
import { useStore } from '@/lib/store';
import { selectAgentUsageRows } from '@/lib/store/agentUsageSlice';
import type { AgentUsageRow } from '@/lib/tauri/agentUsage';

/**
 * The open project's recorded agent runs, newest first.
 *
 * `useAgentUsageSync` normally has them loaded by the time a view opens. A view
 * that finds the project never loaded asks for it itself, so it does not sit on
 * an empty list that is only empty because nobody read the database.
 */
export function useProjectUsageRows(): AgentUsageRow[] {
  const rootPath = useStore((s) => s.rootPath);
  const rows = useStore((s) => selectAgentUsageRows(s, s.rootPath));
  const status = useStore((s) => (s.rootPath ? s.agentUsageStatus[s.rootPath] : undefined));
  const loadAgentUsage = useStore((s) => s.loadAgentUsage);

  useEffect(() => {
    if (rootPath && status === undefined) void loadAgentUsage(rootPath);
  }, [rootPath, status, loadAgentUsage]);

  return rows;
}
