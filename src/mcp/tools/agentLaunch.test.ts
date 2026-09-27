import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { createTestDb } from '../db';
import { createTestNotificationsDb } from '../notificationsDb';
import { createGoal } from './goalsDb';
import { LAUNCH_REQUEST_KEY_PREFIX, registerAgentLaunchTools } from './agentLaunch';

/**
 * The requesting agent's working directory as the IDE hands it over: a real,
 * canonical folder (`tmpdir()` on macOS is itself a symlink, hence realpath).
 */
const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'auric-agent-cwd-')));
const AGENT_CWD = join(SANDBOX, 'agent');
mkdirSync(AGENT_CWD);
afterAll(() => rmSync(SANDBOX, { recursive: true, force: true }));

interface CapturedTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

function captureTools(
  projectDb: Database.Database,
  inboxDb: Database.Database,
  defaults: {
    projectPath?: string;
    projectName?: string;
    installedProviders?: string;
    agentCwd?: string;
  } = {}
): Map<string, CapturedTool> {
  const tools = new Map<string, CapturedTool>();
  const server = {
    addTool: (tool: CapturedTool) => tools.set(tool.name, tool),
  } as unknown as FastMCP;
  registerAgentLaunchTools(server, projectDb, inboxDb, { agentCwd: AGENT_CWD, ...defaults });
  return tools;
}

