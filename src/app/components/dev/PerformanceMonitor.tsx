'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { MemorySnapshot, StoreMetrics } from '@/lib/metrics/types';
import { getMetricsCollector, destroyMetricsCollector } from '@/lib/metrics';
import { MAX_TERMINAL_LOGS } from '@/lib/store/uiSlice';
import { MAX_AGENT_LOGS } from '@/lib/store/agentSlice';

interface TauriProcessEntry {
  label: string;
  pid: number;
  rss_bytes: number;
}

interface LongTaskEntry {
  duration: number;
  timestamp: number;
}

const WARN_TOTAL_MB = 500;
const CRITICAL_TOTAL_MB = 1500;
const WARN_PROC_MB = 200;
const CRITICAL_PROC_MB = 500;
const MAX_LONG_TASKS = 20;
const LONG_TASK_THRESHOLD_MS = 50;
const CAP_WARN_THRESHOLD = 0.8;

function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function totalColor(mb: number): string {
  if (mb >= CRITICAL_TOTAL_MB) return 'bg-red-600 text-white';
  if (mb >= WARN_TOTAL_MB) return 'bg-amber-600 text-white';
  return 'bg-green-700 text-white';
}

function procColor(mb: number): string {
  if (mb >= CRITICAL_PROC_MB) return 'bg-red-500';
  if (mb >= WARN_PROC_MB) return 'bg-amber-500';
  return 'bg-green-500';
}

function capColor(value: number, cap: number): string {
  const ratio = value / cap;
  if (ratio >= 1) return 'text-red-400';
  if (ratio >= CAP_WARN_THRESHOLD) return 'text-amber-400';
  return 'text-foreground-muted';
}

interface StoreRow {
  label: string;
  value: number;
  cap?: number;
}

function buildStoreRows(store: StoreMetrics): StoreRow[] {
  return [
    { label: 'Terminal Logs', value: store.terminalLogsCount, cap: MAX_TERMINAL_LOGS },
    { label: 'Agent Logs (total)', value: store.agentLogsTotal },
    { label: 'Agents', value: store.agentCount },
    { label: 'Entity Index', value: store.entityIndexSize },
    { label: 'Entity Occurrences', value: store.entityOccurrencesTotal },
    { label: 'Heading Index', value: store.headingIndexSize },
    { label: 'Link Index', value: store.linkIndexSize },
    { label: 'Diagnostics', value: store.diagnosticsSize },
    { label: 'Canvas Nodes', value: store.canvasNodesCount },
    { label: 'Open Tabs', value: store.openTabsCount },
    { label: 'File Tree Nodes', value: store.fileTreeNodeCount },
  ];
}

