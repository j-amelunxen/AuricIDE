'use client';

import React from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { AGENT_STATE_LABEL, type AgentState } from '@/lib/agents/state';
import { ComboProgressBadge } from '../ComboProgressBadge';
import { isAuricWorktreePath } from '@/lib/git/agentWorktree';
import { STATE_CHIP } from './cardConstants';

export interface AgentCardHeaderProps {
  agent: AgentInfo;
  displayName: string;
  isLive: boolean;
  isIdling: boolean;
  isRunning: boolean;
  viewMode: 'status' | 'terminal';
  isRenaming: boolean;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  nameTooltip: string;
  durationTitle: string;
  durationLabel: string;
  state: AgentState;
  comboRun?: {
    id: string;
    label: string;
    currentIndex: number;
    steps: Array<{ label?: string }>;
  };
  endLabel: string;
  endTitle: string;
  onRename?: (id: string, name: string) => void;
  onMinimize?: (id: string) => void;
  onKill: (id: string) => void;
  startRename: (e: React.MouseEvent) => void;
  commitRename: () => void;
  handleNameKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  toggleView: (e: React.MouseEvent) => void;
  cancelSkillCombo: (id: string) => void;
}

export function AgentCardHeader({
  agent,
  displayName,
  isLive,
  isIdling,
  isRunning,
  viewMode,
  isRenaming,
  nameInputRef,
  nameTooltip,
  durationTitle,
  durationLabel,
  state,
  comboRun,
  endLabel,
  endTitle,
  onRename,
  onMinimize,
  onKill,
  startRename,
  commitRename,
  handleNameKeyDown,
  toggleView,
  cancelSkillCombo,
}: AgentCardHeaderProps) {
  return (
    <div className="z-10 flex min-w-0 items-start gap-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          className={`relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-white/5 bg-gradient-to-br ${
            isLive
              ? 'from-primary/30 via-primary/10 to-transparent'
              : isIdling
                ? 'from-amber-500/15 to-transparent'
                : 'from-white/5 to-transparent'
          }`}
        >
          <AuricIcon
            name={viewMode === 'terminal' ? 'terminal' : 'smart_toy'}
            aria-hidden="true"
            className="text-lg text-foreground"
          />
          {isRunning && (
            <span className="absolute bottom-0.5 right-0.5 h-2 w-2">
              {isLive ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </>
              ) : (
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
            <div className="flex min-w-0 items-center gap-1.5">
              <h3
                onDoubleClick={onRename ? startRename : undefined}
                title={nameTooltip}
                className="truncate font-display text-[13px] font-semibold leading-tight tracking-[-0.01em] text-foreground transition-colors group-hover:text-primary"
              >
                {displayName}
              </h3>
              <ComboProgressBadge agentId={agent.id} />
              {agent.repoPath && isAuricWorktreePath(agent.repoPath) && (
                <span
                  data-testid="agent-worktree-badge"
                  className="shrink-0 rounded border border-white/10 bg-white/5 px-1 text-[9px] font-medium uppercase tracking-wide text-foreground-muted"
                >
                  worktree
                </span>
              )}
            </div>
          )}
          <div
            data-testid="agent-metadata"
            className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] leading-none text-foreground-muted/70"
          >
            <span className="truncate font-mono">
              {agent.model.split('-').slice(0, 2).join(' ')}
            </span>
            {isRunning && (
              <span
                data-testid="agent-duration-group"
                className="flex flex-shrink-0 items-center gap-1.5"
              >
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
              </span>
            )}
            <span
              data-testid="agent-state"
              className={`flex-shrink-0 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${STATE_CHIP[state]}`}
            >
              {AGENT_STATE_LABEL[state]}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-0.5">
        {onRename && !isRenaming && (
          <button
            onClick={startRename}
            className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted opacity-0 transition-all hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 group-hover:opacity-100 focus-visible:opacity-100"
            title="Rename agent"
            aria-label="Rename agent"
          >
            <AuricIcon name="edit" aria-hidden="true" className="text-sm" />
          </button>
        )}
        {onMinimize && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMinimize(agent.id);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted opacity-0 transition-all hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 group-hover:opacity-100 focus-visible:opacity-100"
            title="Set aside (still running)"
            aria-label="Set aside agent"
          >
            <AuricIcon name="keyboard_arrow_down" aria-hidden="true" className="text-sm" />
          </button>
        )}
        <button
          onClick={toggleView}
          className={`flex h-6 w-6 items-center justify-center rounded transition-all hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary/60 ${viewMode === 'terminal' ? 'text-primary bg-primary/10' : 'text-foreground-muted'}`}
          title={viewMode === 'terminal' ? 'Show Status' : 'Show Terminal'}
          aria-label={viewMode === 'terminal' ? 'Show Status' : 'Show Terminal'}
        >
          <AuricIcon
            name={viewMode === 'terminal' ? 'analytics' : 'terminal'}
            aria-hidden="true"
            className="text-sm"
          />
        </button>
        {comboRun && (
          <>
            <span aria-hidden="true" className="mx-0.5 h-3.5 w-px flex-shrink-0 bg-white/10" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cancelSkillCombo(comboRun.id);
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-foreground-muted transition-all hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-400/60"
              title={`Cancel “${comboRun.label}” — this step keeps running`}
              aria-label="Cancel combo"
            >
              <AuricIcon name="block" aria-hidden="true" className="text-sm" />
            </button>
          </>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onKill(agent.id);
          }}
          className={`flex h-6 w-6 items-center justify-center rounded transition-all focus-visible:ring-2 ${
            comboRun
              ? 'text-primary/80 hover:bg-primary/10 hover:text-primary focus-visible:ring-primary/60'
              : 'text-foreground-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 focus-visible:ring-red-400/60 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
          title={endTitle}
          aria-label={endLabel}
        >
          <AuricIcon
            name={comboRun ? 'skip_next' : 'power_settings_new'}
            aria-hidden="true"
            className="text-sm"
          />
        </button>
      </div>
    </div>
  );
}
