/**
 * Dev-mode monitor that detects zustand subscription storms.
 *
 * Usage: call `monitor.record(propertyName)` whenever a subscription fires.
 * If any property fires more than `maxFiresPerSecond` times in a 1-second window,
 * a console.warn is emitted. This catches feedback loops early.
 */

export interface DevSubscriptionMonitorOptions {
  maxFiresPerSecond: number;
}

export interface DevSubscriptionMonitor {
  record: (property: string) => void;
  destroy: () => void;
}

export function createDevSubscriptionMonitor(
  options: DevSubscriptionMonitorOptions
): DevSubscriptionMonitor {
  const { maxFiresPerSecond } = options;
  const counts = new Map<string, number>();
  let destroyed = false;

  const intervalId = setInterval(() => {
    if (destroyed) return;

    for (const [prop, count] of counts) {
      if (count > maxFiresPerSecond) {
        console.warn(
          `[PerfMonitor] Subscription storm detected: "${prop}" fired ${count}x in 1s (threshold: ${maxFiresPerSecond})`,
          count
        );
      }
    }
    counts.clear();
  }, 1000);

  return {
    record(property: string) {
      if (destroyed) return;
      counts.set(property, (counts.get(property) ?? 0) + 1);
    },
    destroy() {
      destroyed = true;
      clearInterval(intervalId);
      counts.clear();
    },
  };
}
