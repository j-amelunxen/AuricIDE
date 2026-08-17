'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { defaultCommands } from '@/lib/commands/registry';
import { executeNotificationAction, NotificationActionError } from '@/lib/notifications/execute';
import { notificationTrust } from '@/lib/notifications/trust';
import {
  presentNotificationActions,
  type PresentedAction,
  type RepoDirStatus,
} from '@/lib/notifications/presentActions';
import { openSkillSpawnDialog } from '@/lib/quickAccess/launchSkill';
import { launchScheduledConductor } from '@/lib/conductor/scheduledRun';
import { buildScheduledRunDeps } from '@/lib/conductor/scheduledRunDeps';
import { isDir } from '@/lib/tauri/fs';
import {
  parseNotificationActions,
  type Notification,
  type NotificationAction,
} from '@/lib/notifications/types';

export interface UseNotificationActionsInput {
  /** Every row the caller can show — the probe list is derived from it. */
  notifications: Notification[];
  /** Runs a command from the manifest — the same dispatch the palette uses. */
  onRunCommand: (commandId: string) => void;
  /** Opens (or switches to) a project — `handleOpenRecent`, for a `run-conductor` click. */
  onOpenProject: (path: string) => Promise<void>;
}

export interface UseNotificationActionsResult {
  parseActions: (notification: Notification) => PresentedAction[];
  handleAction: (notification: Notification, action: NotificationAction) => Promise<void>;
  handleOpen: (uid: string) => void;
  /** Render this in the caller's tree — the project-switch question lives here. */
  confirmDialog: React.ReactNode;
}

const KNOWN_COMMAND_IDS = new Set(defaultCommands.map((command) => command.id));

const isKnownCommandId = (id: string) => KNOWN_COMMAND_IDS.has(id);

function repoPathsFromNotifications(notifications: Notification[]): string[] {
  const paths = new Set<string>();
  for (const notification of notifications) {
    for (const action of parseNotificationActions(notification.actions, isKnownCommandId)) {
      if (
        (action.kind === 'run-skill' ||
          action.kind === 'run-combo' ||
          action.kind === 'run-conductor' ||
          action.kind === 'spawn-agent') &&
        action.repoPath
      ) {
        paths.add(action.repoPath);
      }
    }
  }
  return [...paths];
}

/**
 * The one path from a notification button to something happening.
 *
 * Tray and Command Center both render inbox rows, and a click has to mean the
 * same thing in either — same trust rule, same settling of a question, same
 * question before a project switch. Two copies of this would let the same
 * payload run with different authority depending on which surface it was
 * clicked in, and nothing at the button would show it.
 */
