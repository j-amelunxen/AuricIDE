'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { PersistChip } from '@/app/components/ui/PersistChip';
import { useNow } from '@/lib/hooks/useNow';
import { getRootGoals } from '@/lib/store/goalsSlice';
import { buildGoalLines } from '@/lib/goals/goalLinesLayout';
import { buildForYouQueue, type ForYouItem } from '@/lib/goals/forYou';
import { GoalLineBoard } from './GoalLineBoard';
import { ForYouQueue } from './ForYouQueue';
import { PlannerPanel } from './PlannerPanel';
import { ForkProposals } from './ForkProposals';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { GoalLineTimeline, type GoalLineTimelineProps } from './GoalLineTimeline';
import { GoalLineProgress } from './GoalLineProgress';

function GoalLineDetail({ onClose, ...timeline }: GoalLineTimelineProps & { onClose: () => void }) {
  const { line } = timeline;
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({
    id: 'goal-line-detail',
    kind: 'tool',
    active: true,
    onEscape: onClose,
  });
  return (
    <div
      className="fixed inset-0 z-[var(--z-tool-nested)] flex items-center justify-center bg-black/70 p-5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="goal-line-detail-title"
        data-testid="goal-line-detail"
        className="flex max-h-[92vh] w-full max-w-[720px] flex-col gap-5 overflow-y-auto rounded-2xl border border-white/10 bg-background-dark p-6 shadow-2xl"
      >
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-3 w-3 flex-none rounded-[3px]"
              style={{ backgroundColor: line.hue }}
            />
            <h2 id="goal-line-detail-title" className="text-xl font-bold text-foreground">
              {line.name}
            </h2>
            <button
              aria-label="Close goal line detail"
              onClick={onClose}
              className="ml-auto rounded-lg p-2 text-foreground-muted hover:bg-white/10 hover:text-foreground"
            >
              <AuricIcon name="close" aria-hidden="true" />
            </button>
          </div>
          <GoalLineProgress line={line} />
          {line.progress.total > 0 && (
            <span className="text-[11px] text-foreground-muted tabular-nums">
              {`${line.progress.done} of ${line.progress.total} ${line.progress.unit}${
                line.progress.skipped ? ` · ${line.progress.skipped} skipped` : ''
              }`}
            </span>
          )}
        </header>
        <GoalLineTimeline {...timeline} />
      </div>
    </div>
  );
}

function GoalLinesDialog({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({
    id: 'goal-lines',
    kind: 'tool',
    active: true,
    onEscape: onClose,
  });
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-lines-modal-title"
      data-testid="goal-lines-modal"
      className="fixed inset-0 z-[var(--z-tool)] flex flex-col bg-black/80 backdrop-blur-sm"
    >
      {children}
    </div>
  );
}

function RestoreLineFocus({ goalId }: { goalId: string | null }) {
  useEffect(() => {
    if (goalId)
      document.querySelector<HTMLElement>(`[data-testid="goal-line-open-${goalId}"]`)?.focus();
  }, [goalId]);
  return null;
}

/**
 * Goal Lines — every goal as a metro line: done work left, the front where
 * agents stand, planned work right, the terminus always last. Derived
 * entirely from goals, tickets, requirements, runs, and agents; nothing on
 * this board is maintained by hand.
 */
export function GoalLinesModal() {
  const goalLinesOpen = useStore((s) => s.goalLinesOpen);
  if (!goalLinesOpen) return null;
  return <GoalLinesPanel />;
}

