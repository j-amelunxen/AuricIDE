'use client';

import type { AgentInfo } from '@/lib/tauri/agents';
import { groupAgentsByRepo } from '@/lib/store/agentSlice';
import { AgentCard } from './AgentCard';

export interface AgentsPanelProps {
  agents: AgentInfo[];
  onSpawn: () => void;
  onKill: (id: string) => void;
  onKillRepo?: (repoPath: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onImageDrop?: (agentId: string, imageData: string) => void;
}

export function AgentsPanel({
  agents,
  onSpawn,
  onKill,
  onKillRepo,
  onSelectAgent,
  onImageDrop,
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

  return (
    <div data-testid="agents-panel" className="flex flex-col h-full bg-panel-bg">
      <div className="px-3 py-2 border-b border-border-dark">
        <h2 className="text-xs font-semibold tracking-wider text-foreground-muted">
          ACTIVE AGENTS
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
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
                    onClick={() => onKillRepo(repoPath)}
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
                  className="rounded transition-all hover:ring-2 hover:ring-primary/50"
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
          className="w-full text-xs py-1.5 rounded bg-primary text-white hover:brightness-110 transition-all"
        >
          Deploy New Instance
        </button>
      </div>
    </div>
  );
}
