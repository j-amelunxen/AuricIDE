'use client';

import { useCallback, useMemo } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { isAgentLive } from '@/lib/agents/liveness';
import { formatAgentDuration } from '@/lib/agents/duration';
import { deriveErrorDigest } from '@/lib/agents/errorDigest';
import { agentColorHex, agentColorLabel, type AgentColor } from '@/lib/agents/colors';

const EMPTY_LOGS: string[] = [];

export interface CompactAgentRowProps {
  agent: AgentInfo;
  /** What clicking the row does, phrased for the label ("Restore", "Open logs of"). */
  activateLabel: string;
  onActivate: (id: string) => void;
  /** Secondary action on hover ("Terminate", "Dismiss"). */
  dismissLabel: string;
  dismissIcon: string;
  onDismiss: (id: string) => void;
  /** Marker colour the user put on this agent. */
  color?: AgentColor;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
  /** True while a stopped agent's outcome has not been opened yet. */
  unseen?: boolean;
}

const DOT_BY_STATUS: Record<AgentInfo['status'], string> = {
  running: 'bg-amber-400/70',
  idle: 'bg-emerald-400/70',
  queued: 'bg-foreground-muted/60',
  error: 'bg-red-400',
};

/**
 * One agent folded to a single line. Used for both the agents you set aside
 * and the ones that have stopped — in both cases you want to know it is
 * there, what it was, and how to get back to it, and nothing more.
 */
export function CompactAgentRow({
  agent,
  activateLabel,
  onActivate,
  dismissLabel,
  dismissIcon,
  onDismiss,
  color,
  onContextMenu,
  unseen = false,
}: CompactAgentRowProps) {
  const now = useNow();
  const dot = isAgentLive(agent, now) ? 'bg-primary' : DOT_BY_STATUS[agent.status];

  // A failed agent states its reason on the row itself — finding out what
  // went wrong must cost a glance, not opening a terminal. Subscribed only
  // for failed agents; everyone else keeps the stable empty reference.
  const isError = agent.status === 'error';
  const logs = useStore(
    useCallback(
      (s) => (isError ? (s.agentLogs[agent.id] ?? EMPTY_LOGS) : EMPTY_LOGS),
      [agent.id, isError]
    )
  );
  const errorDigest = useMemo(() => (isError ? deriveErrorDigest(logs) : null), [isError, logs]);

  // What it is doing now beats what it was asked to do — that is the thing you
  // came back to check on. Fall back to the instruction before any output.
  const detail =
    errorDigest ?? ((agent.status === 'running' && agent.currentActivity) || agent.currentTask);
  const markerHex = agentColorHex(color);
  const markerLabel = agentColorLabel(color);

  return (
    <div
      onContextMenu={onContextMenu && ((e) => onContextMenu(e, agent.id))}
      className="group relative flex items-center gap-2 rounded-md py-1 pl-2.5 pr-1.5 transition-colors hover:bg-white/5"
    >
      {/* Same left edge as the card, so a marked agent stays recognisable
          whether it is expanded, parked or done. */}
      {markerHex && (
        <span
          data-testid="agent-color-marker"
          aria-label={`Marked ${markerLabel}`}
          role="img"
          className="pointer-events-none absolute inset-y-0.5 left-0 w-1 rounded-full"
          style={{ backgroundColor: markerHex }}
        />
      )}
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} />
      {/* An outcome nobody has looked at yet keeps a visible claim on the
          user — the dot only clears when the logs were actually opened. */}
      {unseen && (
        <span
          data-testid="agent-unseen-dot"
          role="img"
          aria-label="Not yet reviewed"
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary"
        />
      )}
      <button
        type="button"
        onClick={() => onActivate(agent.id)}
        aria-label={`${activateLabel} ${agent.name}`}
        title={detail ? `${agent.name} — ${detail}` : agent.name}
        className={`flex-1 truncate text-left text-[11px] transition-colors hover:text-foreground ${
          unseen ? 'font-medium text-foreground' : 'text-foreground-muted'
        }`}
      >
        {agent.name}
        {errorDigest && (
          <span data-testid="agent-error-digest" className="ml-1.5 text-[10px] text-red-400/80">
            {errorDigest}
          </span>
        )}
      </button>
      {/* Coming back to a parked agent, "how long has this been going" is the
          first thing you want — and it costs no extra line here. */}
      <span
        data-testid="compact-agent-age"
        className="flex-shrink-0 font-mono text-[9px] tabular-nums text-foreground-muted/40 group-hover:opacity-0"
      >
        {formatAgentDuration(now - agent.startedAt)}
      </span>
      <button
        type="button"
        onClick={() => onDismiss(agent.id)}
        aria-label={`${dismissLabel} ${agent.name}`}
        title={`${dismissLabel} ${agent.name}`}
        className="flex-shrink-0 rounded p-0.5 text-foreground-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
          {dismissIcon}
        </span>
      </button>
    </div>
  );
}
