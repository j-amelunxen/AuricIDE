'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import { groupAgentsByRepo } from '@/lib/store/agentSlice';
import type { InterruptedAgent } from '@/lib/tauri/agents';
import { AgentCard } from './AgentCard';

export interface AgentsPanelProps {
  agents: AgentInfo[];
  /** Agents from a previous app run, restorable via Resume (restart persistence). */
  interruptedAgents?: InterruptedAgent[];
  onSpawn: () => void;
  onKill: (id: string) => void;
  onKillRepo?: (repoPath: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onImageDrop?: (agentId: string, imageData: string) => void;
  onCollapse?: () => void;
  onResumeInterrupted?: (agentId: string) => void;
  onDiscardInterrupted?: (agentId: string) => void;
}

export function AgentsPanel({
  agents,
  interruptedAgents = [],
  onSpawn,
  onKill,
  onKillRepo,
  onSelectAgent,
  onImageDrop,
  onCollapse,
  onResumeInterrupted,
  onDiscardInterrupted,
}: AgentsPanelProps): React.JSX.Element {
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string' && onImageDrop) {
          onImageDrop(agentId, reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const grouped = groupAgentsByRepo(agents);
  const repoKeys = Object.keys(grouped);
  const runningCount = agents.filter((a) => a.status === 'running').length;

  /**
   * Killing a repo's agents throws away however much work they had done, and
   * the button sits one row above the cards. Name the cost before doing it.
   */
  const confirmKillRepo = (repoPath: string) => {
    const running = (grouped[repoPath] ?? []).filter((a) => a.status === 'running').length;
    const repoName =
      repoPath === 'Unknown' ? 'this group' : (repoPath.split('/').pop() ?? repoPath);
    const what = running === 1 ? '1 running agent' : `${running} running agents`;
    if (running > 0 && !confirm(`Stop ${what} in ${repoName}? Their work in progress is lost.`)) {
      return;
    }
    onKillRepo?.(repoPath);
  };

  return (
    <div data-testid="agents-panel" className="flex flex-col h-full bg-panel-bg">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-dark">
        <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-foreground-muted">
          ACTIVE AGENTS
          {/* The list keeps finished agents around for review, so the header
              would otherwise imply more is happening than actually is. */}
          {runningCount > 0 && (
            <span
              data-testid="agents-running-count"
              className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-bold text-primary-light tabular-nums"
            >
              {runningCount} running
            </span>
          )}
        </h2>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide agents panel"
            className="group flex h-5 w-5 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base">
              right_panel_close
            </span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {interruptedAgents.length > 0 && (
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
                  <span className="text-xs font-semibold text-foreground truncate">
                    {agent.name}
                  </span>
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
        )}
        {agents.length === 0 ? (
          <p className="text-xs text-foreground-muted text-center py-4">No agents running</p>
        ) : (
          repoKeys.map((repoPath) => (
            <div key={repoPath} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground-muted">
                  {repoPath === 'Unknown' ? 'Unknown' : repoPath.split('/').pop()}
                </span>
                {onKillRepo && (
                  <button
                    type="button"
                    onClick={() => confirmKillRepo(repoPath)}
                    className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-400 hover:bg-red-900/50 transition-colors"
                  >
                    Kill All
                  </button>
                )}
              </div>
              {grouped[repoPath].map((agent) => (
                <div
                  key={agent.id}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, agent.id)}
                  className="rounded transition hover:ring-2 hover:ring-primary/50"
                >
                  <AgentCard agent={agent} onKill={onKill} onSelect={onSelectAgent} />
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <div className="p-2 border-t border-border-dark">
        <button
          type="button"
          onClick={onSpawn}
          className="w-full text-xs py-1.5 rounded bg-primary text-white hover:brightness-110 transition-[filter]"
        >
          New Agent…
        </button>
      </div>
    </div>
  );
}
