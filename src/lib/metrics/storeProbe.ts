import { useStore } from '@/lib/store';
import type { StoreMetrics } from './types';

function countFileTreeNodes(nodes: Array<{ children?: unknown[] }>): number {
  let count = nodes.length;
  for (const node of nodes) {
    if (node.children && Array.isArray(node.children)) {
      count += countFileTreeNodes(node.children as Array<{ children?: unknown[] }>);
    }
  }
  return count;
}

export function collectStoreMetrics(): StoreMetrics {
  const state = useStore.getState();

  const agentLogsByAgent: Record<string, number> = {};
  let agentLogsTotal = 0;
  for (const [agentId, logs] of Object.entries(state.agentLogs)) {
    agentLogsByAgent[agentId] = logs.length;
    agentLogsTotal += logs.length;
  }

  const agentsByStatus: Record<string, number> = {};
  for (const agent of state.agents) {
    agentsByStatus[agent.status] = (agentsByStatus[agent.status] ?? 0) + 1;
  }

  let entityOccurrencesTotal = 0;
  for (const occurrences of state.entityIndex.values()) {
    entityOccurrencesTotal += occurrences.length;
  }

  return {
    terminalLogsCount: state.terminalLogs.length,
    agentLogsTotal,
    agentLogsByAgent,
    agentCount: state.agents.length,
    agentsByStatus,
    entityIndexSize: state.entityIndex.size,
    entityOccurrencesTotal,
    headingIndexSize: state.headingIndex.size,
    linkIndexSize: state.linkIndex.size,
    diagnosticsSize: state.diagnostics.size,
    canvasNodesCount: state.canvasNodes.length,
    openTabsCount: state.openTabs.length,
    fileTreeNodeCount: countFileTreeNodes(state.fileTree),
  };
}
