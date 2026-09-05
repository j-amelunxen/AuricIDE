'use client';

import { useState } from 'react';
import type { PmTicket } from '@/lib/tauri/pm';
import type {
  ConductorDecision,
  ConductorPreflight,
  ConductorRunSummary,
} from '@/lib/store/conductorSlice';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useConfirm } from '@/lib/hooks/useConfirm';
import {
  formatRunDuration,
  LAST_RUN_META,
  lastRunLabel,
  preflightLabel,
} from './conductor/conductorHelpers';
import { ConductorSettingsBar } from './conductor/ConductorSettingsBar';
import { ConductorApprovals, ConductorDecisionLog } from './conductor/ConductorPanels';

export { formatRunDuration };

export interface ConductorPanelProps {
  running: boolean;
  scopeGoalName: string | null;
  maxConcurrent: number;
  activeAgentCount: number;
  /**
   * Agents Stop would actually kill — implementers and reviewers alike. Not the
   * same as `activeAgentCount`, which also counts slots held by a spawn still
   * in flight; those have no process to lose.
   */
  runningAgentCount: number;
  pendingApprovals: PmTicket[];
  decisions: ConductorDecision[];
  lastRun: ConductorRunSummary | null;
  canStart: boolean;
  startDisabledReason?: string;
  /** What a run would find right now — shown before starting. */
  preflight?: ConductorPreflight;
  /** Goal a run would be scoped to; null = all tickets. */
  selectedGoalName?: string | null;
  providers: ProviderInfo[];
  providerId: string | null;
  model: string | null;
  /** Whether finished tickets pass an independent judge before done. */
  requireReview: boolean;
  /** Which judge form review uses. */
  judgeForm: 'llm' | 'agent';
  /** Provider a spawned reviewer runs on; null = the conductor's own. */
  judgeProviderId: string | null;
  /** Model a spawned reviewer runs on; null = the conductor's own. */
  judgeModel: string | null;
  /** Model name the inline LLM judge would use, for the read-only line. */
  judgeLlmModel: string | null;
  /** True when a separate judge model is configured (gates the LLM form). */
  judgeConfigured: boolean;
  onStart: () => void;
  onStop: () => void;
  onSetMaxConcurrent: (n: number) => void;
  onSetProvider: (id: string | null) => void;
  onSetModel: (model: string | null) => void;
  onSetRequireReview: (v: boolean) => void;
  onSetJudgeForm: (form: 'llm' | 'agent') => void;
  onSetJudgeProvider: (id: string | null) => void;
  onSetJudgeModel: (model: string | null) => void;
  onApprove: (ticketId: string) => void;
  onDismiss: (ticketId: string) => void;
}

