import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExists = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMcpLaunchSpec = vi.fn();
vi.mock('@/lib/tauri/fs', () => ({
  exists: (...args: unknown[]) => mockExists(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));
vi.mock('@/lib/tauri/mcp', () => ({
  mcpLaunchSpec: (...args: unknown[]) => mockMcpLaunchSpec(...args),
}));

import { buildMcpConfig, buildMcpServerEntry, initMcpJson } from './mcpConfig';

const launchSpec = {
  command: 'node',
  args: ['/app/resources/auric-mcp/server.mjs', '--project-root', '/test/project'],
  env: { AURIC_NOTIFICATIONS_DB: '/app/data/notifications.db' },
};

describe('buildMcpServerEntry', () => {
  it('builds the auric-pm server entry for a project path', () => {
    expect(buildMcpServerEntry(launchSpec)).toEqual(launchSpec);
    expect(buildMcpConfig(launchSpec)).toEqual({ mcpServers: { 'auric-pm': launchSpec } });
  });
});

describe('initMcpJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpLaunchSpec.mockResolvedValue(launchSpec);
  });

  it('creates .mcp.json when none exists', async () => {
    mockExists.mockResolvedValue(false);

    const result = await initMcpJson('/test/project');

    expect(result).toBe('created');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [path, content] = mockWriteFile.mock.calls[0];
    expect(path).toBe('/test/project/.mcp.json');
    expect(JSON.parse(content)).toEqual({
      mcpServers: {
        'auric-pm': {
          command: 'node',
          args: ['/app/resources/auric-mcp/server.mjs', '--project-root', '/test/project'],
          env: { AURIC_NOTIFICATIONS_DB: '/app/data/notifications.db' },
        },
      },
    });
    expect(content.endsWith('\n')).toBe(true);
  });

  it('merges into an existing .mcp.json without clobbering other servers', async () => {
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'other-server': { command: 'foo', args: [] },
        },
        someOtherKey: true,
      })
    );

    const result = await initMcpJson('/test/project');

    expect(result).toBe('updated');
    const [, content] = mockWriteFile.mock.calls[0];
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers['other-server']).toEqual({ command: 'foo', args: [] });
    expect(parsed.mcpServers['auric-pm'].args).not.toContain('/test/project/src/mcp/server.ts');
    expect(parsed.mcpServers['auric-pm'].args).toContain('/test/project');
    expect(parsed.someOtherKey).toBe(true);
  });

  it('overwrites an outdated auric-pm entry in an existing .mcp.json', async () => {
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          'auric-pm': { command: 'npx', args: ['tsx', '/old/path/server.ts', '/old/db'] },
        },
      })
    );

    await initMcpJson('/test/project');

    const [, content] = mockWriteFile.mock.calls[0];
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers['auric-pm']).toEqual(launchSpec);
  });

  it('throws without writing when the existing .mcp.json is invalid JSON', async () => {
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('{ not valid json');

    await expect(initMcpJson('/test/project')).rejects.toThrow(/invalid JSON/i);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('throws without writing when the existing .mcp.json is not an object', async () => {
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('[1, 2, 3]');

    await expect(initMcpJson('/test/project')).rejects.toThrow(/invalid/i);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
