'use client';

import { useEffect } from 'react';
import { invoke } from '@/lib/tauri/invoke';
import {
  createDriftProbe,
  createStallReporter,
  perfBreadcrumbs,
  STALL_REPORT_MS,
} from '@/lib/perf/freezeProbe';

const DRIFT_INTERVAL_MS = 250;

type StoreModules = [typeof import('@/lib/store'), typeof import('@/lib/metrics/storeProbe')];

// Loaded lazily: the layout mounts before SharedPrefsGate has reconciled, and
// importing the store here would evaluate it earlier than it is today.
let storeModules: StoreModules | null = null;

function stallContext(): Record<string, unknown> {
  if (!storeModules) return {};
  const [{ useStore }, { collectStoreMetrics }] = storeModules;
  const state = useStore.getState();
  const activeTab = state.openTabs.find((tab) => tab.id === state.activeTabId);
  const metrics = collectStoreMetrics();
  return {
    agentsRunning: state.agents.filter((a) => a.status === 'running').length,
    activeTabExt: activeTab?.name.split('.').pop() ?? null,
    agentConsoleOpen: state.agentConsoleOpen,
    commandCenterOpen: state.commandCenterOpen,
    fileTreeNodes: metrics.fileTreeNodeCount,
    agentLogBytes: metrics.agentLogBytesTotal,
    linkIndexSize: metrics.linkIndexSize,
    openTabs: metrics.openTabsCount,
  };
}

function supportedObserverTypes(): string[] {
  if (typeof PerformanceObserver === 'undefined') return [];
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  return ['long-animation-frame', 'longtask'].filter((t) => supported.includes(t));
}

/**
 * Answers the Rust watchdog's pings and reports main-thread stalls to
 * `freezes.jsonl`. Runs in production on purpose: the freezes worth
 * catching happen in the installed app, not in a dev session.
 */
export function FreezeProbe(): null {
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible';
    const pong = () => {
      invoke('ui_pong', { visible: visible() }).catch(() => {
        // Browser mode or tests: there is no watchdog to answer.
      });
    };

    const reporter = createStallReporter({
      now: () => performance.now(),
      unixNow: () => Date.now(),
      breadcrumbs: perfBreadcrumbs,
      context: stallContext,
      write: (line) => {
        invoke('record_ui_stall', { line }).catch(() => {});
      },
    });

    let unlisten: (() => void) | null = null;
    let disposed = false;
    Promise.all([import('@/lib/store'), import('@/lib/metrics/storeProbe')])
      .then((mods) => {
        storeModules = mods;
      })
      .catch(() => {});
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen('ui-ping', pong))
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch(() => {});

    // Prefer the engine's own long-task entries; fall back to timer drift.
    const observed = supportedObserverTypes();
    let observer: PerformanceObserver | null = null;
    let driftTimer: ReturnType<typeof setInterval> | null = null;
    const drift = createDriftProbe({
      intervalMs: DRIFT_INTERVAL_MS,
      thresholdMs: STALL_REPORT_MS,
      now: () => performance.now(),
      onStall: (late) => reporter.report('drift', late),
    });

    if (observed.length > 0) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (visible()) reporter.report(entry.entryType, entry.duration);
        }
      });
      observer.observe({ type: observed[0], buffered: false });
    } else {
      driftTimer = setInterval(() => {
        if (visible()) drift.check();
      }, DRIFT_INTERVAL_MS);
    }

    const onVisibility = () => {
      drift.reset();
      pong();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      unlisten?.();
      observer?.disconnect();
      if (driftTimer) clearInterval(driftTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
