import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { browser } from '@wdio/globals';

type McpStatus = {
  status: 'running' | 'stopped';
  phase: 'running' | 'stopped' | 'error';
  pid: number | null;
  projectPath: string | null;
  error: string | null;
};

type TauriApi = {
  core: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  };
};

type TauriBrowser = {
  tauri: {
    execute<ReturnValue, Arguments extends unknown[]>(
      script: (tauri: TauriApi, ...args: Arguments) => ReturnValue | Promise<ReturnValue>,
      ...args: Arguments
    ): Promise<Awaited<ReturnValue>>;
  };
};

declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, body: () => Promise<void>) => void;

const tauriBrowser = browser as typeof browser & TauriBrowser;
const projectPath = process.env.VFY_TAURI_PROJECT_PATH;
const runId = process.env.VFY_TAURI_RUN_ID;
const phase = process.env.VFY_TAURI_PHASE;

if (!projectPath || !runId || (phase !== 'write' && phase !== 'read')) {
  throw new Error('MCP lifecycle E2E must be launched by the native Tauri E2E runner.');
}

describe(`native MCP lifecycle (${phase})`, () => {
  it('is idempotent within a workspace and rebinds atomically when the workspace changes', async () => {
    const fixtureRoot = `${projectPath}/mcp-${phase}-${runId}`;
    const alpha = `${fixtureRoot}/alpha`;
    const beta = `${fixtureRoot}/beta`;
    // The fixture owns only the workspace binding; it boots the real MCP
    // runtime from this build so the E2E crosses FastMCP + SQLite startup.
    const runtimeServerUrl = pathToFileURL(resolve(process.cwd(), 'src/mcp/server.ts')).href;
    const serverSource = `await import(${JSON.stringify(runtimeServerUrl)});\n`;

    const result = await tauriBrowser.tauri.execute(
      async (tauri, fixture) => {
        for (const workspace of [fixture.alpha, fixture.beta]) {
          await tauri.core.invoke('create_directory', { path: `${workspace}/src/mcp` });
          await tauri.core.invoke('init_project_db', { projectPath: workspace });
          await tauri.core.invoke('write_file', {
            path: `${workspace}/src/mcp/server.ts`,
            content: fixture.serverSource,
          });
        }

        const alphaStart = (await tauri.core.invoke('start_mcp', {
          projectPath: fixture.alpha,
        })) as McpStatus;
        const alphaAgain = (await tauri.core.invoke('start_mcp', {
          projectPath: fixture.alpha,
        })) as McpStatus;
        const betaStart = (await tauri.core.invoke('start_mcp', {
          projectPath: fixture.beta,
        })) as McpStatus;
        const afterSwitch = (await tauri.core.invoke('mcp_status')) as McpStatus;

        await tauri.core.invoke('stop_mcp');
        await tauri.core.invoke('stop_mcp');
        const stopped = (await tauri.core.invoke('mcp_status')) as McpStatus;

        return { alphaStart, alphaAgain, betaStart, afterSwitch, stopped };
      },
      { alpha, beta, serverSource }
    );

    assert.equal(result.alphaStart.status, 'running');
    assert.equal(result.alphaStart.phase, 'running');
    assert.equal(result.alphaStart.projectPath, alpha);
    assert.ok(result.alphaStart.pid);

    assert.equal(result.alphaAgain.pid, result.alphaStart.pid, 'same workspace must be idempotent');
    assert.equal(result.betaStart.status, 'running');
    assert.equal(result.betaStart.projectPath, beta);
    assert.notEqual(
      result.betaStart.pid,
      result.alphaStart.pid,
      'workspace switch must replace worker'
    );
    assert.deepEqual(result.afterSwitch, result.betaStart);

    assert.equal(result.stopped.status, 'stopped');
    assert.equal(result.stopped.phase, 'stopped');
    assert.equal(result.stopped.pid, null);
    assert.equal(result.stopped.projectPath, null);
    assert.equal(result.stopped.error, null);
  });
});
