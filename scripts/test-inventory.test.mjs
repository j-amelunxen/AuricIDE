import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { generateTestInventory } from './test-inventory.mjs';

const execFile = promisify(execFileCallback);

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'auric-test-inventory-'));
  const files = {
    'src/lib/math.test.ts': `
      import { describe, it, test, vi } from 'vitest';
      vi.mock('./clock');
      const clock = vi.fn();
      describe('math', () => {
        it('adds', () => {});
        test('subtracts', () => {});
      });
    `,
    'src/app/components/Button.test.tsx': `it('renders', () => {});`,
    'src/lib/store/sessionSlice.test.ts': `test('loads session', () => {});`,
    'e2e/login.spec.ts': `test('logs in', async () => {});`,
    'scripts/utility.test.mjs': `test('keeps scripts covered', () => {});`,
    'src-tauri/src/database/tests/user_tests.rs': `
      #[test]
      fn creates_user() {}
      #[tokio::test]
      async fn lists_users() {}
      mockall::automock!();
    `,
    'tools/ambiguous.test.ts': `it('is discovered but needs classification', () => {});`,
    'src/lib/not-a-test.ts': `test('not a test file', () => {});`,
  };

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = join(root, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    })
  );

  return root;
}

test('groups discovered tests into stable baseline buckets and counts test cases and mocks', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const inventory = await generateTestInventory(root);

  assert.deepEqual(Object.keys(inventory.buckets), ['unit', 'component', 'store', 'e2e', 'rust']);
  assert.deepEqual(inventory.buckets.unit.files, [
    'scripts/utility.test.mjs',
    'src/lib/math.test.ts',
  ]);
  assert.deepEqual(inventory.buckets.component.files, ['src/app/components/Button.test.tsx']);
  assert.deepEqual(inventory.buckets.store.files, ['src/lib/store/sessionSlice.test.ts']);
  assert.deepEqual(inventory.buckets.e2e.files, ['e2e/login.spec.ts']);
  assert.deepEqual(inventory.buckets.rust.files, ['src-tauri/src/database/tests/user_tests.rs']);
  assert.equal(inventory.buckets.unit.testCaseCount, 3);
  assert.equal(inventory.buckets.unit.mockCount, 2);
  assert.equal(inventory.buckets.rust.testCaseCount, 2);
  assert.equal(inventory.buckets.rust.mockCount, 1);
  assert.deepEqual(inventory.baseline, {
    testFileCount: 7,
    testCaseCount: 9,
    mockCount: 3,
    unknownClassification: { fileCount: 1, testCaseCount: 1 },
  });
});

test('records fallback classifications explicitly instead of silently treating them as unit tests', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const inventory = await generateTestInventory(root);

  assert.deepEqual(inventory.unknownClassification, {
    fileCount: 1,
    testCaseCount: 1,
    files: [{ path: 'tools/ambiguous.test.ts', reason: 'No recognised test area' }],
  });
  assert.equal(
    inventory.files.find((file) => file.path === 'tools/ambiguous.test.ts')?.bucket,
    'unknown'
  );
});

test('CLI emits deterministic machine-readable JSON', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const script = new URL('./test-inventory.mjs', import.meta.url).pathname;
  const first = await execFile(process.execPath, [script, '--json', '--root', root]);
  const second = await execFile(process.execPath, [script, '--json', '--root', root]);

  assert.equal(first.stdout, second.stdout);
  const output = JSON.parse(first.stdout);
  assert.equal(output.baseline.testFileCount, 7);
  assert.equal(output.files[0].path, 'e2e/login.spec.ts');
});
