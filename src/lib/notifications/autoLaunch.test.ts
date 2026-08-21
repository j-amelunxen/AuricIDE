import { describe, expect, it } from 'vitest';
import type { Notification, NotificationAction } from './types';
import { autoAgentLaunches } from './autoLaunch';

const REPO = '/tmp/project-a';
const nowMs = Date.UTC(2026, 7, 17, 9, 35, 0);
const freshKey = 'schedule:s1:2026-08-17 09:30:00';
const staleKey = 'schedule:s1:2026-08-17 08:00:00';

const spawnAuto: Extract<NotificationAction, { kind: 'spawn-agent' }> = {
  id: 'run',
  label: 'Start agent',
  kind: 'spawn-agent',
  task: 'scan',
  repoPath: REPO,
  launch: 'auto',
  headless: true,
};

const skillAuto: Extract<NotificationAction, { kind: 'run-skill' }> = {
  id: 'run',
  label: 'Start Changelog',
  kind: 'run-skill',
  skillId: 's1',
  skillLabel: 'Changelog',
  prompt: '/changelog',
  repoPath: REPO,
  launch: 'auto',
  headless: true,
};

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 1,
    uid: 'n1',
    createdAt: '2026-08-17 09:30:00',
    projectPath: null,
    projectName: null,
    source: 'system',
    origin: 'Nightly scan',
    kind: 'info',
    severity: 'info',
    title: 'Scheduled agent',
    body: null,
    actions: [],
    dedupeKey: freshKey,
    refKind: null,
    refId: null,
    readAt: null,
    answeredAt: null,
    answer: null,
    expiresAt: null,
    ...overrides,
  };
}

const parseOne =
  (actions: NotificationAction[]) =>
  (_n: Notification): NotificationAction[] =>
    actions;

describe('autoAgentLaunches', () => {
  it('includes a trusted, fresh, unread spawn-agent auto launch', () => {
    const n = notification();
    expect(autoAgentLaunches([n], parseOne([spawnAuto]), nowMs)).toEqual([
      { notification: n, action: spawnAuto },
    ]);
  });

  it('includes a trusted, fresh, unread run-skill auto launch', () => {
    const n = notification();
    expect(autoAgentLaunches([n], parseOne([skillAuto]), nowMs)).toEqual([
      { notification: n, action: skillAuto },
    ]);
  });

  it('excludes a launch whose occurrence has gone stale', () => {
    const n = notification({ dedupeKey: staleKey });
    expect(autoAgentLaunches([n], parseOne([spawnAuto]), nowMs)).toEqual([]);
  });

  it('excludes a payload written by an agent, not a person', () => {
    const n = notification({ source: 'agent' });
    expect(autoAgentLaunches([n], parseOne([spawnAuto]), nowMs)).toEqual([]);
  });

  it('excludes an already-read notification', () => {
    const n = notification({ readAt: '2026-08-17 09:31:00' });
    expect(autoAgentLaunches([n], parseOne([spawnAuto]), nowMs)).toEqual([]);
  });

  it('excludes a spawn-agent whose launch is a button, not auto', () => {
    const n = notification();
    expect(autoAgentLaunches([n], parseOne([{ ...spawnAuto, launch: 'direct' }]), nowMs)).toEqual(
      []
    );
  });

  it('excludes a run-skill whose launch is a button, not auto', () => {
    const n = notification();
    expect(autoAgentLaunches([n], parseOne([{ ...skillAuto, launch: 'direct' }]), nowMs)).toEqual(
      []
    );
  });

  it('excludes a run-conductor action — that path has its own gate', () => {
    const n = notification();
    const conductor: NotificationAction = {
      id: 'start',
      label: 'Start',
      kind: 'run-conductor',
      repoPath: REPO,
      ticketBudget: 5,
      launch: 'auto',
    };
    expect(autoAgentLaunches([n], parseOne([conductor]), nowMs)).toEqual([]);
  });

  it('excludes a combo — those wait between steps', () => {
    const n = notification();
    const combo: NotificationAction = {
      id: 'run',
      label: 'Start combo',
      kind: 'run-combo',
      comboId: 'c1',
      comboLabel: 'Blog',
      repoPath: REPO,
      steps: [{ id: 's1', label: 'Draft', prompt: '/draft' }],
    };
    expect(autoAgentLaunches([n], parseOne([combo]), nowMs)).toEqual([]);
  });
});
