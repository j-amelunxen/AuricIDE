import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExists = vi.fn();
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
vi.mock('@/lib/tauri/fs', () => ({
  exists: (...args: unknown[]) => mockExists(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

import { buildMcpServerEntry, initMcpJson } from './mcpConfig';

describe('buildMcpServerEntry', () => {
  it('builds the auric-pm server entry for a project path', () => {
    const entry = buildMcpServerEntry('/test/project');
    expect(entry).toEqual({
      command: 'npx',
      args: ['tsx', '/test/project/src/mcp/server.ts', '/test/project/.auric/project.db'],
    });
  });
});

describe('initMcpJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          command: 'npx',
          args: ['tsx', '/test/project/src/mcp/server.ts', '/test/project/.auric/project.db'],
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
    expect(parsed.mcpServers['auric-pm'].args).toContain('/test/project/src/mcp/server.ts');
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
    expect(parsed.mcpServers['auric-pm'].args).toEqual([
      'tsx',
      '/test/project/src/mcp/server.ts',
      '/test/project/.auric/project.db',
    ]);
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
