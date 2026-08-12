'use client';

import { useCallback, useMemo } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { isAgentLive } from '@/lib/agents/liveness';
import { isFinishedAgent } from '@/lib/agents/fleet';
import { formatAgentDuration } from '@/lib/agents/duration';
import { deriveErrorDigest } from '@/lib/agents/errorDigest';
import { agentAttention } from '@/lib/agents/attention';
import { agentColorHex, agentColorLabel, type AgentColor } from '@/lib/agents/colors';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { agentDisplayName } from '@/lib/agents/displayName';
import { ComboProgressBadge } from './ComboProgressBadge';

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
  /** Relaunch a failed agent with its original config. Omit to hide. */
  onRetry?: (id: string) => void;
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
  onRetry,
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
  const displayName = agentDisplayName(agent.name, agent.currentTask);
  const identityTooltip = [displayName, agent.name !== displayName && agent.name, agent.id, detail]
    .filter(Boolean)
    .join(' — ');

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
        aria-label={`${activateLabel} ${displayName}`}
        title={identityTooltip}
        className={`min-w-0 flex-1 truncate text-left text-[11px] transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 ${
          unseen ? 'font-medium text-foreground' : 'text-foreground-muted'
        }`}
      >
        {displayName}
        <ComboProgressBadge agentId={agent.id} className="ml-1.5" />
        {errorDigest && (
          <span data-testid="agent-error-digest" className="ml-1.5 text-[10px] text-red-400/80">
            {errorDigest}
          </span>
        )}
        {/* A parked agent is still being supervised — the one-line activity
            is what lets that happen without restoring the card. Running
            agents only: a frozen last line would read as ongoing work. */}
        {!errorDigest && agent.status === 'running' && agent.currentActivity && (
          <span
            data-testid="agent-row-activity"
            className="ml-1.5 font-mono text-[9px] text-foreground-muted/50"
          >
            {agent.currentActivity}
          </span>
        )}
      </button>
      {/* One number, chosen by state. Parked and running: how long it has
          been going. Stopped: how fresh the outcome is — a review list sorts
          by recency, and the start time answers a question nobody is asking
          anymore. The runtime moves to the tooltip. */}
      <span
        data-testid="compact-agent-age"
        title={
          isFinishedAgent(agent) && agent.finishedAt !== undefined
            ? `Ran for ${formatAgentDuration(agent.finishedAt - agent.startedAt)}`
            : 'Running for'
        }
        className={`flex-shrink-0 font-mono text-[9px] tabular-nums group-hover:opacity-0 ${
          agentAttention(agent, now) === 'needs-input'
            ? 'text-amber-300/80'
            : 'text-foreground-muted/40'
        }`}
      >
        {isFinishedAgent(agent) && agent.finishedAt !== undefined
          ? `${formatAgentDuration(now - agent.finishedAt)} ago`
          : agentAttention(agent, now) === 'needs-input'
            ? // A redrawing prompt makes both runtime and quiet time lie —
              // the reason is the only true thing to print here.
              'needs input'
            : agentAttention(agent, now) === 'stalled' && agent.lastActivityAt !== undefined
              ? // The cost of ignoring a stalled agent is exactly its silence.
                `quiet ${formatAgentDuration(now - agent.lastActivityAt)}`
              : formatAgentDuration(now - agent.startedAt)}
      </span>
      {/* The most likely next action on a failure: run it again, exact same
          config — rebuilding the launch by hand was the expensive part. */}
      {onRetry && agent.status === 'error' && (
        <button
          type="button"
          onClick={() => onRetry(agent.id)}
          aria-label={`Retry ${displayName}`}
          title={`Retry ${agent.name} with the same configuration`}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-foreground-muted opacity-0 transition-all hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <AuricIcon name="replay" aria-hidden="true" className="text-[13px]" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(agent.id)}
        aria-label={`${dismissLabel} ${displayName}`}
        title={`${dismissLabel} ${agent.name}`}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-foreground-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-400/60 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <AuricIcon name={dismissIcon} aria-hidden="true" className="text-[13px]" />
      </button>
    </div>
  );
}
