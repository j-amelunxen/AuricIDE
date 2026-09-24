import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  runId: string;
  webDriverPort: number;
};

/**
 * The two WDIO invocations intentionally create two application processes.
 * A webview reload would not prove that the Rust process released and restored
 * its SQLite-backed state.
 */
export function createTauriDurabilityE2ePlan({
  projectRoot,
  projectPath,
  appHomePath,
  artifactPath,
  runId,
  webDriverPort,
}: PlanInput): CommandPlan[] {
  const phaseEnv = (phase: 'write' | 'read') => ({
    HOME: appHomePath,
    VFY_TAURI_PHASE: phase,
    VFY_TAURI_PROJECT_PATH: projectPath,
    VFY_TAURI_RUN_ID: runId,
    VFY_TAURI_ARTIFACT_DIR: artifactPath,
    TAURI_WEBDRIVER_PORT: String(webDriverPort),
  });

  return [
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
      cwd: projectRoot,
      // Tauri's CLI accepts boolean strings for CI but rejects the common
      // shell shorthand CI=1. Normalize it at the build boundary.
      env: { CI: 'true', NEXT_PUBLIC_E2E_WEBDRIVER: '1' },
    },
    ...(['write', 'read'] as const).map((phase) => ({
      command: 'pnpm',
      args: ['exec', 'wdio', 'run', 'wdio.tauri.mac.conf.ts'],
      cwd: projectRoot,
      env: phaseEnv(phase),
    })),
  ];
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
    throw new Error('The VFY-05 embedded WebDriver pilot is macOS-only.');
  }

  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const sandboxRoot = await mkdtemp(join(tmpdir(), 'auric-vfy05-'));
  const projectPath = join(sandboxRoot, 'project');
  const appHomePath = join(sandboxRoot, 'home');
  const artifactPath = join(sandboxRoot, 'artifacts');

  await Promise.all([mkdir(projectPath), mkdir(appHomePath), mkdir(artifactPath)]);
  const webDriverPort = await allocateLoopbackPort();
  let succeeded = false;

  try {
    const plan = createTauriDurabilityE2ePlan({
      projectRoot,
      projectPath,
      appHomePath,
      artifactPath,
      runId: randomUUID(),
      webDriverPort,
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
      `run-tauri-durability-e2e: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
