import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_LIMIT_GB, decideClean, limitBytesFrom } from './cargo-target-guard.mjs';

const GB = 1024 ** 3;

test('leaves a cache under the limit alone', () => {
  assert.equal(decideClean({ sizeBytes: 10 * GB, limitBytes: 25 * GB, busy: false }), 'keep');
});

test('cleans a cache over the limit when nothing builds into it', () => {
  assert.equal(decideClean({ sizeBytes: 30 * GB, limitBytes: 25 * GB, busy: false }), 'clean');
});

test('never cleans under a running build, however large the cache is', () => {
  assert.equal(decideClean({ sizeBytes: 90 * GB, limitBytes: 25 * GB, busy: true }), 'busy');
});

test('reads the limit from the environment, in GB', () => {
  assert.equal(limitBytesFrom({ AURIC_CARGO_TARGET_LIMIT_GB: '40' }), 40 * GB);
});

test('falls back to the default for a missing or unusable limit', () => {
  for (const value of [undefined, '', 'lots', '0', '-5']) {
    assert.equal(
      limitBytesFrom({ AURIC_CARGO_TARGET_LIMIT_GB: value }),
      DEFAULT_LIMIT_GB * GB,
      `value ${String(value)}`
    );
  }
});