describe('request_agent_launch (contract)', () => {
  let projectDb: Database.Database;
  let inboxDb: Database.Database;
  let tools: Map<string, CapturedTool>;
  let goalId: string;

  beforeEach(() => {
    projectDb = createTestDb();
    inboxDb = createTestNotificationsDb();
    goalId = createGoal(projectDb, { name: 'Ship it' }, 'test').id;
    tools = captureTools(projectDb, inboxDb, { projectPath: '/repo/auric', projectName: 'auric' });
  });

  const request = async (args: Record<string, unknown>) =>
    JSON.parse(await tools.get('request_agent_launch')!.execute(args)) as Record<string, unknown>;

  const rows = () =>
    inboxDb.prepare('SELECT * FROM notifications ORDER BY id').all() as Array<
      Record<string, unknown>
    >;
  const actionsOf = (row: Record<string, unknown>) =>
    JSON.parse(row.actions as string) as Array<Record<string, unknown>>;

  it('writes one inbox request and returns its uid as pending', async () => {
    const result = await request({ prompt: 'Work on the goal', goalId });

    expect(result.status).toBe('pending');
    expect(typeof result.uid).toBe('string');
    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(row.uid).toBe(result.uid);
  });

  // The row is what the UI later trusts or distrusts: it must say an agent
  // wrote it, which project it belongs to, and which goal it is for.
  it('marks the row as agent-written, project-bound and goal-bound', async () => {
    const { uid } = await request({ prompt: 'Work on the goal', goalId });
    const [row] = rows();

    expect(row.source).toBe('agent');
    expect(row.kind).toBe('info');
    expect(row.project_path).toBe('/repo/auric');
    expect(row.ref_kind).toBe('goal');
    expect(row.ref_id).toBe(goalId);
    expect(row.dedupe_key).toBe(`${LAUNCH_REQUEST_KEY_PREFIX}${uid as string}`);
  });

  it('offers exactly one spawn-agent button carrying the request', async () => {
    await request({
      prompt: 'Work on the goal',
      goalId,
      provider: 'codex',
      model: 'gpt-5-codex',
      worktree: true,
      title: 'Start 09',
    });
    const [row] = rows();
    const actions = actionsOf(row);

    expect(row.title).toBe('Start 09');
    expect(actions).toEqual([
      {
        id: 'start',
        label: 'Start agent',
        kind: 'spawn-agent',
        task: 'Work on the goal',
        repoPath: AGENT_CWD,
        goalId,
        provider: 'codex',
        model: 'gpt-5-codex',
        useWorktree: true,
      },
    ]);
  });

  it('names the goal in the default title', async () => {
    await request({ prompt: 'Work on the goal', goalId });

    expect(rows()[0].title).toContain('Ship it');
  });

  // The authority fields are the UI's to decide, and the target folder is the
  // IDE's. A caller that sends any of them gets a clear refusal and no row,
  // never a request that skips the click or runs somewhere else.
  it.each([
    ['launch', 'auto'],
    ['permissionMode', 'bypassPermissions'],
    ['headless', true],
    ['note', 'extra prompt channel'],
    ['source', 'system'],
    ['projectPath', '/repo/other'],
    ['repoPath', '/repo/other'],
    ['cwd', '/repo/other'],
    ['path', '/repo/other'],
  ])('refuses a request that carries %s and writes nothing', async (field, value) => {
    await expect(request({ prompt: 'Work on the goal', goalId, [field]: value })).rejects.toThrow(
      new RegExp(field)
    );
    expect(rows()).toHaveLength(0);
  });

  it('omits the optional fields that were not given', async () => {
    await request({ prompt: 'Work on the goal', goalId });
    const [action] = actionsOf(rows()[0]);

    expect(action).not.toHaveProperty('provider');
    expect(action).not.toHaveProperty('model');
    expect(action).not.toHaveProperty('useWorktree');
  });

  // The model name ends up on a shell command line. The spawn path quotes it,
  // and this boundary refuses anything that is not a plain model id, so a
  // hostile value never reaches the inbox, let alone a Start button.
  it.each([
    'x; touch /tmp/pwned #',
    'x && id',
    '$(id)',
    '`id`',
    'x\nid',
    "x' ; id ; '",
    'x"; id; "',
    'x | id',
    ' opus',
    '',
    'a'.repeat(129),
  ])('refuses the model %j and writes nothing', async (model) => {
    await expect(request({ prompt: 'x', goalId, model })).rejects.toThrow(/model/i);
    expect(rows()).toHaveLength(0);
  });

  it.each([
    'opus',
    'gpt-5-codex',
    'moonshotai/kimi-k2-thinking',
    'grok-4:fast',
    'claude-opus-4-1[1m]',
  ])('accepts the ordinary model id %j', async (model) => {
    await request({ prompt: 'x', goalId, model });
    expect(actionsOf(rows()[0])[0].model).toBe(model);
  });

  it.each(['claude; id', 'codex $(id)', '../codex', 'co dex'])(
    'refuses the provider id %j even when the install is unknown',
    async (provider) => {
      await expect(request({ prompt: 'x', goalId, provider })).rejects.toThrow(/provider/i);
      expect(rows()).toHaveLength(0);
    }
  );

  it('refuses an unknown goal and writes nothing', async () => {
    await expect(request({ prompt: 'x', goalId: 'no-such-goal' })).rejects.toThrow(
      /goal 'no-such-goal' not found/i
    );
    expect(rows()).toHaveLength(0);
  });

  it('refuses an empty prompt and writes nothing', async () => {
    await expect(request({ prompt: '   ', goalId })).rejects.toThrow(/prompt/i);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a missing goal id and writes nothing', async () => {
    await expect(request({ prompt: 'x', goalId: '' })).rejects.toThrow(/goalId/i);
    expect(rows()).toHaveLength(0);
  });

  it('refuses when the server is not bound to a project', async () => {
    const unbound = captureTools(projectDb, inboxDb, {});

    await expect(
      unbound.get('request_agent_launch')!.execute({ prompt: 'x', goalId })
    ).rejects.toThrow(/project/i);
    expect(rows()).toHaveLength(0);
  });

  // A model that asks twice for the same goal must not stack two Start
  // buttons — one click would then start two agents on one goal.
  it('returns the open request instead of stacking a second one for the same goal', async () => {
    const first = await request({ prompt: 'Work on the goal', goalId });
    const second = await request({ prompt: 'Work on the goal again', goalId });

    expect(second.uid).toBe(first.uid);
    expect(second.reused).toBe(true);
    expect(rows()).toHaveLength(1);
    expect(actionsOf(rows()[0])[0].task).toBe('Work on the goal');
  });

  it('opens a fresh request once the earlier one was settled', async () => {
    const first = await request({ prompt: 'Work on the goal', goalId });
    inboxDb
      .prepare("UPDATE notifications SET answer = 'dismissed', answered_at = datetime('now')")
      .run();

    const second = await request({ prompt: 'Work on the goal', goalId });

    expect(second.uid).not.toBe(first.uid);
    expect(rows()).toHaveLength(2);
  });

  it('keeps requests for different goals apart', async () => {
    const other = createGoal(projectDb, { name: 'Other' }, 'test').id;
    const a = await request({ prompt: 'a', goalId });
    const b = await request({ prompt: 'b', goalId: other });

    expect(a.uid).not.toBe(b.uid);
    expect(rows()).toHaveLength(2);
  });

  it('does not reuse an open request that belongs to another project', async () => {
    const elsewhere = captureTools(projectDb, inboxDb, { projectPath: '/repo/other' });
    const first = JSON.parse(
      await elsewhere.get('request_agent_launch')!.execute({ prompt: 'x', goalId })
    ) as Record<string, unknown>;

    const second = await request({ prompt: 'x', goalId });

    expect(second.uid).not.toBe(first.uid);
  });
});

