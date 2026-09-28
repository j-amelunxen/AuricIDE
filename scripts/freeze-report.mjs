#!/usr/bin/env node
/**
 * Summarises the UI freeze log written by the Rust watchdog
 * (`src-tauri/src/ui_watchdog.rs`) and the frontend probe
 * (`src/lib/perf/freezeProbe.ts`).
 *
 *   node scripts/freeze-report.mjs                 # the installed app's log
 *   node scripts/freeze-report.mjs --since 60      # last 60 minutes only
 *   node scripts/freeze-report.mjs path/to/freezes.jsonl
 *
 * `watchdog` lines are stalls of a second or more, seen from Rust: the UI did
 * not answer. `probe` lines are the frontend's own view, down to 200 ms, with
 * the breadcrumbs of what ran in the ten seconds before.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_LOG = join(homedir(), 'Library', 'Logs', 'com.auricide.ide', 'freezes.jsonl');

export function parseLines(text) {
  const records = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      skipped += 1;
    }
  }
  return { records, skipped };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export function summarize(records) {
  const durations = {};
  const totals = {};
  const preceded = new Map();
  const spans = new Map();

  for (const r of records) {
    const source = r.source ?? 'unknown';
    (durations[source] ??= []).push(r.durationMs ?? 0);
    totals[source] = (totals[source] ?? 0) + (r.durationMs ?? 0) + (r.foldedMs ?? 0);

    const seen = new Set();
    for (const crumb of r.breadcrumbs ?? []) {
      if (!seen.has(crumb.label)) {
        seen.add(crumb.label);
        preceded.set(crumb.label, (preceded.get(crumb.label) ?? 0) + 1);
      }
      if (typeof crumb.durationMs === 'number') {
        const s = spans.get(crumb.label) ?? { label: crumb.label, maxMs: 0, count: 0 };
        s.maxMs = Math.max(s.maxMs, crumb.durationMs);
        s.count += 1;
        spans.set(crumb.label, s);
      }
    }
  }

  const bySource = {};
  for (const [source, list] of Object.entries(durations)) {
    const sorted = [...list].sort((a, b) => a - b);
    bySource[source] = {
      count: sorted.length,
      totalMs: totals[source],
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      max: sorted[sorted.length - 1],
    };
  }

  return {
    bySource,
    precededBy: [...preceded]
      .map(([label, stalls]) => ({ label, stalls }))
      .sort((a, b) => b.stalls - a.stalls),
    slowestSpans: [...spans.values()].sort((a, b) => b.maxMs - a.maxMs),
  };
}

function main(argv) {
  let path = DEFAULT_LOG;
  let sinceMin = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--since') sinceMin = Number(argv[(i += 1)]);
    else path = argv[i];
  }
  if (!existsSync(path)) {
    console.log(`No freeze log at ${path} — nothing recorded yet.`);
    return;
  }
  const { records, skipped } = parseLines(readFileSync(path, 'utf8'));
  const cutoff = sinceMin ? Date.now() - sinceMin * 60_000 : 0;
  const recent = records.filter((r) => (r.atMs ?? 0) >= cutoff);
  const summary = summarize(recent);

  console.log(
    `${path}\n${recent.length} records${sinceMin ? ` in the last ${sinceMin} min` : ''}` +
      (skipped ? `, ${skipped} unreadable lines skipped` : '')
  );
  console.log('\nBy source (ms):');
  console.table(summary.bySource);
  console.log('Ran within 10 s before a probe stall:');
  console.table(summary.precededBy.slice(0, 10));
  console.log('Slowest measured spans:');
  console.table(summary.slowestSpans.slice(0, 10));
  const worst = recent
    .filter((r) => r.source === 'watchdog')
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);
  if (worst.length) {
    console.log('Longest watchdog stalls:');
    for (const r of worst) {
      const top = r.webContent?.[0];
      console.log(
        `  ${new Date(r.atMs).toISOString()}  ${r.kind} ${r.durationMs} ms` +
          (top ? `  busiest WebContent ${top.cpuPercent}% CPU, ${top.rssMb} MB` : '')
      );
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
