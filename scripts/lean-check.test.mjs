import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AXIOM_CHECKS,
  ORACLES,
  assertIdenticalCorpus,
  assertStandardAxioms,
  verifyLeanCorpus,
} from './lean-check.mjs';

const corpusPath = fileURLToPath(
  new URL('../verification/contracts/provider-policy-v1.jsonl', import.meta.url)
);
const [launchGateAxioms] = AXIOM_CHECKS;
/** What `#print axioms` prints when every checked theorem is clean. */
const standardAxiomOutput = AXIOM_CHECKS.flatMap((check) =>
  check.theorems.map(
    (theorem) =>
      `'${check.namespace}.${theorem}' depends on axioms: [propext, Classical.choice, Quot.sound]`
  )
).join('\n');

test('accepts byte-identical Lean oracle output', async () => {
  const checkedInCorpus = await readFile(corpusPath, 'utf8');

  assert.doesNotThrow(() => assertIdenticalCorpus(checkedInCorpus, checkedInCorpus));
});

test('regenerates every oracle corpus before comparing it byte-for-byte', async () => {
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const corpora = new Map(
    await Promise.all(
      ORACLES.map(async ({ executable, corpus }) => [
        executable,
        await readFile(`${repositoryRoot}${corpus}`, 'utf8'),
      ])
    )
  );
  const calls = [];

  await verifyLeanCorpus({
    repositoryRoot,
    execute: async (...argumentsList) => {
      calls.push(argumentsList);
      const [, [verb, target]] = argumentsList;
      const stdout =
        verb === 'env' ? standardAxiomOutput : verb === 'exe' ? corpora.get(target) : '';
      return { stdout, stderr: '' };
    },
  });

  const options = {
    cwd: `${repositoryRoot}verification/lean`,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  };
  const probes = calls.filter(([, [verb]]) => verb === 'env');
  assert.deepEqual(
    calls.filter(([, [verb]]) => verb !== 'env'),
    [
      ['lake', ['build', 'AuricIDE.McpLifecycle'], options],
      ['lake', ['build', 'AuricIDE.McpSessionIsolation'], options],
      ...ORACLES.map(({ executable }) => ['lake', ['exe', executable], options]),
    ]
  );
  assert.equal(probes.length, AXIOM_CHECKS.length);
  assert.match(probes[0][1][2], /AuricIDE_LaunchGate_axioms\.lean$/);
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
  for (const theorem of launchGateAxioms.theorems) assert.ok(found[theorem], theorem);
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
