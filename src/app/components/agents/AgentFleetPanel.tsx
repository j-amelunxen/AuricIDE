'use client';

import { useMemo } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { groupAgentsByRepo } from '@/lib/store/agentSlice';

interface AgentFleetPanelProps {
  agents: AgentInfo[];
  onOpenAgent: (agent: AgentInfo) => void;
  onKillAgent: (agentId: string) => void;
  onNewAgent: () => void;
}

const STATUS_META: Record<AgentInfo['status'], { dot: string; label: string }> = {
  running: { dot: 'bg-green-400 animate-pulse', label: 'running' },
  queued: { dot: 'bg-sky-400', label: 'queued' },
  idle: { dot: 'bg-gray-500', label: 'finished' },
  error: { dot: 'bg-red-400', label: 'error' },
};

function repoLabel(path: string): string {
  return path === 'Unknown' ? 'No repo' : (path.split('/').pop() ?? path);
}

/**
 * Warp-style fleet view: every agent across every repo, grouped by repo, with
 * live status. One click opens the agent's terminal; the + button launches a
 * new agent in any repo.
 */
export function AgentFleetPanel({
  agents,
  onOpenAgent,
  onKillAgent,
  onNewAgent,
}: AgentFleetPanelProps) {
  const groups = useMemo(() => groupAgentsByRepo(agents), [agents]);
  const runningCount = agents.filter((a) => a.status === 'running').length;

  return (
    <div data-testid="agent-fleet-panel" className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/2 p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
            Agent Fleet
          </h2>
          {runningCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-green-500/15 px-1.5 py-0.5 text-[9px] font-bold text-green-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
              {runningCount}
            </span>
          )}
        </div>
        <button
          data-testid="fleet-new-agent-btn"
          onClick={onNewAgent}
          title="Deploy a new agent in any repo"
          className="flex items-center gap-1 rounded-lg bg-primary/15 border border-primary/25 px-2 py-1 text-[10px] font-bold text-primary-light hover:bg-primary/25 transition-colors"
        >
          <span className="material-symbols-outlined text-[13px]">add</span>
          New
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="material-symbols-outlined text-3xl text-foreground-muted/40">
            smart_toy
          </span>
          <p className="text-xs text-foreground-muted">No agents yet.</p>
          <button
            onClick={onNewAgent}
            className="rounded-lg bg-primary/15 border border-primary/25 px-3 py-1.5 text-[11px] font-medium text-primary-light hover:bg-primary/25 transition-colors"
          >
            Deploy your first agent
          </button>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto p-2">
          {Object.entries(groups).map(([repoPath, repoAgents]) => (
            <div key={repoPath}>
              <div
                className="flex items-center gap-1.5 px-1.5 pb-1"
                title={repoPath === 'Unknown' ? undefined : repoPath}
              >
                <span className="material-symbols-outlined text-[12px] text-foreground-muted/60">
                  folder
                </span>
                <span className="text-[10px] font-bold text-foreground-muted">
                  {repoLabel(repoPath)}
                </span>
                <span className="text-[9px] text-foreground-muted/50">{repoAgents.length}</span>
              </div>
              <div className="space-y-1">
                {repoAgents.map((agent) => {
                  const meta = STATUS_META[agent.status];
                  return (
                    <div
                      key={agent.id}
                      data-testid={`fleet-agent-${agent.id}`}
                      className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                    >
                      <button
                        onClick={() => onOpenAgent(agent)}
                        className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        title="Open agent terminal"
                      >
                        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium text-foreground">
                            {agent.name}
                          </span>
                          <span className="block truncate text-[9px] text-foreground-muted">
                            {meta.label} · {agent.model}
                            {agent.currentTask ? ` · ${agent.currentTask}` : ''}
                          </span>
                        </span>
                      </button>
                      <button
                        data-testid={`fleet-kill-${agent.id}`}
                        onClick={() => onKillAgent(agent.id)}
                        title={agent.status === 'running' ? 'Kill agent' : 'Remove from list'}
                        className="mt-0.5 hidden shrink-0 rounded p-0.5 text-foreground-muted hover:bg-red-500/15 hover:text-red-300 group-hover:block"
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          {agent.status === 'running' ? 'stop_circle' : 'close'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
