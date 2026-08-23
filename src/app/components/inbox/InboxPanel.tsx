'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useSpawnLauncher } from '@/lib/quickAccess/useSpawnLauncher';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ProjectTileFace } from '@/app/components/cockpit/ProjectTileFace';
import { InboxCapture } from './InboxCapture';
import { InboxItemRow } from './InboxItemRow';
import { unsortedInboxItems } from '@/lib/inbox/unsortedInboxItems';
import { groupInboxByProject, type InboxProjectGroup } from '@/lib/inbox/groupInboxByProject';
import { inboxProjectOptions } from '@/lib/inbox/inboxProjectOptions';
import { needsDismissConfirm } from '@/lib/inbox/dismissGate';
import { projectIconFor } from '@/lib/quickAccess/icon';
import {
  INBOX_SORTS,
  INBOX_SORT_LABEL,
  sortInboxItems,
  type InboxSort,
} from '@/lib/inbox/sortInboxItems';
import {
  activeInboxItems,
  liveTicketStatusFor,
  resolveInboxTicketStatus,
} from '@/lib/inbox/inboxTicketStatus';
import { mirroredInboxItem } from '@/lib/inbox/inboxMirror';
import type { InboxItem } from '@/lib/tauri/inbox';

export interface InboxPanelProps {
  variant: 'sidebar' | 'wide';
  /** The start screen renders its own capture bar above this panel. */
  hideCapture?: boolean;
  onOpenProject: (path: string) => void;
}

function projectCountsLine(group: InboxProjectGroup): string {
  if (!group.overview) return '';
  if (!group.overview.hasDb) return 'not opened yet';
  if (group.overview.error !== null) return "couldn't read";
  return `${group.overview.open} open · ${group.overview.inProgress} in progress · ${group.overview.inReview} in review`;
}

/**
 * The whole inbox: capture, what is still unsorted, and everything already
 * handed to a project — mirroring each ticket's live status. Reads the store
 * directly; the data itself is kept warm app-wide by `useInboxData`, so this
 * component only has to render what is already there and report clicks.
 */
