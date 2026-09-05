'use client';

import type React from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import type { AgentState } from '@/lib/agents/state';

export interface AgentCardStatusBodyProps {
  agentId: string;
  agentName: string;
  currentTask?: string;
  currentActivity?: string;
  isRunning: boolean;
  isLive: boolean;
  taskSummary?: string;
  objectiveRepeatsName: boolean;
  state: AgentState;
  replyError: string | null;
  setReplyError: (err: string | null) => void;
  sendReply: (e: React.KeyboardEvent<HTMLInputElement>) => Promise<void>;
}

export function AgentCardStatusBody({
  agentId,
  agentName,
  currentTask,
  currentActivity,
  isRunning,
  isLive,
  taskSummary,
  objectiveRepeatsName,
  state,
  replyError,
  setReplyError,
  sendReply,
}: AgentCardStatusBodyProps) {
  return (
    <div className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-right-2 duration-300">
      {/* Only when it adds something the name did not already say. The
          label is gone too: position and phrasing carry it, a magenta
          "OBJECTIVE:" only shouted. */}
      {taskSummary && !objectiveRepeatsName && (
        <p
          data-testid="agent-task-context"
          title={taskSummary}
          className="line-clamp-2 px-0.5 text-[11px] leading-snug text-foreground-muted"
        >
          {taskSummary}
        </p>
      )}
      {!currentTask && (
        <p className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2 text-[11px] italic text-foreground-muted/30">
          Awaiting instructions…
        </p>
      )}

      {/* The objective is what the agent was asked to do; this is what
          it is doing about it. Only while it is still running — a frozen
          last line would read as ongoing work. */}
      {isRunning && currentActivity && (
        <div
          data-testid="agent-activity"
          title={currentActivity}
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
            {currentActivity}
          </span>
        </div>
      )}

      {/* A stalled CLI most often just wants an Enter — make that one
          click instead of open-terminal-and-type. Anything more than a
          nudge goes through the terminal as before. */}
      {state === 'stalled' && (
        <button
          type="button"
          onClick={async (e) => {
            e.stopPropagation();
            setReplyError(null);
            try {
              const { writeToShell } = await import('@/lib/tauri/terminal');
              await writeToShell(`agent-${agentId}`, '\n');
            } catch {
              setReplyError('Nudge could not be delivered. The agent may have exited.');
            }
          }}
          className="flex min-h-6 self-start items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-orange-300 transition-colors hover:bg-orange-400/10 focus-visible:ring-2 focus-visible:ring-orange-400/60"
        >
          <AuricIcon name="notifications_active" aria-hidden="true" className="text-[13px]" />
          Nudge: send Enter
        </button>
      )}
      {state === 'stalled' && replyError && (
        <p role="alert" className="text-[8px] text-red-400">
          {replyError}
        </p>
      )}

      {/* Answering the prompt is THE next action on a blocked agent —
          requiring a switch to the terminal view first was one hop of
          pure friction. Same wire as the terminal reply. */}
      {state === 'needs-input' && (
        <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-black/30 px-2 py-1.5">
            <span aria-hidden="true" className="text-[10px] font-bold text-amber-300/70">
              ❯
            </span>
            <input
              type="text"
              placeholder="Reply to agent..."
              aria-label={`Reply to ${agentName}`}
              className="flex-1 rounded border-none bg-transparent px-1 text-[10px] text-foreground outline-none placeholder:opacity-30 focus:ring-1 focus:ring-amber-400/40"
              onKeyDown={sendReply}
            />
          </div>
          {replyError && (
            <p role="alert" className="text-[8px] text-red-400">
              {replyError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
