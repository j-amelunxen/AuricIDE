import assert from 'node:assert/strict';
import test from 'node:test';

import { assertE2eReleaseRejected } from './check-e2e-release-boundary.mjs';

test('accepts the intentional compile-time release rejection', async () => {
  await assertE2eReleaseRejected({
    execute: async () => {
      throw Object.assign(new Error('cargo failed'), {
        stderr: 'error: the e2e-webdriver feature must never be linked into a release artifact',
      });
    },
  });
});

test('fails closed if Cargo accepts a release WebDriver artifact', async () => {
  await assert.rejects(
    assertE2eReleaseRejected({ execute: async () => ({ stdout: '', stderr: '' }) }),
    /release artifact accepted e2e-webdriver/i
  );
});
