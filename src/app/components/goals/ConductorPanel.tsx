'use client';

import { useState } from 'react';
import type { PmTicket } from '@/lib/tauri/pm';
import type { ConductorDecision } from '@/lib/store/conductorSlice';
import type { ProviderInfo } from '@/lib/tauri/providers';

interface ConductorPanelProps {
  running: boolean;
  scopeGoalName: string | null;
  maxConcurrent: number;
  activeAgentCount: number;
  pendingApprovals: PmTicket[];
  decisions: ConductorDecision[];
  canStart: boolean;
  providers: ProviderInfo[];
  providerId: string | null;
  model: string | null;
  onStart: () => void;
  onStop: () => void;
  onSetMaxConcurrent: (n: number) => void;
  onSetProvider: (id: string | null) => void;
  onSetModel: (model: string | null) => void;
  onApprove: (ticketId: string) => void;
  onDismiss: (ticketId: string) => void;
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

export function ConductorPanel({
  running,
  scopeGoalName,
  maxConcurrent,
  activeAgentCount,
  pendingApprovals,
  decisions,
  canStart,
  providers,
  providerId,
  model,
  onStart,
  onStop,
  onSetMaxConcurrent,
  onSetProvider,
  onSetModel,
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
            className={`h-2 w-2 rounded-full ${running ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}
          />
          <span className="text-[11px] font-bold text-foreground">Conductor</span>
          <span className="text-[10px] text-foreground-muted">
            {running
              ? `working${scopeGoalName ? ` on "${scopeGoalName}"` : ' (all tickets)'} · ${activeAgentCount} agent(s)`
              : 'stopped'}
          </span>
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

        {/* Agent + model selection (before a run starts) */}
        {!running && providerList.length > 0 && (
          <>
            <label className="flex items-center gap-1.5 text-[10px] text-foreground-muted">
              agent
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
            <label className="flex items-center gap-1.5 text-[10px] text-foreground-muted">
              model
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

        <div className="ml-auto flex items-center gap-2">
          <button
            data-testid="conductor-log-toggle"
            onClick={() => setLogExpanded((v) => !v)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
          >
            <span className="material-symbols-outlined text-sm">receipt_long</span>
            Log ({decisions.length})
          </button>
          {running ? (
            <button
              data-testid="conductor-stop-btn"
              onClick={onStop}
              className="flex items-center gap-1.5 rounded-lg bg-red-500/15 border border-red-500/25 px-3 py-1 text-[11px] font-bold text-red-300 hover:bg-red-500/25 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">stop</span>
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
              className="flex items-center gap-1.5 rounded-lg bg-green-500/15 border border-green-500/25 px-3 py-1 text-[11px] font-bold text-green-300 hover:bg-green-500/25 transition-colors disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-sm">play_arrow</span>
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
              <span className="material-symbols-outlined text-sm text-amber-400">pan_tool</span>
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
                  <span className={`material-symbols-outlined text-[13px] ${meta.cls}`}>
                    {meta.icon}
                  </span>
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
