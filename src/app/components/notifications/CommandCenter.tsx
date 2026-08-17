'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import {
  centerSummary,
  closesCommandCenter,
  formatCenterSummary,
  groupByProject,
  lastRaisedBySchedule,
  upcomingSchedules,
} from '@/lib/notifications/commandCenter';
import { projectPickerOptions } from '@/lib/projects/projectOptions';
import { enabledSkillSources, loadSkillSources } from '@/lib/settings/skillSources';
import { listProjectSkills, type ProjectSkill } from '@/lib/tauri/projectSkills';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import { schedulesPreview, type Schedule } from '@/lib/tauri/schedules';
import { ProjectDetail } from './ProjectDetail';
import { ProjectRail } from './ProjectRail';
import { ScheduleEditor } from './ScheduleEditor';
import { UpcomingStrip } from './UpcomingStrip';
import { useNotificationActions } from './useNotificationActions';

export interface CommandCenterProps {
  /** Runs a command from the manifest — the same dispatch the palette uses. */
  onRunCommand: (commandId: string) => void;
  /** Opens (or switches to) a project — for a `run-conductor` click. */
  onOpenProject: (path: string) => Promise<void>;
}

/** Which schedule the editor is open for, and what a new one starts bound to. */
interface EditorState {
  schedule: Schedule | null;
  defaultProjectPath: string | null;
  defaultProjectName: string | null;
}

/**
 * Everything the inbox is, in one place: the full-area overlay the tray opens.
 *
 * Returns null when closed — the same null-guard pattern as `AgentConsole`,
 * and for the same reason: the content below owns a 1-second clock and the
 * whole notification list, and neither should be subscribed to while nobody
 * is looking at them.
 */
export function CommandCenter({ onRunCommand, onOpenProject }: CommandCenterProps) {
  const commandCenterOpen = useStore((s) => s.commandCenterOpen);
  if (!commandCenterOpen) return null;
  return <CommandCenterContent onRunCommand={onRunCommand} onOpenProject={onOpenProject} />;
}

/**
 * The store connector, and the only place in the center that knows there is a
 * store at all — the rail, the strip and the detail pane are prop-driven so
 * they can be tested without one.
 *
 * It is a **projection** (I11): no notification or schedule state is invented
 * here. Grouping is pure and lives in `src/lib/notifications/commandCenter.ts`,
 * so the same rows and the same counts can be asserted without a DOM.
 */
