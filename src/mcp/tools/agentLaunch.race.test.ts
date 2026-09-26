import { execFile } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import { openNotificationsDb } from '../notificationsDb';
import { createGoal } from './goalsDb';

const execFileAsync = promisify(execFile);

/** Rethrows a failed contender with its stderr as plain text. */
async function run(...args: Parameters<typeof execFileAsync>) {
  try {
    return await execFileAsync(...args);
  } catch (error) {
    const detail = (error as { stderr?: unknown }).stderr;
    // Only the first line: the full stderr carries stack frames of transpiled
    // files that the test reporter would try (and fail) to source-map.
    throw new Error(
      `contender failed: ${
        String(detail ?? error)
          .split('\n')
          .find((l) => /Error/.test(l)) ?? 'unknown'
      }`
    );
  }
}
/**
 * One contender: a separate process, as a second MCP server would be, asking
 * for a launch on the same goal at the same moment as its siblings. Imports by
 * absolute path because `tsx --eval` has no module location of its own.
 */
const CONTENDER = `
import { openDatabase } from ${JSON.stringify(resolve(__dirname, '../db.ts'))};
import { openNotificationsDb } from ${JSON.stringify(resolve(__dirname, '../notificationsDb.ts'))};
import { requestAgentLaunch } from ${JSON.stringify(resolve(__dirname, './agentLaunch.ts'))};
const [projectDbPath, inboxDbPath, goalId, startAt, agentCwd] = process.argv.slice(-5);
const projectDb = openDatabase(projectDbPath);
const inboxDb = openNotificationsDb(inboxDbPath);
while (Date.now() < Number(startAt)) {}
const result = requestAgentLaunch(projectDb, inboxDb, { prompt: 'race', goalId },
  { projectPath: '/repo/race', projectName: 'race', agentCwd });
process.stdout.write(result.uid + '\\n');
`;
const TSX = resolve(__dirname, '../../../node_modules/.bin/tsx');

/**
 * Review r1: two MCP server processes (two agents) asking for the same goal
 * at the same moment must end up with one open request, not two Start
 * buttons. Real processes, real file, real SQLite locking.
 */
describe('request_agent_launch across processes', () => {
  let dir: string;

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('leaves exactly one open request when several processes race for one goal', async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'auric-launch-race-')));
    const projectPath = join(dir, 'project.db');
    const inboxPath = join(dir, 'notifications.db');
    const projectDb = openDatabase(projectPath);
    const goalIds = [1, 2, 3].map((n) => createGoal(projectDb, { name: `G${n}` }, 'test').id);
    projectDb.close();
    openNotificationsDb(inboxPath).close();

    for (const goalId of goalIds) {
      const startAt = Date.now() + 1500;
      const outputs = await Promise.all(
        Array.from({ length: 6 }, () =>
          // A clean environment: the test worker's own Node options (its
          // loaders, its IPC channel) must not leak into the contenders.
          run(
            TSX,
            ['--eval', CONTENDER, '--', projectPath, inboxPath, goalId, String(startAt), dir],
            {
              env: {
                NODE_ENV: 'test',
                PATH: process.env.PATH ?? '',
                HOME: process.env.HOME ?? '',
              },
            }
          )
        )
      );
      const uids = new Set(outputs.map((o) => String(o.stdout).trim()));
      expect(uids.size, `goal ${goalId}`).toBe(1);
      expect([...uids][0], `goal ${goalId}`).toMatch(/^[0-9a-f-]{36}$/);
    }

    const inbox = openNotificationsDb(inboxPath);
    const perGoal = inbox
      .prepare(
        `SELECT ref_id, COUNT(*) AS n FROM notifications
          WHERE dedupe_key LIKE 'agent-launch:%' GROUP BY ref_id`
      )
      .all() as Array<{ ref_id: string; n: number }>;
    inbox.close();
    expect(perGoal.map((row) => row.n)).toEqual([1, 1, 1]);
  }, 60_000);
});
