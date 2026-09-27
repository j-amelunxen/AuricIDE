import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FastMCP } from 'fastmcp';
import { createTestDb } from '@/mcp/db';
import { createTestNotificationsDb } from '@/mcp/notificationsDb';
import { registerAgentLaunchTools } from '@/mcp/tools/agentLaunch';
import { registerNotificationTools } from '@/mcp/tools/notifications';
import { autoAgentLaunches, grantedAgentLaunches, type GrantLaunchContext } from './autoLaunch';
import {
  grantForRoot,
  LAUNCH_GRANTS_CHANGED_EVENT,
  listLaunchGrants,
  MAX_GRANT_BUDGET,
  MAX_GRANT_CONCURRENT,
  revokeLaunchGrant,
  saveLaunchGrant,
  type LaunchGrant,
} from './launchGrants';
import type { Notification, NotificationAction } from './types';

const native = vi.hoisted(() => ({
  save: vi.fn(),
  revoke: vi.fn(),
  list: vi.fn(),
}));
vi.mock('@/lib/tauri/notifications', () => ({
  notificationsSaveLaunchGrant: native.save,
  notificationsRevokeLaunchGrant: native.revoke,
  notificationsListLaunchGrants: native.list,
}));

const REPO = '/repo/auric';
const NOW = Date.UTC(2026, 8, 26, 10, 0, 0);

const goals = [
  { id: 'root', parentId: null },
  { id: 'sub', parentId: 'root' },
  { id: 'leaf', parentId: 'sub' },
  { id: 'other-root', parentId: null },
  { id: 'other-sub', parentId: 'other-root' },
];

function grant(overrides: Partial<LaunchGrant> = {}): LaunchGrant {
  return {
    id: 'g1',
    projectPath: REPO,
    rootGoalId: 'root',
    rootGoalName: 'Mission',
    maxConcurrent: 2,
    launchBudget: 5,
    grantedAt: '2026-09-26 10:00:00',
    launchesUsed: 0,
    ...overrides,
  };
}

function action(overrides: Partial<Extract<NotificationAction, { kind: 'spawn-agent' }>> = {}) {
  return {
    id: 'start',
    label: 'Start agent',
    kind: 'spawn-agent' as const,
    task: 'work',
    repoPath: REPO,
    goalId: 'sub',
    ...overrides,
  };
}