export function ConductorPanel({
  running,
  scopeGoalName,
  maxConcurrent,
  activeAgentCount,
  runningAgentCount,
  pendingApprovals,
  decisions,
  lastRun,
  canStart,
  startDisabledReason,
  preflight,
  selectedGoalName = null,
  providers,
  providerId,
  model,
  requireReview,
  judgeForm,
  judgeProviderId,
  judgeModel,
  judgeLlmModel,
  judgeConfigured,
  onStart,
  onStop,
  onSetMaxConcurrent,
  onSetProvider,
  onSetModel,
  onSetRequireReview,
  onSetJudgeForm,
  onSetJudgeProvider,
  onSetJudgeModel,
  onApprove,
  onDismiss,
}: ConductorPanelProps) {
  const [logExpanded, setLogExpanded] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const providerList = providers ?? [];
  const activeProvider = providerList.find((p) => p.id === providerId) ?? providerList[0];
  // A review needs *a* judge: an API key for the inline form, or an agent CLI
  // for the spawned one. With neither there is nothing to review with.
  const canReview = judgeConfigured || providerList.length > 0;
  // What the stored form would actually resolve to. Without a key the inline
  // form cannot run, so the panel must not claim it is the one in effect.
  const effectiveJudgeForm = judgeForm === 'llm' && !judgeConfigured ? 'agent' : judgeForm;
  const judgeProvider =
    providerList.find((p) => p.id === (judgeProviderId ?? providerId)) ?? providerList[0];

  // Stop kills every agent the run launched, so it asks first — but only while
  // there is something to lose. With nothing running the question would be
  // friction, not a safeguard.
  const handleStop = async () => {
    if (runningAgentCount > 0) {
      const what =
        runningAgentCount === 1 ? '1 running agent' : `${runningAgentCount} running agents`;
      const go = await confirm({
        title: 'Stop the conductor?',
        message: `Stop ${what}? Their work in progress is lost.`,
        confirmLabel: 'Stop',
      });
      if (!go) return;
    }
    onStop();
  };

  return (
    <div data-testid="conductor-panel" className="border-t border-white/5 bg-black/20 px-4 py-3">
      {/* Row one answers "what is it doing" and "what do I press". It carries
          nothing that can grow, so the button never gets pushed off the edge of
          a narrow surface — the panel sits in a 768px card on the cockpit and
          at full modal width in Goals. */}
      <div className="flex items-center gap-3">
        {/* Status */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            data-testid="conductor-status-dot"
            className={`h-2 w-2 flex-shrink-0 rounded-full ${
              running
                ? 'bg-green-400 animate-pulse'
                : lastRun
                  ? LAST_RUN_META[lastRun.outcome].dot
                  : 'bg-gray-500'
            }`}
          />
          <span className="flex-shrink-0 text-[11px] font-bold text-foreground">Conductor</span>
          {running ? (
            <span className="truncate text-[11px] text-foreground-muted">
              {`working${scopeGoalName ? ` on "${scopeGoalName}"` : ' (all tickets)'} · ${activeAgentCount} agent(s)`}
            </span>
          ) : lastRun ? (
            <span
              data-testid="conductor-last-run"
              className={`truncate text-[11px] ${LAST_RUN_META[lastRun.outcome].cls}`}
              title={lastRun.blockers.length > 0 ? lastRun.blockers.join('; ') : undefined}
            >
              {lastRunLabel(lastRun)}
              {lastRun.ticketBudget !== null
                ? ` · ${lastRun.spawned} of ${lastRun.ticketBudget} tickets started`
                : ''}
              {` · ${lastRun.completed} done`}
              {lastRun.failed > 0 ? `, ${lastRun.failed} failed` : ''}
              {` · ${formatRunDuration(lastRun.startedAt, lastRun.endedAt)}`}
            </span>
          ) : (
            <span className="truncate text-[11px] text-foreground-muted">stopped</span>
          )}
        </div>

        {/* What pressing Start would actually do */}
        {!running && preflight && (canStart || startDisabledReason?.includes('tickets')) && (
          <span
            data-testid="conductor-preflight"
            role="status"
            aria-live="polite"
            title={preflightLabel(preflight, selectedGoalName)}
            className="min-w-0 truncate text-[10px] text-foreground-muted tabular-nums"
          >
            {preflightLabel(preflight, selectedGoalName)}
          </span>
        )}

        <div data-testid="conductor-actions" className="flex flex-shrink-0 items-center gap-2">
          <button
            data-testid="conductor-log-toggle"
            onClick={() => setLogExpanded((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
          >
            <AuricIcon name="receipt_long" className="text-sm" />
            Log ({decisions.length})
          </button>
          {running ? (
            <button
              data-testid="conductor-stop-btn"
              onClick={() => void handleStop()}
              className="flex items-center gap-1.5 rounded-lg bg-red-500/15 border border-red-500/25 px-3 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/25 transition-colors"
            >
              <AuricIcon name="stop" className="text-sm" />
              Stop
            </button>
          ) : (
            <button
              data-testid="conductor-start-btn"
              onClick={onStart}
              disabled={!canStart}
              title={
                canStart
                  ? 'Autonomously work all unblocked tickets in scope'
                  : (startDisabledReason ?? 'Open a project first')
              }
              className="flex items-center gap-1.5 rounded-lg bg-green-500/15 border border-green-500/25 px-3 py-1 text-[11px] font-bold text-green-300 hover:bg-green-500/25 transition-colors disabled:opacity-40"
            >
              <AuricIcon name="play_arrow" className="text-sm" />
              Start
            </button>
          )}
        </div>
      </div>

      {/* Settings bar */}
      <ConductorSettingsBar
        running={running}
        maxConcurrent={maxConcurrent}
        onSetMaxConcurrent={onSetMaxConcurrent}
        providerList={providerList}
        providerId={providerId}
        onSetProvider={onSetProvider}
        model={model}
        onSetModel={onSetModel}
        activeProvider={activeProvider}
        canReview={canReview}
        requireReview={requireReview}
        judgeConfigured={judgeConfigured}
        onSetRequireReview={onSetRequireReview}
        onSetJudgeForm={onSetJudgeForm}
        effectiveJudgeForm={effectiveJudgeForm}
        judgeProviderId={judgeProviderId}
        onSetJudgeProvider={onSetJudgeProvider}
        judgeModel={judgeModel}
        onSetJudgeModel={onSetJudgeModel}
        judgeProvider={judgeProvider}
        judgeLlmModel={judgeLlmModel}
      />

      {/* Pending approvals */}
      <ConductorApprovals
        pendingApprovals={pendingApprovals}
        onApprove={onApprove}
        onDismiss={onDismiss}
      />

      {/* Decision log */}
      <ConductorDecisionLog expanded={logExpanded} decisions={decisions} />

      {confirmDialog}
    </div>
  );
}
