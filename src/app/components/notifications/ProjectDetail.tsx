'use client';

import { useMemo } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import type { ProjectGroup } from '@/lib/notifications/commandCenter';
import type { PresentedAction } from '@/lib/notifications/presentActions';
import type { Notification, NotificationAction } from '@/lib/notifications/types';
import { projectIconFor } from '@/lib/quickAccess/icon';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';
import type { Schedule } from '@/lib/tauri/schedules';
import { NotificationsPanel } from './NotificationsPanel';
import { SchedulesSection } from './SchedulesSection';

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
  onEditSchedule: (schedule: Schedule) => void;
  onToggleSchedule: (schedule: Schedule, enabled: boolean) => void;
  onDeleteSchedule: (schedule: Schedule) => void;
  /** Already scoped by the caller to this pane's project. */
  onMarkAllRead: () => void;
  onClear: () => void;
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
  onEditSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onMarkAllRead,
  onClear,
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Capped so a project with many reminders cannot push its inbox — the
            part that changes — below the fold. */}
        <section
          data-testid="command-center-triggers"
          className="max-h-[42vh] overflow-y-auto border-b border-white/10"
        >
          <div className="flex items-center justify-between px-3 py-2">
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

          {triggerGroups.length === 0 ? (
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

        <div className="min-h-[240px]">
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
          />
        </div>
      </div>
    </div>
  );
}
