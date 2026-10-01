'use client';

import { useState, useMemo, type DragEvent, type MouseEvent } from 'react';
import type { PmGoal, PmGoalDependency, PmGoalStation } from '@/lib/tauri/goals';
import type { PmTicket } from '@/lib/tauri/pm';
import type { GoalStatusValue } from '@/lib/pm/enums';
import {
  getGoalChildren,
  getGoalDescendants,
  getGoalWorkProgress,
  getRootGoals,
  type GoalDropPosition,
} from '@/lib/store/goalsSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ContextMenu, type ContextMenuOption } from '@/app/components/ide/ContextMenu';
import { GoalDependencyChips } from './GoalDependencyChips';
import {
  buildBulkGoalMenuOptions,
  type BulkMenuStage,
  type GoalBulkUpdate,
} from '@/lib/goals/bulkGoalMenu';

export const GOAL_STATUS_STYLES: Record<
  GoalStatusValue,
  { dot: string; label: string; text: string }
> = {
  draft: { dot: 'bg-gray-400', label: 'Draft', text: 'text-gray-300' },
  active: { dot: 'bg-sky-400', label: 'Active', text: 'text-sky-300' },
  in_progress: { dot: 'bg-amber-400 animate-pulse', label: 'In Progress', text: 'text-amber-300' },
  in_review: { dot: 'bg-violet-400', label: 'In Review', text: 'text-violet-300' },
  achieved: { dot: 'bg-green-400', label: 'Achieved', text: 'text-green-300' },
  failed: { dot: 'bg-red-400', label: 'Failed', text: 'text-red-300' },
  archived: { dot: 'bg-gray-600', label: 'Archived', text: 'text-gray-500' },
};

interface GoalTreeProps {
  goals: PmGoal[];
  tickets: PmTicket[];
  /** Goal stations: a goal worked without tickets shows its station progress. */
  stations?: PmGoalStation[];
  /** "Waits for" edges and bundle scoping; a goal shows its own chips from these. */
  dependencies?: PmGoalDependency[];
  /** The focused goal: the one the detail panel shows. */
  selectedId: string | null;
  /** Everything selected, focused goal included. Absent means just `selectedId`. */
  selectedIds?: ReadonlySet<string>;
  /** Plain click: replaces the selection. */
  onSelect: (id: string) => void;
  /** Shift-click: toggles one goal in the selection. Without it Shift-click selects. */
  onToggleSelect?: (id: string) => void;
  /** Applies bulk changes from the multi-selection menu; without it that menu is not offered. */
  onBulkUpdate?: (updates: GoalBulkUpdate[]) => void;
  onMoveGoal?: (draggedId: string, targetId: string, position: GoalDropPosition) => void;
  /** Deletes a goal and its subtree; adds the entry to the right-click menu. */
  onDelete?: (id: string) => void;
  /** Starts a new goal under this one; adds the entry to the right-click menu. */
  onAddSubGoal?: (parentId: string) => void;
  /** Agent count per goal id (running agents working toward the goal). */
  activeAgentsByGoal?: Record<string, number>;
  /** Opens the goal creation dialog; enables the empty-state call to action. */
  onCreate?: () => void;
  /** True while goals are being read — an empty tree is not yet a fact. */
  loading?: boolean;
  /** Why the goals could not be read; shown instead of a false empty state. */
  loadError?: string | null;
}

