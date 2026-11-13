'use client';

import { useMemo, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/ui/ProjectTileFace';
import type { ProjectGroup } from '@/lib/notifications/commandCenter';
import type { PresentedAction } from '@/lib/notifications/presentActions';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import { APP_CONFIG_KEYS, readAppPref, writeAppPref } from '@/lib/config/appConfig';
import { parseScheduleView, type ScheduleView } from '@/lib/notifications/scheduleCalendar';
import { projectIconFor } from '@/lib/quickAccess/icon';
import type { StarredProject } from '@/lib/quickAccess/types';
import type { Schedule } from '@/lib/tauri/schedules';
import { NotificationsPanel } from './NotificationsPanel';
import { SchedulesCalendar } from './SchedulesCalendar';
import { ScheduleViewSwitch } from './ScheduleViewSwitch';
import { SchedulesSection } from './SchedulesSection';
import { SchedulesTimeline } from './SchedulesTimeline';

export interface ProjectDetailProps {
  /** The selected group, or `null` for "All". */
  group: ProjectGroup | null;
  /** Every group — the All view's grouped trigger list comes from these. */
  groups: ProjectGroup[];
  /** The whole inbox, newest-first. What "All" shows. */
  notifications: Notification[];
  /** The whole inbox's counts, for the All heading (I1). */
  totals: { unread: number; openQuestions: number };
  status: 'idle' | 'loading' | 'error';
  now: number;
  starredProjects: StarredProject[];
  /** Schedule id → the newest notification it raised. */
  lastRaised: Map<string, Notification>;
  parseActions: (notification: Notification) => PresentedAction[];
  onOpen: (uid: string) => void;
  onAction: (notification: Notification, action: NotificationAction) => void;
  /** Opens the editor pre-bound to whatever this pane is showing. */
  onNewSchedule: () => void;
  /** A click on an empty slot of the calendar or timeline. */
  onCreateScheduleAt: (at: number, project?: { path: string | null; name: string | null }) => void;
  /** A run dropped on another slot. */
  onMoveRun: (schedule: Schedule, from: number, to: number) => void;
  onEditSchedule: (schedule: Schedule) => void;
  onToggleSchedule: (schedule: Schedule, enabled: boolean) => void;
  onDeleteSchedule: (schedule: Schedule) => void;
  /** Already scoped by the caller to this pane's project. */
  onMarkAllRead: () => void;
  onClear: () => void;
  onDismiss: (uid: string) => void;
}

/**
 * "1 question waiting", or nothing at all.
 *
 * Deliberately not the unread count: the panel's own badge is a few pixels
 * below and already carries it. A number printed twice is one people stop
 * reading in both places.
 */
function questionsWaiting(openQuestions: number): string {
  if (openQuestions === 0) return '';
  return openQuestions === 1 ? '1 question waiting' : `${openQuestions} questions waiting`;
}

/**
 * One project, whole: what fires for it, and what it has reported.
 *
 * Two sections in that order on purpose. Triggers are the causes and sit
 * above the effects they produce, so the question "why does this project keep
 * telling me things" is answered before the things themselves.
 *
 * The pane never filters by project itself — the rail already made that
 * decision, and the rows arrive scoped. What it must not do is re-derive the
 * counts from the rows it was handed: the unread badge is the project's, so it
 * keeps saying the same number when the panel's own read filter hides half the
 * list (I1).
 */
export function ProjectDetail({
  group,
  groups,
  notifications,
  totals,
  status,
  now,
  starredProjects,
  lastRaised,
  parseActions,
  onOpen,
  onAction,
  onNewSchedule,
  onCreateScheduleAt,
  onMoveRun,
  onEditSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onMarkAllRead,
  onClear,
  onDismiss,
}: ProjectDetailProps) {
  const rows = group === null ? notifications : group.notifications;
  const unread = group === null ? totals.unread : group.unread;
  const openQuestions = group === null ? totals.openQuestions : group.openQuestions;

  // Under All every project's triggers are one list, each run labelled; under a
  // project it is that project's, unlabelled — the heading above already said
  // whose they are.
  const triggerGroups = useMemo(
    () =>
      group === null
        ? groups
            .filter((candidate) => candidate.schedules.length > 0)
            .map((candidate) => ({
              key: candidate.key,
              label: candidate.label,
              schedules: candidate.schedules,
            }))
        : [{ key: group.key, label: null, schedules: group.schedules }],
    [group, groups]
  );

  // The views draw exactly what the list would: the rail already scoped
  // `groups`/`group`, so the project filter reaches them with no extra code.
  const viewSchedules = useMemo(
    () => triggerGroups.flatMap((triggerGroup) => triggerGroup.schedules),
    [triggerGroups]
  );

  // The center only mounts once opened (client side), so reading the saved
  // choice while initialising cannot disagree with a server render.
  const [view, setView] = useState<ScheduleView>(() =>
    parseScheduleView(readAppPref(APP_CONFIG_KEYS.commandCenterScheduleView))
  );
  const changeView = (next: ScheduleView) => {
    setView(next);
    writeAppPref(APP_CONFIG_KEYS.commandCenterScheduleView, next);
  };

  // Calendar and timeline want the height; the inbox folds into a bar beneath
  // them so a click on its header, not a scroll, brings it back.
  const roomy = view !== 'list' && viewSchedules.length > 0;
  const [inboxOpen, setInboxOpen] = useState(false);

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div
        data-testid="command-center-detail-heading"
        className="flex items-center gap-2 border-b border-white/5 px-4 py-2"
      >
        {group !== null && group.path !== null && (
          <ProjectTileFace
            path={group.path}
            icon={projectIconFor(starredProjects, group.path)}
            size="sm"
            className="flex-shrink-0"
          />
        )}
        <h2 className="truncate text-xs font-bold text-foreground">
          {group === null ? 'All projects' : group.label}
        </h2>
        {/* Amber wherever a question is counted — it is the one number
            somebody else is waiting on. */}
        {openQuestions > 0 && (
          <span
            data-testid="command-center-detail-questions"
            className="truncate font-mono text-[10px] text-[#ffce2e]"
          >
            {questionsWaiting(openQuestions)}
          </span>
        )}
        <ScheduleViewSwitch value={view} onChange={changeView} />
      </div>

      <div className={`min-h-0 flex-1 ${roomy ? 'flex flex-col' : 'overflow-y-auto'}`}>
        {/* Capped so a project with many reminders cannot push its inbox — the
            part that changes — below the fold. */}
        <section
          data-testid="command-center-triggers"
          className={
            roomy
              ? 'flex min-h-0 flex-1 flex-col border-b border-white/10 pt-2'
              : 'max-h-[42vh] overflow-y-auto border-b border-white/10'
          }
        >
          <div className={`flex items-center justify-between px-3 py-2 ${roomy ? 'hidden' : ''}`}>
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
              Triggers
            </h3>
            <button
              type="button"
              data-testid="command-center-new-schedule-here"
              onClick={onNewSchedule}
              className="press-feedback flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-foreground-muted hover:bg-white/10 hover:text-foreground"
            >
              <AuricIcon name="add" aria-hidden="true" className="text-sm" />
              New schedule
            </button>
          </div>

          {view === 'calendar' && viewSchedules.length > 0 ? (
            <SchedulesCalendar
              schedules={viewSchedules}
              notifications={notifications}
              now={now}
              onEdit={onEditSchedule}
              onCreate={(at) => onCreateScheduleAt(at)}
              onMove={onMoveRun}
            />
          ) : view === 'timeline' && viewSchedules.length > 0 ? (
            <SchedulesTimeline
              schedules={viewSchedules}
              notifications={notifications}
              now={now}
              onEdit={onEditSchedule}
              onCreate={(at, lane) =>
                onCreateScheduleAt(
                  at,
                  lane.path === null ? undefined : { path: lane.path, name: lane.label }
                )
              }
              onMove={onMoveRun}
            />
          ) : triggerGroups.length === 0 ? (
            <SchedulesSection
              schedules={[]}
              now={now}
              starredProjects={starredProjects}
              onEdit={onEditSchedule}
              onToggle={onToggleSchedule}
              onDelete={onDeleteSchedule}
            />
          ) : (
            triggerGroups.map((triggerGroup) => (
              <SchedulesSection
                key={triggerGroup.key}
                schedules={triggerGroup.schedules}
                now={now}
                starredProjects={starredProjects}
                lastRaised={lastRaised}
                label={triggerGroup.label}
                onEdit={onEditSchedule}
                onToggle={onToggleSchedule}
                onDelete={onDeleteSchedule}
              />
            ))
          )}
        </section>

        {roomy && (
          <button
            type="button"
            data-testid="command-center-inbox-toggle"
            aria-expanded={inboxOpen}
            onClick={() => setInboxOpen(!inboxOpen)}
            className="flex flex-shrink-0 cursor-pointer items-center gap-2 border-b border-white/5 px-3 py-1.5 text-left hover:bg-white/5"
          >
            <AuricIcon
              name={inboxOpen ? 'expand_more' : 'chevron_right'}
              aria-hidden="true"
              className="text-sm text-foreground-muted"
            />
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
              Notifications
            </span>
            {unread > 0 && (
              <span className="rounded-full bg-primary/20 px-1.5 text-[10px] font-semibold text-primary">
                {unread}
              </span>
            )}
            {openQuestions > 0 && (
              <span className="text-[10px] text-[#ffce2e]">{questionsWaiting(openQuestions)}</span>
            )}
          </button>
        )}

        <div
          className={
            roomy
              ? inboxOpen
                ? 'h-[40%] min-h-[200px] flex-shrink-0 overflow-y-auto'
                : 'hidden'
              : 'min-h-[240px]'
          }
        >
          <NotificationsPanel
            notifications={rows}
            unreadCount={unread}
            status={status}
            now={now}
            starredProjects={starredProjects}
            parseActions={parseActions}
            onOpen={onOpen}
            onAction={onAction}
            onMarkAllRead={onMarkAllRead}
            onClear={onClear}
            onDismiss={onDismiss}
          />
        </div>
      </div>
    </div>
  );
}
