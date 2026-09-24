import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertIdenticalCorpus, verifyLeanCorpus } from './lean-check.mjs';

const corpusPath = fileURLToPath(
  new URL('../verification/contracts/provider-policy-v1.jsonl', import.meta.url)
);

test('accepts byte-identical Lean oracle output', async () => {
  const checkedInCorpus = await readFile(corpusPath, 'utf8');

  assert.doesNotThrow(() => assertIdenticalCorpus(checkedInCorpus, checkedInCorpus));
});

test('regenerates a temporary corpus before comparing it byte-for-byte', async () => {
  const checkedInCorpus = await readFile(corpusPath, 'utf8');
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const calls = [];

  await verifyLeanCorpus({
    repositoryRoot,
    execute: async (...argumentsList) => {
      calls.push(argumentsList);
      return {
        stdout: argumentsList[1][0] === 'exe' ? checkedInCorpus : '',
        stderr: '',
      };
    },
  });

  assert.deepEqual(calls, [
    [
      'lake',
      ['build', 'AuricIDE.McpLifecycle'],
      {
        cwd: `${repositoryRoot}verification/lean`,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
    ],
    [
      'lake',
      ['build', 'AuricIDE.McpSessionIsolation'],
      {
        cwd: `${repositoryRoot}verification/lean`,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
    ],
    [
      'lake',
      ['exe', 'provider-policy-oracle'],
      {
        cwd: `${repositoryRoot}verification/lean`,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
    ],
  ]);
});

test('rejects a one-byte oracle divergence', () => {
  assert.throws(
    () => assertIdenticalCorpus('{"allowed":true}\n', '{"allowed":false}\n'),
    /Lean oracle corpus differs byte-for-byte/
  );
});
