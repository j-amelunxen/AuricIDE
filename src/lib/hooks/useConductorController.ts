'use client';

import { useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { getConductorPreflight } from '@/lib/store/conductorSlice';

/**
 * Shared wiring for the ConductorPanel: derives every prop the panel needs
 * from the store so any surface (GoalsModal, Mission Control) can embed the
 * same panel without duplicating the glue. Starting scopes the run to the
 * currently selected goal (null = all tickets), exactly like the Goals modal.
 */
export function useConductorController() {
  const running = useStore((s) => s.conductorRunning);
  const conductorGoalId = useStore((s) => s.conductorGoalId);
  const maxConcurrent = useStore((s) => s.conductorMaxConcurrent);
  const assignments = useStore((s) => s.conductorAssignments);
  const reviewAssignments = useStore((s) => s.conductorReviewAssignments);
  const requireReview = useStore((s) => s.conductorRequireReview);
  const judgeForm = useStore((s) => s.conductorJudgeForm);
  const judgeConfigured = useStore((s) => s.judgeLlmConfigured);
  const pendingApprovalIds = useStore((s) => s.conductorPendingApprovals);
  const decisions = useStore((s) => s.conductorDecisions);
  const lastRun = useStore((s) => s.conductorLastRun);
  const providerId = useStore((s) => s.conductorProviderId);
  const model = useStore((s) => s.conductorModel);
  const providers = useStore((s) => s.providers);
  const tickets = useStore((s) => s.pmDraftTickets);
  const dependencies = useStore((s) => s.pmDraftDependencies);
  const goals = useStore((s) => s.goalsDraft);
  const selectedGoalId = useStore((s) => s.selectedGoalId);
  const failedTickets = useStore((s) => s.conductorFailedTickets);
  const approvedTickets = useStore((s) => s.conductorApprovedTickets);
  const rootPath = useStore((s) => s.rootPath);

  const startConductor = useStore((s) => s.startConductor);
  const stopConductor = useStore((s) => s.stopConductor);
  const conductorTick = useStore((s) => s.conductorTick);
  const setConductorMaxConcurrent = useStore((s) => s.setConductorMaxConcurrent);
  const setConductorProviderId = useStore((s) => s.setConductorProviderId);
  const setConductorModel = useStore((s) => s.setConductorModel);
  const setConductorRequireReview = useStore((s) => s.setConductorRequireReview);
  const setConductorJudgeForm = useStore((s) => s.setConductorJudgeForm);
  const approveConductorTicket = useStore((s) => s.approveConductorTicket);
  const dismissConductorApproval = useStore((s) => s.dismissConductorApproval);

  const pendingApprovals = useMemo(
    () => tickets.filter((t) => pendingApprovalIds.includes(t.id)),
    [tickets, pendingApprovalIds]
  );

  // Scoped to the SELECTED goal, not the running one: this answers "what would
  // happen if I pressed Start now".
  const preflight = useMemo(
    () =>
      getConductorPreflight({
        tickets: tickets ?? [],
        // Mirrors conductorTick's own defensive reads: these slices may not be
        // populated yet on a freshly opened project.
        dependencies: dependencies ?? [],
        goals: goals ?? [],
        goalId: selectedGoalId,
        failedTickets: failedTickets ?? {},
        approvedTickets: approvedTickets ?? [],
      }),
    [tickets, dependencies, goals, selectedGoalId, failedTickets, approvedTickets]
  );

  const selectedGoalName = useMemo(
    () =>
      selectedGoalId ? ((goals ?? []).find((g) => g.id === selectedGoalId)?.name ?? null) : null,
    [selectedGoalId, goals]
  );

  const scopeGoalName = useMemo(() => {
    if (!conductorGoalId) return null;
    return goals.find((g) => g.id === conductorGoalId)?.name ?? null;
  }, [conductorGoalId, goals]);

  const onStart = useCallback(() => {
    startConductor(selectedGoalId);
    void conductorTick();
  }, [startConductor, selectedGoalId, conductorTick]);

  const onStop = useCallback(() => stopConductor(), [stopConductor]);

  const onApprove = useCallback(
    (ticketId: string) => void approveConductorTicket(ticketId),
    [approveConductorTicket]
  );

  return {
    running,
    scopeGoalName,
    maxConcurrent,
    // Implementers and reviewers share one budget, so both count as active.
    activeAgentCount: Object.keys(assignments).length + Object.keys(reviewAssignments).length,
    pendingApprovals,
    decisions,
    lastRun,
    preflight,
    selectedGoalName,
    canStart: rootPath !== null && preflight.total > 0,
    startDisabledReason:
      rootPath === null
        ? 'Open a project first'
        : preflight.total === 0
          ? 'No tickets yet - create work first'
          : undefined,
    providers,
    providerId,
    model,
    requireReview,
    judgeForm,
    judgeConfigured,
    onStart,
    onStop,
    onSetMaxConcurrent: setConductorMaxConcurrent,
    onSetProvider: setConductorProviderId,
    onSetModel: setConductorModel,
    onSetRequireReview: setConductorRequireReview,
    onSetJudgeForm: setConductorJudgeForm,
    onApprove,
    onDismiss: dismissConductorApproval,
  };
}