/**
 * Sub-goal 09, directory rule: a requested agent runs where the requesting
 * agent runs (or in a fresh IDE worktree of that repo). The folder comes from
 * the IDE (`AURIC_AGENT_CWD`), never from the request, and must be a real,
 * canonical directory.
 */
describe('request_agent_launch: directory rule', () => {
  let projectDb: Database.Database;
  let inboxDb: Database.Database;
  let goalId: string;

  beforeEach(() => {
    projectDb = createTestDb();
    inboxDb = createTestNotificationsDb();
    goalId = createGoal(projectDb, { name: 'Ship it' }, 'test').id;
  });

  const rows = () =>
    inboxDb.prepare('SELECT * FROM notifications ORDER BY id').all() as Array<
      Record<string, unknown>
    >;
  const requestFrom = (agentCwd: string | undefined, args: Record<string, unknown> = {}) =>
    captureTools(projectDb, inboxDb, { projectPath: '/repo/auric', agentCwd })
      .get('request_agent_launch')!
      .execute({ prompt: 'x', goalId, ...args });

  it('stores the requesting agent folder as the start folder, project unchanged', async () => {
    await requestFrom(AGENT_CWD);
    const [row] = rows();
    const [action] = JSON.parse(row.actions as string) as Array<Record<string, unknown>>;

    expect(action.repoPath).toBe(AGENT_CWD);
    expect(row.project_path).toBe('/repo/auric');
    expect(action).not.toHaveProperty('useWorktree');
  });

  it('asks for a fresh worktree of that folder when worktree is true', async () => {
    await requestFrom(AGENT_CWD, { worktree: true });
    const [action] = JSON.parse(rows()[0].actions as string) as Array<Record<string, unknown>>;

    expect(action).toMatchObject({ repoPath: AGENT_CWD, useWorktree: true });
  });

  it('refuses when the IDE did not pass the requesting agent folder', async () => {
    await expect(requestFrom(undefined)).rejects.toThrow(/working directory/);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a relative folder', async () => {
    await expect(requestFrom('repo/auric')).rejects.toThrow(/absolute/);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a folder spelled with ..', async () => {
    await expect(requestFrom(`${AGENT_CWD}/../agent`)).rejects.toThrow(/canonical/);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a symlink to the folder', async () => {
    const link = join(SANDBOX, 'link-to-agent');
    symlinkSync(AGENT_CWD, link);

    await expect(requestFrom(link)).rejects.toThrow(/canonical/);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a folder that does not exist', async () => {
    await expect(requestFrom(join(SANDBOX, 'missing'))).rejects.toThrow(/does not exist/);
    expect(rows()).toHaveLength(0);
  });

  it('refuses a file in place of a folder', async () => {
    const file = join(SANDBOX, 'a-file');
    writeFileSync(file, 'x');

    await expect(requestFrom(file)).rejects.toThrow(/not a directory/);
    expect(rows()).toHaveLength(0);
  });
});

