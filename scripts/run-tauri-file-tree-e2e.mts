import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { allocateLoopbackPort, run, type CommandPlan } from './run-tauri-merge-e2e.mts';

/**
 * The explorer's drag-and-drop, multi-selection and "Compare Selected" in the
 * real app: one native app process, one project folder prepared by the spec.
 * Build and run exactly like the merge run (`run-tauri-merge-e2e.mts`).
 *
 * `--skip-build` reuses the last e2e build.
 */
export function createTauriFileTreeE2ePlan(input: {
  projectRoot: string;
  projectPath: string;
  appHomePath: string;
  screenshotPath: string;
  webDriverPort: number;
  skipBuild: boolean;
}): CommandPlan[] {
  const { projectRoot, projectPath, appHomePath, screenshotPath, webDriverPort } = input;
  const build: CommandPlan = {
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
    cwd: projectRoot,
    env: { CI: 'true', NEXT_PUBLIC_E2E_WEBDRIVER: '1' },
  };
  const spec: CommandPlan = {
    command: join(projectRoot, 'node_modules', '.bin', 'wdio'),
    args: ['run', 'wdio.tauri.mac.conf.ts', '--spec', 'e2e/tauri/file-tree.spec.ts'],
    cwd: projectRoot,
    env: {
      HOME: appHomePath,
      VFY_TAURI_FILE_TREE_PROJECT_PATH: projectPath,
      VFY_TAURI_SCREENSHOT_DIR: screenshotPath,
      TAURI_WEBDRIVER_PORT: String(webDriverPort),
    },
  };
  return input.skipBuild ? [spec] : [build, spec];
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The embedded WebDriver file-tree run is macOS-only.');
  }
  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  // realpath: /var is a link to /private/var, and the app reports canonical paths.
  const sandboxRoot = await realpath(await mkdtemp(join(tmpdir(), 'auric-file-tree-e2e-')));
  const projectPath = join(sandboxRoot, 'notes-project');
  const appHomePath = join(sandboxRoot, 'home');
  const screenshotPath = process.env.VFY_TAURI_SCREENSHOT_DIR ?? join(sandboxRoot, 'screens');
  await Promise.all([mkdir(projectPath), mkdir(appHomePath)]);
  await mkdir(screenshotPath, { recursive: true });
  let succeeded = false;
  try {
    const plan = createTauriFileTreeE2ePlan({
      projectRoot,
      projectPath,
      appHomePath,
      screenshotPath,
      webDriverPort: await allocateLoopbackPort(),
      skipBuild: process.argv.includes('--skip-build'),
    });
    for (const step of plan) await run(step);
    succeeded = true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${detail}; diagnostics preserved at ${sandboxRoot}`);
  } finally {
    if (succeeded) await rm(sandboxRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `run-tauri-file-tree-e2e: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