interface GoalNodeProps extends GoalTreeProps {
  goal: PmGoal;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  draggedId: string | null;
  dropTarget: { id: string; position: GoalDropPosition } | null;
  onDragStart: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDragOverGoal: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDropGoal: (id: string, event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onContextMenuGoal: (id: string, event: MouseEvent<HTMLDivElement>) => void;
}

export function getGoalDropPosition(
  clientY: number,
  rect: Pick<DOMRect, 'top' | 'height'>
): GoalDropPosition {
  const ratio = (clientY - rect.top) / Math.max(rect.height, 1);
  return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
}

// code-gate: complexity-cyclomatic, complexity-function-length, complexity-parameter-count - recursive tree-node row (drag/drop, menu, collapse, progress, badges, children); chips already split out to GoalDependencyChips, splitting the rest would scatter one visual row across files
function GoalNode({
  goal,
  depth,
  goals,
  tickets,
  stations = [],
  dependencies = [],
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onMoveGoal,
  activeAgentsByGoal,
  collapsed,
  onToggle,
  draggedId,
  dropTarget,
  onDragStart,
  onDragOverGoal,
  onDropGoal,
  onDragEnd,
  onContextMenuGoal,
}: GoalNodeProps) {
  const children = getGoalChildren(goals, goal.id);
  const progress = getGoalWorkProgress(goals, tickets, stations, goal.id);
  const isCollapsed = collapsed.has(goal.id);
  const isFocused = goal.id === selectedId;
  const inSelection = selectedIds ? selectedIds.has(goal.id) : isFocused;
  const isMulti = (selectedIds?.size ?? 0) > 1;
  const isSelected = isFocused || inSelection;
  // Shift-click edits the selection; without a handler it behaves as a plain click.
  const choose = (shift: boolean) =>
    shift && onToggleSelect ? onToggleSelect(goal.id) : onSelect(goal.id);
  const style = GOAL_STATUS_STYLES[goal.status] ?? GOAL_STATUS_STYLES.draft;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;
  const agentCount = activeAgentsByGoal?.[goal.id] ?? 0;
  const dropPosition = dropTarget?.id === goal.id ? dropTarget.position : null;

  return (
    <div className="relative">
      {dropPosition === 'before' && (
        <span
          data-testid={`goal-drop-before-${goal.id}`}
          className="pointer-events-none absolute -top-px left-3 right-3 z-10 h-0.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary-light-rgb),0.7)]"
        />
      )}
      <div
        data-testid={`goal-node-${goal.id}`}
        role="button"
        aria-pressed={inSelection}
        tabIndex={0}
        draggable
        onDragStart={(event) => onDragStart(goal.id, event)}
        onDragOver={(event) => onDragOverGoal(goal.id, event)}
        onDrop={(event) => onDropGoal(goal.id, event)}
        onDragEnd={onDragEnd}
        onContextMenu={(event) => onContextMenuGoal(goal.id, event)}
        onClick={(e) => choose(e.shiftKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            choose(e.shiftKey);
          }
        }}
        style={{ paddingLeft: `${12 + depth * 20}px` }}
        className={`group flex w-full cursor-grab select-none items-center gap-2 rounded-lg py-2 pr-3 text-left transition-[background-color,box-shadow,opacity] active:cursor-grabbing ${
          draggedId === goal.id ? 'opacity-35' : ''
        } ${
          dropPosition === 'inside'
            ? 'bg-primary/20 ring-1 ring-inset ring-primary/60'
            : isFocused
              ? 'bg-primary/15 ring-1 ring-primary/30'
              : isSelected
                ? 'bg-primary/10 ring-1 ring-inset ring-primary/20'
                : 'hover:bg-white/5'
        }`}
      >
        {children.length > 0 ? (
          <button
            type="button"
            data-testid={`goal-toggle-${goal.id}`}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? 'Expand sub-goals' : 'Collapse sub-goals'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(goal.id);
            }}
            className="-ml-1 w-4 shrink-0 cursor-pointer text-sm text-foreground-muted hover:text-foreground"
          >
            <AuricIcon name={isCollapsed ? 'chevron_right' : 'expand_more'} />
          </button>
        ) : (
          <span className="-ml-1 w-4 shrink-0" />
        )}

        <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} title={style.label} />

        <span
          className={`flex-1 truncate text-xs ${isFocused || (isSelected && !isMulti) ? 'font-semibold text-foreground' : 'text-foreground/90'}`}
        >
          {goal.name}
        </span>

        {agentCount > 0 && (
          <span
            data-testid={`goal-agents-${goal.id}`}
            title={`${agentCount} agent(s) running`}
            className="flex items-center gap-1 rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold text-primary-light"
          >
            <AuricIcon name="smart_toy" className="text-[10px]" />
            {agentCount}
          </span>
        )}

        {(goal.priority === 'critical' || goal.priority === 'high') && (
          <span
            className={`text-[9px] font-bold uppercase ${goal.priority === 'critical' ? 'text-red-400' : 'text-amber-400'}`}
          >
            {goal.priority}
          </span>
        )}

        <GoalDependencyChips goal={goal} goals={goals} dependencies={dependencies} />

        {percent !== null && (
          <span className="flex w-24 shrink-0 items-center gap-1.5">
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <span
                data-testid={`goal-progress-${goal.id}`}
                className={`block h-full rounded-full transition ${percent === 100 ? 'bg-green-400' : 'bg-primary'}`}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span
              data-testid={`goal-progress-label-${goal.id}`}
              title={progress.unit === 'stations' ? 'Stations verified' : 'Tickets done'}
              className="text-[9px] tabular-nums text-foreground-muted"
            >
              {progress.done}/{progress.total}
              {progress.skipped ? ` · ${progress.skipped} skipped` : ''}
            </span>
          </span>
        )}
      </div>

      {dropPosition === 'after' && (
        <span
          data-testid={`goal-drop-after-${goal.id}`}
          className="pointer-events-none absolute -bottom-px left-3 right-3 z-10 h-0.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary-light-rgb),0.7)]"
        />
      )}

      {!isCollapsed &&
        children.map((child) => (
          <GoalNode
            key={child.id}
            goal={child}
            depth={depth + 1}
            goals={goals}
            tickets={tickets}
            stations={stations}
            dependencies={dependencies}
            selectedId={selectedId}
            selectedIds={selectedIds}
            onSelect={onSelect}
            onToggleSelect={onToggleSelect}
            onMoveGoal={onMoveGoal}
            activeAgentsByGoal={activeAgentsByGoal}
            collapsed={collapsed}
            onToggle={onToggle}
            draggedId={draggedId}
            dropTarget={dropTarget}
            onDragStart={onDragStart}
            onDragOverGoal={onDragOverGoal}
            onDropGoal={onDropGoal}
            onDragEnd={onDragEnd}
            onContextMenuGoal={onContextMenuGoal}
          />
        ))}
    </div>
  );
}

