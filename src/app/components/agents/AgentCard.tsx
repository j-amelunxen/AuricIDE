'use client';

import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { useStore } from '@/lib/store';
import { useNow } from '@/lib/hooks/useNow';

const EMPTY_LOGS: string[] = [];

export interface AgentCardProps {
  agent: AgentInfo;
  onKill: (id: string) => void;
  onSelect?: (id: string) => void;
}

export function AgentCard({ agent, onKill, onSelect }: AgentCardProps) {
  const [viewMode, setViewMode] = useState<'status' | 'terminal'>('status');
  const now = useNow();
  const isRunning = agent.status === 'running';
  const isLive = agent.lastActivityAt && now - agent.lastActivityAt < 2000;
  const isIdling = isRunning && !isLive;

  // Subscribe only to this agent's logs (not ALL terminal logs) to avoid re-rendering
  // every AgentCard whenever any agent produces output
  const logs = useStore(useCallback((s) => s.agentLogs[agent.id] ?? EMPTY_LOGS, [agent.id]));

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewMode === 'terminal') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, viewMode]);

  const toggleView = (e: React.MouseEvent) => {
    e.stopPropagation();
    setViewMode((v) => (v === 'status' ? 'terminal' : 'status'));
  };

  // Card border + glow varies by agent activity state
  const cardGlowClass = isLive
    ? 'border-primary/50 shadow-[0_0_35px_rgba(188,19,254,0.25),0_0_70px_rgba(188,19,254,0.08)] hover:shadow-[0_0_45px_rgba(188,19,254,0.35)]'
    : isIdling
      ? 'border-amber-500/25 hover:border-amber-500/40 hover:shadow-[0_0_20px_rgba(245,158,11,0.08)]'
      : 'hover:border-primary/30 hover:shadow-[0_0_20px_rgba(188,19,254,0.1)]';

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
            <span className="material-symbols-outlined text-lg text-foreground">
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
              <h3 className="font-display text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                {agent.name}
              </h3>
              {isLive && (
                <span className="animate-pulse rounded-full bg-primary/20 px-1 py-0.5 text-[7px] font-black text-primary border border-primary/30 uppercase tracking-tighter">
                  Live
                </span>
              )}
              {isIdling && (
                <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1 py-0.5 text-[7px] font-black text-amber-400/80 border border-amber-500/25 uppercase tracking-tighter">
                  <span className="h-1 w-1 rounded-full bg-amber-400/70" />
                  Idle
                </span>
              )}
            </div>
            <span className="text-[9px] font-mono text-foreground-muted opacity-60 uppercase">
              {agent.model.split('-').slice(0, 2).join(' ')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleView}
            className={`rounded p-1.5 transition-all hover:bg-white/10 ${viewMode === 'terminal' ? 'text-primary bg-primary/10' : 'text-foreground-muted'}`}
            title={viewMode === 'terminal' ? 'Show Status' : 'Show Terminal'}
          >
            <span className="material-symbols-outlined text-sm">
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
          >
            <span className="material-symbols-outlined text-sm">power_settings_new</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 relative">
        {viewMode === 'status' ? (
          <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
            {agent.currentTask ? (
              <div className="rounded-lg border border-white/5 bg-black/20 p-2.5">
                <p className="line-clamp-3 text-[10px] leading-relaxed text-foreground-muted">
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

            <div className="flex items-center justify-between px-1 mt-1">
              <span
                className={`text-[9px] font-black uppercase tracking-widest ${
                  isLive
                    ? 'text-primary animate-pulse-soft'
                    : isIdling
                      ? 'text-amber-400/70'
                      : 'text-foreground-muted'
                }`}
              >
                {agent.status}
              </span>
              <span className="font-mono text-[8px] text-foreground-muted opacity-30">
                {agent.id}
              </span>
            </div>
          </div>
        ) : (
          <div className="h-40 flex flex-col rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[9px] animate-in fade-in slide-in-from-left-2 duration-300">
            <div className="flex-1 overflow-y-auto no-scrollbar custom-scrollbar select-text">
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center opacity-20 italic">
                  No activity stream...
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-all text-primary-light/80">
                  {logs.map((log, i) => (
                    <span key={i}>{log}</span>
                  ))}
                </div>
              )}
              <div ref={logEndRef} />
            </div>

            {/* Interactive Input for Agent */}
            <div className="mt-1 flex items-center gap-1 border-t border-white/5 pt-1">
              <span className="text-primary font-bold opacity-50">❯</span>
              <input
                type="text"
                autoFocus
                placeholder="Reply to agent..."
                className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:opacity-20 text-[9px]"
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    const val = e.currentTarget.value;
                    if (!val) return;
                    const { writeToShell } = await import('@/lib/tauri/terminal');
                    await writeToShell(`agent-${agent.id}`, val + '\n');
                    e.currentTarget.value = '';
                  }
                }}
              />
            </div>

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
