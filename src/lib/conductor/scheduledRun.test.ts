import { describe, expect, it, vi } from 'vitest';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import dedupeKeyFixture from './scheduleDedupeKey.fixtures.json';
import {
  AUTO_START_FRESHNESS_MS,
  PROJECT_LOAD_TIMEOUT_MS,
  UNATTENDED_AFTER_MS,
  autoConductorLaunches,
  gateRefusalMessage,
  isFreshOccurrence,
  launchScheduledConductor,
  scheduleOccurrenceMs,
  scheduledRunGate,
  type ScheduledRunDeps,
  type ScheduledRunSnapshot,
} from './scheduledRun';

const REPO = '/tmp/project-a';

function snapshot(overrides: Partial<ScheduledRunSnapshot> = {}): ScheduledRunSnapshot {
  return {
    rootPath: REPO,
    conductorRunning: false,
    runningAgentCount: 0,
    dirtyTabCount: 0,
    idleForMs: UNATTENDED_AFTER_MS,
    ...overrides,
  };
}

describe('scheduledRunGate', () => {
  it('refuses when a conductor run is already active, even for the open project', () => {
    const verdict = scheduledRunGate(snapshot({ conductorRunning: true }), REPO);
    expect(verdict).toEqual({ ok: false, reason: 'conductor-running' });
  });

  it('refuses when an agent is running, before any project comparison', () => {
    const verdict = scheduledRunGate(snapshot({ runningAgentCount: 1, rootPath: null }), REPO);
    expect(verdict).toEqual({ ok: false, reason: 'agents-running' });
  });

  it('allows a run against the already-open project without an idle or dirty-tab check', () => {
    const verdict = scheduledRunGate(
      snapshot({ rootPath: REPO, dirtyTabCount: 3, idleForMs: 0 }),
      REPO
    );
    expect(verdict).toEqual({ ok: true, needsSwitch: false });
  });

  it('allows opening into an empty IDE without an idle or dirty-tab check', () => {
    const verdict = scheduledRunGate(snapshot({ rootPath: null, idleForMs: 0 }), REPO);
    expect(verdict).toEqual({ ok: true, needsSwitch: true });
  });

  it('refuses a switch away from a different project with unsaved tabs', () => {
    const verdict = scheduledRunGate(
      snapshot({ rootPath: '/tmp/project-b', dirtyTabCount: 1 }),
      REPO
    );
    expect(verdict).toEqual({ ok: false, reason: 'dirty-tabs' });
  });

  it('refuses a switch while the window was used recently', () => {
    const verdict = scheduledRunGate(
      snapshot({
        rootPath: '/tmp/project-b',
        dirtyTabCount: 0,
        idleForMs: UNATTENDED_AFTER_MS - 1,
      }),
      REPO
    );
    expect(verdict).toEqual({ ok: false, reason: 'in-use' });
  });

  it('allows a switch once clean and idle for the full unattended window', () => {
    const verdict = scheduledRunGate(
      snapshot({ rootPath: '/tmp/project-b', dirtyTabCount: 0, idleForMs: UNATTENDED_AFTER_MS }),
      REPO
    );
    expect(verdict).toEqual({ ok: true, needsSwitch: true });
  });
});

describe('the schedule dedupe key contract', () => {
  // Rust writes the key (schedules.rs, schedule_dedupe_key) and is tested
  // against the same fixture — the one place both readings of the format meet.
  it('reads the occurrence Rust wrote, as UTC', () => {
    expect(scheduleOccurrenceMs(dedupeKeyFixture.dedupeKey)).toBe(dedupeKeyFixture.occurrenceMs);
  });
});

