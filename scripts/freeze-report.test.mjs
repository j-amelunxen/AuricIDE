import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLines, summarize } from './freeze-report.mjs';

const lines = [
  { atMs: 1000, source: 'watchdog', kind: 'stall', durationMs: 3000 },
  {
    atMs: 1200,
    source: 'probe',
    kind: 'drift',
    durationMs: 2900,
    breadcrumbs: [
      { label: 'fs-flush', atMs: 1 },
      { label: 'root-refresh', atMs: 2, durationMs: 2800 },
    ],
  },
  {
    atMs: 5000,
    source: 'probe',
    kind: 'drift',
    durationMs: 250,
    foldedMs: 500,
    foldedCount: 2,
    breadcrumbs: [{ label: 'fs-flush', atMs: 3 }],
  },
];

test('parseLines skips broken lines instead of failing the report', () => {
  const text = `${JSON.stringify(lines[0])}\nnot json\n\n${JSON.stringify(lines[1])}\n`;
  const { records, skipped } = parseLines(text);
  assert.equal(records.length, 2);
  assert.equal(skipped, 1);
});

test('summarize groups by source and counts folded stall time', () => {
  const summary = summarize(lines);
  assert.deepEqual(summary.bySource.watchdog, {
    count: 1,
    totalMs: 3000,
    p50: 3000,
    p95: 3000,
    max: 3000,
  });
  assert.equal(summary.bySource.probe.count, 2);
  assert.equal(summary.bySource.probe.totalMs, 2900 + 250 + 500);
  assert.equal(summary.bySource.probe.max, 2900);
});

test('summarize ranks what ran before stalls, and the slowest spans', () => {
  const summary = summarize(lines);
  assert.deepEqual(summary.precededBy[0], { label: 'fs-flush', stalls: 2 });
  assert.deepEqual(summary.slowestSpans[0], { label: 'root-refresh', maxMs: 2800, count: 1 });
});
