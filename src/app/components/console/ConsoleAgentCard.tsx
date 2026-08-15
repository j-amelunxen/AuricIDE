'use client';

import { useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
import { consoleAgentState, consoleStateLabel } from '@/lib/agents/consoleState';
import { describeRightNow } from '@/lib/agents/consoleActivity';
import { filesTouched } from '@/lib/agents/events/footprint';
import { formatAgentDuration } from '@/lib/agents/duration';
import { isAgentLive } from '@/lib/agents/liveness';
import { agentColorHex, type AgentColor } from '@/lib/agents/colors';
import { useNow } from '@/lib/hooks/useNow';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';
import { parsePermissionMenu, promptTailLines } from '@/lib/agents/permissionMenu';
import { Heartbeat, CONSOLE_STATE_HEARTBEAT_TONE } from './Heartbeat';
import { PhaseChip } from './PhaseChip';

function footprintLabel(files: string[]): string {
  if (files.length === 0) return 'No files changed yet';
  return `${files.length} ${files.length === 1 ? 'file' : 'files'} changed`;
}

const ANSWER_LABEL_LIMIT = 28;

function truncateAnswerLabel(label: string): string {
  return label.length > ANSWER_LABEL_LIMIT ? `${label.slice(0, ANSWER_LABEL_LIMIT - 1)}…` : label;
}

/** Yes/no colour cues, same reading as the dummy's `.radio button.yes/.no`. */
function answerToneClass(label: string): string {
  if (/^yes\b/i.test(label))
    return 'border-emerald-400/40 text-emerald-400 hover:bg-emerald-400/10';
  if (/^no\b/i.test(label)) return 'border-red-400/35 text-red-400 hover:bg-red-400/10';
  return 'border-white/10 text-foreground-muted hover:bg-white/5';
}

const EMPTY_LOGS: string[] = [];

function lastOutputLabel(agent: AgentInfo, now: number): string {
  if (agent.status === 'running' && isAgentLive(agent, now)) return 'live';
  return agent.lastActivityAt !== undefined
    ? formatAgentDuration(now - agent.lastActivityAt)
    : 'live';
}

export interface ConsoleAgentCardProps {
  agent: AgentInfo;
  /** This agent's structured event history, oldest first. */
  events: AgentEvent[];
  /** 24 trailing per-minute output-volume samples — see `heartbeatSeries`. */
  heartbeat: number[];
  /** Whether this agent's outcome has already been opened. */
  reviewed: boolean;
  /** Marker colour the user put on this agent. */
  color?: AgentColor;
  /** Opens the focus view — the single-agent stage with its live terminal. */
  onFocus?: (agentId: string) => void;
  onOpenTerminal: (agentId: string) => void;
  onStop?: (agentId: string) => void;
  onRetry?: (agentId: string) => void;
  onMarkReviewed?: (agentId: string) => void;
  onDismiss?: (agentId: string) => void;
}

/**
 * One agent's row in the Agent Console: what it is, what it's doing right
 * now, and the handful of actions that make sense from its current state.
 * Phase and urgency are read from `consoleAgentState`, the same bucket the
 * project section sorts by — a card can never disagree with its own position
 * in the list.
 */
export function ConsoleAgentCard({
  agent,
  events,
  heartbeat,
  reviewed,
  color,
  onFocus,
  onOpenTerminal,
  onStop,
  onRetry,
  onMarkReviewed,
  onDismiss,
}: ConsoleAgentCardProps) {
  const now = useNow();
  const { confirm, confirmDialog } = useConfirm();
  const sendAgentInput = useStore((s) => s.sendAgentInput);
  const showToast = useStore((s) => s.showToast);
  // Scoped to this one agent's id, so a chunk streamed for any other agent in
  // the fleet does not force this card to re-render — same trick AgentCard
  // uses for its own log preview.
  const logTail = useStore((s) => s.agentLogs[agent.id] ?? EMPTY_LOGS);
  const [replyText, setReplyText] = useState('');

  const state = consoleAgentState(agent, reviewed, now);
  const label = consoleStateLabel(state, reviewed);
  const lastEvent = events.at(-1);
  const filesChanged = filesTouched(events);
  const markerHex = agentColorHex(color);

  const runtime = formatAgentDuration(now - agent.startedAt);
  const quietFor = lastOutputLabel(agent, now);
  const rightNow = describeRightNow({
    state,
    lastEvent,
    currentActivity: agent.currentActivity,
    quietFor,
  });

  const isRunningLike = state === 'yours' || state === 'stalled' || state === 'working';
  const menuOptions = state === 'yours' ? parsePermissionMenu(logTail) : null;
  const tailLines = state === 'yours' ? promptTailLines(logTail) : [];

  const handleStop = async () => {
    const go = await confirm({
      title: 'Stop this agent?',
      message: `Stop ${agent.name}? Its work in progress is lost.`,
      confirmLabel: 'Stop',
    });
    if (go) onStop?.(agent.id);
  };

  const send = (text: string) => {
    void sendAgentInput(agent.id, text);
    showToast(`Sent to ${agent.name}`);
  };

  const sendReply = () => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    send(`${trimmed}\n`);
    setReplyText('');
  };

  return (
    <div
      data-testid={`console-agent-card-${agent.id}`}
      className={`glass-card relative flex flex-col gap-1.5 overflow-hidden rounded-lg p-2.5 ${
        markerHex ? 'pl-4' : ''
      }`}
    >
      {markerHex && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: markerHex }}
        />
      )}

      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {agent.name}
        </span>
        <span className="font-mono text-[10px] text-foreground-muted">{agent.model}</span>
        <PhaseChip state={state} label={label} />
        <span
          className="whitespace-nowrap font-mono text-[10px] text-foreground-muted"
          title="Runtime · last output"
        >
          {runtime} · {quietFor}
        </span>
      </div>

      {agent.currentTask && (
        <p className="truncate text-[11px] text-foreground-muted" title={agent.currentTask}>
          {agent.currentTask}
        </p>
      )}

      <div className="flex items-end justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-[11px] text-foreground">
          <span aria-hidden="true" className="text-foreground-muted">
            ›{' '}
          </span>
          {rightNow}
        </p>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          <Heartbeat values={heartbeat} tone={CONSOLE_STATE_HEARTBEAT_TONE[state]} />
          <span
            className="font-mono text-[10px] text-foreground-muted"
            title={filesChanged.length > 0 ? filesChanged.join('\n') : undefined}
          >
            {footprintLabel(filesChanged)}
          </span>
        </div>
      </div>

      {state === 'yours' && tailLines.length > 0 && (
        <div
          data-testid="prompt-tail"
          className="overflow-hidden rounded bg-black/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground-muted"
        >
          {tailLines.map((line, i) => (
            <div
              key={i}
              className={
                line.endsWith('?') || line.startsWith('❯') ? 'truncate text-amber-300' : 'truncate'
              }
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {state === 'yours' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {menuOptions?.map((option) => (
            <button
              key={option.send}
              type="button"
              title={option.label}
              onClick={() => send(`${option.send}\n`)}
              className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${answerToneClass(
                option.label
              )}`}
            >
              {option.send} {truncateAnswerLabel(option.label)}
            </button>
          ))}
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendReply();
            }}
            placeholder="Or send an instruction"
            aria-label={`Reply to ${agent.name}`}
            className="min-w-0 flex-1 rounded border border-amber-500/30 bg-black/40 px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-foreground-muted/60 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
          />
        </div>
      )}

      <div className="flex items-center gap-1.5 pt-0.5">
        {onFocus && (
          <button
            type="button"
            onClick={() => onFocus(agent.id)}
            className="rounded border border-primary/40 bg-white/5 px-2 py-1 text-[11px] text-primary-light transition-colors hover:bg-primary/10"
          >
            Focus
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenTerminal(agent.id)}
          className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-primary/50 hover:text-foreground"
        >
          Open terminal
        </button>
        {state === 'stalled' && (
          <button
            type="button"
            onClick={() => send('\n')}
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:border-orange-400/50 hover:text-orange-300"
          >
            Send Enter
          </button>
        )}
        {state === 'error' && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(agent.id)}
            className="rounded border border-primary/40 bg-white/5 px-2 py-1 text-[11px] text-primary-light transition-colors hover:bg-primary/10"
          >
            Retry
          </button>
        )}
        {state === 'done' && !reviewed && onMarkReviewed && (
          <button
            type="button"
            onClick={() => onMarkReviewed(agent.id)}
            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:text-foreground"
          >
            Mark reviewed
          </button>
        )}
        {(state === 'done' || state === 'error') && onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(agent.id)}
            className="ml-auto rounded px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:text-red-400"
          >
            Dismiss
          </button>
        )}
        {isRunningLike && onStop && (
          <button
            type="button"
            onClick={() => void handleStop()}
            className="ml-auto rounded px-2 py-1 text-[11px] text-foreground-muted transition-colors hover:text-red-400"
          >
            Stop
          </button>
        )}
      </div>

      {confirmDialog}
    </div>
  );
}
