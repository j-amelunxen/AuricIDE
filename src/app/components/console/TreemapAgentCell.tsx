'use client';

import { useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
import {
  consoleAgentState,
  consoleStateLabel,
  type ConsoleAgentState,
} from '@/lib/agents/consoleState';
import { describeRightNow } from '@/lib/agents/consoleActivity';
import { formatAgentDuration } from '@/lib/agents/duration';
import { agentColorHex, type AgentColor } from '@/lib/agents/colors';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useWorktreeMergeOffer } from '@/lib/hooks/useWorktreeMergeOffer';
import { useStore } from '@/lib/store';
import { parsePermissionMenu, promptTailLines } from '@/lib/agents/permissionMenu';
import { PhaseChip } from './PhaseChip';

const EMPTY_LOGS: string[] = [];

const CELL_FACE: Record<ConsoleAgentState, string> = {
  yours: 'bg-amber-500/15 border-amber-400/45',
  error: 'bg-red-500/15 border-red-400/50',
  stalled: 'bg-orange-500/15 border-orange-400/45',
  working: 'bg-emerald-500/10 border-emerald-400/30',
  done: 'bg-primary/10 border-primary/35',
};

function answerToneClass(label: string): string {
  if (/^yes\b/i.test(label))
    return 'border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10';
  if (/^no\b/i.test(label)) return 'border-red-400/35 text-red-400 hover:bg-red-400/10';
  return 'border-white/10 text-foreground-muted hover:bg-white/5';
}

export interface TreemapAgentCellProps {
  agent: AgentInfo;
  events: AgentEvent[];
  reviewed: boolean;
  color?: AgentColor;
  width: number;
  height: number;
  onFocus?: (agentId: string) => void;
  onOpenTerminal: (agentId: string) => void;
  onStop?: (agentId: string) => void;
  onRetry?: (agentId: string) => void;
  onMarkReviewed?: (agentId: string) => void;
  onDismiss?: (agentId: string) => void;
}

/**
 * One agent in the fleet treemap. Colour is status — the Finviz reading —
 * and a user marker only ever sits on the left edge. Clicking the cell
 * (not a nested control) opens Focus.
 */
