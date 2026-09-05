'use client';

import type React from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import type { AgentColor } from '@/lib/agents/colors';
import { CompactAgentRow } from '../CompactAgentRow';

export interface FinishedAgentsSectionProps {
  reviewList: AgentInfo[];
  reviewedAgentIds: string[];
  agentColors: Record<string, AgentColor>;
  onSelectAgent?: (agentId: string) => void;
  onDismissFinished?: (agentId: string) => void;
  onSetColor?: (agentId: string, color: AgentColor | null) => void;
  openColorMenu: (e: React.MouseEvent, agentId: string) => void;
  onRetryFailed?: (agentId: string) => void;
}

export function FinishedAgentsSection({
  reviewList,
  reviewedAgentIds,
  agentColors,
  onSelectAgent,
  onDismissFinished,
  onSetColor,
  openColorMenu,
  onRetryFailed,
}: FinishedAgentsSectionProps) {
  if (reviewList.length === 0) return null;

  return (
    <div data-testid="finished-agents" className="mt-1 flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-1.5">
        <span className="text-[10px] font-black uppercase tracking-widest text-foreground-muted/60">
          Done · {reviewList.length}
        </span>
        {onDismissFinished && reviewList.length > 1 && (
          <button
            type="button"
            onClick={() =>
              reviewList
                .filter((a) => a.status !== 'error' || reviewedAgentIds.includes(a.id))
                .forEach((a) => onDismissFinished(a.id))
            }
            title="Clear done (keep unreviewed fails)"
            className="rounded px-1 text-[10px] text-foreground-muted/60 transition-colors hover:bg-white/5 hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {reviewList.map((agent) => (
        <CompactAgentRow
          key={agent.id}
          agent={agent}
          activateLabel="Open logs of"
          onActivate={(id) => onSelectAgent?.(id)}
          dismissLabel="Dismiss"
          dismissIcon="close"
          onDismiss={(id) => onDismissFinished?.(id)}
          color={agentColors[agent.id]}
          onContextMenu={onSetColor && openColorMenu}
          unseen={!reviewedAgentIds.includes(agent.id)}
          onRetry={onRetryFailed}
        />
      ))}
    </div>
  );
}
