'use client';

import { useCallback, useMemo } from 'react';
import { useStore } from '@/lib/store';

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
  const pendingApprovalIds = useStore((s) => s.conductorPendingApprovals);
  const decisions = useStore((s) => s.conductorDecisions);
  const providerId = useStore((s) => s.conductorProviderId);
  const model = useStore((s) => s.conductorModel);
  const providers = useStore((s) => s.providers);
  const tickets = useStore((s) => s.pmDraftTickets);
  const goals = useStore((s) => s.goalsDraft);
  const selectedGoalId = useStore((s) => s.selectedGoalId);
  const rootPath = useStore((s) => s.rootPath);

  const startConductor = useStore((s) => s.startConductor);
  const stopConductor = useStore((s) => s.stopConductor);
  const conductorTick = useStore((s) => s.conductorTick);
  const setConductorMaxConcurrent = useStore((s) => s.setConductorMaxConcurrent);
  const setConductorProviderId = useStore((s) => s.setConductorProviderId);
  const setConductorModel = useStore((s) => s.setConductorModel);
  const approveConductorTicket = useStore((s) => s.approveConductorTicket);
  const dismissConductorApproval = useStore((s) => s.dismissConductorApproval);

  const pendingApprovals = useMemo(
    () => tickets.filter((t) => pendingApprovalIds.includes(t.id)),
    [tickets, pendingApprovalIds]
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
    activeAgentCount: Object.keys(assignments).length,
    pendingApprovals,
    decisions,
    canStart: rootPath !== null,
    providers,
    providerId,
    model,
    onStart,
    onStop,
    onSetMaxConcurrent: setConductorMaxConcurrent,
    onSetProvider: setConductorProviderId,
    onSetModel: setConductorModel,
    onApprove,
    onDismiss: dismissConductorApproval,
  };
}
