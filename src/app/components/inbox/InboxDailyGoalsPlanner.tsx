'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { getProjectDailyGoal } from '@/lib/inbox/dailyGoals';
import type { InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';
import type { ProjectPickerOption } from '@/lib/projects/projectOptions';

export interface InboxDailyGoalsPlannerProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectPickerOption[];
  inboxItems: InboxItem[];
  overview: Record<string, ProjectPmOverview>;
  onToggleDailyGoal: (id: string) => void;
  onCaptureTicketAsDailyGoal: (projectPath: string, ticketId: string) => void;
  onCreateAndSetDailyGoal: (title: string, projectPath: string) => void;
}

export function InboxDailyGoalsPlanner({
  isOpen,
  onClose,
  projects,
  inboxItems,
  overview,
  onToggleDailyGoal,
  onCaptureTicketAsDailyGoal,
  onCreateAndSetDailyGoal,
}: InboxDailyGoalsPlannerProps) {
  const [draftInputs, setDraftInputs] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const handleInputChange = (projectPath: string, value: string) => {
    setDraftInputs((prev) => ({ ...prev, [projectPath]: value }));
  };

  const handleCreateGoal = (projectPath: string) => {
    const text = (draftInputs[projectPath] ?? '').trim();
    if (!text) return;
    onCreateAndSetDailyGoal(text, projectPath);
    setDraftInputs((prev) => ({ ...prev, [projectPath]: '' }));
  };

  const plannedCount = projects.filter((p) =>
    Boolean(getProjectDailyGoal(inboxItems, p.path))
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-goals-planner-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel-bg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
              <AuricIcon name="flag" className="text-[16px]" />
            </span>
            <div>
              <h2
                id="daily-goals-planner-title"
                className="text-[14px] font-bold tracking-wide text-foreground"
              >
                Tagesziele planen
              </h2>
              <p className="text-[11px] text-foreground-muted">
                Wähle pro Projekt genau ein Mini-Sprint-Ziel für den Tag.
              </p>
            </div>
          </div>

          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
          >
            <AuricIcon name="close" className="text-[16px]" />
          </button>
        </div>

        {/* Status bar */}
        <div className="border-b border-white/5 bg-white/[0.01] px-4 py-2">
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
            {plannedCount} von {projects.length} Projekten haben ein Tagesziel
          </span>
        </div>

        {/* Project list */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {projects.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-foreground-muted">
              Keine Projekte gefunden. Öffne oder favorisiere ein Projekt, um Tagesziele zu planen.
            </p>
          ) : (
            projects.map((project) => {
              const currentGoal = getProjectDailyGoal(inboxItems, project.path);
              const projectOverview = overview[project.path];
              const openTickets = (projectOverview?.tickets ?? []).filter(
                (t) => t.status !== 'done' && t.status !== 'archived' && t.status !== 'discarded'
              );

              return (
                <div
                  key={project.path}
                  data-testid={`planner-project-${project.path}`}
                  className="rounded-xl border border-white/5 bg-white/[0.02] p-3 transition-colors"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <ProjectTileFace path={project.path} icon={project.icon} size="xs" />
                    <span className="text-[12px] font-semibold text-foreground">
                      {project.name}
                    </span>
                  </div>

                  {currentGoal ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-amber-400">
                          <AuricIcon name="flag" className="text-[13px]" />
                        </span>
                        <span className="truncate text-[12px] font-medium text-amber-200">
                          {currentGoal.title}
                        </span>
                      </div>

                      <button
                        type="button"
                        aria-label="Tagesziel entfernen"
                        onClick={() => onToggleDailyGoal(currentGoal.id)}
                        className="flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold text-foreground-muted hover:bg-white/10 hover:text-foreground"
                      >
                        Entfernen
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {openTickets.length > 0 && (
                        <div>
                          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-foreground-muted/60">
                            Aus vorhandenen Tickets wählen:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {openTickets.slice(0, 6).map((ticket) => (
                              <button
                                key={ticket.id}
                                type="button"
                                onClick={() => onCaptureTicketAsDailyGoal(project.path, ticket.id)}
                                className="flex max-w-[240px] items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-left text-[11px] text-foreground transition-colors hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-200"
                              >
                                <span className="truncate">{ticket.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="text"
                          placeholder={`Neues Tagesziel für ${project.name}...`}
                          value={draftInputs[project.path] ?? ''}
                          onChange={(e) => handleInputChange(project.path, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleCreateGoal(project.path);
                            }
                          }}
                          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-foreground placeholder-foreground-muted/50 outline-none focus:border-amber-500/50"
                        />
                        <button
                          type="button"
                          onClick={() => handleCreateGoal(project.path)}
                          disabled={!(draftInputs[project.path] ?? '').trim()}
                          className="rounded-lg bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-foreground transition-colors hover:bg-amber-500/20 hover:text-amber-300 disabled:opacity-40"
                        >
                          Hinzufügen
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-white/10 bg-white/[0.02] p-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-primary px-4 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-primary"
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
