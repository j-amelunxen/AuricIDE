'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import { useNow } from '@/lib/hooks/useNow';
import { isAgentLive } from '@/lib/agents/liveness';

export interface ParkedAgentRowProps {
  agent: AgentInfo;
  onRestore: (id: string) => void;
  onKill: (id: string) => void;
}

const DOT_BY_STATUS: Record<AgentInfo['status'], string> = {
  running: 'bg-amber-400/70',
  idle: 'bg-emerald-400/70',
  queued: 'bg-foreground-muted/60',
  error: 'bg-red-400',
};

/**
 * A parked agent: still running, folded down to a single line. The row keeps
 * exactly what you need to decide whether to come back to it — is it alive,
 * what is it called — and nothing that would cost vertical space.
 */
export function ParkedAgentRow({ agent, onRestore, onKill }: ParkedAgentRowProps) {
  const now = useNow();
  const dot = isAgentLive(agent, now) ? 'bg-primary' : DOT_BY_STATUS[agent.status];

  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5">
      <span aria-hidden="true" className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} />
      <button
        type="button"
        onClick={() => onRestore(agent.id)}
        aria-label={`Restore ${agent.name}`}
        title={agent.currentTask ? `${agent.name} — ${agent.currentTask}` : agent.name}
        className="flex-1 truncate text-left text-[11px] text-foreground-muted transition-colors hover:text-foreground"
      >
        {agent.name}
      </button>
      <button
        type="button"
        onClick={() => onKill(agent.id)}
        aria-label={`Terminate ${agent.name}`}
        title={`Terminate ${agent.name}`}
        className="flex-shrink-0 rounded p-0.5 text-foreground-muted opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[13px]">
          power_settings_new
        </span>
      </button>
    </div>
  );
}