function CommandCenterContent({ onRunCommand, onOpenProject }: CommandCenterProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const now = useNow();
  const { confirm, confirmDialog } = useConfirm();

  const [editing, setEditing] = useState<EditorState | null>(null);
  const [draft, setDraft] = useState<Schedule | null>(null);
  const [preview, setPreview] = useState<string[]>([]);
  const [discoveredByPath, setDiscoveredByPath] = useState<{
    path: string;
    skills: ProjectSkill[];
  } | null>(null);

  const notifications = useStore((s) => s.notifications);
  const unreadCount = useStore((s) => s.notificationsUnreadCount);
  const status = useStore((s) => s.notificationsStatus);
  const schedules = useStore((s) => s.schedules);
  const starredProjects = useStore((s) => s.starredProjects);
  const recentProjects = useStore((s) => s.recentProjects);
  const providers = useStore((s) => s.providers);
  const rootPath = useStore((s) => s.rootPath);
  const commandCenterProject = useStore((s) => s.commandCenterProject);

  const closeCommandCenter = useStore((s) => s.closeCommandCenter);
  const selectCommandCenterProject = useStore((s) => s.selectCommandCenterProject);
  const markAllNotificationsRead = useStore((s) => s.markAllNotificationsRead);
  const clearNotifications = useStore((s) => s.clearNotifications);
  const loadSchedules = useStore((s) => s.loadSchedules);
  const saveSchedule = useStore((s) => s.saveSchedule);
  const deleteSchedule = useStore((s) => s.deleteSchedule);
  const toggleSchedule = useStore((s) => s.toggleSchedule);

  useOverlayLayer({
    id: 'command-center',
    kind: 'tool',
    active: true,
    onEscape: closeCommandCenter,
  });

  // The list is app-global, so it loads with the surface that shows it rather
  // than with a project.
  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  const {
    parseActions,
    handleAction,
    handleOpen,
    confirmDialog: actionConfirmDialog,
  } = useNotificationActions({ notifications, onRunCommand, onOpenProject });

  // The center is the whole window, so anything that opens a file, a ticket or
  // an agent's terminal would land behind it. `closesCommandCenter` names the
  // one exception: answering a question leaves you in the inbox you are
  // working through.
  const runAction = useCallback(
    async (notification: Notification, action: NotificationAction) => {
      await handleAction(notification, action);
      if (closesCommandCenter(action)) closeCommandCenter();
    },
    [handleAction, closeCommandCenter]
  );

  // Derived here, never inside a selector: each of these builds fresh arrays,
  // and a zustand v5 selector that returns a new reference re-renders forever.
  const groups = useMemo(
    () => groupByProject(notifications, schedules, starredProjects),
    [notifications, schedules, starredProjects]
  );
  const upcoming = useMemo(() => upcomingSchedules(schedules, now), [schedules, now]);
  const lastRaised = useMemo(() => lastRaisedBySchedule(notifications), [notifications]);
  const summary = useMemo(
    () => centerSummary(notifications, schedules),
    [notifications, schedules]
  );

  // `undefined` is "All". A path with no group left (its rows were cleared
  // while it was selected) falls back to All rather than to a blank pane.
  const selectedGroup =
    commandCenterProject === undefined
      ? null
      : (groups.find((group) => group.path === commandCenterProject) ?? null);
  const selectedKey = selectedGroup?.key ?? null;

  /**
   * What a scoped button acts on. `undefined` is the whole inbox, and it is
   * what "All" has to send — not a list of paths, because the store's own
   * scoping is the thing being trusted here.
   */
  const scope = selectedGroup === null ? undefined : selectedGroup.path;

  const openEditorFor = useCallback(
    (path: string | null, name: string | null) =>
      setEditing({ schedule: null, defaultProjectPath: path, defaultProjectName: name }),
    []
  );

  // A new reminder started from a project pane is aimed at THAT project; from
  // All it starts on whatever is open, which is the only project the user
  // could mean.
  const newScheduleTarget = selectedGroup
    ? { path: selectedGroup.path, name: selectedGroup.label }
    : { path: rootPath, name: rootPath?.split('/').filter(Boolean).pop() ?? null };

  // Deleting a reminder is not undoable and the thing you lose is future
  // prompting you will not notice is missing — so it asks.
  const confirmDelete = useCallback(
    async (schedule: Schedule) => {
      const go = await confirm({
        title: 'Delete this schedule?',
        message: `"${schedule.name}" will no longer remind you. Notifications already sent stay.`,
        confirmLabel: 'Delete',
      });
      if (go) await deleteSchedule(schedule.id);
    },
    [confirm, deleteSchedule]
  );

  // The preview is computed by the backend, from the same code the runner uses,
  // so the form can never promise a date the runner would not pick.
  useEffect(() => {
    if (draft === null) return;
    let current = true;
    schedulesPreview(draft, 3)
      .then((next) => {
        if (current) setPreview(next);
      })
      .catch(() => {
        if (current) setPreview([]);
      });
    return () => {
      current = false;
    };
  }, [draft]);

  // Derived rather than cleared in the effect: with no draft there is nothing
  // to preview, and holding the last one would flash a stale date into the
  // next editor that opens.
  const visiblePreview = draft === null ? [] : preview;

  const editorProjectPath =
    editing === null
      ? null
      : (draft?.projectPath ?? editing.schedule?.projectPath ?? editing.defaultProjectPath);

  useEffect(() => {
    if (editorProjectPath === null) return;
    const path = editorProjectPath;
    let cancelled = false;
    void listProjectSkills(path, enabledSkillSources(loadSkillSources())).then((found) => {
      if (!cancelled) setDiscoveredByPath({ path, skills: found });
    });
    return () => {
      cancelled = true;
    };
  }, [editorProjectPath]);

  // Only the catalogue for this path — a previous project's list must not sit
  // in the picker while the next fetch is in flight.
  const skillsForEditor =
    editorProjectPath !== null && discoveredByPath?.path === editorProjectPath
      ? discoveredByPath.skills
      : [];

  /**
   * The project the picker must keep offering whatever else it lists.
   *
   * Taken from the editor's own state, not from the draft: for a saved
   * reminder it is the project it was SAVED with, so pointing the draft
   * elsewhere cannot make the original unreachable — and for a new one it is
   * the project "+ New schedule" was pressed in. That second half matters
   * because a project the app knows only from its notifications is neither
   * pinned nor recent nor open, and a picker that cannot show it would
   * silently retarget the reminder to one that is.
   */
  const boundProject = useMemo(() => {
    if (editing === null) return null;
    const path = editing.schedule?.projectPath ?? editing.defaultProjectPath;
    if (path === null) return null;
    return { path, name: editing.schedule?.projectName ?? editing.defaultProjectName };
  }, [editing]);

  const projectOptions = useMemo(
    () =>
      projectPickerOptions({
        starred: starredProjects,
        recent: recentProjects,
        openPath: rootPath,
        bound: boundProject,
      }),
    [starredProjects, recentProjects, rootPath, boundProject]
  );

  const closeEditor = () => {
    setEditing(null);
    setDraft(null);
  };

  return (
    <div className="command-center-enter fixed inset-0 z-[var(--z-tool)] flex flex-col bg-[#050508]">
      <div
        ref={dialogRef}
        data-testid="command-center-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-center-title"
        // Explicit rows, not nested flex: only the body may grow, so a long
        // project list can never push the header off the window.
        className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]"
      >
        <div
          data-testid="command-center-header"
          data-tauri-drag-region
          // titleBarStyle is "Overlay", so the traffic lights float over this
          // row's top-left — `--titlebar-gutter` is the room they need, the
          // same reservation `Header.tsx` and the Agent Console make.
          className="flex min-w-0 items-center gap-3 border-b border-white/10 py-2 pr-4 pl-[calc(1rem+var(--titlebar-gutter,0px))]"
        >
          <h1 id="command-center-title" className="text-xs font-bold tracking-wide text-foreground">
            Command Center
          </h1>
          <span
            data-testid="command-center-summary"
            className="truncate text-[11px] text-foreground-muted"
          >
            {formatCenterSummary(summary)}
          </span>
          {/* The one number someone else is waiting on gets the same amber
              pill the rail gives it — folded into the sentence it would be
              the first thing to truncate. */}
          {summary.openQuestions > 0 && (
            <span
              data-testid="command-center-questions-badge"
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-[#ffce2e]/15 px-2 py-0.5 text-[10px] font-semibold text-[#ffce2e]"
            >
              <AuricIcon name="help" aria-hidden="true" className="text-[12px]" />
              {summary.openQuestions === 1
                ? '1 question waiting'
                : `${summary.openQuestions} questions waiting`}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              data-testid="command-center-new-schedule"
              onClick={() => openEditorFor(newScheduleTarget.path, newScheduleTarget.name)}
              className="press-feedback flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-foreground-muted hover:bg-white/10 hover:text-foreground"
            >
              <AuricIcon name="add" aria-hidden="true" className="text-sm" />
              New schedule
            </button>
            {/* No global "mark all read" up here on purpose: the pane below
                carries one scoped to whatever the rail points at (under All,
                that is the whole inbox), and a second button with a wider
                blast radius one row above it is the kind of pair people
                press wrong. */}
            <button
              type="button"
              data-testid="command-center-close"
              onClick={closeCommandCenter}
              aria-label="Close command center"
              className="rounded p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <AuricIcon name="close" aria-hidden="true" className="text-[18px]" />
            </button>
          </div>
        </div>

        <UpcomingStrip
          schedules={upcoming}
          now={now}
          starredProjects={starredProjects}
          onSelectProject={selectCommandCenterProject}
        />

        <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)]">
          <ProjectRail
            groups={groups}
            selectedKey={selectedKey}
            totals={{
              // The store's own count, not a sum over the groups: it is the
              // number the tray badge states, and two readings of "unread"
              // that can disagree is one too many (I1).
              unread: unreadCount,
              openQuestions: summary.openQuestions,
              schedules: schedules.length,
            }}
            now={now}
            starredProjects={starredProjects}
            onSelect={selectCommandCenterProject}
          />

          <ProjectDetail
            group={selectedGroup}
            groups={groups}
            notifications={notifications}
            totals={{ unread: unreadCount, openQuestions: summary.openQuestions }}
            status={status}
            now={now}
            starredProjects={starredProjects}
            lastRaised={lastRaised}
            parseActions={parseActions}
            onOpen={handleOpen}
            onAction={(notification, action) => void runAction(notification, action)}
            onNewSchedule={() => openEditorFor(newScheduleTarget.path, newScheduleTarget.name)}
            onEditSchedule={(schedule) =>
              setEditing({
                schedule,
                defaultProjectPath: schedule.projectPath,
                defaultProjectName: schedule.projectName,
              })
            }
            onToggleSchedule={(schedule, enabled) => void toggleSchedule(schedule.id, enabled)}
            onDeleteSchedule={(schedule) => void confirmDelete(schedule)}
            onMarkAllRead={() => void markAllNotificationsRead(scope)}
            onClear={() => void clearNotifications(scope)}
          />
        </div>
      </div>

      {editing !== null && (
        <ScheduleEditor
          schedule={editing.schedule}
          defaultProjectPath={editing.defaultProjectPath}
          defaultProjectName={editing.defaultProjectName}
          preview={visiblePreview}
          starredProjects={starredProjects}
          projectOptions={projectOptions}
          discoveredSkills={skillsForEditor}
          providers={providers}
          onDraftChange={setDraft}
          onSave={(next) => {
            void saveSchedule(next);
            closeEditor();
          }}
          onCancel={closeEditor}
        />
      )}
      {confirmDialog}
      {actionConfirmDialog}
    </div>
  );
}