function request(overrides: Partial<Notification> = {}, act = action()): Notification {
  return {
    id: 1,
    uid: 'r1',
    createdAt: '2026-09-26 10:05:00',
    projectPath: REPO,
    projectName: 'auric',
    source: 'agent',
    origin: 'request_agent_launch',
    kind: 'info',
    severity: 'info',
    title: 'Agent requested',
    body: null,
    actions: [act],
    dedupeKey: 'agent-launch:r1',
    refKind: 'goal',
    refId: act.goalId ?? null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

const parse = (n: Notification) => n.actions as NotificationAction[];

function context(overrides: Partial<GrantLaunchContext> = {}): GrantLaunchContext {
  return {
    grants: [grant()],
    goals,
    openProjectPath: REPO,
    activeAgents: [],
    nowMs: NOW + 10 * 60_000,
    ...overrides,
  };
}

const launched = (notifications: Notification[], ctx = context()) =>
  grantedAgentLaunches(notifications, parse, ctx);

describe('grantedAgentLaunches: positive', () => {
  it('starts a request for a goal under the granted root', () => {
    const n = request();
    expect(launched([n])).toEqual([{ notification: n, action: action(), grant: grant() }]);
  });

  it('starts a request for the root itself and for deeper goals', () => {
    const forRoot = request({ uid: 'a' }, action({ goalId: 'root' }));
    const forLeaf = request({ uid: 'b' }, action({ goalId: 'leaf' }));
    expect(launched([forRoot, forLeaf])).toHaveLength(2);
  });
});

describe('grantedAgentLaunches: negative (MET-09-trust)', () => {
  it('starts nothing without any grant', () => {
    expect(launched([request()], context({ grants: [] }))).toEqual([]);
  });

  it('starts nothing for a goal under a different root', () => {
    const n = request({}, action({ goalId: 'other-sub' }));
    expect(launched([n])).toEqual([]);
  });

  // Goal 10, station 4: the root was deleted while its grant is still in
  // force. Neither the root itself nor a goal still pointing at it counts.
  it('starts nothing for a deleted root, not even a request on the root itself', () => {
    const withoutRoot = goals.filter((goal) => goal.id !== 'root');
    const forRoot = request({ uid: 'a' }, action({ goalId: 'root' }));
    const forSub = request({ uid: 'b' }, action({ goalId: 'sub' }));
    expect(launched([forRoot, forSub], context({ goals: withoutRoot }))).toEqual([]);
  });

  it('starts nothing for an unknown goal', () => {
    const n = request({}, action({ goalId: 'ghost' }));
    expect(launched([n])).toEqual([]);
  });

  it('starts nothing for a request from another project', () => {
    const n = request({ projectPath: '/repo/other' }, action({ repoPath: '/repo/other' }));
    expect(launched([n])).toEqual([]);
  });

  // The requester's folder (maybe a worktree beside the checkout) is checked
  // natively at spawn (`launch_dir.rs`); the pre-filter keys on the project.
  it("keys on the row's project, not on the folder the agent runs in", () => {
    const n = request({}, action({ repoPath: `${REPO}.auric-wt/feature` }));
    expect(launched([n])).toHaveLength(1);
  });

  it('starts nothing when the action has no repository', () => {
    const n = request({}, action({ repoPath: undefined }));
    expect(launched([n])).toEqual([]);
  });

  // The goal tree is only known for the open project; a grant for a project
  // that is not open cannot check ancestry, so it must not guess.
  it('starts nothing when the granted project is not the open one', () => {
    expect(launched([request()], context({ openProjectPath: '/repo/other' }))).toEqual([]);
  });

  it('starts nothing when the row names a different goal than its action', () => {
    const n = request({ refId: 'sub' }, action({ goalId: 'other-sub' }));
    expect(launched([n])).toEqual([]);
  });

  it('starts nothing for a plain notify with a spawn button', () => {
    expect(launched([request({ dedupeKey: null })])).toEqual([]);
  });

  it('starts nothing that was read, answered or expired', () => {
    expect(launched([request({ readAt: '2026-09-26 10:06:00' })])).toEqual([]);
    expect(launched([request({ answeredAt: 'x', answer: 'dismissed' })])).toEqual([]);
    expect(launched([request({ expiresAt: '2026-09-26 10:00:00' })])).toEqual([]);
  });

  // Decision Jennifer 2026-09-26: a request that waited starts once granted.
  it('starts a request written before the grant like any other', () => {
    expect(launched([request({ createdAt: '2026-09-25 08:00:00' })])).toHaveLength(1);
  });

  // Trusted rows already have their own auto-start rules; the grant is only
  // for foreign requests and must not widen what a schedule does.
  it('leaves user-authored rows to the schedule path', () => {
    expect(launched([request({ source: 'system' })])).toEqual([]);
    expect(launched([request({ source: 'ui' })])).toEqual([]);
  });

  it('ignores a launch: "auto" the model wrote into the payload', () => {
    const n = request({}, action({ launch: 'auto', goalId: 'other-sub' }));
    expect(launched([n])).toEqual([]);
    expect(autoAgentLaunches([n], parse, Date.now())).toEqual([]);
  });
});

describe('grantedAgentLaunches: limits', () => {
  it('holds back once the mission has its maximum of agents running', () => {
    const busy = context({
      activeAgents: [
        { status: 'running', spawnedByGoalId: 'sub' },
        { status: 'queued', spawnedByGoalId: 'leaf' },
      ],
    });
    expect(launched([request()], busy)).toEqual([]);
  });

  it('does not count finished agents or agents of other missions', () => {
    const ctx = context({
      activeAgents: [
        { status: 'idle', spawnedByGoalId: 'sub' },
        { status: 'error', spawnedByGoalId: 'leaf' },
        { status: 'running', spawnedByGoalId: 'other-sub' },
        { status: 'running', spawnedByGoalId: null },
      ],
    });
    expect(launched([request({}, action({ goalId: 'leaf' }))], ctx)).toHaveLength(1);
  });

  it('counts starts within one batch against the limit', () => {
    const batch = ['a', 'b', 'c'].map((uid, i) =>
      request({ uid, id: i + 1 }, action({ goalId: i === 0 ? 'root' : i === 1 ? 'sub' : 'leaf' }))
    );
    expect(launched(batch)).toHaveLength(2);
  });

  it('does not start a second agent on a goal that already has one running', () => {
    const ctx = context({ activeAgents: [{ status: 'running', spawnedByGoalId: 'sub' }] });
    expect(launched([request()], ctx)).toEqual([]);
  });

  it('stops once the launch budget is spent', () => {
    expect(launched([request()], context({ grants: [grant({ launchesUsed: 5 })] }))).toEqual([]);
  });

  // Fault injection: a usage count that is not a number closes the gate.
  it('starts nothing while the usage of the grant is unreadable', () => {
    const ctx = context({ grants: [grant({ launchesUsed: Number.NaN })] });
    expect(launched([request()], ctx)).toEqual([]);
  });

  it('starts nothing for a request someone already read', () => {
    expect(launched([request({ readAt: '2026-09-26 10:06:00' })])).toEqual([]);
  });

  it('spends the remaining budget within one batch and no more', () => {
    const ctx = context({ grants: [grant({ maxConcurrent: 5, launchesUsed: 4 })] });
    const batch = [request({ uid: 'a' }, action({ goalId: 'root' })), request({ uid: 'b' })];
    expect(launched(batch, ctx)).toHaveLength(1);
  });
});

describe('launch grants store: native, acknowledged (fault injection)', () => {
  beforeEach(() => {
    native.save.mockReset();
    native.revoke.mockReset();
    native.list.mockReset();
  });

  const input = {
    projectPath: REPO,
    rootGoalId: 'root',
    rootGoalName: 'Mission',
    maxConcurrent: 2,
    launchBudget: 5,
  };

  it('saves through the native command and resolves with the stored row', async () => {
    native.save.mockImplementation(async (row: LaunchGrant) => ({ ...grant(), id: row.id }));
    const changed = vi.fn();
    window.addEventListener(LAUNCH_GRANTS_CHANGED_EVENT, changed);

    const saved = await saveLaunchGrant(input);

    window.removeEventListener(LAUNCH_GRANTS_CHANGED_EVENT, changed);
    expect(native.save).toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: REPO, rootGoalId: 'root', maxConcurrent: 2 })
    );
    expect(saved.id).toBe(native.save.mock.calls[0][0].id);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('clamps limits to the hard ceilings before they reach the database', async () => {
    native.save.mockImplementation(async (row: LaunchGrant) => ({ ...grant(), ...row }));
    await saveLaunchGrant({ ...input, maxConcurrent: 99, launchBudget: 10_000 });
    expect(native.save.mock.calls[0][0]).toMatchObject({
      maxConcurrent: MAX_GRANT_CONCURRENT,
      launchBudget: MAX_GRANT_BUDGET,
    });
  });

  it('refuses a grant without a project or root before writing', async () => {
    await expect(saveLaunchGrant({ ...input, projectPath: ' ' })).rejects.toThrow();
    await expect(saveLaunchGrant({ ...input, rootGoalId: '' })).rejects.toThrow();
    expect(native.save).not.toHaveBeenCalled();
  });

  it('rejects, and announces nothing, when the database does not acknowledge a save', async () => {
    native.save.mockRejectedValue(new Error('disk I/O error'));
    const changed = vi.fn();
    window.addEventListener(LAUNCH_GRANTS_CHANGED_EVENT, changed);

    await expect(saveLaunchGrant(input)).rejects.toThrow('disk I/O error');

    window.removeEventListener(LAUNCH_GRANTS_CHANGED_EVENT, changed);
    expect(changed).not.toHaveBeenCalled();
  });

  it('rejects when a revoke is not acknowledged', async () => {
    native.revoke.mockRejectedValue(new Error('database is locked'));
    await expect(revokeLaunchGrant('g1')).rejects.toThrow('database is locked');
  });

  it('finds the grant for a root among the project grants', async () => {
    native.list.mockResolvedValue([grant(), grant({ id: 'g2', rootGoalId: 'other-root' })]);
    expect((await grantForRoot(REPO, 'other-root'))?.id).toBe('g2');
    expect(await grantForRoot(REPO, 'ghost')).toBeNull();
    expect(native.list).toHaveBeenCalledWith(REPO);
  });

  it('passes a read failure on instead of reading it as "no grants"', async () => {
    native.list.mockRejectedValue(new Error('unreadable'));
    await expect(listLaunchGrants(REPO)).rejects.toThrow('unreadable');
  });
});

describe('a grant cannot come from a model', () => {
  let projectDb: Database.Database;
  let inboxDb: Database.Database;

  beforeEach(() => {
    projectDb = createTestDb();
    inboxDb = createTestNotificationsDb();
  });

  function toolNames(): string[] {
    const names: string[] = [];
    const server = { addTool: (t: { name: string }) => names.push(t.name) } as unknown as FastMCP;
    registerNotificationTools(server, inboxDb, { projectPath: REPO });
    registerAgentLaunchTools(server, projectDb, inboxDb, { projectPath: REPO });
    return names;
  }

  it('offers no MCP tool that writes a grant', () => {
    expect(toolNames().filter((name) => /grant|permit|allow/i.test(name))).toEqual([]);
  });

  // The grant table is created by the MCP side's schema mirror so both sides
  // agree on the schema; no MCP code may read or write it.
  it('has no MCP code that touches the grant table outside the schema mirror', () => {
    const root = join(process.cwd(), 'src/mcp');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
          const text = readFileSync(path, 'utf8');
          const uses = text.split(/agent_launch_grants(?!_)/).length - 1;
          const mirrored = entry.name === 'notificationsDb.ts' ? 3 : 0; // CREATE, INDEX ON, migration name
          if (uses > mirrored) offenders.push(path);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('does not turn a grant sent with the request into one', async () => {
    const { createGoal } = await import('@/mcp/tools/goalsDb');
    const root = createGoal(projectDb, { name: 'Mission' }, 'test').id;
    const names = new Map<string, { execute: (a: unknown) => Promise<string> }>();
    const server = {
      addTool: (t: { name: string; execute: (a: unknown) => Promise<string> }) =>
        names.set(t.name, t),
    } as unknown as FastMCP;
    registerAgentLaunchTools(server, projectDb, inboxDb, {
      projectPath: REPO,
      agentCwd: realpathSync(tmpdir()),
    });

    // The request schema is strict: a smuggled grant is refused by name and
    // nothing is written, let alone a grant.
    await expect(
      names.get('request_agent_launch')!.execute({
        prompt: 'work',
        goalId: root,
        grant: grant({ rootGoalId: root }),
      })
    ).rejects.toThrow(/grant/);

    expect(native.save).not.toHaveBeenCalled();
    expect(inboxDb.prepare('SELECT COUNT(*) AS n FROM notifications').get()).toEqual({ n: 0 });
  });
});