export function GoalLinesPanel({ embedded = false }: { embedded?: boolean }) {
  const setGoalLinesOpen = useStore((s) => s.setGoalLinesOpen);
  const goalLinesReturnToGoals = useStore((s) => s.goalLinesReturnToGoals);
  const setSelectedGoalId = useStore((s) => s.setSelectedGoalId);
  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);
  const setWorkTab = useStore((s) => s.setWorkTab);
  const rootPath = useStore((s) => s.rootPath);
  const loadGoals = useStore((s) => s.loadGoals);
  const loadPmData = useStore((s) => s.loadPmData);
  const loadRequirements = useStore((s) => s.loadRequirements);
  const saveGoals = useStore((s) => s.saveGoals);
  const quickAddHumanStation = useStore((s) => s.quickAddHumanStation);
  const tickHumanStation = useStore((s) => s.tickHumanStation);
  const moveStationTo = useStore((s) => s.moveStationTo);
  const resetGoalLine = useStore((s) => s.resetGoalLine);
  const skipStation = useStore((s) => s.skipStation);
  const [detailGoalId, setDetailGoalId] = useState<string | null>(null);
  const [restoreGoalId, setRestoreGoalId] = useState<string | null>(null);

  const goalsDraft = useStore((s) => s.goalsDraft);
  const tickets = useStore((s) => s.pmDraftTickets);
  const dependencies = useStore((s) => s.pmDraftDependencies);
  const requirements = useStore((s) => s.requirementsDraft);
  const requirementLinks = useStore((s) => s.goalRequirementLinksDraft);
  const stations = useStore((s) => s.goalStationsDraft);
  const runs = useStore((s) => s.goalRunsDraft);
  const agents = useStore((s) => s.agents);
  const reviewedAgentIds = useStore((s) => s.reviewedAgentIds);

  const now = useNow();

  // The board opens on whatever the store already has, then freshens.
  useEffect(() => {
    if (!rootPath) return;
    void loadGoals(rootPath);
    void loadPmData(rootPath);
    void loadRequirements(rootPath);
  }, [rootPath, loadGoals, loadPmData, loadRequirements]);

  // The agents array is replaced every ~2s just to bump lastActivityAt, which
  // the layout doesn't read — key the memos on a signature without it so
  // streaming output doesn't rebuild the board every tick.
  const agentSignature = JSON.stringify(
    agents.map(({ lastActivityAt: _ignored, ...rest }) => rest)
  );

  const layoutInput = useMemo(
    () => ({
      goals: goalsDraft,
      tickets,
      dependencies,
      requirements,
      requirementLinks,
      stations,
      runs,
      agents,
      now,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agents is represented by agentSignature
    [
      goalsDraft,
      tickets,
      dependencies,
      requirements,
      requirementLinks,
      stations,
      runs,
      agentSignature,
      now,
    ]
  );

  const lines = useMemo(() => buildGoalLines(layoutInput), [layoutInput]);
  const queue = useMemo(
    () => buildForYouQueue({ ...layoutInput, reviewedAgentIds }),
    [layoutInput, reviewedAgentIds]
  );

  const lineGoalIds = useMemo(() => new Set(lines.map((l) => l.goalId)), [lines]);
  const notStarted = useMemo(
    () => getRootGoals(goalsDraft).filter((g) => g.status !== 'archived' && !lineGoalIds.has(g.id)),
    [goalsDraft, lineGoalIds]
  );
  const agentsById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const runningCount = agents.filter((a) => a.status === 'running').length;
  const needYouCount = queue.length;

  const handleClose = useCallback(() => {
    const returnToGoals = goalLinesReturnToGoals;
    setGoalLinesOpen(false);
    if (returnToGoals) setGoalsModalOpen(true);
  }, [goalLinesReturnToGoals, setGoalLinesOpen, setGoalsModalOpen]);

  const openGoalEditor = useCallback(
    (goalId: string) => {
      setSelectedGoalId(goalId);
      if (embedded) {
        setWorkTab('goals');
        return;
      }
      setGoalsModalOpen(true);
      setGoalLinesOpen(false);
    },
    [embedded, setSelectedGoalId, setGoalsModalOpen, setGoalLinesOpen, setWorkTab]
  );

  const openLine = useCallback((goalId: string) => setDetailGoalId(goalId), []);
  const closeDetail = useCallback(() => {
    const goalId = detailGoalId;
    setRestoreGoalId(goalId);
    setDetailGoalId(null);
  }, [detailGoalId]);

  // Board mutations persist immediately — the board has no Save button, and
  // an edit that only lives in a draft would vanish with the window.
  const persist = useCallback(() => {
    if (rootPath) void saveGoals(rootPath);
  }, [rootPath, saveGoals]);

  const handleQuickAdd = useCallback(
    (goalId: string, name: string) => {
      quickAddHumanStation(goalId, name);
      persist();
    },
    [quickAddHumanStation, persist]
  );
  const handleTick = useCallback(
    (stationId: string) => {
      tickHumanStation(stationId);
      persist();
    },
    [tickHumanStation, persist]
  );
  const handleMove = useCallback(
    (goalId: string, stationId: string, toIndex: number) => {
      moveStationTo(goalId, stationId, toIndex);
      persist();
    },
    [moveStationTo, persist]
  );

  const handleSkip = useCallback(
    (stationId: string, reason: string) => {
      skipStation(stationId, reason);
      persist();
    },
    [skipStation, persist]
  );

  const handleVerify = useCallback((stationId: string) => {
    // The engine writes the outcome to the store and persists it itself.
    void import('@/lib/evidence/engine').then((m) => m.checkStation(stationId));
  }, []);

  const handleReset = useCallback(
    (goalId: string) => {
      resetGoalLine(goalId);
      persist();
      setDetailGoalId(null);
    },
    [persist, resetGoalLine]
  );

  const handleQueueClick = useCallback(
    (item: ForYouItem) => {
      if (item.kind === 'agent' && !item.goalId) {
        // No goal to jump to — get out of the way so the fleet panel shows.
        setGoalLinesOpen(false);
        return;
      }
      const goalId = item.kind === 'agent' ? item.goalId! : item.goalId;
      if (goalId) openGoalEditor(goalId);
    },
    [openGoalEditor, setGoalLinesOpen]
  );

  if (detailGoalId) {
    const detailLine = lines.find((line) => line.goalId === detailGoalId);
    if (detailLine)
      return createPortal(
        <GoalLineDetail
          line={detailLine}
          agentsById={agentsById}
          onClose={closeDetail}
          onTick={handleTick}
          onMove={handleMove}
          onVerify={handleVerify}
          onSkip={handleSkip}
          onQuickAdd={handleQuickAdd}
          onReset={handleReset}
        />,
        document.body
      );
  }

  const inner = (
    <div
      data-testid={embedded ? 'work-panel-lines' : undefined}
      className={embedded ? 'flex h-full flex-col bg-background-dark' : 'flex h-full flex-col'}
    >
      <RestoreLineFocus goalId={restoreGoalId} />
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-background-dark/80 px-6 py-3">
        <div className="flex items-center gap-3">
          <AuricIcon name="route" aria-hidden="true" className="text-primary-light" />
          <h1 id="goal-lines-modal-title" className="text-sm font-bold text-foreground">
            Goal Lines
          </h1>
          <PersistChip mode="autosaved" />
          <span className="text-[10px] text-foreground-muted tabular-nums">
            {lines.length} line{lines.length === 1 ? '' : 's'} · {runningCount} running agent
            {runningCount === 1 ? '' : 's'}
          </span>
          {needYouCount > 0 && (
            <span
              data-testid="goal-lines-need-you"
              className="rounded-full bg-[#ffce2e]/15 px-2 py-0.5 text-[10px] font-bold text-[#ffce2e] tabular-nums"
            >
              {needYouCount} need{needYouCount === 1 ? 's' : ''} you
            </span>
          )}
        </div>
        {!embedded && (
          <button
            data-testid="goal-lines-close-btn"
            aria-label="Close"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <AuricIcon name="close" aria-hidden="true" className="text-base" />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6">
        {lines.length === 0 && notStarted.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <AuricIcon
              name="route"
              aria-hidden="true"
              className="text-4xl text-foreground-muted/30"
            />
            <p className="text-xs text-foreground-muted">No goals have work yet.</p>
            <p className="max-w-[320px] text-[10px] text-foreground-muted/70">
              Create a goal and attach tickets. Each goal appears here from completed work to its
              next step.
            </p>
            <button
              data-testid="goal-lines-open-goals"
              onClick={() => {
                if (embedded) {
                  setWorkTab('goals');
                  return;
                }
                setGoalsModalOpen(true);
                setGoalLinesOpen(false);
              }}
              className="mt-2 rounded-xl border border-primary/20 bg-primary/10 px-5 py-2 text-xs font-bold text-primary-light transition-colors hover:bg-primary/20"
            >
              Open Goals
            </button>
            <div className="mt-4 w-full max-w-[720px]">
              <PlannerPanel />
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
            <PlannerPanel />
            <ForkProposals />
            <ForYouQueue items={queue} runningCount={runningCount} onItemClick={handleQueueClick} />
            <GoalLineBoard
              lines={lines}
              notStarted={notStarted}
              agentsById={agentsById}
              now={now}
              onOpenLine={openLine}
              onOpenGoal={openGoalEditor}
              onTick={handleTick}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) return inner;

  return createPortal(
    <GoalLinesDialog onClose={handleClose}>{inner}</GoalLinesDialog>,
    document.body
  );
}
