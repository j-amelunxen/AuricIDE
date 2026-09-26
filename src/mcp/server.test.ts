import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FastMCP } from 'fastmcp';
import { createTestDb } from './db';
import { createMcpServer } from './server';

function registeredToolNames(): string[] {
  const addTool = vi.spyOn(FastMCP.prototype, 'addTool');
  createMcpServer(createTestDb(), '/repo/auric');
  const names = addTool.mock.calls.map(([tool]) => (tool as { name: string }).name);
  addTool.mockRestore();
  return names;
}

describe('createMcpServer: launch tools follow the inbox', () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env.AURIC_NOTIFICATIONS_DB;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('offers request_agent_launch when the app passed an inbox', () => {
    const dir = mkdtempSync(join(tmpdir(), 'auric-inbox-'));
    dirs.push(dir);
    process.env.AURIC_NOTIFICATIONS_DB = join(dir, 'notifications.db');

    expect(registeredToolNames()).toEqual(
      expect.arrayContaining(['request_agent_launch', 'list_agent_providers', 'get_agent_run'])
    );
  });

  // A request that lands nowhere must not look like it could start anything.
  it('does not offer it without an inbox', () => {
    delete process.env.AURIC_NOTIFICATIONS_DB;

    expect(registeredToolNames()).not.toContain('request_agent_launch');
    expect(registeredToolNames()).not.toContain('list_agent_providers');
    expect(registeredToolNames()).not.toContain('get_agent_run');
  });
});
