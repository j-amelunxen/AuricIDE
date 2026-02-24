import type { MemorySnapshot, JsHeapMetrics, ProcessMetrics } from './types';
import { collectStoreMetrics } from './storeProbe';
import { getXtermCount } from './xtermTracker';

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_BUFFER_SIZE = 60;

export interface MetricsCollectorConfig {
  intervalMs?: number;
  bufferSize?: number;
  consoleLog?: boolean;
  onSnapshot?: (snapshot: MemorySnapshot) => void;
  appendMetricsLog?: (line: string) => Promise<void>;
}

function readJsHeap(): JsHeapMetrics | null {
  const mem = (
    performance as unknown as {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }
  ).memory;
  if (!mem) return null;
  return {
    usedJSHeapSizeMB: Math.round(mem.usedJSHeapSize / (1024 * 1024)),
    totalJSHeapSizeMB: Math.round(mem.totalJSHeapSize / (1024 * 1024)),
    jsHeapSizeLimitMB: Math.round(mem.jsHeapSizeLimit / (1024 * 1024)),
  };
}

export class MemoryMetricsCollector {
  private buffer: MemorySnapshot[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<
    Omit<MetricsCollectorConfig, 'onSnapshot' | 'appendMetricsLog'>
  > &
    Pick<MetricsCollectorConfig, 'onSnapshot' | 'appendMetricsLog'>;
  private readonly maxBufferSize: number;
  private fetchProcesses: (() => Promise<ProcessMetrics[]>) | null = null;

  constructor(config: MetricsCollectorConfig = {}) {
    this.config = {
      intervalMs: config.intervalMs ?? DEFAULT_INTERVAL_MS,
      bufferSize: config.bufferSize ?? DEFAULT_BUFFER_SIZE,
      consoleLog: config.consoleLog ?? false,
      onSnapshot: config.onSnapshot,
      appendMetricsLog: config.appendMetricsLog,
    };
    this.maxBufferSize = this.config.bufferSize;
  }

  setProcessFetcher(fetcher: () => Promise<ProcessMetrics[]>): void {
    this.fetchProcesses = fetcher;
  }

  setOnSnapshot(callback: ((snapshot: MemorySnapshot) => void) | undefined): void {
    this.config.onSnapshot = callback;
  }

  setAppendMetricsLog(callback: ((line: string) => Promise<void>) | undefined): void {
    this.config.appendMetricsLog = callback;
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => void this.collect(), this.config.intervalMs);
    void this.collect();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  isRunning(): boolean {
    return this.intervalId !== null;
  }

  async collect(): Promise<MemorySnapshot> {
    const store = collectStoreMetrics();
    const jsHeap = readJsHeap();
    const processes = this.fetchProcesses ? await this.fetchProcesses() : [];
    const xtermInstanceCount = getXtermCount();

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      store,
      jsHeap,
      processes,
      xtermInstanceCount,
    };

    this.buffer.push(snapshot);
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxBufferSize);
    }

    if (this.config.consoleLog) {
      console.log('[MemoryMetrics]', JSON.stringify(snapshot));
    }

    if (this.config.appendMetricsLog) {
      this.config.appendMetricsLog(JSON.stringify(snapshot)).catch(() => {});
    }

    if (this.config.onSnapshot) {
      this.config.onSnapshot(snapshot);
    }

    return snapshot;
  }

  getLatest(): MemorySnapshot | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;
  }

  getHistory(): readonly MemorySnapshot[] {
    return this.buffer;
  }

  destroy(): void {
    this.stop();
    this.buffer = [];
  }
}