export function GoalTree({
  goals,
  tickets,
  stations,
  dependencies,
  selectedId,
  selectedIds,
  onSelect,
  onToggleSelect,
  onBulkUpdate,
  onMoveGoal,
  onDelete,
  onAddSubGoal,
  activeAgentsByGoal,
  onCreate,
  loading = false,
  loadError = null,
}: GoalTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{
    goalId: string;
    x: number;
    y: number;
    /** Set when the menu acts on the whole multi-selection, not on the clicked row. */
    bulkIds?: string[];
    stage?: BulkMenuStage;
  } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: GoalDropPosition;
  } | null>(null);
  const roots = useMemo(() => getRootGoals(goals), [goals]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canDrop = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return false;
    return !getGoalDescendants(goals, sourceId).some((goal) => goal.id === targetId);
  };

  const handleDragStart = (id: string, event: DragEvent<HTMLDivElement>) => {
    setDraggedId(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const handleDragOverGoal = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    if (!draggedId || !canDrop(draggedId, targetId)) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position = getGoalDropPosition(event.clientY, rect);
    setDropTarget({ id: targetId, position });
  };

  const handleDropGoal = (targetId: string, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedId && dropTarget?.id === targetId && canDrop(draggedId, targetId)) {
      onMoveGoal?.(draggedId, targetId, dropTarget.position);
      if (dropTarget.position === 'inside') {
        setCollapsed((previous) => {
          const next = new Set(previous);
          next.delete(targetId);
          return next;
        });
      }
    }
    setDraggedId(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  // Without either handler the menu would open with nothing in it — leave the
  // browser's own menu alone in that case.
  const handleContextMenuGoal = (id: string, event: MouseEvent<HTMLDivElement>) => {
    // A right-click inside a multi-selection acts on all of it; outside, on that row alone.
    if (onBulkUpdate && selectedIds && selectedIds.size > 1 && selectedIds.has(id)) {
      event.preventDefault();
      event.stopPropagation();
      setMenu({
        goalId: id,
        x: event.clientX,
        y: event.clientY,
        bulkIds: [...selectedIds],
        stage: 'root',
      });
      return;
    }
    if (!onDelete && !onAddSubGoal) return;
    event.preventDefault();
    event.stopPropagation();
    setMenu({ goalId: id, x: event.clientX, y: event.clientY });
  };

  // The menu acts on the row that was right-clicked, which is not necessarily
  // the selected one — so it names the goal, and says what else goes with it.
  // Adding comes first: the destructive entry should not be where the pointer
  // already is when the menu appears.
  const menuGoal = menu ? (goals.find((goal) => goal.id === menu.goalId) ?? null) : null;
  const menuOptions: ContextMenuOption[] = useMemo(() => {
    if (!menuGoal) return [];
    if (menu?.bulkIds && onBulkUpdate) {
      const ids = menu.bulkIds;
      const showStage = (stage: BulkMenuStage) =>
        setMenu((prev) => (prev ? { ...prev, stage } : prev));
      return buildBulkGoalMenuOptions(goals, ids, menu.stage ?? 'root', {
        onApply: onBulkUpdate,
        onOpenParentStage: () => showStage('parent'),
        onBack: () => showStage('root'),
      });
    }
    const options: ContextMenuOption[] = [{ type: 'header', label: menuGoal.name }];
    if (onAddSubGoal) {
      options.push({
        type: 'item',
        label: 'Add sub-goal',
        icon: 'add',
        action: () => onAddSubGoal(menuGoal.id),
      });
    }
    if (onDelete) {
      if (onAddSubGoal) options.push({ type: 'separator' });
      options.push({
        type: 'item',
        label: 'Delete goal',
        icon: 'delete',
        danger: true,
        action: () => onDelete(menuGoal.id),
      });
      const subCount = getGoalDescendants(goals, menuGoal.id).length;
      if (subCount > 0) {
        options.push({
          type: 'header',
          label: `Includes ${subCount} sub-goal${subCount === 1 ? '' : 's'}`,
        });
      }
    }
    return options;
  }, [goals, menu, menuGoal, onAddSubGoal, onBulkUpdate, onDelete]);

  // An empty tree means three different things. Saying "no goals yet" while
  // the read is still running — or failed — is the one that makes a user
  // believe their project state is gone.
  if (roots.length === 0 && loadError) {
    return (
      <div
        data-testid="goal-tree-error"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <AuricIcon name="error" className="text-3xl text-red-400/60" />
        <p className="text-xs font-medium text-foreground">Goals could not be read</p>
        <p className="max-w-[260px] text-[10px] leading-relaxed text-foreground-muted">
          {loadError}
        </p>
      </div>
    );
  }

  if (roots.length === 0 && loading) {
    return (
      <div
        data-testid="goal-tree-loading"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-xs text-foreground-muted">Loading goals…</p>
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div
        data-testid="goal-tree-empty"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <AuricIcon name="flag" className="text-3xl text-foreground-muted/40" />
        <p className="text-xs font-medium text-foreground">No goals yet</p>
        <p className="max-w-[260px] text-[10px] leading-relaxed text-foreground-muted">
          A goal describes a target state the conductor can verify: tickets done, requirements
          verified, sub-goals achieved.
        </p>
        {onCreate ? (
          <button
            data-testid="goal-tree-empty-create"
            onClick={onCreate}
            className="mt-2 rounded-lg bg-primary/15 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/25 transition-colors"
          >
            Create your first goal
          </button>
        ) : (
          <p className="mt-2 max-w-[260px] text-[10px] leading-relaxed text-foreground-muted">
            Open a project to create goals.
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-testid="goal-tree" className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {roots.map((root) => (
        <GoalNode
          key={root.id}
          goal={root}
          depth={0}
          goals={goals}
          tickets={tickets}
          stations={stations}
          dependencies={dependencies}
          selectedId={selectedId}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onToggleSelect={onToggleSelect}
          onMoveGoal={onMoveGoal}
          activeAgentsByGoal={activeAgentsByGoal}
          collapsed={collapsed}
          onToggle={toggle}
          draggedId={draggedId}
          dropTarget={dropTarget}
          onDragStart={handleDragStart}
          onDragOverGoal={handleDragOverGoal}
          onDropGoal={handleDropGoal}
          onDragEnd={handleDragEnd}
          onContextMenuGoal={handleContextMenuGoal}
        />
      ))}

      {menu && menuGoal && (
        <ContextMenu x={menu.x} y={menu.y} options={menuOptions} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
