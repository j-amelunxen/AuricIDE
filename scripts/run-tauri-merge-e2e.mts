import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type CommandPlan = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

type PlanInput = {
  projectRoot: string;
  projectPath: string;
  appHomePath: string;
  artifactPath: string;
  screenshotPath: string;
  webDriverPort: number;
  skipBuild: boolean;
};

/**
 * One native app process drives all five scenarios (merge, abort, hunk
 * staging, merge preview, rebase continue) against one real repository. The repository is prepared by the
 * spec itself with the git CLI, so a merge is started outside the IDE.
 */
export function createTauriMergeE2ePlan({
  projectRoot,
  projectPath,
  appHomePath,
  artifactPath,
  screenshotPath,
  webDriverPort,
  skipBuild,
}: PlanInput): CommandPlan[] {
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
    // Tauri's CLI accepts boolean strings for CI but rejects the common
    // shell shorthand CI=1. Normalize it at the build boundary.
    env: { CI: 'true', NEXT_PUBLIC_E2E_WEBDRIVER: '1' },
  };
  const run: CommandPlan = {
    // Not `pnpm exec`: with HOME pointed at the sandbox, pnpm's dependency
    // check sees another store and refuses to run without a TTY
    // (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
    command: join(projectRoot, 'node_modules', '.bin', 'wdio'),
    args: ['run', 'wdio.tauri.mac.conf.ts', '--spec', 'e2e/tauri/merge-panel.spec.ts'],
    cwd: projectRoot,
    env: {
      HOME: appHomePath,
      VFY_TAURI_MERGE_PROJECT_PATH: projectPath,
      VFY_TAURI_ARTIFACT_DIR: artifactPath,
      VFY_TAURI_SCREENSHOT_DIR: screenshotPath,
      TAURI_WEBDRIVER_PORT: String(webDriverPort),
    },
  };
  return skipBuild ? [run] : [build, run];
}

async function allocateLoopbackPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a loopback WebDriver port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolvePort(address.port)));
    });
  });
}

function run({ command, args, cwd, env }: CommandPlan): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(' ')} failed (code ${code ?? 'null'}, signal ${signal ?? 'none'})`
        )
      );
    });
  });
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('The embedded WebDriver merge run is macOS-only.');
  }

  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  // realpath: /var is a link to /private/var, and the app reports canonical paths.
  const sandboxRoot = await realpath(await mkdtemp(join(tmpdir(), 'auric-merge-e2e-')));
  const projectPath = join(sandboxRoot, 'billing-service');
  const appHomePath = join(sandboxRoot, 'home');
  const artifactPath = join(sandboxRoot, 'artifacts');
  const screenshotPath = process.env.VFY_TAURI_SCREENSHOT_DIR ?? join(artifactPath, 'screens');

  await Promise.all([mkdir(projectPath), mkdir(appHomePath), mkdir(artifactPath)]);
  await mkdir(screenshotPath, { recursive: true });
  const webDriverPort = await allocateLoopbackPort();
  let succeeded = false;

  try {
    const plan = createTauriMergeE2ePlan({
      projectRoot,
      projectPath,
      appHomePath,
      artifactPath,
      screenshotPath,
      webDriverPort,
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
      `run-tauri-merge-e2e: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