describe('scheduleOccurrenceMs', () => {
  it('reads the UTC occurrence time out of a schedule dedupe key', () => {
    const ms = scheduleOccurrenceMs('schedule:abc-123:2026-08-17 09:30:00');
    expect(ms).toBe(Date.UTC(2026, 7, 17, 9, 30, 0));
  });

  it('returns null for a key that is not a schedule key', () => {
    expect(scheduleOccurrenceMs('goal:g1:achieved')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(scheduleOccurrenceMs(null)).toBeNull();
  });

  it('returns null for a malformed occurrence suffix', () => {
    expect(scheduleOccurrenceMs('schedule:abc-123:not-a-date')).toBeNull();
  });
});

describe('isFreshOccurrence', () => {
  const occurredAt = Date.UTC(2026, 7, 17, 9, 30, 0);
  const key = 'schedule:abc-123:2026-08-17 09:30:00';

  it('is fresh right at the occurrence time', () => {
    expect(isFreshOccurrence(key, occurredAt)).toBe(true);
  });

  it('is fresh just inside the freshness window', () => {
    expect(isFreshOccurrence(key, occurredAt + AUTO_START_FRESHNESS_MS)).toBe(true);
  });

  it('is stale just past the freshness window', () => {
    expect(isFreshOccurrence(key, occurredAt + AUTO_START_FRESHNESS_MS + 1)).toBe(false);
  });

  it('tolerates a small clock skew into the future', () => {
    expect(isFreshOccurrence(key, occurredAt - 60_000)).toBe(true);
  });

  it('rejects an occurrence more than a minute in the future', () => {
    expect(isFreshOccurrence(key, occurredAt - 60_001)).toBe(false);
  });

  it('is never fresh when the key does not parse', () => {
    expect(isFreshOccurrence(null, occurredAt)).toBe(false);
  });
});

describe('autoConductorLaunches', () => {
  const nowMs = Date.UTC(2026, 7, 17, 9, 35, 0);
  const freshKey = 'schedule:s1:2026-08-17 09:30:00';
  const staleKey = 'schedule:s1:2026-08-17 08:00:00';

  const autoAction: Extract<NotificationAction, { kind: 'run-conductor' }> = {
    id: 'start',
    label: 'Start',
    kind: 'run-conductor',
    repoPath: REPO,
    ticketBudget: 5,
    launch: 'auto',
  };

  function notification(overrides: Partial<Notification> = {}): Notification {
    return {
      id: 1,
      uid: 'n1',
      createdAt: '2026-08-17 09:30:00',
      projectPath: null,
      projectName: null,
      source: 'system',
      origin: 'Nightly A',
      kind: 'info',
      severity: 'info',
      title: 'Scheduled run',
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

  it('includes a trusted, fresh, unread auto launch', () => {
    const n = notification();
    const result = autoConductorLaunches([n], parseOne([autoAction]), nowMs);
    expect(result).toEqual([{ notification: n, action: autoAction }]);
  });

  it('excludes a launch whose occurrence has gone stale', () => {
    const n = notification({ dedupeKey: staleKey });
    const result = autoConductorLaunches([n], parseOne([autoAction]), nowMs);
    expect(result).toEqual([]);
  });

  it('excludes a payload written by an agent, not a person', () => {
    const n = notification({ source: 'agent' });
    const result = autoConductorLaunches([n], parseOne([autoAction]), nowMs);
    expect(result).toEqual([]);
  });

  it('excludes an already-read notification', () => {
    const n = notification({ readAt: '2026-08-17 09:31:00' });
    const result = autoConductorLaunches([n], parseOne([autoAction]), nowMs);
    expect(result).toEqual([]);
  });

  it('excludes an already-answered notification', () => {
    const n = notification({ answeredAt: '2026-08-17 09:31:00', answer: 'start' });
    const result = autoConductorLaunches([n], parseOne([autoAction]), nowMs);
    expect(result).toEqual([]);
  });

  it('excludes a run-conductor action whose launch is a button, not auto', () => {
    const n = notification();
    const directAction = { ...autoAction, launch: 'direct' as const };
    const result = autoConductorLaunches([n], parseOne([directAction]), nowMs);
    expect(result).toEqual([]);
  });

  it('ignores actions of other kinds on the same notification', () => {
    const n = notification();
    const openAction: NotificationAction = {
      id: 'open',
      label: 'Open',
      kind: 'open',
      target: { type: 'goal', goalId: 'g1' },
    };
    const result = autoConductorLaunches([n], parseOne([openAction, autoAction]), nowMs);
    expect(result).toEqual([{ notification: n, action: autoAction }]);
  });
});

describe('gateRefusalMessage', () => {
  it('names the schedule and the reason for each refusal', () => {
    expect(gateRefusalMessage('conductor-running', 'Nightly A')).toContain('Nightly A');
    expect(gateRefusalMessage('conductor-running', 'Nightly A')).toMatch(/conductor/i);
    expect(gateRefusalMessage('agents-running', 'Nightly A')).toMatch(/agent/i);
    expect(gateRefusalMessage('dirty-tabs', 'Nightly A')).toMatch(/unsaved|dirty/i);
    expect(gateRefusalMessage('in-use', 'Nightly A')).toMatch(/use/i);
  });
});

describe('launchScheduledConductor', () => {
  function buildDeps(overrides: Partial<ScheduledRunDeps> = {}): {
    deps: ScheduledRunDeps;
    calls: Record<string, unknown[][]>;
  } {
    const calls: Record<string, unknown[][]> = {
      startConductor: [],
      conductorTick: [],
      prepareConductorPanel: [],
      toast: [],
      openProject: [],
      readyTicketCount: [],
    };
    const deps: ScheduledRunDeps = {
      getState: () => ({
        rootPath: REPO,
        pmLoading: false,
        goalsLoading: false,
        conductorRunning: false,
      }),
      openProject: async (path) => {
        calls.openProject.push([path]);
      },
      waitUntil: async () => true,
      startConductor: (goalId, options) => {
        calls.startConductor.push([goalId, options]);
      },
      conductorTick: async () => {
        calls.conductorTick.push([]);
      },
      prepareConductorPanel: (input) => {
        calls.prepareConductorPanel.push([input]);
      },
      toast: (message, variant) => {
        calls.toast.push([message, variant]);
      },
      readyTicketCount: (goalId) => {
        calls.readyTicketCount.push([goalId]);
        return 3;
      },
      ...overrides,
    };
    return { deps, calls };
  }

  it('refuses to start while a conductor run is already active — a click must not restart it', async () => {
    const { deps, calls } = buildDeps({
      getState: () => ({
        rootPath: REPO,
        pmLoading: false,
        goalsLoading: false,
        conductorRunning: true,
      }),
    });
    const outcome = await launchScheduledConductor(
      { repoPath: REPO, ticketBudget: 5, maxConcurrent: 1, requireReview: false, mode: 'direct' },
      deps
    );

    expect(outcome).toBe('busy');
    expect(calls.startConductor).toEqual([]);
    expect(calls.openProject).toEqual([]);
    expect(calls.toast[0]?.[1]).toBe('info');
  });

  it('refuses to switch projects while a conductor run is active, even for the panel', async () => {
    const { deps, calls } = buildDeps({
      getState: () => ({
        rootPath: '/tmp/project-b',
        pmLoading: false,
        goalsLoading: false,
        conductorRunning: true,
      }),
    });
    const outcome = await launchScheduledConductor(
      { repoPath: REPO, ticketBudget: 5, maxConcurrent: 1, requireReview: false, mode: 'dialog' },
      deps
    );

    expect(outcome).toBe('busy');
    expect(calls.openProject).toEqual([]);
    expect(calls.prepareConductorPanel).toEqual([]);
  });

  it('starts directly in the already-open project without switching', async () => {
    const { deps, calls } = buildDeps();
    const outcome = await launchScheduledConductor(
      {
        repoPath: REPO,
        ticketBudget: 5,
        maxConcurrent: 1,
        goalId: 'g1',
        requireReview: true,
        mode: 'direct',
        origin: 'Nightly A',
      },
      deps
    );

    expect(outcome).toBe('started');
    expect(calls.openProject).toEqual([]);
    expect(calls.startConductor).toEqual([
      ['g1', { ticketBudget: 5, maxConcurrent: 1, requireReview: true, origin: 'Nightly A' }],
    ]);
    expect(calls.conductorTick).toHaveLength(1);
    expect(calls.toast[0]?.[1]).toBe('success');
  });

  describe('a cycle with nothing to work on', () => {
    // A schedule that fires on an empty backlog is the normal case, not an
    // error: the nightly run comes round whether or not anyone filed tickets
    // that day. Starting anyway costs a run that immediately reports itself
    // finished, and — worse for an unattended IDE — a scope holding only
    // blocked or approval-gated tickets never reaches a finished state at all,
    // so the run parks and every later schedule refuses behind it.
    it('skips instead of starting a run that has nothing to spawn', async () => {
      const { deps, calls } = buildDeps({ readyTicketCount: () => 0 });

      const outcome = await launchScheduledConductor(
        {
          repoPath: REPO,
          ticketBudget: 5,
          maxConcurrent: 1,
          requireReview: false,
          mode: 'direct',
          origin: 'Nightly A',
        },
        deps
      );

      expect(outcome).toBe('skipped');
      expect(calls.startConductor).toEqual([]);
      expect(calls.conductorTick).toEqual([]);
      // Said out loud, not swallowed: a cycle that did nothing still has to be
      // tellable apart from one that never fired.
      expect(calls.toast).toHaveLength(1);
      expect(String(calls.toast[0][0])).toContain('Nightly A');
      expect(calls.toast[0][1]).toBe('info');
    });

    it('counts what is ready inside the run’s own scope', async () => {
      const { deps, calls } = buildDeps();

      await launchScheduledConductor(
        {
          repoPath: REPO,
          ticketBudget: 5,
          maxConcurrent: 1,
          goalId: 'g1',
          requireReview: false,
          mode: 'direct',
        },
        deps
      );

      expect(calls.readyTicketCount).toEqual([['g1']]);
    });

    it('still pre-fills the panel — an empty scope is a human’s to look at', async () => {
      const { deps, calls } = buildDeps({ readyTicketCount: () => 0 });

      const outcome = await launchScheduledConductor(
        { repoPath: REPO, ticketBudget: 5, maxConcurrent: 1, requireReview: false, mode: 'dialog' },
        deps
      );

      expect(outcome).toBe('prepared');
      expect(calls.prepareConductorPanel).toHaveLength(1);
    });

    it('counts only after the switched-to project has finished loading', async () => {
      // Counting before the load lands reads an empty backlog for every
      // project switch, which would skip every scheduled run that needed one.
      const order: string[] = [];
      const { deps } = buildDeps({
        getState: () => ({
          rootPath: '/tmp/project-b',
          pmLoading: false,
          goalsLoading: false,
          conductorRunning: false,
        }),
        waitUntil: async () => {
          order.push('loaded');
          return true;
        },
        readyTicketCount: () => {
          order.push('counted');
          return 1;
        },
      });

      await launchScheduledConductor(
        { repoPath: REPO, ticketBudget: 5, maxConcurrent: 1, requireReview: false, mode: 'direct' },
        deps
      );

      expect(order).toEqual(['loaded', 'counted']);
    });
  });

  it('opens the target project and waits for it to load before starting', async () => {
    const { deps, calls } = buildDeps({
      getState: () => ({
        rootPath: '/tmp/project-b',
        pmLoading: false,
        goalsLoading: false,
        conductorRunning: false,
      }),
      waitUntil: vi.fn(async () => true),
    });

    const outcome = await launchScheduledConductor(
      { repoPath: REPO, ticketBudget: 3, maxConcurrent: 1, requireReview: false, mode: 'direct' },
      deps
    );

    expect(outcome).toBe('started');
    expect(calls.openProject).toEqual([[REPO]]);
    expect(deps.waitUntil).toHaveBeenCalledWith(expect.any(Function), PROJECT_LOAD_TIMEOUT_MS);
    expect(calls.startConductor).toHaveLength(1);
  });

  it('reports a timeout and never starts when the project fails to finish loading', async () => {
    const { deps, calls } = buildDeps({
      getState: () => ({
        rootPath: '/tmp/project-b',
        pmLoading: false,
        goalsLoading: false,
        conductorRunning: false,
      }),
      waitUntil: async () => false,
    });

    const outcome = await launchScheduledConductor(
      { repoPath: REPO, ticketBudget: 3, maxConcurrent: 1, requireReview: false, mode: 'direct' },
      deps
    );

    expect(outcome).toBe('timeout');
    expect(calls.startConductor).toEqual([]);
    expect(calls.toast[0]?.[1]).toBe('error');
  });

  it('opens the Conductor panel instead of starting when mode is dialog', async () => {
    const { deps, calls } = buildDeps();

    const outcome = await launchScheduledConductor(
      {
        repoPath: REPO,
        ticketBudget: 4,
        maxConcurrent: 2,
        goalId: 'g2',
        requireReview: true,
        mode: 'dialog',
      },
      deps
    );

    expect(outcome).toBe('prepared');
    expect(calls.startConductor).toEqual([]);
    expect(calls.prepareConductorPanel).toEqual([
      [{ goalId: 'g2', maxConcurrent: 2, requireReview: true }],
    ]);
  });

  it('the wait predicate does not resolve until the target project matches and both loads are finished', async () => {
    const states = [
      {
        rootPath: '/tmp/project-b',
        pmLoading: false,
        goalsLoading: false,
        conductorRunning: false,
      }, // before the switch
      { rootPath: REPO, pmLoading: true, goalsLoading: false, conductorRunning: false }, // switched, pm still loading
      { rootPath: REPO, pmLoading: false, goalsLoading: true, conductorRunning: false }, // pm done, goals still loading
      { rootPath: REPO, pmLoading: false, goalsLoading: false, conductorRunning: false }, // fully loaded
    ];
    let index = 0;
    let capturedPred: (() => boolean) | undefined;
    const { deps } = buildDeps({
      getState: () => states[index],
      openProject: async () => {
        index = 1;
      },
      waitUntil: async (pred) => {
        capturedPred = pred;
        return true;
      },
    });

    await launchScheduledConductor(
      { repoPath: REPO, ticketBudget: 1, maxConcurrent: 1, requireReview: false, mode: 'direct' },
      deps
    );

    expect(capturedPred).toBeDefined();
    index = 1;
    expect(capturedPred!()).toBe(false);
    index = 2;
    expect(capturedPred!()).toBe(false);
    index = 3;
    expect(capturedPred!()).toBe(true);
  });
});
