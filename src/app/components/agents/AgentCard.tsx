'use client';

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { isAgentIdling, isAgentLive } from '@/lib/agents/liveness';
import { formatAgentDuration } from '@/lib/agents/duration';
import { AGENT_STATE_LABEL, agentState, type AgentState } from '@/lib/agents/state';
import { agentColorHex, agentColorLabel, type AgentColor } from '@/lib/agents/colors';
import { stripAnsi } from '@/lib/terminal/ansi';

const EMPTY_LOGS: string[] = [];

/** Muted by default — the chip states a fact, it does not compete with the name. */
const STATE_CHIP: Record<AgentState, string> = {
  working: 'border-primary/30 bg-primary/10 text-primary-light',
  waiting: 'border-amber-500/25 bg-amber-500/10 text-amber-400/90',
  done: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400/90',
  error: 'border-red-400/30 bg-red-400/10 text-red-400',
  queued: 'border-white/10 bg-white/5 text-foreground-muted',
};

// The card preview is ~10 lines tall — rendering the whole retained buffer
// (up to MAX_AGENT_LOG_BYTES) per streamed chunk wastes CPU for nothing.
const LOG_PREVIEW_CHUNKS = 50;

export interface AgentCardProps {
  agent: AgentInfo;
  onKill: (id: string) => void;
  onSelect?: (id: string) => void;
  /** Fold this agent down to a parked one-liner. Omit to hide the control. */
  onMinimize?: (id: string) => void;
  /** Give the agent a human-chosen name. Omit to hide the control. */
  onRename?: (id: string, name: string) => void;
  /** Marker colour the user put on this agent, for grouping and flagging. */
  color?: AgentColor;
  /** Right-click on the card — the panel turns this into the colour menu. */
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
}

