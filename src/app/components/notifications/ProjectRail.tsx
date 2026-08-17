'use client';

import { useCallback, useRef } from 'react';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import type { ProjectGroup } from '@/lib/notifications/commandCenter';
import { formatNextDue } from '@/lib/notifications/scheduleFormat';
import { projectIconFor } from '@/lib/quickAccess/icon';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';

export interface ProjectRailProps {
  /** Already ordered by `groupByProject` — rendered in the order handed over. */
  groups: ProjectGroup[];
  /** The selected group's key, or `null` for the All row. */
  selectedKey: string | null;
  /** The whole inbox, for the All row. Never derived from the groups shown. */
  totals: { unread: number; openQuestions: number; schedules: number };
  now: number;
  starredProjects: StarredProject[];
  /** `undefined` selects All, `null` the app-wide group, a string a project. */
  onSelect: (projectPath: string | null | undefined) => void;
}

/**
 * Which project you are looking at.
 *
 * Two counts and never a third: unread, and open questions. A question is a
 * debt someone else is waiting on, so it gets amber and its own pill rather
 * than being folded into unread — and agent attention stays out of both (I7),
 * because a fleet that needs a human and an inbox that needs a human are
 * different jobs with different answers.
 *
 * A project with nothing at all still gets a row. That is the whole reason
 * starred projects are in the group list: aiming a new reminder at a quiet
 * project should be one click, not a hunt. Such a row renders quiet — no
 * pills, no meta line — or the rail would stop ranking anything.
 */
export function ProjectRail({
  groups,
  selectedKey,
  totals,
  now,
  starredProjects,
  onSelect,
}: ProjectRailProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // The rail's order is the model's, so stepping through it reads the same
  // list the eye does. Keys, not indices, cross the boundary: `undefined` for
  // All is the store's own vocabulary for "no project picked".
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const keys: (string | null)[] = [null, ...groups.map((group) => group.key)];
      const current = keys.indexOf(selectedKey);
      const target = current + (event.key === 'ArrowDown' ? 1 : -1);
      // Arrows scroll the rail by default; once they mean "move selection"
      // here they must not do both.
      event.preventDefault();
      // Stops at the ends rather than wrapping: a rail that jumps from the
      // last project back to All reads as a mis-click, not as navigation.
      if (target < 0 || target >= keys.length) return;

      const key = keys[target];
      const group = key === null ? null : groups.find((candidate) => candidate.key === key);
      onSelect(group ? group.path : undefined);
      listRef.current
        ?.querySelector<HTMLElement>(
          `[data-testid="command-center-project-${key === null ? 'all' : key}"]`
        )
        ?.focus();
    },
    [groups, selectedKey, onSelect]
  );

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Projects"
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      className="min-h-0 space-y-0.5 overflow-y-auto border-r border-white/10 p-2"
    >
      <button
        type="button"
        role="option"
        aria-selected={selectedKey === null}
        data-testid="command-center-project-all"
        onClick={() => onSelect(undefined)}
        className={rowClass(selectedKey === null)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[11px] font-semibold text-foreground">All</span>
        </span>
        <Pills testIdSuffix="all" unread={totals.unread} openQuestions={totals.openQuestions} />
      </button>

      {groups.map((group) => {
        const quiet =
          group.notifications.length === 0 && group.schedules.length === 0 && group.unread === 0;
        // The schedule that owns the group's next date, so the words come from
        // the one formatter the rows use rather than a second reading of it.
        const due =
          group.nextDueAt === null
            ? null
            : (group.schedules.find(
                (schedule) => schedule.enabled && schedule.nextDueAt === group.nextDueAt
              ) ?? null);

        return (
          <button
            key={group.key}
            type="button"
            role="option"
            aria-selected={selectedKey === group.key}
            data-testid={`command-center-project-${group.key}`}
            data-quiet={quiet}
            onClick={() => onSelect(group.path)}
            className={rowClass(selectedKey === group.key, quiet)}
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                {group.path !== null && (
                  <ProjectTileFace
                    path={group.path}
                    icon={projectIconFor(starredProjects, group.path)}
                    size="xs"
                    className="flex-shrink-0"
                  />
                )}
                <span className="truncate text-[11px] font-semibold text-foreground">
                  {group.label}
                </span>
              </span>
              {group.schedules.length > 0 && (
                <span className="truncate font-mono text-[9px] uppercase tracking-wider text-foreground-muted/50">
                  {group.schedules.length === 1
                    ? '1 schedule'
                    : `${group.schedules.length} schedules`}
                  {due !== null && (
                    <>
                      <span aria-hidden="true"> · </span>
                      {formatNextDue(due, now)}
                    </>
                  )}
                </span>
              )}
            </span>
            <Pills
              testIdSuffix={group.key}
              unread={group.unread}
              openQuestions={group.openQuestions}
            />
          </button>
        );
      })}
    </div>
  );
}

function rowClass(selected: boolean, quiet = false): string {
  return [
    'press-feedback flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left',
    selected ? 'bg-white/[0.08] ring-1 ring-inset ring-primary/30' : 'hover:bg-white/[0.04]',
    quiet && !selected ? 'opacity-60' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Unread and open questions, in that order and never merged. Zero renders
 * nothing at all rather than a "0" — a badge is a call to act, and one that
 * says nothing needs doing is noise the eye still has to parse.
 */
function Pills({
  testIdSuffix,
  unread,
  openQuestions,
}: {
  testIdSuffix: string;
  unread: number;
  openQuestions: number;
}) {
  return (
    <span className="flex flex-shrink-0 items-center gap-1">
      {openQuestions > 0 && (
        <span
          data-testid={`rail-questions-${testIdSuffix}`}
          title={openQuestions === 1 ? '1 open question' : `${openQuestions} open questions`}
          className="rounded-full bg-[#ffce2e]/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[#ffce2e]"
        >
          {openQuestions}
        </span>
      )}
      {unread > 0 && (
        <span
          data-testid={`rail-unread-${testIdSuffix}`}
          title={unread === 1 ? '1 unread' : `${unread} unread`}
          className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-primary-light"
        >
          {unread}
        </span>
      )}
    </span>
  );
}
