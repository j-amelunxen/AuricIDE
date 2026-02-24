export interface StoreMetrics {
  terminalLogsCount: number;
  agentLogsTotal: number;
  agentLogsByAgent: Record<string, number>;
  agentCount: number;
  agentsByStatus: Record<string, number>;
  entityIndexSize: number;
  entityOccurrencesTotal: number;
  headingIndexSize: number;
  linkIndexSize: number;
  diagnosticsSize: number;
  canvasNodesCount: number;
  openTabsCount: number;
  fileTreeNodeCount: number;
}

export interface JsHeapMetrics {
  usedJSHeapSizeMB: number;
  totalJSHeapSizeMB: number;
  jsHeapSizeLimitMB: number;
}

export interface ProcessMetrics {
  label: string;
  rssMB: number;
}

export interface MemorySnapshot {
  timestamp: number;
  store: StoreMetrics;
  jsHeap: JsHeapMetrics | null;
  processes: ProcessMetrics[];
  xtermInstanceCount: number;
}