export function InboxPanel({ variant, hideCapture, onOpenProject }: InboxPanelProps) {
  const now = useNow();
  const { confirm, confirmDialog } = useConfirm();
  const launch = useSpawnLauncher();

  // `loadInbox` assigns the IPC result verbatim; a mock (or a genuinely empty
  // backend response) resolving to null must not crash the panel.
  const inboxItems = useStore((s) => s.inboxItems) ?? [];
  const inboxLoading = useStore((s) => s.inboxLoading);
  const inboxError = useStore((s) => s.inboxError);
  const inboxOverview = useStore((s) => s.inboxOverview);
  const starredProjects = useStore((s) => s.starredProjects);
  const recentProjects = useStore((s) => s.recentProjects);
  const rootPath = useStore((s) => s.rootPath);
  const pmDraftTickets = useStore((s) => s.pmDraftTickets) ?? [];
  const updateInboxItem = useStore((s) => s.updateInboxItem);
  const dismissInboxItem = useStore((s) => s.dismissInboxItem);
  const assignInboxItem = useStore((s) => s.assignInboxItem);
  const unassignInboxItem = useStore((s) => s.unassignInboxItem);
  const attachInboxFile = useStore((s) => s.attachInboxFile);
  const attachInboxText = useStore((s) => s.attachInboxText);
  const detachInboxFile = useStore((s) => s.detachInboxFile);
  const setSpawnAgentTicketId = useStore((s) => s.setSpawnAgentTicketId);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<InboxSort>('created');

  const liveTickets = { projectPath: rootPath, tickets: pmDraftTickets };
  const visibleItems = activeInboxItems(inboxItems, inboxOverview, liveTickets).map((item) =>
    mirroredInboxItem(item, inboxOverview, liveTickets)
  );
  const orderedItems = sortInboxItems(visibleItems, sort);
  const unsorted = unsortedInboxItems(orderedItems);
  const groups = groupInboxByProject(orderedItems, inboxOverview);
  const projectOptions = inboxProjectOptions({
    starred: starredProjects,
    recent: recentProjects,
    openPath: rootPath,
  });

  const toggleGroup = (path: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const handleDismiss = async (item: InboxItem) => {
    if (needsDismissConfirm(item)) {
      const go = await confirm({
        title: 'Dismiss this task?',
        message:
          item.projectPath !== null
            ? `"${item.title}" leaves the inbox. The ticket stays in ${item.projectName ?? 'its project'}.`
            : `"${item.title}" will be removed. This cannot be undone.`,
        confirmLabel: 'Dismiss',
      });
      if (!go) return;
    }
    void dismissInboxItem(item.id);
  };

  const handleUnassign = async (item: InboxItem) => {
    const go = await confirm({
      title: 'Unassign this task?',
      message: `"${item.title}" returns to Unsorted. The ticket stays in ${item.projectName ?? 'its project'}.`,
      confirmLabel: 'Unassign',
    });
    if (!go) return;
    void unassignInboxItem(item.id);
  };

  const handleHandToAgent = (item: InboxItem) => {
    if (item.projectPath === null || item.ticketId === null) return;
    const parts = [`Work on ticket "${item.title}"`];
    if (item.notes.trim() !== '') parts.push(item.notes.trim());
    parts.push(
      `The ticket lives in this project's AuricIDE PM database (id ${item.ticketId}); when finished, set its status to done via the auric-pm MCP tools if available.`
    );
    launch(item.projectPath, { prompt: parts.join('\n\n') });
    if (item.projectPath === rootPath) setSpawnAgentTicketId(item.ticketId);
  };

  const renderRow = (item: InboxItem) => {
    const overview = item.projectPath !== null ? inboxOverview[item.projectPath] : undefined;
    const ticketStatus = resolveInboxTicketStatus(
      item,
      overview,
      liveTicketStatusFor(item, liveTickets)
    );
    return (
      <InboxItemRow
        key={item.id}
        item={item}
        ticketStatus={ticketStatus}
        now={now}
        starredProjects={starredProjects}
        projectOptions={projectOptions}
        overview={inboxOverview}
        onUpdate={(id, patch) => void updateInboxItem(id, patch)}
        onDismiss={(target) => void handleDismiss(target)}
        onAssign={(request) => void assignInboxItem(request)}
        onUnassign={(target) => void handleUnassign(target)}
        onOpenProject={onOpenProject}
        onHandToAgent={handleHandToAgent}
        onAttach={(id, sourcePath) => void attachInboxFile(id, sourcePath)}
        onAttachText={(id, fileName, body) => void attachInboxText(id, fileName, body)}
        onDetach={(id, attachmentId) => void detachInboxFile(id, attachmentId)}
      />
    );
  };

  const loadingFirstPaint = inboxLoading && inboxItems.length === 0;
  const empty = !loadingFirstPaint && visibleItems.length === 0;
  const wide = variant === 'wide';

  // The start screen's own capture bar already sits above this panel; an
  // empty inbox there is not news worth a sentence — the splash stays as
  // calm as it always was. That holds during the loading window too: a
  // skeleton flashing on the splash before anything is known would be its
  // own kind of noise, so "not yet known" renders the same as "empty".
  if (wide && hideCapture && (loadingFirstPaint || empty)) return null;

  return (
    <div
      data-testid="inbox-panel"
      className={
        wide
          ? 'glass-card mx-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl'
          : 'flex h-full flex-col bg-panel-bg'
      }
    >
      <div className="flex items-center justify-between border-b border-white/5 bg-white/2 p-3">
        <h2 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
          Inbox
          {visibleItems.length > 0 && (
            <span
              data-testid="inbox-count"
              className="rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[9px] tracking-normal text-primary-light"
            >
              {visibleItems.length}
            </span>
          )}
        </h2>
        {!loadingFirstPaint && !empty && (
          <label className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-foreground-muted/70">
            <span className="sr-only">Sort inbox</span>
            <select
              aria-label="Sort inbox"
              value={sort}
              onChange={(e) => setSort(e.target.value as InboxSort)}
              className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-foreground-muted outline-none focus-visible:outline-2 focus-visible:outline-primary"
            >
              {INBOX_SORTS.map((option) => (
                <option key={option} value={option}>
                  {INBOX_SORT_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-2">
        {!hideCapture && <InboxCapture />}

        {inboxError !== null && (
          <p data-testid="inbox-error" className="px-1 text-[11px] text-[#ff4a4a]/80">
            {inboxError}
          </p>
        )}

        {loadingFirstPaint && (
          <div data-testid="inbox-loading" className="space-y-1.5 px-1 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-white/[0.03]" />
            ))}
          </div>
        )}

        {empty && (
          <p data-testid="inbox-empty" className="px-1 py-3 text-[11px] text-foreground-muted">
            Nothing captured yet. Drop a task above — you can sort it onto a project later.
          </p>
        )}

        {!loadingFirstPaint && !empty && unsorted.length > 0 && (
          <div>
            <h3 className="mb-1.5 px-1 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-muted/60">
              Unsorted
            </h3>
            <div className="space-y-1.5">{unsorted.map(renderRow)}</div>
          </div>
        )}

        {!loadingFirstPaint && !empty && groups.length > 0 && (
          <div>
            <h3 className="mb-1.5 px-1 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground-muted/60">
              By project
            </h3>
            <div className="space-y-2">
              {groups.map((group) => {
                const collapsed = collapsedGroups.has(group.projectPath);
                return (
                  <div key={group.projectPath} data-testid={`inbox-group-${group.projectPath}`}>
                    <div className="flex items-center gap-1.5 rounded-lg px-1 py-1">
                      <button
                        type="button"
                        data-testid={`inbox-group-collapse-${group.projectPath}`}
                        aria-label={collapsed ? 'Expand group' : 'Collapse group'}
                        onClick={() => toggleGroup(group.projectPath)}
                        className="rounded p-0.5 text-foreground-muted transition-colors hover:bg-white/10"
                      >
                        <AuricIcon
                          name={collapsed ? 'chevron_right' : 'expand_more'}
                          className="text-[13px]"
                        />
                      </button>
                      <button
                        type="button"
                        data-testid={`inbox-group-open-${group.projectPath}`}
                        onClick={() => onOpenProject(group.projectPath)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg py-0.5 text-left transition-colors hover:bg-white/5"
                      >
                        <ProjectTileFace
                          path={group.projectPath}
                          icon={projectIconFor(starredProjects, group.projectPath)}
                          size="xs"
                        />
                        <span className="truncate text-[11px] font-medium text-foreground">
                          {group.projectName}
                        </span>
                        <span className="truncate text-[9px] text-foreground-muted/60">
                          {projectCountsLine(group)}
                        </span>
                      </button>
                    </div>
                    {!collapsed && (
                      <div className="space-y-1.5 pl-2">
                        {group.items.map((entry) => renderRow(entry.item))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {confirmDialog}
    </div>
  );
}