export function TreemapAgentCell({
  agent,
  events,
  reviewed,
  color,
  width,
  height,
  onFocus,
  onOpenTerminal,
  onStop,
  onRetry,
  onMarkReviewed,
  onDismiss,
}: TreemapAgentCellProps) {
  const now = useNow();
  const { confirm, confirmDialog } = useConfirm();
  const offerMerge = useWorktreeMergeOffer(confirm);
  const sendAgentInput = useStore((s) => s.sendAgentInput);
  const showToast = useStore((s) => s.showToast);
  const logTail = useStore((s) => s.agentLogs[agent.id] ?? EMPTY_LOGS);
  const [replyText, setReplyText] = useState('');

  const state = consoleAgentState(agent, reviewed, now);
  const label = consoleStateLabel(state, reviewed);
  const lastEvent = events.at(-1);
  const markerHex = agentColorHex(color);
  const rightNow = describeRightNow({
    state,
    lastEvent,
    currentActivity: agent.currentActivity,
  });
  const roomy = width >= 260 && height >= 140;
  const isRunningLike = state === 'yours' || state === 'stalled' || state === 'working';
  const menuOptions = roomy && state === 'yours' ? parsePermissionMenu(logTail) : null;
  const tailLines = roomy && state === 'yours' ? promptTailLines(logTail) : [];

  const handleStop = async () => {
    const go = await confirm({
      title: 'Stop this agent?',
      message: `Stop ${agent.name}? Its work in progress is lost.`,
      confirmLabel: 'Stop',
    });
    if (!go) return;
    await Promise.resolve(onStop?.(agent.id));
    await offerMerge(agent);
  };

  const send = (text: string) => {
    void sendAgentInput(agent.id, text);
    showToast(`Sent to ${agent.name}`);
  };

  const onCellClick = (event: React.MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('button, input, textarea')) return;
    onFocus?.(agent.id);
  };

  return (
    <div
      data-testid={`console-agent-card-${agent.id}`}
      data-console-card
      data-agent-id={agent.id}
      data-repo-path={agent.repoPath ?? ''}
      tabIndex={0}
      role="group"
      aria-label={`${agent.name} — ${label}`}
      onClick={onCellClick}
      className={`relative flex h-full min-h-0 cursor-pointer flex-col overflow-hidden rounded-md border p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${CELL_FACE[state]} ${
        markerHex ? 'pl-3' : ''
      }`}
    >
      {markerHex && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: markerHex }}
        />
      )}

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">
          {agent.name}
        </span>
        <PhaseChip state={state} label={label} size="compact" />
      </div>

      <p className="mt-0.5 min-w-0 flex-1 truncate text-[10px] leading-4 text-foreground/90">
        {rightNow}
      </p>

      {roomy && state === 'yours' && tailLines.length > 0 && (
        <div
          data-testid="prompt-tail"
          className="mt-1 overflow-hidden rounded bg-black/40 px-1.5 py-1 font-mono text-[10px] leading-relaxed text-foreground-muted"
        >
          {tailLines.map((line, i) => (
            <div key={i} className="truncate">
              {line}
            </div>
          ))}
        </div>
      )}

      {roomy && state === 'yours' && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {menuOptions?.map((option) => (
            <button
              key={option.send}
              type="button"
              title={option.label}
              onClick={() => send(`${option.send}\n`)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${answerToneClass(
                option.label
              )}`}
            >
              {option.send}
            </button>
          ))}
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const trimmed = replyText.trim();
                if (!trimmed) return;
                send(`${trimmed}\n`);
                setReplyText('');
              }
            }}
            placeholder="Reply"
            aria-label={`Reply to ${agent.name}`}
            className="min-w-0 flex-1 rounded border border-amber-500/30 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground placeholder:text-foreground-muted/60 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
          />
        </div>
      )}

      <div className="mt-auto flex flex-shrink-0 items-center gap-1 pt-1">
        {onFocus && (
          <button
            type="button"
            onClick={() => onFocus(agent.id)}
            className="rounded border border-primary/40 bg-white/5 px-1.5 py-0.5 text-[10px] text-primary-light transition-colors hover:bg-primary/10"
          >
            Focus
          </button>
        )}
        {roomy && (
          <button
            type="button"
            onClick={() => onOpenTerminal(agent.id)}
            className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-foreground-muted transition-colors hover:text-foreground"
          >
            Terminal
          </button>
        )}
        {state === 'stalled' && roomy && (
          <button
            type="button"
            onClick={() => send('\n')}
            className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-foreground-muted hover:text-orange-300"
          >
            Send Enter
          </button>
        )}
        {state === 'error' && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(agent.id)}
            className="rounded border border-primary/40 bg-white/5 px-1.5 py-0.5 text-[10px] text-primary-light hover:bg-primary/10"
          >
            Retry
          </button>
        )}
        {state === 'done' && !reviewed && onMarkReviewed && (
          <button
            type="button"
            onClick={() => onMarkReviewed(agent.id)}
            className="rounded px-1.5 py-0.5 text-[10px] text-foreground-muted hover:text-foreground"
          >
            Reviewed
          </button>
        )}
        <span className="ml-auto flex items-center gap-1">
          {roomy && (
            <span className="font-mono text-[9px] text-foreground-muted">
              {formatAgentDuration(now - agent.startedAt)}
            </span>
          )}
          {(state === 'done' || state === 'error') && onDismiss && roomy && (
            <button
              type="button"
              onClick={() => {
                onDismiss(agent.id);
                void offerMerge(agent);
              }}
              className="rounded px-1.5 py-0.5 text-[10px] text-foreground-muted hover:text-red-400"
            >
              Dismiss
            </button>
          )}
          {isRunningLike && onStop && (
            <button
              type="button"
              onClick={() => void handleStop()}
              className="rounded px-1.5 py-0.5 text-[10px] text-foreground-muted hover:text-red-400"
            >
              Stop
            </button>
          )}
        </span>
      </div>

      {confirmDialog}
    </div>
  );
}
