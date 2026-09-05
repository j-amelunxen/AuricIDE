'use client';

import type { InterruptedAgent } from '@/lib/tauri/agents';

export interface InterruptedAgentsSectionProps {
  interruptedAgents: InterruptedAgent[];
  onResumeInterrupted?: (agentId: string) => void;
  onDiscardInterrupted?: (agentId: string) => void;
}

export function InterruptedAgentsSection({
  interruptedAgents,
  onResumeInterrupted,
  onDiscardInterrupted,
}: InterruptedAgentsSectionProps) {
  if (interruptedAgents.length === 0) return null;

  return (
    <div data-testid="interrupted-agents" className="flex flex-col gap-2">
      <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
        INTERRUPTED
      </span>
      {interruptedAgents.map((agent) => (
        <div
          key={agent.id}
          className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground truncate">{agent.name}</span>
            <span className="font-mono text-[9px] text-foreground-muted opacity-50 flex-shrink-0">
              {agent.id}
            </span>
          </div>
          <p className="text-[10px] text-foreground-muted line-clamp-2">{agent.task}</p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onResumeInterrupted?.(agent.id)}
              className="flex-1 text-[10px] font-bold py-1 rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={() => onDiscardInterrupted?.(agent.id)}
              className="flex-1 text-[10px] font-bold py-1 rounded bg-white/5 text-foreground-muted border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
