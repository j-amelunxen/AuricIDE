import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '@/mcp/db';
import { createTestNotificationsDb } from '@/mcp/notificationsDb';
import { createGoal } from '@/mcp/tools/goalsDb';
import { requestAgentLaunch } from '@/mcp/tools/agentLaunch';
import { SPAWN_DEFAULTS_KEY } from '@/lib/agents/spawnDefaults';
import { autoAgentLaunches } from './autoLaunch';
import { buildSpawnConfig } from './execute';
import { isLaunchRequest } from './launchRequest';
import { notificationTrust } from './trust';
import { parseNotificationActions, type Notification, type NotificationAction } from './types';

/** The requesting agent's folder as the IDE hands it to the MCP server. */
const AGENT_DIR = realpathSync(tmpdir());

/** The row as the IDE reads it back — the same mapping the Rust drain does. */
function toNotification(row: Record<string, unknown>): Notification {
  return {
    id: row.id as number,
    uid: row.uid as string,
    createdAt: row.created_at as string,
    projectPath: row.project_path as string | null,
    projectName: row.project_name as string | null,
    source: row.source as Notification['source'],
    origin: row.origin as string | null,
    kind: row.kind as Notification['kind'],
    severity: row.severity as Notification['severity'],
    title: row.title as string,
    body: row.body as string | null,
    actions: row.actions,
    dedupeKey: row.dedupe_key as string | null,
    refKind: row.ref_kind as Notification['refKind'],
    refId: row.ref_id as string | null,
    readAt: row.read_at as string | null,
    answeredAt: row.answered_at as string | null,
    answer: row.answer as string | null,
    expiresAt: row.expires_at as string | null,
  };
}

const parse = (n: Notification): NotificationAction[] =>
  parseNotificationActions(n.actions, () => false);

describe('a launch request as the IDE sees it', () => {
  let projectDb: Database.Database;
  let inboxDb: Database.Database;
  let goalId: string;

  beforeEach(() => {
    localStorage.clear();
    projectDb = createTestDb();
    inboxDb = createTestNotificationsDb();
    goalId = createGoal(projectDb, { name: 'Ship it' }, 'test').id;
  });

  const requested = (args: Record<string, unknown> = {}): Notification => {
    const { uid } = requestAgentLaunch(
      projectDb,
      inboxDb,
      { prompt: 'Work on the goal', goalId, ...args },
      { projectPath: '/repo/auric', projectName: 'auric', agentCwd: AGENT_DIR }
    );
    return toNotification(
      inboxDb.prepare('SELECT * FROM notifications WHERE uid = ?').get(uid) as Record<
        string,
        unknown
      >
    );
  };

  /** The context a click on the request builds (`useNotificationActions`). */
  const onClick = (row: ReturnType<typeof requested>) => ({
    trust: notificationTrust(row),
    launchRequestUid: row.uid,
    launchProjectPath: row.projectPath ?? undefined,
    notificationUid: row.uid,
  });

  it('is recognised as a launch request', () => {
    expect(isLaunchRequest(requested())).toBe(true);
  });

  it('is not a launch request when it is a plain notify', () => {
    const plain = { ...requested(), dedupeKey: null };
    expect(isLaunchRequest(plain)).toBe(false);
  });

  it('is not a launch request when another origin wrote the same key', () => {
    expect(isLaunchRequest({ ...requested(), origin: 'my-agent' })).toBe(false);
  });

  it('is not a launch request unless an agent wrote it', () => {
    expect(isLaunchRequest({ ...requested(), source: 'ui' })).toBe(false);
  });

  it('is read as foreign, whatever it says about itself', () => {
    expect(notificationTrust(requested())).toBe('foreign');
  });

  it('survives the UI parse with every field of the action intact', () => {
    const [action] = parse(requested({ provider: 'codex', model: 'm', worktree: true }));

    expect(action).toMatchObject({
      kind: 'spawn-agent',
      task: 'Work on the goal',
      repoPath: AGENT_DIR,
      goalId,
      provider: 'codex',
      model: 'm',
      useWorktree: true,
    });
  });

  // Without a grant the request is a button and nothing else.
  it('never qualifies for the schedule auto-start on its own', () => {
    expect(autoAgentLaunches([requested()], parse, Date.now())).toEqual([]);
  });

  it('builds a goal-bound launch in the project on click', () => {
    const row = requested();
    const [action] = parse(row);
    const config = buildSpawnConfig(
      action as Extract<NotificationAction, { kind: 'spawn-agent' }>,
      {
        trust: 'foreign',
        launchRequestUid: row.uid,
        launchProjectPath: row.projectPath ?? undefined,
      }
    );

    expect(config.cwd).toBe(AGENT_DIR);
    expect(config.projectPath).toBe('/repo/auric');
    expect(config.spawnedByGoalId).toBe(goalId);
    expect(config.task).toBe('Work on the goal');
  });

  it('asks for a worktree of the project when the request said so', () => {
    const row = requested({ worktree: true });
    const [action] = parse(row);
    const config = buildSpawnConfig(
      action as Extract<NotificationAction, { kind: 'spawn-agent' }>,
      onClick(row)
    );

    expect(config.useWorktree).toBe(true);
    expect(config.worktreeRepoPath).toBe(AGENT_DIR);
  });

  it('runs in the checkout itself when no worktree was asked for', () => {
    const row = requested();
    const [action] = parse(row);
    const config = buildSpawnConfig(
      action as Extract<NotificationAction, { kind: 'spawn-agent' }>,
      onClick(row)
    );

    expect(config.useWorktree).toBeUndefined();
  });

  // Rights come from the last launch in that folder, never from the request.
  it('takes the permission mode from the remembered defaults, not the payload', () => {
    localStorage.setItem(
      SPAWN_DEFAULTS_KEY,
      JSON.stringify({
        providerId: 'claude',
        model: 'opus',
        permissionMode: 'default',
        headless: false,
      })
    );
    const row = requested();
    const forged = {
      ...row,
      actions: JSON.stringify([
        { ...parse(row)[0], permissionMode: 'bypassPermissions', headless: true },
      ]),
    };
    const [action] = parse(forged);
    const config = buildSpawnConfig(
      action as Extract<NotificationAction, { kind: 'spawn-agent' }>,
      onClick(forged)
    );

    expect(config.permissionMode).not.toBe('bypassPermissions');
    expect(config.headless).not.toBe(true);
  });

  // The chosen provider reaches the spawn untouched, whichever it is; the
  // Rust spawn path then applies the project policy one last time.
  it.each(['claude', 'codex', 'grok'])('launches the requested %s provider', (provider) => {
    localStorage.setItem(
      SPAWN_DEFAULTS_KEY,
      JSON.stringify({
        providerId: 'claude',
        model: 'opus',
        permissionMode: 'default',
        headless: false,
      })
    );
    const row = requested({ provider });
    const [action] = parse(row);
    const config = buildSpawnConfig(
      action as Extract<NotificationAction, { kind: 'spawn-agent' }>,
      onClick(row)
    );

    expect(config.provider).toBe(provider);
  });

  it('carries the request uid into the launch so the run can be reported', () => {
    const row = requested();
    const [action] = parse(row);
    const config = buildSpawnConfig(
      action as Extract<NotificationAction, { kind: 'spawn-agent' }>,
      {
        launchRequestUid: row.uid,
        launchProjectPath: row.projectPath ?? undefined,
      }
    );

    expect(config.launchRequestUid).toBe(row.uid);
    expect(config.projectPath).toBe('/repo/auric');
    expect(config.cwd).toBe(AGENT_DIR);
  });
});