describe('providers: request_agent_launch and list_agent_providers', () => {
  let projectDb: Database.Database;
  let inboxDb: Database.Database;
  let goalId: string;

  beforeEach(() => {
    projectDb = createTestDb();
    inboxDb = createTestNotificationsDb();
    goalId = createGoal(projectDb, { name: 'Ship it' }, 'test').id;
  });

  const setPolicy = (policy: unknown) =>
    projectDb
      .prepare(
        "INSERT OR REPLACE INTO kv_store (namespace, key, value) VALUES ('provider_policy', 'policy', ?)"
      )
      .run(JSON.stringify(policy));

  const toolsWith = (installed?: string) =>
    captureTools(projectDb, inboxDb, {
      projectPath: '/repo/auric',
      ...(installed === undefined ? {} : { installedProviders: installed }),
    });

  const run = async (tools: Map<string, CapturedTool>, name: string, args = {}) =>
    JSON.parse(await tools.get(name)!.execute(args)) as Record<string, unknown>;

  const actionProvider = () =>
    (
      JSON.parse(
        (inboxDb.prepare('SELECT actions FROM notifications').get() as { actions: string }).actions
      ) as Array<{ provider?: string }>
    )[0].provider;

  // Across the board: whichever provider the calling agent runs on, it can
  // ask for any installed, permitted one. The server has no notion of "self".
  it.each([
    ['claude', 'codex'],
    ['codex', 'claude'],
    ['claude', 'grok'],
    ['codex', 'grok'],
    ['grok', 'claude'],
  ])('a %s agent can request a %s agent', async (caller, target) => {
    const tools = toolsWith('claude,codex,crush,grok');
    await run(tools, 'request_agent_launch', {
      prompt: `from ${caller}`,
      goalId,
      provider: target,
    });

    expect(actionProvider()).toBe(target);
  });

  it('normalises the provider id the way the policy does', async () => {
    await run(toolsWith('claude,codex'), 'request_agent_launch', {
      prompt: 'x',
      goalId,
      provider: ' Codex ',
    });
    expect(actionProvider()).toBe('codex');
  });

  it('refuses a provider the project policy denies, and writes nothing', async () => {
    setPolicy({ allow: null, deny: ['grok'] });
    await expect(
      run(toolsWith('claude,codex,grok'), 'request_agent_launch', {
        prompt: 'x',
        goalId,
        provider: 'grok',
      })
    ).rejects.toThrow(/'grok' is not permitted/);
    expect(inboxDb.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 0 });
  });

  it('refuses a provider outside the allow list', async () => {
    setPolicy({ allow: ['claude'], deny: [] });
    await expect(
      run(toolsWith('claude,codex'), 'request_agent_launch', {
        prompt: 'x',
        goalId,
        provider: 'codex',
      })
    ).rejects.toThrow(/not permitted/);
  });

  it('refuses a provider that is not installed, naming the installed ones', async () => {
    await expect(
      run(toolsWith('claude,codex'), 'request_agent_launch', {
        prompt: 'x',
        goalId,
        provider: 'nope',
      })
    ).rejects.toThrow(/'nope' is not installed.*claude, codex/);
  });

  // Outside the IDE the server cannot see the install; the spawn path then
  // stays the check that refuses an unknown one (resolve_permitted_provider).
  it('accepts a permitted provider when the install is unknown', async () => {
    await run(toolsWith(), 'request_agent_launch', { prompt: 'x', goalId, provider: 'codex' });
    expect(actionProvider()).toBe('codex');
  });

  it('still applies the policy when the install is unknown', async () => {
    setPolicy({ allow: null, deny: ['codex'] });
    await expect(
      run(toolsWith(), 'request_agent_launch', { prompt: 'x', goalId, provider: 'codex' })
    ).rejects.toThrow(/not permitted/);
  });

  it('lists installed providers with what the policy allows', async () => {
    setPolicy({ allow: null, deny: ['grok'] });
    const listed = await run(toolsWith('claude,codex,grok'), 'list_agent_providers');

    expect(listed.installedKnown).toBe(true);
    expect(listed.providers).toEqual([
      { id: 'claude', allowed: true },
      { id: 'codex', allowed: true },
      { id: 'grok', allowed: false },
    ]);
    expect(listed.policy).toEqual({ allow: null, deny: ['grok'] });
  });

  it('says so when it cannot see the install', async () => {
    setPolicy({ allow: ['claude'], deny: [] });
    const listed = await run(toolsWith(), 'list_agent_providers');

    expect(listed.installedKnown).toBe(false);
    expect(listed.providers).toEqual([{ id: 'claude', allowed: true }]);
  });

  it('reads a corrupt policy as open, like the spawn path does', async () => {
    projectDb
      .prepare(
        "INSERT OR REPLACE INTO kv_store (namespace, key, value) VALUES ('provider_policy', 'policy', '{broken')"
      )
      .run();
    await run(toolsWith('claude,codex'), 'request_agent_launch', {
      prompt: 'x',
      goalId,
      provider: 'codex',
    });
    expect(actionProvider()).toBe('codex');
  });
});

