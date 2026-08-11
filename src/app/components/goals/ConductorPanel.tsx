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

interface ConductorPanelProps {
  running: boolean;
  scopeGoalName: string | null;
  maxConcurrent: number;
  activeAgentCount: number;
  pendingApprovals: PmTicket[];
  decisions: ConductorDecision[];
  lastRun: ConductorRunSummary | null;
  canStart: boolean;
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
  /** True when a separate judge model is configured (gates review). */
  judgeConfigured: boolean;
  onStart: () => void;
  onStop: () => void;
  onSetMaxConcurrent: (n: number) => void;
  onSetProvider: (id: string | null) => void;
  onSetModel: (model: string | null) => void;
  onSetRequireReview: (v: boolean) => void;
  onSetJudgeForm: (form: 'llm' | 'agent') => void;
  onApprove: (ticketId: string) => void;
  onDismiss: (ticketId: string) => void;
}

/** Compact human-readable run duration: 42s, 13m, 1h 4m. */
export function formatRunDuration(startedAt: string, endedAt: string): string {
  const ms = Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const LAST_RUN_META: Record<ConductorRunSummary['outcome'], { cls: string; dot: string }> = {
  goal_achieved: { cls: 'text-green-300', dot: 'bg-green-400' },
  goal_blocked: { cls: 'text-amber-300', dot: 'bg-amber-400' },
  finished: { cls: 'text-foreground-muted', dot: 'bg-gray-500' },
  user_stopped: { cls: 'text-foreground-muted', dot: 'bg-gray-500' },
};

function lastRunLabel(run: ConductorRunSummary): string {
  switch (run.outcome) {
    case 'goal_achieved':
      return run.goalName ? `achieved "${run.goalName}"` : 'goal achieved';
    case 'goal_blocked':
      return `blocked — ${run.blockers.length} blocker${run.blockers.length === 1 ? '' : 's'}`;
    case 'finished':
      return 'finished';
    case 'user_stopped':
      return 'stopped by you';
  }
}

const DECISION_ICONS: Record<ConductorDecision['action'], { icon: string; cls: string }> = {
  start: { icon: 'play_arrow', cls: 'text-green-400' },
  stop: { icon: 'stop', cls: 'text-gray-400' },
  spawn: { icon: 'rocket_launch', cls: 'text-primary-light' },
  complete: { icon: 'check_circle', cls: 'text-green-400' },
  fail: { icon: 'error', cls: 'text-red-400' },
  approval_needed: { icon: 'pan_tool', cls: 'text-amber-400' },
  approved: { icon: 'thumb_up', cls: 'text-sky-400' },
  goal_achieved: { icon: 'military_tech', cls: 'text-green-300' },
};

/**
 * Reads the preflight as a sentence a human can act on: what the run will pick
 * up first, then what it will leave alone and why.
 */
function preflightLabel(preflight: ConductorPreflight, selectedGoalName: string | null): string {
  const held: string[] = [];
  if (preflight.blocked > 0) held.push(`${preflight.blocked} blocked`);
  if (preflight.needsApproval > 0) held.push(`${preflight.needsApproval} need approval`);
  if (preflight.inProgress > 0) held.push(`${preflight.inProgress} in progress`);
  if (preflight.exhausted > 0) held.push(`${preflight.exhausted} out of attempts`);

  if (preflight.ready === 0 && preflight.inProgress === 0) {
    const nothing = selectedGoalName
      ? 'nothing to work — will verify the goal'
      : 'no open tickets in scope';
    return held.length > 0 ? `${nothing} · ${held.join(' · ')}` : nothing;
  }

  return [`${preflight.ready} ready`, ...held].join(' · ');
}

export function ConductorPanel({
  running,
  scopeGoalName,
  maxConcurrent,
  activeAgentCount,
  pendingApprovals,
  decisions,
  lastRun,
  canStart,
  preflight,
  selectedGoalName = null,
  providers,
  providerId,
  model,
  requireReview,
  judgeForm,
  judgeConfigured,
  onStart,
  onStop,
  onSetMaxConcurrent,
  onSetProvider,
  onSetModel,
  onSetRequireReview,
  onSetJudgeForm,
  onApprove,
  onDismiss,
}: ConductorPanelProps) {
  const [logExpanded, setLogExpanded] = useState(false);
  const providerList = providers ?? [];
  const activeProvider = providerList.find((p) => p.id === providerId) ?? providerList[0];
  const selectCls =
    'rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary/30';

  return (
    <div data-testid="conductor-panel" className="border-t border-white/5 bg-black/20 px-4 py-2.5">
      <div className="flex items-center gap-3">
        {/* Status */}
        <div className="flex items-center gap-2">
          <span
            data-testid="conductor-status-dot"
            className={`h-2 w-2 rounded-full ${
              running
                ? 'bg-green-400 animate-pulse'
                : lastRun
                  ? LAST_RUN_META[lastRun.outcome].dot
                  : 'bg-gray-500'
            }`}
          />
          <span className="text-[11px] font-bold text-foreground">Conductor</span>
          {running ? (
            <span className="text-[10px] text-foreground-muted">
              {`working${scopeGoalName ? ` on "${scopeGoalName}"` : ' (all tickets)'} · ${activeAgentCount} agent(s)`}
            </span>
          ) : lastRun ? (
            <span
              data-testid="conductor-last-run"
              className={`text-[10px] ${LAST_RUN_META[lastRun.outcome].cls}`}
              title={lastRun.blockers.length > 0 ? lastRun.blockers.join('; ') : undefined}
            >
              {lastRunLabel(lastRun)}
              {` · ${lastRun.completed} done`}
              {lastRun.failed > 0 ? `, ${lastRun.failed} failed` : ''}
              {` · ${formatRunDuration(lastRun.startedAt, lastRun.endedAt)}`}
            </span>
          ) : (
            <span className="text-[10px] text-foreground-muted">stopped</span>
          )}
        </div>

        {/* Concurrency */}
        <label className="ml-2 flex items-center gap-1.5 text-[10px] text-foreground-muted">
          parallel
          <input
            data-testid="conductor-max-concurrent"
            type="number"
            min={1}
            max={8}
            value={maxConcurrent}
            onChange={(e) => onSetMaxConcurrent(Number(e.target.value) || 1)}
            className="w-12 rounded bg-white/5 px-1.5 py-0.5 text-center text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary/30"
          />
        </label>

        {/* Provider + model selection (before a run starts) */}
        {!running && providerList.length > 0 && (
          <>
            <label className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
              Provider
              <select
                data-testid="conductor-provider-select"
                value={providerId ?? ''}
                onChange={(e) => onSetProvider(e.target.value || null)}
                className={selectCls}
              >
                <option value="">Default</option>
                {providerList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
              Model
              <select
                data-testid="conductor-model-select"
                value={model ?? ''}
                onChange={(e) => onSetModel(e.target.value || null)}
                className={selectCls}
              >
                <option value="">Auto (per ticket)</option>
                {activeProvider?.models.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {/* Judge review: gated on a configured judge model. Off = the old
            behavior (exit 0 = done). On = a finished ticket is reviewed first. */}
        {!running && (
          <label
            className={`flex items-center gap-1.5 text-[11px] ${
              judgeConfigured ? 'text-foreground-muted' : 'text-foreground-muted/40'
            }`}
            title={
              judgeConfigured
                ? 'Finished tickets pass an independent judge before counting as done.'
                : 'Configure a Judge model in Settings → Judge to enable review.'
            }
          >
            <input
              data-testid="conductor-require-review"
              type="checkbox"
              checked={requireReview && judgeConfigured}
              disabled={!judgeConfigured}
              onChange={(e) => onSetRequireReview(e.target.checked)}
              className="accent-primary"
            />
            Judge review
          </label>
        )}
        {!running && requireReview && judgeConfigured && (
          <label className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
            via
            <select
              data-testid="conductor-judge-form"
              value={judgeForm}
              onChange={(e) => onSetJudgeForm(e.target.value as 'llm' | 'agent')}
              className={selectCls}
            >
              <option value="llm">LLM call</option>
              <option value="agent">Review agent</option>
            </select>
          </label>
        )}

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* What pressing Start would actually do, in the same glance as the
              button. One line, always: squeezed by the bar it truncates with
              the full sentence in the tooltip — a one-word-per-line column
              reads as a broken layout, not as information. */}
          {!running && canStart && preflight && (
            <span
              data-testid="conductor-preflight"
              title={preflightLabel(preflight, selectedGoalName)}
              className="min-w-0 truncate text-[10px] text-foreground-muted tabular-nums"
            >
              {preflightLabel(preflight, selectedGoalName)}
            </span>
          )}
          <button
            data-testid="conductor-log-toggle"
            onClick={() => setLogExpanded((v) => !v)}
            className="flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
          >
            <AuricIcon name="receipt_long" className="text-sm" />
            Log ({decisions.length})
          </button>
          {running ? (
            <button
              data-testid="conductor-stop-btn"
              onClick={onStop}
              className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-red-500/15 border border-red-500/25 px-3 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/25 transition-colors"
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
                  : 'Open a project first'
              }
              className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-green-500/15 border border-green-500/25 px-3 py-1 text-[11px] font-bold text-green-300 hover:bg-green-500/25 transition-colors disabled:opacity-40"
            >
              <AuricIcon name="play_arrow" className="text-sm" />
              Start
            </button>
          )}
        </div>
      </div>

      {/* Pending approvals */}
      {pendingApprovals.length > 0 && (
        <div
          data-testid="conductor-approvals"
          className="mt-2 space-y-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-300">
            Human approval needed
          </p>
          {pendingApprovals.map((ticket) => (
            <div key={ticket.id} className="flex items-center gap-2">
              <AuricIcon name="pan_tool" className="text-sm text-amber-400" />
              <span className="flex-1 truncate text-[11px] text-foreground">{ticket.name}</span>
              <button
                data-testid={`conductor-approve-${ticket.id}`}
                onClick={() => onApprove(ticket.id)}
                className="rounded-lg bg-green-500/20 px-2.5 py-1 text-[10px] font-bold text-green-300 hover:bg-green-500/30 transition-colors"
              >
                Approve
              </button>
              <button
                data-testid={`conductor-dismiss-${ticket.id}`}
                onClick={() => onDismiss(ticket.id)}
                className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] text-foreground-muted hover:bg-white/10 transition-colors"
              >
                Skip
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Decision log */}
      {logExpanded && (
        <div
          data-testid="conductor-log"
          className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-xl bg-black/30 p-2.5"
        >
          {decisions.length === 0 ? (
            <p className="text-[10px] text-foreground-muted/70">No decisions yet.</p>
          ) : (
            decisions.map((d) => {
              const meta = DECISION_ICONS[d.action];
              return (
                <div key={d.id} className="flex items-start gap-2 text-[10px]">
                  <AuricIcon name={meta.icon} className={`text-[13px] ${meta.cls}`} />
                  <span className="flex-1 text-foreground/80">{d.detail}</span>
                  <span className="tabular-nums text-foreground-muted/60">{d.timestamp}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
