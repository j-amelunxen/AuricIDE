'use client';

import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';
import { isAgentIdling, isAgentLive } from '@/lib/agents/liveness';
import { formatAgentDuration } from '@/lib/agents/duration';
import { stripAnsi } from '@/lib/terminal/ansi';

const EMPTY_LOGS: string[] = [];
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
}

export function AgentCard({ agent, onKill, onSelect, onMinimize, onRename }: AgentCardProps) {
  const [viewMode, setViewMode] = useState<'status' | 'terminal'>('status');
  const [isRenaming, setIsRenaming] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const isRunning = agent.status === 'running';
  const isLive = isAgentLive(agent, now);
  const isIdling = isAgentIdling(agent, now);
  // Without any recorded activity there is no silence to measure — reporting
  // one would be inventing a number.
  const quietFor =
    agent.lastActivityAt === undefined ? null : formatAgentDuration(now - agent.lastActivityAt);

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
      className={`glass-card group relative flex flex-col gap-3 rounded-xl p-3 transition-all duration-500 cursor-pointer overflow-hidden ${cardGlowClass} ${
        viewMode === 'terminal' ? 'min-h-[200px]' : ''
      }`}
    >
      {/* Live: subtle purple inner glow overlay */}
      {isLive && (
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent" />
      )}

      {/* Header */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div
            className={`relative flex h-8 w-8 items-center justify-center rounded-lg border border-white/5 bg-gradient-to-br ${
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
            {isRunning && (
              <span className="absolute bottom-0 right-0 h-2 w-2 translate-x-1/2 translate-y-1/2">
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
          <div>
            <div className="flex items-center gap-2">
              {isRenaming ? (
                <input
                  ref={nameInputRef}
                  type="text"
                  defaultValue={agent.name}
                  aria-label="Agent name"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={handleNameKeyDown}
                  onBlur={commitRename}
                  className="w-28 rounded border border-primary/40 bg-black/40 px-1 py-0.5 font-display text-xs font-bold text-foreground outline-none focus:border-primary"
                />
              ) : (
                <h3
                  onDoubleClick={onRename ? startRename : undefined}
                  title={onRename ? 'Double-click to rename' : undefined}
                  className="font-display text-xs font-bold text-foreground group-hover:text-primary transition-colors"
                >
                  {agent.name}
                </h3>
              )}
              {/* The pulsing dot on the avatar already carries "live"; a second
                  and third out-of-phase pulse on the same card just twitches. */}
              {isLive && (
                <span className="rounded-full bg-primary/20 px-1 py-0.5 text-[7px] font-black text-primary border border-primary/30 uppercase tracking-tighter">
                  Live
                </span>
              )}
              {/* How long it has been quiet is the whole question: five
                  seconds of thinking and twenty minutes of waiting on an
                  unanswered prompt look identical without it. */}
              {isIdling && (
                <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1 py-0.5 text-[7px] font-black text-amber-400/80 border border-amber-500/25 uppercase tracking-tighter">
                  <span className="h-1 w-1 rounded-full bg-amber-400/70" />
                  {quietFor === null ? 'Idle' : `Idle ${quietFor}`}
                </span>
              )}
            </div>
            <span className="text-[9px] font-mono text-foreground-muted opacity-60 uppercase">
              {agent.model.split('-').slice(0, 2).join(' ')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
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
            {agent.currentTask ? (
              <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                <p className="line-clamp-2 text-[10px] leading-relaxed text-foreground-muted">
                  <span className="mr-1.5 font-bold text-primary/80 uppercase text-[8px] tracking-wider">
                    Objective:
                  </span>
                  {agent.currentTask}
                </p>
              </div>
            ) : (
              <div className="h-10 rounded-lg border border-white/5 bg-black/20 p-2 flex items-center justify-center">
                <span className="text-[10px] text-foreground-muted italic opacity-30">
                  Awaiting instructions...
                </span>
              </div>
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

            <div className="flex items-center justify-between px-1 mt-1">
              <span
                className={`text-[9px] font-black uppercase tracking-widest ${
                  isLive ? 'text-primary' : isIdling ? 'text-amber-400/70' : 'text-foreground-muted'
                }`}
              >
                {agent.status}
              </span>
              <div className="flex items-center gap-2">
                {isRunning && (
                  <span
                    data-testid="agent-runtime"
                    title="Running for"
                    className="font-mono text-[8px] tabular-nums text-foreground-muted opacity-50"
                  >
                    {formatAgentDuration(now - agent.startedAt)}
                  </span>
                )}
                <span className="font-mono text-[8px] text-foreground-muted opacity-30">
                  {agent.id}
                </span>
              </div>
            </div>
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
