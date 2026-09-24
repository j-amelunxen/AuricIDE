import assert from 'node:assert/strict';
import test from 'node:test';

import { createTauriDurabilityE2ePlan } from './run-tauri-durability-e2e.mts';

test('builds an isolated two-process native durability plan', () => {
  const plan = createTauriDurabilityE2ePlan({
    projectRoot: '/workspace/AuricIDE',
    projectPath: '/tmp/auric-vfy05-example',
    appHomePath: '/tmp/auric-vfy05-home',
    artifactPath: '/tmp/auric-vfy05-artifacts',
    runId: 'vfy05-example',
    webDriverPort: 49152,
  });

  assert.deepEqual(plan, [
    {
      command: 'pnpm',
      args: [
        'tauri',
        'build',
        '--debug',
        '--no-bundle',
        '--features',
        'e2e-webdriver',
        '--config',
        'src-tauri/tauri.e2e.conf.json',
      ],
      cwd: '/workspace/AuricIDE',
      env: { CI: 'true', NEXT_PUBLIC_E2E_WEBDRIVER: '1' },
    },
    {
      command: 'pnpm',
      args: ['exec', 'wdio', 'run', 'wdio.tauri.mac.conf.ts'],
      cwd: '/workspace/AuricIDE',
      env: {
        VFY_TAURI_PHASE: 'write',
        VFY_TAURI_PROJECT_PATH: '/tmp/auric-vfy05-example',
        VFY_TAURI_RUN_ID: 'vfy05-example',
        VFY_TAURI_ARTIFACT_DIR: '/tmp/auric-vfy05-artifacts',
        TAURI_WEBDRIVER_PORT: '49152',
        HOME: '/tmp/auric-vfy05-home',
      },
    },
    {
      command: 'pnpm',
      args: ['exec', 'wdio', 'run', 'wdio.tauri.mac.conf.ts'],
      cwd: '/workspace/AuricIDE',
      env: {
        VFY_TAURI_PHASE: 'read',
        VFY_TAURI_PROJECT_PATH: '/tmp/auric-vfy05-example',
        VFY_TAURI_RUN_ID: 'vfy05-example',
        VFY_TAURI_ARTIFACT_DIR: '/tmp/auric-vfy05-artifacts',
        TAURI_WEBDRIVER_PORT: '49152',
        HOME: '/tmp/auric-vfy05-home',
      },
    },
  ]);
});
