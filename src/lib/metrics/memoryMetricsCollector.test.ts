import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { MemoryMetricsCollector } from './memoryMetricsCollector';
import { resetXtermCount, xtermMounted } from './xtermTracker';

describe('MemoryMetricsCollector', () => {
  let collector: MemoryMetricsCollector;

  beforeEach(() => {
    vi.useFakeTimers();
    resetXtermCount();

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

  afterEach(() => {
    collector?.destroy();
    vi.useRealTimers();
  });

  it('constructor sets defaults', () => {
    collector = new MemoryMetricsCollector();
    expect(collector.isRunning()).toBe(false);
    expect(collector.getLatest()).toBeNull();
    expect(collector.getHistory()).toHaveLength(0);
  });

  it('collect() returns a MemorySnapshot with correct store metrics', async () => {
    useStore.setState({
      terminalLogs: [{ tab: 'terminal', text: 'hello', timestamp: 1 }],
      agentLogs: { a1: ['x', 'y'] },
    });
    xtermMounted();

    collector = new MemoryMetricsCollector();
    const snapshot = await collector.collect();

    expect(snapshot.timestamp).toBeGreaterThan(0);
    expect(snapshot.store.terminalLogsCount).toBe(1);
    expect(snapshot.store.agentLogsTotal).toBe(2);
    expect(snapshot.xtermInstanceCount).toBe(1);
    expect(snapshot.processes).toEqual([]);
    // jsHeap is null in test environment (no performance.memory)
    expect(snapshot.jsHeap).toBeNull();
  });

  it('ring buffer caps at maxBufferSize', async () => {
    collector = new MemoryMetricsCollector({ bufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      await collector.collect();
    }

    expect(collector.getHistory()).toHaveLength(3);
  });

  it('getLatest() returns last snapshot', async () => {
    collector = new MemoryMetricsCollector();
    await collector.collect();

    useStore.setState({
      terminalLogs: [
        { tab: 'terminal', text: 'a', timestamp: 1 },
        { tab: 'terminal', text: 'b', timestamp: 2 },
      ],
    });
    await collector.collect();

    const latest = collector.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.store.terminalLogsCount).toBe(2);
  });

  it('getHistory() returns all snapshots', async () => {
    collector = new MemoryMetricsCollector();
    await collector.collect();
    await collector.collect();
    await collector.collect();

    const history = collector.getHistory();
    expect(history).toHaveLength(3);
  });

  it('start/stop controls the interval', async () => {
    collector = new MemoryMetricsCollector({ intervalMs: 1000 });

    collector.start();
    expect(collector.isRunning()).toBe(true);

    // Initial collect + 2 interval ticks
    await vi.advanceTimersByTimeAsync(2000);
    // start() does an immediate collect, then 2 more from interval ticks
    expect(collector.getHistory().length).toBe(3);

    collector.stop();
    expect(collector.isRunning()).toBe(false);

    // No more collects after stop
    await vi.advanceTimersByTimeAsync(2000);
    expect(collector.getHistory().length).toBe(3);
  });

  it('start() is idempotent when already running', () => {
    collector = new MemoryMetricsCollector({ intervalMs: 1000 });
    collector.start();
    collector.start(); // should not create a second interval
    expect(collector.isRunning()).toBe(true);
    collector.stop();
  });

  it('onSnapshot callback is called', async () => {
    const onSnapshot = vi.fn();
    collector = new MemoryMetricsCollector({ onSnapshot });

    await collector.collect();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: expect.any(Number),
        store: expect.any(Object),
      })
    );
  });

  it('destroy() clears buffer and stops', async () => {
    collector = new MemoryMetricsCollector({ intervalMs: 500 });
    collector.start();
    await collector.collect();

    collector.destroy();
    expect(collector.isRunning()).toBe(false);
    expect(collector.getHistory()).toHaveLength(0);
    expect(collector.getLatest()).toBeNull();
  });

  it('consoleLog option outputs to console.log', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    collector = new MemoryMetricsCollector({ consoleLog: true });

    await collector.collect();

    expect(consoleSpy).toHaveBeenCalledWith('[MemoryMetrics]', expect.any(String));
    consoleSpy.mockRestore();
  });

  it('setProcessFetcher provides process metrics', async () => {
    collector = new MemoryMetricsCollector();
    collector.setProcessFetcher(async () => [
      { label: 'main', rssMB: 128 },
      { label: 'gpu', rssMB: 64 },
    ]);

    const snapshot = await collector.collect();
    expect(snapshot.processes).toHaveLength(2);
    expect(snapshot.processes[0]).toEqual({ label: 'main', rssMB: 128 });
  });

  it('appendMetricsLog is called with JSON string', async () => {
    const appendMetricsLog = vi.fn().mockResolvedValue(undefined);
    collector = new MemoryMetricsCollector({ appendMetricsLog });

    await collector.collect();

    expect(appendMetricsLog).toHaveBeenCalledTimes(1);
    const arg = appendMetricsLog.mock.calls[0][0];
    expect(() => JSON.parse(arg)).not.toThrow();
  });
});
