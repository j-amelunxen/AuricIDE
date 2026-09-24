import assert from 'node:assert/strict';
import test from 'node:test';

import { GATES, runGate } from './verify.mjs';

test('defines explicit fast, pr, native, and release gates', () => {
  assert.deepEqual(Object.keys(GATES), ['fast', 'pr', 'native', 'release']);
  assert.deepEqual(
    GATES.fast.map((step) => step.id),
    [
      'inventory',
      'tooling-tests',
      'typecheck',
      'lint',
      'format',
      'typescript-tests',
      'rust-tests',
      'lean',
    ]
  );
  assert.ok(GATES.pr.some((step) => step.id === 'browser-e2e'));
  assert.ok(GATES.native.some((step) => step.id === 'tauri-e2e'));
  assert.ok(GATES.release.some((step) => step.id === 'production-build'));
});

test('runs every required step in order', async () => {
  const calls = [];

  await runGate('native', async (step) => {
    calls.push(step.id);
    return 0;
  });

  assert.deepEqual(
    calls,
    GATES.native.map((step) => step.id)
  );
});

test('stops at the first failing required step', async () => {
  const calls = [];

  await assert.rejects(
    runGate('fast', async (step) => {
      calls.push(step.id);
      return step.id === 'lint' ? 7 : 0;
    }),
    /lint.*exit code 7/i
  );

  assert.deepEqual(calls, ['inventory', 'tooling-tests', 'typecheck', 'lint']);
});

test('rejects an unknown gate instead of falling back to a smaller suite', async () => {
  await assert.rejects(
    runGate('typo', async () => 0),
    /Unknown verification gate: typo/
  );
});