export function AgentCard({
  agent,
  onKill,
  onSelect,
  onMinimize,
  onRename,
  color,
  onContextMenu,
}: AgentCardProps) {
  const [viewMode, setViewMode] = useState<'status' | 'terminal'>('status');
  const [isRenaming, setIsRenaming] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const isRunning = agent.status === 'running';
  const isLive = isAgentLive(agent, now);
  const isIdling = isAgentIdling(agent, now);
  const state = agentState(agent, now);
  const markerHex = agentColorHex(color);
  const markerLabel = agentColorLabel(color);

  /**
   * One duration, chosen by state. While an agent is quiet, how long it has
   * been quiet is the useful number; otherwise it is how long it has been
   * running. Showing both put two bare numbers side by side that read as a
   * mistake — and on a fresh agent they are literally the same number. With no
   * recorded activity there is no silence to measure, so runtime stands in.
   */
  const runtime = formatAgentDuration(now - agent.startedAt);
  const showQuiet = state === 'waiting' && agent.lastActivityAt !== undefined;
  const durationLabel = showQuiet
    ? `quiet ${formatAgentDuration(now - (agent.lastActivityAt ?? now))}`
    : runtime;
  const durationTitle = showQuiet
    ? `No output for a while — running for ${runtime}`
    : 'Running for';

  /** The name is derived from the instruction, so the two are often the same
   * text. Showing it twice — truncated above, in full below — is noise. */
  const nameStem = agent.name.replace(/…$/, '');
  const objectiveRepeatsName = !!agent.currentTask && agent.currentTask.startsWith(nameStem);
  const nameTooltip = [
    agent.currentTask ?? agent.name,
    agent.id,
    onRename && 'Double-click to rename',
  ]
    .filter(Boolean)
    .join(' · ');

  // Subscribe only to this agent's logs, and only while the terminal preview
  // is visible — in status mode the stable EMPTY_LOGS reference means log
  // appends don't re-render the card at all.
  const showTerminal = viewMode === 'terminal';
  const logs = useStore(
    useCallback(
      (s) => (showTerminal ? (s.agentLogs[agent.id] ?? EMPTY_LOGS) : EMPTY_LOGS),
      [agent.id, showTerminal]
    )
  );

  // Memoized: the card re-renders every second via useNow, but the preview
  // only changes when this agent's logs do.
  const logPreview = useMemo(() => stripAnsi(logs.slice(-LOG_PREVIEW_CHUNKS).join('')), [logs]);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewMode === 'terminal') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, viewMode]);

  useEffect(() => {
    if (isRenaming) nameInputRef.current?.select();
  }, [isRenaming]);

  // Switching to the terminal view is asking to talk to the agent, so put the
  // caret there — but without preventScroll the browser yanks the whole panel
  // to the card, which is not what "let me peek at this one" should do.
  useEffect(() => {
    if (viewMode === 'terminal') replyRef.current?.focus({ preventScroll: true });
    else setReplyError(null);
  }, [viewMode]);

  const toggleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewMode((v) => (v === 'status' ? 'terminal' : 'status'));
  };

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRenaming(true);
  };

  /**
   * Commits on blur as well as on Enter: a name typed and then clicked away
   * from is a name the user meant. Escape is the way to back out, and it
   * clears the field first so the blur that follows has nothing to commit.
   */
  const commitRename = () => {
    if (!isRenaming) return;
    const next = nameInputRef.current?.value.trim() ?? '';
    setIsRenaming(false);
    if (next && next !== agent.name) onRename?.(agent.id, next);
  };

  /**
   * Sends a reply to the agent's PTY. The input element is captured before the
   * await: React resets the event's currentTarget once the handler returns, so
   * touching it afterwards would clear the wrong thing — or nothing at all.
   * A message that failed to reach the agent stays in the field, because
   * clearing it would look exactly like a delivered one.
   */
  const sendReply = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const input = e.currentTarget;
    const message = input.value;
    if (!message) return;

    setReplyError(null);
    try {
      const { writeToShell } = await import('@/lib/tauri/terminal');
      await writeToShell(`agent-${agent.id}`, `${message}\n`);
      input.value = '';
    } catch {
      setReplyError('Message could not be delivered — the agent may have exited.');
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.currentTarget.value = agent.name;
      setIsRenaming(false);
    }
  };

  // Card border + glow varies by agent activity state
  const cardGlowClass = isLive
    ? 'border-primary/50 shadow-[0_0_35px_rgba(var(--primary-rgb),0.25),0_0_70px_rgba(var(--primary-rgb),0.08)] hover:shadow-[0_0_45px_rgba(var(--primary-rgb),0.35)]'
    : isIdling
      ? 'border-amber-500/25 hover:border-amber-500/40 hover:shadow-[0_0_20px_rgba(245,158,11,0.08)]'
      : 'hover:border-primary/30 hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)]';

  return (
    <div
      onClick={() => onSelect?.(agent.id)}
      onContextMenu={onContextMenu && ((e) => onContextMenu(e, agent.id))}
      className={`glass-card group relative flex flex-col gap-3 rounded-xl p-3 transition-all duration-500 cursor-pointer overflow-hidden ${cardGlowClass} ${
        viewMode === 'terminal' ? 'min-h-[200px]' : ''
      } ${markerHex ? 'pl-4' : ''}`}
    >
      {/* The marker gets the left edge, deliberately away from the state chip:
          status already owns amber, emerald, red and the accent, so painting a
          user's colour into that slot would quietly change what the card
          claims. An edge stripe also scans a whole column at a glance. */}
      {markerHex && (
        <span
          data-testid="agent-color-marker"
          aria-label={`Marked ${markerLabel}`}
          role="img"
          className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
          style={{ backgroundColor: markerHex }}
        />
      )}

      {/* Live: subtle purple inner glow overlay */}
      {isLive && (
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent" />
      )}

      {/* Header */}
      <div className="z-10 flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div
            className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/5 bg-gradient-to-br ${
              isLive
                ? 'from-primary/30 via-primary/10 to-transparent'
                : isIdling
                  ? 'from-amber-500/15 to-transparent'
                  : 'from-white/5 to-transparent'
            }`}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-lg text-foreground">
              {viewMode === 'terminal' ? 'terminal' : 'smart_toy'}
            </span>
            {/* Anchored inside the tile rather than hanging half outside it,
                where it read as a stray dot. It scans the list at a glance;
                the chip carries the same state in words. */}
            {isRunning && (
              <span className="absolute bottom-0.5 right-0.5 h-2 w-2">
                {isLive ? (
                  <>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                  </>
                ) : (
                  /* Idle: static amber dot — agent is running but not outputting */
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400/70" />
                )}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                ref={nameInputRef}
                type="text"
                defaultValue={agent.name}
                aria-label="Agent name"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleNameKeyDown}
                onBlur={commitRename}
                className="w-full rounded border border-primary/40 bg-black/40 px-1 py-0.5 font-display text-[13px] font-semibold text-foreground outline-none focus:border-primary"
              />
            ) : (
              /* One line, always. The name is the loudest thing on the card
                 because it is what you are looking for. */
              <h3
                onDoubleClick={onRename ? startRename : undefined}
                title={nameTooltip}
                className="truncate font-display text-[13px] font-semibold leading-tight tracking-[-0.01em] text-foreground transition-colors group-hover:text-primary"
              >
                {agent.name}
              </h3>
            )}
            {/* One quiet line of context: which model, and the single duration
                that matters in this state. Never two bare numbers. */}
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-none text-foreground-muted/70">
              <span className="truncate font-mono">
                {agent.model.split('-').slice(0, 2).join(' ')}
              </span>
              {isRunning && (
                <>
                  <span aria-hidden="true" className="opacity-40">
                    ·
                  </span>
                  <span
                    data-testid="agent-runtime"
                    title={durationTitle}
                    className="flex-shrink-0 font-mono tabular-nums"
                  >
                    {durationLabel}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Exactly one statement of what the agent is doing. */}
        <span
          data-testid="agent-state"
          className={`flex-shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${STATE_CHIP[state]}`}
        >
          {AGENT_STATE_LABEL[state]}
        </span>

        <div className="flex flex-shrink-0 items-center gap-0.5">
          {onRename && !isRenaming && (
            <button
              onClick={startRename}
              className="rounded p-1.5 text-foreground-muted opacity-0 transition-all hover:bg-white/10 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
              title="Rename agent"
              aria-label="Rename agent"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-sm">
                edit
              </span>
            </button>
          )}
          {onMinimize && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMinimize(agent.id);
              }}
              className="rounded p-1.5 text-foreground-muted opacity-0 transition-all hover:bg-white/10 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
              title="Park agent — keeps it running, folds it to one line"
              aria-label="Park agent"
            >
              <span aria-hidden="true" className="material-symbols-outlined text-sm">
                keyboard_arrow_down
              </span>
            </button>
          )}
          <button
            onClick={toggleView}
            className={`rounded p-1.5 transition-all hover:bg-white/10 ${viewMode === 'terminal' ? 'text-primary bg-primary/10' : 'text-foreground-muted'}`}
            title={viewMode === 'terminal' ? 'Show Status' : 'Show Terminal'}
            aria-label={viewMode === 'terminal' ? 'Show Status' : 'Show Terminal'}
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">
              {viewMode === 'terminal' ? 'analytics' : 'terminal'}
            </span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onKill(agent.id);
            }}
            className="rounded p-1.5 text-foreground-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
            title="Terminate Agent"
            aria-label="Terminate Agent"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">
              power_settings_new
            </span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative">
        {viewMode === 'status' ? (
          <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
            {/* Only when it adds something the name did not already say. The
                label is gone too: position and phrasing carry it, a magenta
                "OBJECTIVE:" only shouted. */}
            {agent.currentTask && !objectiveRepeatsName && (
              <p
                title={agent.currentTask}
                className="line-clamp-2 rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 text-[11px] leading-relaxed text-foreground-muted"
              >
                {agent.currentTask}
              </p>
            )}
            {!agent.currentTask && (
              <p className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 text-[11px] italic text-foreground-muted/30">
                Awaiting instructions…
              </p>
            )}

            {/* The objective is what the agent was asked to do; this is what
                it is doing about it. Only while it is still running — a frozen
                last line would read as ongoing work. */}
            {isRunning && agent.currentActivity && (
              <div
                data-testid="agent-activity"
                title={agent.currentActivity}
                className="flex items-center gap-1.5 px-1"
              >
                <span
                  aria-hidden="true"
                  className={`text-[9px] ${isLive ? 'text-primary' : 'text-amber-400/60'}`}
                >
                  ▸
                </span>
                <span
                  className={`truncate font-mono text-[9px] ${
                    isLive ? 'text-primary-light/90' : 'text-foreground-muted/70'
                  }`}
                >
                  {agent.currentActivity}
                </span>
              </div>
            )}

            {/* No status footer: the chip in the header already said it, the
                raw status word disagreed with it, and the agent id belongs in
                a tooltip rather than in the card's scarcest space. */}
          </div>
        ) : (
          /* Reading the stream, selecting text from it and typing a reply are
             all things you do *without* wanting the fullscreen terminal, so
             this whole area stops the card's select click. */
          <div
            onClick={(e) => e.stopPropagation()}
            className="h-40 flex flex-col rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[9px] animate-in fade-in slide-in-from-left-2 duration-300"
          >
            <div
              data-testid="agent-log-preview"
              className="flex-1 overflow-y-auto no-scrollbar custom-scrollbar select-text"
            >
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center opacity-20 italic">
                  No activity stream...
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-all text-primary-light/80">
                  {logPreview}
                </div>
              )}
              <div ref={logEndRef} />
            </div>

            {/* Interactive Input for Agent */}
            <div className="mt-1 flex items-center gap-1 border-t border-white/5 pt-1">
              <span className="text-primary font-bold opacity-50">❯</span>
              <input
                ref={replyRef}
                type="text"
                placeholder="Reply to agent..."
                aria-label={`Reply to ${agent.name}`}
                className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:opacity-20 text-[9px] focus:ring-1 focus:ring-primary/50 rounded px-1"
                onKeyDown={sendReply}
              />
            </div>
            {replyError && (
              <p role="alert" className="mt-1 text-[8px] text-red-400">
                {replyError}
              </p>
            )}

            <div className="mt-1 flex items-center gap-1 text-[8px] text-primary/40 uppercase tracking-widest border-t border-white/5 pt-1">
              <span className="animate-pulse">●</span>
              <span>Interactive PTY Stream</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
