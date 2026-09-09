'use client';

import { useState, type DragEvent } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { TicketStatusChip } from '@/app/components/pm/TicketStatusChip';
import { projectIconFor } from '@/lib/quickAccess/icon';
import { calculateDailyGoalsProgress } from '@/lib/inbox/dailyGoals';
import { parseInboxTaskDragData, type InboxTaskDragPayload } from '@/lib/inbox/inboxDrag';
import {
  liveTicketStatusFor,
  resolveInboxTicketStatus,
  type LiveInboxTickets,
} from '@/lib/inbox/inboxTicketStatus';
import type { TicketStatus } from '@/lib/pm/enums';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';

export interface InboxDailyGoalsSectionProps {
  goals: InboxItem[];
  overview: Record<string, ProjectPmOverview>;
  starredProjects: StarredProject[];
  liveTickets?: LiveInboxTickets;
  onOpenProject: (path: string) => void;
  onHandToAgent: (item: InboxItem) => void;
  onToggleDailyGoal: (id: string) => void;
  onSetStatus: (projectPath: string, ticketId: string, status: TicketStatus) => void;
  onOpenPlanner: () => void;
  onDropTask?: (payload: InboxTaskDragPayload) => void;
}

const ACTION_BTN_CLASS =
  'rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary';

export function InboxDailyGoalsSection({
  goals,
  overview,
  starredProjects,
  liveTickets,
  onOpenProject,
  onHandToAgent,
  onToggleDailyGoal,
  onSetStatus,
  onOpenPlanner,
  onDropTask,
}: InboxDailyGoalsSectionProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const payload = parseInboxTaskDragData(e);
    if (payload && onDropTask) {
      onDropTask(payload);
    }
  };

  const goalItemsWithStatus = goals.map((item) => {
    const projectOverview = item.projectPath ? overview[item.projectPath] : undefined;
    const ticketStatus = resolveInboxTicketStatus(
      item,
      projectOverview,
      liveTickets ? liveTicketStatusFor(item, liveTickets) : undefined
    );
    return { item, ticketStatus };
  });

  const progress = calculateDailyGoalsProgress(goalItemsWithStatus);
  const allDone = progress.total > 0 && progress.done === progress.total;

  return (
    <div
      data-testid="inbox-daily-goals-section"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`rounded-xl border p-3 shadow-sm transition-all duration-200 ${
        isDragOver
          ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-400/40 shadow-amber-500/10'
          : 'border-amber-500/20 bg-gradient-to-b from-amber-500/[0.06] to-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-amber-500/20 text-amber-400">
            <AuricIcon name="flag" className="text-[13px]" />
          </span>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200/90">
            Tagesziele
          </h3>
          {goals.length > 0 && (
            <span
              data-testid="daily-goals-progress"
              className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-amber-300"
            >
              {progress.done}/{progress.total} erledigt
            </span>
          )}
        </div>

        <button
          type="button"
          aria-label="Tagesziele planen"
          onClick={onOpenPlanner}
          className="flex items-center gap-1 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/20 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <AuricIcon name="edit" className="text-[12px]" />
          Planen
        </button>
      </div>

      {isDragOver && (
        <div
          data-testid="daily-goals-drop-cue"
          className="mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-400 bg-amber-400/10 py-2 text-[11px] font-semibold text-amber-300"
        >
          <AuricIcon name="flag" className="text-[13px]" />
          <span>Aufgabe als Tagesziel ablegen</span>
        </div>
      )}

      {goals.length > 0 && (
        <div className="mb-2.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      )}

      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-2.5 text-center">
          <p className="text-[11px] text-foreground-muted">
            Noch keine Tagesziele für heute definiert.
          </p>
          <p className="mt-1 text-[10px] text-foreground-muted/70">
            Ziehe eine Aufgabe hierher oder plane deine Ziele.
          </p>
          <button
            type="button"
            onClick={onOpenPlanner}
            className="mt-2 text-[11px] font-medium text-amber-400 hover:underline"
          >
            Tagesziele für deine Projekte planen →
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {goalItemsWithStatus.map(({ item, ticketStatus }) => {
            const isDone = ticketStatus === 'done';
            const assigned = item.projectPath !== null;

            return (
              <div
                key={item.id}
                data-testid={`daily-goal-${item.id}`}
                className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                  isDone
                    ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                    : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {assigned ? (
                      <span className="flex items-center gap-1 text-[10px] font-semibold text-foreground-muted">
                        <ProjectTileFace
                          path={item.projectPath as string}
                          icon={projectIconFor(starredProjects, item.projectPath)}
                          size="xs"
                        />
                        <span className="max-w-[120px] truncate">
                          {item.projectName ?? item.projectPath}
                        </span>
                      </span>
                    ) : (
                      <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-semibold text-foreground-muted">
                        Unsorted
                      </span>
                    )}
                    <span aria-hidden="true" className="text-foreground-muted/40">
                      ·
                    </span>
                    <span
                      className={`truncate text-[12px] font-medium ${
                        isDone ? 'text-foreground-muted line-through' : 'text-foreground'
                      }`}
                    >
                      {item.title}
                    </span>
                  </div>
                </div>

                <div className="flex flex-shrink-0 items-center gap-1">
                  {assigned && (
                    <TicketStatusChip
                      status={ticketStatus}
                      onSetStatus={(next) => {
                        if (item.projectPath && item.ticketId) {
                          onSetStatus(item.projectPath, item.ticketId, next);
                        }
                      }}
                    />
                  )}

                  {assigned && (
                    <>
                      <button
                        type="button"
                        title="Open project"
                        aria-label="Open project"
                        onClick={() => onOpenProject(item.projectPath as string)}
                        className={ACTION_BTN_CLASS}
                      >
                        <AuricIcon name="folder_open" className="text-[13px]" />
                      </button>
                      <button
                        type="button"
                        title="Hand to agent"
                        aria-label="Hand to agent"
                        onClick={() => onHandToAgent(item)}
                        className={ACTION_BTN_CLASS}
                      >
                        <AuricIcon name="smart_toy" className="text-[13px]" />
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    title="Tagesziel entfernen"
                    aria-label="Tagesziel entfernen"
                    onClick={() => onToggleDailyGoal(item.id)}
                    className="rounded-lg p-1 text-amber-400 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <AuricIcon name="flag" className="text-[13px]" />
                  </button>
                </div>
              </div>
            );
          })}

          {allDone && (
            <div className="pt-1 text-center text-[10px] font-semibold text-emerald-400">
              🎉 Alle Tagesziele für heute erreicht!
            </div>
          )}
        </div>
      )}
    </div>
  );
}
