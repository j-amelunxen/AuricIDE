'use client';

import { useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { formatNotificationAge } from '@/lib/notifications/format';
import { projectIconFor } from '@/lib/quickAccess/icon';
import { TICKET_STATUS_BADGE_CLASS, TICKET_STATUS_LABEL } from '@/lib/pm/ticketStatusStyle';
import type { TicketStatus } from '@/lib/pm/enums';
import type { ProjectPickerOption } from '@/lib/projects/projectOptions';
import type { InboxAssignRequest, InboxItem, ProjectPmOverview } from '@/lib/tauri/inbox';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';

export interface InboxItemRowProps {
  item: InboxItem;
  /** Only meaningful once the item is assigned; ignored for unsorted items. */
  ticketStatus: TicketStatus | 'unknown';
  now: number;
  starredProjects: StarredProject[];
  projectOptions: ProjectPickerOption[];
  overview: Record<string, ProjectPmOverview>;
  onUpdateTitle: (id: string, title: string) => void;
  onDismiss: (item: InboxItem) => void;
  onAssign: (request: InboxAssignRequest) => void;
  onUnassign: (item: InboxItem) => void;
  onOpenProject: (path: string) => void;
  onHandToAgent: (item: InboxItem) => void;
}

type AssignMenuState =
  | { stage: 'projects'; x: number; y: number }
  | { stage: 'epics'; project: ProjectPickerOption; x: number; y: number }
  | null;

/** Classes shared by every small icon-only action button in this row. */
const ICON_BUTTON_CLASS =
  'rounded-lg p-1 text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary';

const UNKNOWN_STATUS_BADGE_CLASS = 'bg-white/5 text-foreground-muted/60';

/**
 * One inbox item: a bare capture, or — once assigned — a live mirror of the
 * ticket it became. Every mutating action is a prop; this component decides
 * nothing about whether an action needs confirming, only what to ask for.
 */
export function InboxItemRow({
  item,
  ticketStatus,
  now,
  starredProjects,
  projectOptions,
  overview,
  onUpdateTitle,
  onDismiss,
  onAssign,
  onUnassign,
  onOpenProject,
  onHandToAgent,
}: InboxItemRowProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [assignMenu, setAssignMenu] = useState<AssignMenuState>(null);
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null);

  const assigned = item.projectPath !== null;
  // A status the project db never wrote (a stale value from an old schema, a
  // hand-edited row) must render the same as "not known yet" rather than an
  // undefined label and an undefined class.
  const statusLabel = TICKET_STATUS_LABEL[ticketStatus as TicketStatus] ?? 'Unknown';
  const statusBadgeClass =
    TICKET_STATUS_BADGE_CLASS[ticketStatus as TicketStatus] ?? UNKNOWN_STATUS_BADGE_CLASS;

  const startEditing = () => {
    setDraftTitle(item.title);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = draftTitle.trim();
    setEditing(false);
    if (trimmed !== '' && trimmed !== item.title) onUpdateTitle(item.id, trimmed);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraftTitle(item.title);
  };

  const pickProject = (option: ProjectPickerOption) => {
    if (assignMenu === null) return;
    const epics = overview[option.path]?.epics ?? [];
    if (epics.length === 0) {
      onAssign({ itemId: item.id, projectPath: option.path });
      setAssignMenu(null);
    } else {
      setAssignMenu({ stage: 'epics', project: option, x: assignMenu.x, y: assignMenu.y });
    }
  };

  const pickEpic = (project: ProjectPickerOption, epicId?: string) => {
    onAssign({ itemId: item.id, projectPath: project.path, ...(epicId ? { epicId } : {}) });
    setAssignMenu(null);
  };

  const projectMenuOptions: ContextMenuOption[] =
    projectOptions.length === 0
      ? [{ type: 'header', label: 'No projects yet — open or star one first.' }]
      : projectOptions.map((option) => ({
          label: option.name,
          leading: <ProjectTileFace path={option.path} icon={option.icon} size="xs" />,
          // A project with epics opens a second stage rather than finishing
          // the assign right here — the menu must survive its own action.
          keepOpen: (overview[option.path]?.epics ?? []).length > 0,
          action: () => pickProject(option),
        }));

  const epicMenuOptions: ContextMenuOption[] =
    assignMenu?.stage === 'epics'
      ? [
          { label: 'Inbox (default)', action: () => pickEpic(assignMenu.project) },
          ...(overview[assignMenu.project.path]?.epics ?? []).map((epic) => ({
            label: epic.name,
            action: () => pickEpic(assignMenu.project, epic.id),
          })),
        ]
      : [];

  return (
    <div
      data-testid={`inbox-item-${item.id}`}
      className="relative flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
    >
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                cancelEdit();
              }
            }}
            className="w-full rounded bg-white/5 px-1.5 py-0.5 text-[12px] text-foreground outline-none"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={startEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') startEditing();
            }}
            className="block w-full truncate rounded text-left text-[12px] text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            title="Double-click to rename"
          >
            {item.title}
          </button>
        )}

        <div className="mt-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-foreground-muted/50">
          {assigned && (
            <>
              <ProjectTileFace
                path={item.projectPath as string}
                icon={projectIconFor(starredProjects, item.projectPath)}
                size="xs"
              />
              <span className="truncate normal-case tracking-normal">
                {item.projectName ?? item.projectPath}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={`rounded px-1 py-0.5 normal-case tracking-normal ${statusBadgeClass}`}
              >
                {statusLabel}
              </span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>{formatNotificationAge(item.createdAt, now)}</span>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        {assigned ? (
          <>
            <button
              type="button"
              title="Open project"
              aria-label="Open project"
              onClick={() => onOpenProject(item.projectPath as string)}
              className={ICON_BUTTON_CLASS}
            >
              <AuricIcon name="folder_open" className="text-[13px]" />
            </button>
            <button
              type="button"
              title="Hand to agent"
              aria-label="Hand to agent"
              onClick={() => onHandToAgent(item)}
              className={ICON_BUTTON_CLASS}
            >
              <AuricIcon name="smart_toy" className="text-[13px]" />
            </button>
            <button
              type="button"
              title="More actions"
              aria-label="More actions"
              onClick={(e) => setOverflowMenu({ x: e.clientX, y: e.clientY })}
              className={ICON_BUTTON_CLASS}
            >
              <AuricIcon name="more_horiz" className="text-[13px]" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={(e) => setAssignMenu({ stage: 'projects', x: e.clientX, y: e.clientY })}
            className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] font-semibold text-foreground transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-primary"
          >
            Assign
            <AuricIcon name="expand_more" className="text-[12px]" />
          </button>
        )}
        <button
          type="button"
          title="Dismiss"
          aria-label="Dismiss"
          onClick={() => onDismiss(item)}
          className={ICON_BUTTON_CLASS}
        >
          <AuricIcon name="close" className="text-[13px]" />
        </button>
      </div>

      {assignMenu?.stage === 'projects' && (
        <ContextMenu
          x={assignMenu.x}
          y={assignMenu.y}
          options={projectMenuOptions}
          onClose={() => setAssignMenu(null)}
        />
      )}
      {assignMenu?.stage === 'epics' && (
        <ContextMenu
          x={assignMenu.x}
          y={assignMenu.y}
          options={epicMenuOptions}
          onClose={() => setAssignMenu(null)}
        />
      )}

      {overflowMenu && (
        <ContextMenu
          x={overflowMenu.x}
          y={overflowMenu.y}
          options={[
            {
              label: 'Unassign',
              icon: 'link_off',
              action: () => onUnassign(item),
            },
          ]}
          onClose={() => setOverflowMenu(null)}
        />
      )}
    </div>
  );
}
