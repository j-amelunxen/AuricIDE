export type { StoreMetrics, JsHeapMetrics, ProcessMetrics, MemorySnapshot } from './types';
export { collectStoreMetrics } from './storeProbe';
export { xtermMounted, xtermUnmounted, getXtermCount, resetXtermCount } from './xtermTracker';
export { MemoryMetricsCollector, type MetricsCollectorConfig } from './memoryMetricsCollector';

import { MemoryMetricsCollector } from './memoryMetricsCollector';

let instance: MemoryMetricsCollector | null = null;

export function getMetricsCollector(): MemoryMetricsCollector {
  if (!instance) {
    instance = new MemoryMetricsCollector();
  }
  return instance;
}

export function destroyMetricsCollector(): void {
  if (instance) {
    instance.destroy();
    instance = null;
  }
}
