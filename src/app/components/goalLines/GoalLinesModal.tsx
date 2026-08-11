'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useNow } from '@/lib/hooks/useNow';
import { getRootGoals } from '@/lib/store/goalsSlice';
import { buildGoalLines } from '@/lib/goals/goalLinesLayout';
import { buildForYouQueue, type ForYouItem } from '@/lib/goals/forYou';
import { GoalLineBoard } from './GoalLineBoard';
import { GoalLineLegend } from './GoalLineLegend';
import { ForYouQueue } from './ForYouQueue';
import { PlannerPanel } from './PlannerPanel';
import { ForkProposals } from './ForkProposals';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

/**
 * Goal Lines — every goal as a metro line: done work left, the front where
 * agents stand, planned work right, the terminus always last. Derived
 * entirely from goals, tickets, requirements, runs, and agents; nothing on
 * this board is maintained by hand.
 */
export function GoalLinesModal() {
  const goalLinesOpen = useStore((s) => s.goalLinesOpen);
  if (!goalLinesOpen) return null;
  return <GoalLinesModalContent />;
}

function GoalLinesModalContent() {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const setGoalLinesOpen = useStore((s) => s.setGoalLinesOpen);
  const setSelectedGoalId = useStore((s) => s.setSelectedGoalId);
  const setGoalsModalOpen = useStore((s) => s.setGoalsModalOpen);
  const rootPath = useStore((s) => s.rootPath);
  const loadGoals = useStore((s) => s.loadGoals);
  const loadPmData = useStore((s) => s.loadPmData);
  const loadRequirements = useStore((s) => s.loadRequirements);
  const saveGoals = useStore((s) => s.saveGoals);
  const quickAddHumanStation = useStore((s) => s.quickAddHumanStation);
  const tickHumanStation = useStore((s) => s.tickHumanStation);
  const moveStationTo = useStore((s) => s.moveStationTo);

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
      now: Date.now(),
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

  const handleClose = useCallback(() => setGoalLinesOpen(false), [setGoalLinesOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  const openGoal = useCallback(
    (goalId: string) => {
      setSelectedGoalId(goalId);
      setGoalsModalOpen(true);
      setGoalLinesOpen(false);
    },
    [setSelectedGoalId, setGoalsModalOpen, setGoalLinesOpen]
  );

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

  const handleVerify = useCallback((stationId: string) => {
    // The engine writes the outcome to the store and persists it itself.
    void import('@/lib/evidence/engine').then((m) => m.checkStation(stationId));
  }, []);

  const handleQueueClick = useCallback(
    (item: ForYouItem) => {
      if (item.kind === 'agent' && !item.goalId) {
        // No goal to jump to — get out of the way so the fleet panel shows.
        setGoalLinesOpen(false);
        return;
      }
      const goalId = item.kind === 'agent' ? item.goalId! : item.goalId;
      if (goalId) openGoal(goalId);
    },
    [openGoal, setGoalLinesOpen]
  );

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-lines-modal-title"
      data-testid="goal-lines-modal"
      className="fixed inset-0 z-[105] flex flex-col bg-black/80 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-background-dark/80 px-6 py-3">
        <div className="flex items-center gap-3">
          <AuricIcon name="route" aria-hidden="true" className="text-primary-light" />
          <h1 id="goal-lines-modal-title" className="text-sm font-bold text-foreground">
            Goal Lines
          </h1>
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
        <button
          data-testid="goal-lines-close-btn"
          onClick={handleClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <AuricIcon name="close" aria-hidden="true" className="text-base" />
        </button>
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
            <p className="text-xs text-foreground-muted">No goal has work attached yet.</p>
            <p className="max-w-[320px] text-[10px] text-foreground-muted/70">
              Create a goal and attach tickets. Each goal becomes a line here, with done work on
              the left and the goal always on the right.
            </p>
            <button
              data-testid="goal-lines-open-goals"
              onClick={() => {
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
              onOpenGoal={openGoal}
              onQuickAdd={handleQuickAdd}
              onTick={handleTick}
              onMove={handleMove}
              onVerify={handleVerify}
            />
            <GoalLineLegend />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
