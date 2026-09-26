import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AXIOM_CHECKS,
  assertIdenticalCorpus,
  assertStandardAxioms,
  verifyLeanCorpus,
} from './lean-check.mjs';

const corpusPath = fileURLToPath(
  new URL('../verification/contracts/provider-policy-v1.jsonl', import.meta.url)
);
const launchGateCorpusPath = fileURLToPath(
  new URL('../verification/contracts/launch-gate-v1.jsonl', import.meta.url)
);

const [launchGateAxioms] = AXIOM_CHECKS;
/** What `#print axioms` prints when every checked theorem is clean. */
const standardAxiomOutput = launchGateAxioms.theorems
  .map(
    (theorem) =>
      `'${launchGateAxioms.namespace}.${theorem}' depends on axioms: [propext, Classical.choice, Quot.sound]`
  )
  .join('\n');

test('accepts byte-identical Lean oracle output', async () => {
  const checkedInCorpus = await readFile(corpusPath, 'utf8');

  assert.doesNotThrow(() => assertIdenticalCorpus(checkedInCorpus, checkedInCorpus));
});

test('regenerates every oracle corpus before comparing it byte-for-byte', async () => {
  const checkedInCorpus = await readFile(corpusPath, 'utf8');
  const launchGateCorpus = await readFile(launchGateCorpusPath, 'utf8');
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const calls = [];

  await verifyLeanCorpus({
    repositoryRoot,
    execute: async (...argumentsList) => {
      calls.push(argumentsList);
      const [, [verb, target]] = argumentsList;
      const stdout =
        verb === 'env'
          ? standardAxiomOutput
          : verb !== 'exe'
            ? ''
            : target === 'launch-gate-oracle'
              ? launchGateCorpus
              : checkedInCorpus;
      return { stdout, stderr: '' };
    },
  });

  const options = {
    cwd: `${repositoryRoot}verification/lean`,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  };
  const [probeCall] = calls.splice(4, 1);
  assert.deepEqual(calls, [
    ['lake', ['build', 'AuricIDE.McpLifecycle'], options],
    ['lake', ['build', 'AuricIDE.McpSessionIsolation'], options],
    ['lake', ['exe', 'provider-policy-oracle'], options],
    ['lake', ['exe', 'launch-gate-oracle'], options],
  ]);
  assert.deepEqual(probeCall[1].slice(0, 2), ['env', 'lean']);
  assert.match(probeCall[1][2], /AuricIDE_LaunchGate_axioms\.lean$/);
});

test('rejects a launch-gate corpus that no longer matches the model', async () => {
  const checkedInCorpus = await readFile(corpusPath, 'utf8');
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

  await assert.rejects(
    verifyLeanCorpus({
      repositoryRoot,
      execute: async (_command, [verb, target]) => ({
        stdout:
          verb === 'env'
            ? standardAxiomOutput
            : verb !== 'exe'
              ? ''
              : target === 'launch-gate-oracle'
                ? '{"version":"launch-gate-v1"}\n'
                : checkedInCorpus,
        stderr: '',
      }),
    }),
    /launch-gate-v1\.jsonl/
  );
});

test('rejects a one-byte oracle divergence', () => {
  assert.throws(
    () => assertIdenticalCorpus('{"allowed":true}\n', '{"allowed":false}\n'),
    /Lean oracle corpus differs byte-for-byte/
  );
});

test('accepts requirement theorems on standard axioms only', () => {
  const found = assertStandardAxioms(standardAxiomOutput, launchGateAxioms);
  assert.equal(Object.keys(found).length, launchGateAxioms.theorems.length);
  assert.doesNotThrow(() =>
    assertStandardAxioms(
      `${standardAxiomOutput}\n'AuricIDE.LaunchGate.waiting_request_example' does not depend on any axioms`,
      launchGateAxioms
    )
  );
});

test('rejects a requirement theorem that rests on sorry', () => {
  const withSorry = standardAxiomOutput.replace(
    "revocation_holds' depends on axioms: [propext",
    "revocation_holds' depends on axioms: [propext, sorryAx"
  );
  assert.throws(
    () => assertStandardAxioms(withSorry, launchGateAxioms),
    /revocation_holds depends on sorryAx/
  );
});

test('rejects an axiom report that misses a requirement theorem', () => {
  const missing = standardAxiomOutput
    .split('\n')
    .filter((line) => !line.includes('budget_stops_root'))
    .join('\n');
  assert.throws(
    () => assertStandardAxioms(missing, launchGateAxioms),
    /budget_stops_root was not printed/
  );
});
