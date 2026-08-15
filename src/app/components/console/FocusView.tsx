'use client';

import { useState } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { sendToAgent } from '@/lib/tauri/agents';
import type { AgentEvent } from '@/lib/agents/events/types';
import type { HeartbeatBucket } from '@/lib/agents/events/heartbeat';
import { heartbeatSeries } from '@/lib/agents/events/heartbeat';
import {
  consoleAgentState,
  consoleStateLabel,
  CONSOLE_STATE_RANK,
} from '@/lib/agents/consoleState';
import { describeRightNow } from '@/lib/agents/consoleActivity';
import { useNow } from '@/lib/hooks/useNow';
import { useStore } from '@/lib/store';
import { XtermTerminal } from '@/app/components/terminal/XtermTerminal';
import { Heartbeat, CONSOLE_STATE_HEARTBEAT_TONE } from './Heartbeat';
import { PhaseChip } from './PhaseChip';

function repoName(repoPath?: string): string {
  if (!repoPath) return 'Unknown';
  return repoPath.split('/').pop() || repoPath;
}

const THUMB_TONE: Record<'yours' | 'error' | 'other', string> = {
  yours: 'border-amber-500/45',
  error: 'border-red-400/45',
  other: 'border-white/10 hover:border-white/20',
};

export interface FocusViewProps {
  agent: AgentInfo;
  /** Every other agent still in the fleet, most-actionable first once sorted. */
  otherAgents: AgentInfo[];
  reviewedAgentIds: string[];
  agentEvents: Record<string, AgentEvent[]>;
  agentHeartbeat: Record<string, HeartbeatBucket[]>;
  onBack: () => void;
  onFocus: (agentId: string) => void;
}

/**
 * The single-agent stage: the focused agent's real terminal filling the
 * centre, with every other running agent one click away in the right rail.
 * Leaving requires an explicit back — Esc is wired one layer up in
 * `AgentConsole` to land here before it closes the console outright.
 */
export function FocusView({
  agent,
  otherAgents,
  reviewedAgentIds,
  agentEvents,
  agentHeartbeat,
  onBack,
  onFocus,
}: FocusViewProps) {
  const now = useNow();
  const sendAgentInput = useStore((s) => s.sendAgentInput);
  const [instruction, setInstruction] = useState('');

  const reviewed = reviewedAgentIds.includes(agent.id);
  const state = consoleAgentState(agent, reviewed, now);
  const label = consoleStateLabel(state, reviewed);

  const sendInstruction = () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    void sendAgentInput(agent.id, `${trimmed}\n`);
    setInstruction('');
  };

  const sortedOthers = [...otherAgents].sort((a, b) => {
    const aState = consoleAgentState(a, reviewedAgentIds.includes(a.id), now);
    const bState = consoleAgentState(b, reviewedAgentIds.includes(b.id), now);
    return CONSOLE_STATE_RANK[aState] - CONSOLE_STATE_RANK[bState];
  });

  return (
    <div data-testid="focus-view" className="grid min-h-0 flex-1 grid-cols-[1fr_260px]">
      <div className="grid min-h-0 grid-rows-[auto_1fr_auto] gap-2.5 p-3.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="rounded border border-white/10 px-2.5 py-1 text-[11px] text-foreground-muted transition-colors hover:text-foreground"
          >
            ← Projects
          </button>
          <span data-testid="focus-crumb" className="text-[11px] text-foreground-muted">
            {repoName(agent.repoPath)} /{' '}
            <b className="font-semibold text-foreground">{agent.name}</b> · {agent.model}
          </span>
          <PhaseChip state={state} label={label} className="ml-1" />
          <Heartbeat
            values={heartbeatSeries(agentHeartbeat[agent.id] ?? [], now)}
            tone={CONSOLE_STATE_HEARTBEAT_TONE[state]}
            className="ml-auto h-6 w-36"
          />
        </div>

        <div className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-black/60">
          <XtermTerminal
            id={`agent-${agent.id}`}
            agentId={agent.id}
            onInput={(data) => void sendToAgent(agent.id, data)}
          />
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendInstruction();
            }}
            placeholder="Send instruction to this agent · Enter to send"
            aria-label={`Send instruction to ${agent.name}`}
            className="flex-1 rounded border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground placeholder:text-foreground-muted/60 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto border-l border-white/10 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">
          Other agents
        </h3>
        {sortedOthers.map((other) => {
          const otherReviewed = reviewedAgentIds.includes(other.id);
          const otherState = consoleAgentState(other, otherReviewed, now);
          const otherLabel = consoleStateLabel(otherState, otherReviewed);
          const rightNow = describeRightNow({
            state: otherState,
            lastEvent: agentEvents[other.id]?.at(-1),
            currentActivity: other.currentActivity,
            quietFor: '',
          });
          const tone =
            otherState === 'yours'
              ? THUMB_TONE.yours
              : otherState === 'error'
                ? THUMB_TONE.error
                : THUMB_TONE.other;

          return (
            <button
              key={other.id}
              type="button"
              data-testid={`focus-thumb-${other.id}`}
              onClick={() => onFocus(other.id)}
              className={`rounded-lg border bg-white/[0.02] p-2 text-left transition-colors ${tone}`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
                  {other.name}
                </span>
                <Heartbeat
                  values={heartbeatSeries(agentHeartbeat[other.id] ?? [], now)}
                  tone={CONSOLE_STATE_HEARTBEAT_TONE[otherState]}
                  className="h-5 w-14 flex-shrink-0"
                />
              </div>
              <div className="truncate text-[10.5px] text-foreground-muted">
                {repoName(other.repoPath)} · {other.model} · {otherLabel}
              </div>
              <div className="truncate text-[11px] text-foreground">
                <span aria-hidden="true" className="text-foreground-muted">
                  ›{' '}
                </span>
                {rightNow}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
