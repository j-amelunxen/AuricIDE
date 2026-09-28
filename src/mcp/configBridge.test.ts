import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { emptyServerReply, resolveBridgeTarget, serve } from './configBridge';

const binding = JSON.stringify({
  mcpServers: {
    'auric-pm': {
      command: 'node',
      args: ['/app/auric-mcp/server.mjs', '--project-root', '/work/project-a'],
      env: { AURIC_AGENT_CWD: '/work/project-a' },
    },
  },
});

const files = (map: Record<string, string>) => (path: string) => {
  if (!(path in map)) throw new Error(`ENOENT: ${path}`);
  return map[path];
};

describe('resolveBridgeTarget', () => {
  it('becomes the auric-pm server named in the bound config', () => {
    const resolution = resolveBridgeTarget(
      { AURIC_MCP_CONFIG: '/data/project-a.mcp.json' },
      files({ '/data/project-a.mcp.json': binding })
    );
    expect(resolution).toEqual({
      kind: 'serve',
      target: {
        command: 'node',
        args: ['/app/auric-mcp/server.mjs', '--project-root', '/work/project-a'],
        env: { AURIC_AGENT_CWD: '/work/project-a' },
      },
    });
  });

  it('offers nothing when the IDE did not bind the process', () => {
    expect(resolveBridgeTarget({}, files({}))).toMatchObject({ kind: 'empty' });
    expect(resolveBridgeTarget({ AURIC_MCP_CONFIG: '  ' }, files({}))).toMatchObject({
      kind: 'empty',
    });
  });

  it('offers nothing, and says why, when the config is missing or malformed', () => {
    const missing = resolveBridgeTarget({ AURIC_MCP_CONFIG: '/gone.json' }, files({}));
    expect(missing).toMatchObject({ kind: 'empty' });
    expect(missing.kind === 'empty' && missing.why).toContain('/gone.json');

    const broken = resolveBridgeTarget(
      { AURIC_MCP_CONFIG: '/x.json' },
      files({ '/x.json': '{not json' })
    );
    expect(broken).toMatchObject({ kind: 'empty' });
  });

  it('refuses an entry that is not a runnable server', () => {
    const shapes = [
      { mcpServers: {} },
      { mcpServers: { 'auric-pm': { command: '' } } },
      { mcpServers: { 'auric-pm': { command: 'node', args: [1] } } },
      { mcpServers: { 'auric-pm': { command: 'node', env: { A: 1 } } } },
      { mcpServers: { other: { command: 'node' } } },
    ];
    for (const shape of shapes) {
      const resolution = resolveBridgeTarget(
        { AURIC_MCP_CONFIG: '/x.json' },
        files({ '/x.json': JSON.stringify(shape) })
      );
      expect(resolution.kind).toBe('empty');
    }
  });
});

describe('emptyServerReply', () => {
  it('completes the handshake and lists no tools', () => {
    expect(
      emptyServerReply({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    ).toMatchObject({
      id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: {} } },
    });
    expect(emptyServerReply({ id: 2, method: 'tools/list' })).toEqual({
      jsonrpc: '2.0',
      id: 2,
      result: { tools: [] },
    });
  });

  it('stays silent on notifications and rejects unknown methods', () => {
    expect(emptyServerReply({ method: 'notifications/initialized' })).toBeNull();
    expect(emptyServerReply({ id: 3, method: 'tools/call' })).toMatchObject({
      id: 3,
      error: { code: -32601 },
    });
  });
});

describe('serve', () => {
  const initialize = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });

  function run(script: string) {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk) => (written += chunk));
    const exits: number[] = [];
    serve({ command: process.execPath, args: ['-e', script], env: {} }, input, output, (code) =>
      exits.push(code)
    );
    return { input, exits, written: () => written };
  }

  // A server that dies before its handshake would leave the CLI waiting on it.
  it('answers as the empty server when the bound server dies before replying', async () => {
    const bridge = run('process.exit(1)');
    bridge.input.write(`${initialize}\n`);
    await vi.waitFor(() => expect(bridge.written()).toContain('"tools":{}'));
    bridge.input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    await vi.waitFor(() => expect(bridge.written()).toContain('"tools":[]'));
    expect(bridge.exits).toEqual([]);
  });

  it('passes a working server through and ends with it', async () => {
    const bridge = run(
      "process.stdin.once('data', () => { process.stdout.write('{\"ok\":true}\\n'); process.exit(0); })"
    );
    bridge.input.write(`${initialize}\n`);
    await vi.waitFor(() => expect(bridge.exits).toEqual([0]));
    expect(bridge.written()).toBe('{"ok":true}\n');
  });
});
