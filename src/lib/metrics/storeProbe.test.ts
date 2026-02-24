import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/lib/store';
import { collectStoreMetrics } from './storeProbe';

describe('collectStoreMetrics', () => {
  beforeEach(() => {
    // Reset store to clean state
    useStore.setState({
      terminalLogs: [],
      agentLogs: {},
      agents: [],
      entityIndex: new Map(),
      headingIndex: new Map(),
      linkIndex: new Map(),
      diagnostics: new Map(),
      canvasNodes: [],
      openTabs: [],
      fileTree: [],
    });
  });

  it('returns zero counts for empty store', () => {
    const metrics = collectStoreMetrics();
    expect(metrics.terminalLogsCount).toBe(0);
    expect(metrics.agentLogsTotal).toBe(0);
    expect(metrics.agentCount).toBe(0);
    expect(metrics.entityIndexSize).toBe(0);
    expect(metrics.openTabsCount).toBe(0);
  });

  it('counts terminal logs', () => {
    useStore.setState({
      terminalLogs: [
        { tab: 'terminal', text: 'a', timestamp: 1 },
        { tab: 'terminal', text: 'b', timestamp: 2 },
      ],
    });
    const metrics = collectStoreMetrics();
    expect(metrics.terminalLogsCount).toBe(2);
  });

  it('counts agent logs per agent and total', () => {
    useStore.setState({
      agentLogs: {
        'agent-1': ['log1', 'log2', 'log3'],
        'agent-2': ['logA'],
      },
    });
    const metrics = collectStoreMetrics();
    expect(metrics.agentLogsTotal).toBe(4);
    expect(metrics.agentLogsByAgent['agent-1']).toBe(3);
    expect(metrics.agentLogsByAgent['agent-2']).toBe(1);
  });

  it('counts agents by status', () => {
    useStore.setState({
      agents: [
        { id: '1', name: 'A', model: 'm', provider: 'claude', status: 'running', startedAt: 0 },
        { id: '2', name: 'B', model: 'm', provider: 'claude', status: 'running', startedAt: 0 },
        { id: '3', name: 'C', model: 'm', provider: 'claude', status: 'idle', startedAt: 0 },
      ],
    });
    const metrics = collectStoreMetrics();
    expect(metrics.agentCount).toBe(3);
    expect(metrics.agentsByStatus['running']).toBe(2);
    expect(metrics.agentsByStatus['idle']).toBe(1);
  });

  it('counts entity occurrences total', () => {
    const entityIndex = new Map();
    entityIndex.set('Foo', [
      { filePath: 'a.md', lineNumber: 1, lineText: 'Foo', charFrom: 0, charTo: 3 },
      { filePath: 'b.md', lineNumber: 1, lineText: 'Foo', charFrom: 0, charTo: 3 },
    ]);
    entityIndex.set('Bar', [
      { filePath: 'a.md', lineNumber: 2, lineText: 'Bar', charFrom: 0, charTo: 3 },
    ]);
    useStore.setState({ entityIndex });
    const metrics = collectStoreMetrics();
    expect(metrics.entityIndexSize).toBe(2);
    expect(metrics.entityOccurrencesTotal).toBe(3);
  });

  it('counts file tree nodes recursively', () => {
    useStore.setState({
      fileTree: [
        {
          name: 'src',
          path: '/src',
          isDirectory: true,
          children: [
            { name: 'a.ts', path: '/src/a.ts', isDirectory: false },
            { name: 'b.ts', path: '/src/b.ts', isDirectory: false },
          ],
        },
        { name: 'README.md', path: '/README.md', isDirectory: false },
      ],
    });
    const metrics = collectStoreMetrics();
    expect(metrics.fileTreeNodeCount).toBe(4); // src + a.ts + b.ts + README.md
  });
});