export function PerformanceMonitor() {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [longTasks, setLongTasks] = useState<LongTaskEntry[]>([]);
  const [peakMB, setPeakMB] = useState(0);
  const peakRef = useRef(0);
  const [now, setNow] = useState(Date.now);

  // Initialize MemoryMetricsCollector
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;

    const collector = getMetricsCollector();

    // Set up Tauri IPC process fetcher
    collector.setProcessFetcher(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entries = (await invoke('get_system_memory')) as TauriProcessEntry[];
        if (entries && entries.length > 0) {
          return entries.map((e) => ({
            label: e.label,
            rssMB: Math.round(e.rss_bytes / (1024 * 1024)),
          }));
        }
      } catch {
        // Not in Tauri
      }
      return [];
    });

    // Set up file logging via Tauri IPC
    collector.setAppendMetricsLog(async (line: string) => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('append_metrics_log', { line });
      } catch {
        // Not in Tauri
      }
    });

    collector.setOnSnapshot((snap) => {
      setSnapshot(snap);
      setNow(Date.now());

      const total = snap.processes.reduce((s, p) => s + p.rssMB, 0);
      if (total > peakRef.current) {
        peakRef.current = total;
        setPeakMB(total);
      }
    });

    collector.start();

    return () => {
      destroyMetricsCollector();
    };
  }, []);

  // Observe long tasks
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (typeof PerformanceObserver === 'undefined') return;

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= LONG_TASK_THRESHOLD_MS) {
            setLongTasks((prev) => {
              const next = [
                ...prev,
                { duration: Math.round(entry.duration), timestamp: Date.now() },
              ];
              return next.slice(-MAX_LONG_TASKS);
            });
          }
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      // PerformanceObserver longtask not supported
    }

    return () => observer?.disconnect();
  }, []);

  const toggle = useCallback(() => setExpanded((e) => !e), []);

  const recentLongTasks = useMemo(
    () => longTasks.filter((t) => now - t.timestamp < 30_000),
    [longTasks, now]
  );

  const processes = useMemo(() => snapshot?.processes ?? [], [snapshot]);
  const processTotalMB = useMemo(() => processes.reduce((s, p) => s + p.rssMB, 0), [processes]);

  // Fall back to JS heap when no process data is available (browser mode)
  const totalMB = processTotalMB > 0 ? processTotalMB : (snapshot?.jsHeap?.usedJSHeapSizeMB ?? 0);

  if (process.env.NODE_ENV === 'production') return null;

  const badgeText = totalMB > 0 ? formatMemory(totalMB) : 'N/A';
  const colorClass = totalMB > 0 ? totalColor(totalMB) : 'bg-gray-600 text-white';
  const maxProcessMB = processes.length > 0 ? Math.max(...processes.map((p) => p.rssMB)) : 0;
  const storeRows = snapshot ? buildStoreRows(snapshot.store) : [];

  return (
    <>
      <button
        data-testid="perf-monitor"
        onClick={toggle}
        className={`fixed bottom-8 right-3 z-[9999] flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-bold shadow-lg transition-all hover:scale-105 ${colorClass}`}
        title="Performance Monitor — click to expand"
      >
        <span className="material-symbols-outlined text-sm">memory</span>
        {badgeText}
        {processes.length > 1 && (
          <span className="ml-0.5 px-1 rounded-full bg-white/20 text-[10px]">
            {processes.length}
          </span>
        )}
        {recentLongTasks.length > 0 && (
          <span className="ml-1 px-1.5 rounded-full bg-white/20 text-[10px]">
            {recentLongTasks.length} slow
          </span>
        )}
      </button>

      {expanded && (
        <div
          data-testid="perf-panel"
          className="fixed bottom-16 right-3 z-[9999] w-80 max-h-[70vh] rounded-xl bg-panel-bg border border-white/15 shadow-2xl text-xs text-foreground-muted overflow-y-auto"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 sticky top-0 bg-panel-bg z-10">
            <span className="font-semibold text-foreground">Performance Monitor</span>
            <button onClick={toggle} className="text-foreground-muted hover:text-foreground">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>

          <div className="p-3 space-y-3">
            {/* Process Breakdown */}
            {processes.length > 0 && (
              <div className="space-y-2">
                {processes.map((p) => (
                  <div key={p.label}>
                    <div className="flex justify-between mb-0.5">
                      <span>{p.label}</span>
                      <span className="font-mono font-bold text-foreground">
                        {formatMemory(p.rssMB)}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${procColor(p.rssMB)}`}
                        style={{
                          width: `${Math.min(100, maxProcessMB > 0 ? (p.rssMB / maxProcessMB) * 100 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}

                {processes.length > 1 && (
                  <div className="flex justify-between pt-1 border-t border-white/10">
                    <span className="font-semibold text-foreground">Total</span>
                    <span className="font-mono font-bold text-foreground">
                      {formatMemory(totalMB)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-[10px]">
                  <span>Peak: {formatMemory(peakMB)}</span>
                </div>
              </div>
            )}

            {processes.length === 0 && !snapshot && (
              <div className="text-center py-2 text-foreground-muted">No memory data available</div>
            )}

            {/* JS Heap */}
            {snapshot?.jsHeap && (
              <div className="border-t border-white/10 pt-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1">
                  JS Heap
                </div>
                <div className="flex justify-between">
                  <span>Used</span>
                  <span className="font-mono font-bold text-foreground">
                    {formatMemory(snapshot.jsHeap.usedJSHeapSizeMB)}
                  </span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>Total: {formatMemory(snapshot.jsHeap.totalJSHeapSizeMB)}</span>
                  <span>Limit: {formatMemory(snapshot.jsHeap.jsHeapSizeLimitMB)}</span>
                </div>
              </div>
            )}

            {/* Store Breakdown */}
            {storeRows.length > 0 && (
              <div className="border-t border-white/10 pt-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1">
                  Store Breakdown
                </div>
                <div className="space-y-0.5">
                  {storeRows.map((row) => (
                    <div key={row.label} className="flex justify-between">
                      <span>{row.label}</span>
                      <span
                        className={`font-mono font-bold ${
                          row.cap ? capColor(row.value, row.cap) : 'text-foreground'
                        }`}
                      >
                        {row.value.toLocaleString()}
                        {row.cap && (
                          <span className="text-foreground-muted font-normal">
                            /{row.cap.toLocaleString()}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}

                  {/* Per-agent log breakdown */}
                  {snapshot && Object.keys(snapshot.store.agentLogsByAgent).length > 0 && (
                    <div className="ml-2 mt-0.5 space-y-0.5">
                      {Object.entries(snapshot.store.agentLogsByAgent).map(([agentId, count]) => (
                        <div key={agentId} className="flex justify-between text-[10px]">
                          <span className="truncate max-w-[140px]">{agentId}</span>
                          <span className={`font-mono ${capColor(count, MAX_AGENT_LOGS)}`}>
                            {count.toLocaleString()}/{MAX_AGENT_LOGS.toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Xterm instances */}
                  {snapshot && (
                    <div className="flex justify-between">
                      <span>Xterm Instances</span>
                      <span className="font-mono font-bold text-foreground">
                        {snapshot.xtermInstanceCount}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Thresholds */}
            <div className="text-[10px] space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" /> &lt; {WARN_TOTAL_MB} MB —
                Normal
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> &gt; {WARN_TOTAL_MB} MB —
                Elevated
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" /> &gt; {CRITICAL_TOTAL_MB} MB —
                Critical
              </div>
            </div>

            {/* Long Tasks */}
            <div>
              <div className="flex justify-between mb-1">
                <span>Long Tasks (last 30s)</span>
                <span className="font-mono font-bold text-foreground">
                  {recentLongTasks.length}
                </span>
              </div>
              {recentLongTasks.length > 0 && (
                <div className="space-y-0.5 max-h-24 overflow-y-auto">
                  {recentLongTasks.slice(-5).map((t, i) => (
                    <div key={i} className="flex justify-between font-mono text-[10px]">
                      <span>{new Date(t.timestamp).toLocaleTimeString()}</span>
                      <span className={t.duration > 100 ? 'text-red-400' : 'text-amber-400'}>
                        {t.duration}ms
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