describe('get_agent_run', () => {
  let projectDb: Database.Database;
  let inboxDb: Database.Database;
  let tools: Map<string, CapturedTool>;
  let goalId: string;

  beforeEach(() => {
    projectDb = createTestDb();
    inboxDb = createTestNotificationsDb();
    goalId = createGoal(projectDb, { name: 'Ship it' }, 'test').id;
    tools = captureTools(projectDb, inboxDb, { projectPath: '/repo/auric' });
  });

  const call = async (name: string, args: Record<string, unknown>) =>
    JSON.parse(await tools.get(name)!.execute(args)) as Record<string, unknown>;
  const requestUid = async () =>
    (await call('request_agent_launch', { prompt: 'work', goalId })).uid as string;
  const answer = (uid: string, value: string) =>
    inboxDb
      .prepare("UPDATE notifications SET answer = ?, answered_at = datetime('now') WHERE uid = ?")
      .run(value, uid);
  const runRow = (uid: string, status: string, extra: Record<string, string | null> = {}) =>
    inboxDb
      .prepare(
        `INSERT OR REPLACE INTO agent_launch_runs
           (request_uid, agent_id, agent_name, provider, model, status, summary, error, finished_at)
         VALUES (?, 'agent-3', 'Worker', 'codex', 'gpt', ?, ?, ?, ?)`
      )
      .run(uid, status, extra.summary ?? null, extra.error ?? null, extra.finished_at ?? null);

  it('reports a request nobody acted on yet as pending', async () => {
    const uid = await requestUid();
    expect(await call('get_agent_run', { uid })).toMatchObject({ status: 'pending', goalId });
  });

  it('reports a running agent with its identity', async () => {
    const uid = await requestUid();
    answer(uid, 'agent:agent-3');
    runRow(uid, 'running');

    expect(await call('get_agent_run', { uid })).toMatchObject({
      status: 'running',
      goalId,
      agentId: 'agent-3',
      agentName: 'Worker',
      provider: 'codex',
      model: 'gpt',
    });
  });

  it('reports a finished run with its summary', async () => {
    const uid = await requestUid();
    answer(uid, 'agent:agent-3');
    runRow(uid, 'completed', { summary: 'All green', finished_at: '2026-09-26 12:00:00' });

    expect(await call('get_agent_run', { uid })).toMatchObject({
      status: 'completed',
      summary: 'All green',
      finishedAt: '2026-09-26 12:00:00',
    });
  });

  it.each(['failed', 'killed', 'interrupted'])('reports a %s run', async (status) => {
    const uid = await requestUid();
    runRow(uid, status);
    expect((await call('get_agent_run', { uid })).status).toBe(status);
  });

  it('reports a start that failed before an agent existed, with the reason', async () => {
    const uid = await requestUid();
    answer(uid, "failed:Provider 'nope' is not installed");

    expect(await call('get_agent_run', { uid })).toMatchObject({
      status: 'failed',
      error: "Provider 'nope' is not installed",
    });
  });

  it('reports a started agent whose run record is missing as running', async () => {
    const uid = await requestUid();
    answer(uid, 'agent:agent-3');

    expect(await call('get_agent_run', { uid })).toMatchObject({
      status: 'running',
      agentId: 'agent-3',
    });
  });

  it('reports a dismissed request as declined', async () => {
    const uid = await requestUid();
    answer(uid, 'dismissed');
    expect((await call('get_agent_run', { uid })).status).toBe('declined');
  });

  it('reports a cleared or unknown uid as gone', async () => {
    const uid = await requestUid();
    inboxDb.prepare('DELETE FROM notifications WHERE uid = ?').run(uid);

    expect(await call('get_agent_run', { uid })).toEqual({ status: 'gone' });
    expect(await call('get_agent_run', { uid: 'never-existed' })).toEqual({ status: 'gone' });
  });

  it('does not reveal a request from another project', async () => {
    const other = captureTools(projectDb, inboxDb, { projectPath: '/repo/other' });
    const { uid } = JSON.parse(
      await other.get('request_agent_launch')!.execute({ prompt: 'x', goalId })
    ) as { uid: string };

    expect(await call('get_agent_run', { uid })).toEqual({ status: 'gone' });
  });

  it('refuses a uid that is not a launch request', async () => {
    inboxDb
      .prepare(
        "INSERT INTO notifications (uid, project_path, source, title) VALUES ('plain', '/repo/auric', 'agent', 'hi')"
      )
      .run();
    await expect(call('get_agent_run', { uid: 'plain' })).rejects.toThrow(/not an agent launch/);
  });
});