export function useNotificationActions({
  notifications,
  onRunCommand,
  onOpenProject,
}: UseNotificationActionsInput): UseNotificationActionsResult {
  const { confirm, confirmDialog } = useConfirm();

  const rootPath = useStore((s) => s.rootPath);
  const starredProjects = useStore((s) => s.starredProjects);
  const markNotificationRead = useStore((s) => s.markNotificationRead);

  const [repoDirStatus, setRepoDirStatus] = useState<Map<string, RepoDirStatus>>(new Map());
  const probedPaths = useRef(new Set<string>());

  const writeRepoDir = useCallback((path: string, ok: boolean) => {
    setRepoDirStatus((prev) => {
      const next = new Map(prev);
      next.set(path, ok ? 'dir' : 'missing');
      return next;
    });
  }, []);

  const parseActions = useCallback(
    (notification: Notification): PresentedAction[] =>
      presentNotificationActions(
        parseNotificationActions(notification.actions, isKnownCommandId),
        starredProjects,
        repoDirStatus,
        rootPath
      ),
    [starredProjects, repoDirStatus, rootPath]
  );

  // Probe each new repoPath once. Absent / in-flight reads as unknown (button
  // stays enabled). 'dir' stays trusted until click-time execute; 'missing' is
  // re-checked on window focus so a restored folder can re-enable.
  useEffect(() => {
    for (const path of repoPathsFromNotifications(notifications)) {
      if (probedPaths.current.has(path)) continue;
      probedPaths.current.add(path);
      void isDir(path)
        .then((ok) => writeRepoDir(path, ok))
        .catch(() => {
          // Stay 'unknown': click-time execute still gates a vanished folder.
        });
    }
  }, [notifications, writeRepoDir]);

  useEffect(() => {
    const onFocus = () => {
      for (const [path, status] of repoDirStatus) {
        if (status !== 'missing') continue;
        void isDir(path)
          .then((ok) => writeRepoDir(path, ok))
          .catch(() => {
            // Keep the last known 'missing'; the next focus can try again.
          });
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [repoDirStatus, writeRepoDir]);

  const handleAction = useCallback(
    async (notification: Notification, action: NotificationAction) => {
      const store = useStore.getState();

      // Every action on a question settles it, not just an `answer` one — and
      // it is stamped before the effect runs, so a spawn that fails still
      // leaves the decision recorded rather than re-asking.
      if (notification.kind === 'ask') {
        await store.answerNotification(notification.uid, action.id);
      } else {
        await store.markNotificationRead(notification.uid);
      }

      try {
        await executeNotificationAction(
          action,
          {
            // Selected on the way out, so the agent this click started is the
            // one the terminal is showing. A launch you cannot see is the same
            // problem as a launch that never happened.
            spawnAgent: async (config) => {
              const agent = await store.spawnNewAgent(config);
              store.selectAgent(agent.id);
              store.showToast(`${agent.name} started`, 'success');
              return agent;
            },
            openSpawnDialog: ({ task, repoPath, preset }) =>
              openSkillSpawnDialog(store, repoPath, {
                prompt: task,
                providerId: preset?.providerId,
                model: preset?.model,
                permissionMode: preset?.permissionMode,
              }),
            startSkillCombo: (projectPath, combo) => store.startSkillCombo(projectPath, combo),
            projectDirExists: (path) => isDir(path),
            openFile: (path) => {
              const name = path.split('/').pop() ?? path;
              store.openTab({ id: path, path, name });
              store.setActiveTab(path);
            },
            openTicket: (ticketId) => {
              const ticket = useStore.getState().pmDraftTickets.find((t) => t.id === ticketId);
              if (ticket) store.setPmSelectedEpicId(ticket.epicId);
              store.setPmSelectedTicketId(ticketId);
              store.openWorkPlace('tickets');
            },
            openGoal: (goalId) => {
              store.setSelectedGoalId(goalId);
              store.openWorkPlace('goals');
            },
            openAgent: (agentId) => store.selectAgent(agentId),
            runCommand: onRunCommand,
            // A run against a different project opens it first — closing every
            // tab — so this asks before doing that, the same in-app `confirm`
            // the agent panel uses for an equivalent switch.
            startConductorRun: async (input) => {
              const openPath = useStore.getState().rootPath;
              if (openPath !== null && openPath !== input.repoPath) {
                const folder = input.repoPath.split('/').filter(Boolean).pop() ?? input.repoPath;
                const go = await confirm({
                  title: 'Switch project?',
                  message: `Starting this run opens "${folder}" and closes the tabs of the current project.`,
                  confirmLabel: 'Open & start',
                });
                if (!go) return;
              }
              await launchScheduledConductor(input, buildScheduledRunDeps(onOpenProject));
            },
          },
          {
            fallbackCwd: useStore.getState().rootPath ?? undefined,
            // What the payload may decide about the launch depends on who
            // wrote it, never on what it says about itself.
            trust: notificationTrust(notification.source),
            providers: useStore.getState().providers,
            origin: notification.origin ?? undefined,
          }
        );
      } catch (error) {
        // The decision stands; only the effect failed. Say so rather than
        // leaving the click looking like it did nothing.
        const message =
          error instanceof NotificationActionError && error.code === 'missing-project'
            ? 'Project folder not found'
            : error instanceof NotificationActionError && error.code === 'empty-combo'
              ? 'Combo has no valid steps'
              : `"${action.label}" could not run`;
        store.showToast(message, 'error');
      }
    },
    [onRunCommand, onOpenProject, confirm]
  );

  const handleOpen = useCallback(
    (uid: string) => void markNotificationRead(uid),
    [markNotificationRead]
  );

  return { parseActions, handleAction, handleOpen, confirmDialog };
}
