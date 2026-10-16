'use client';

import { useCallback } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { supervisorChildSummary } from '@/lib/agents/fleet';
import { agentDisplayName } from '@/lib/agents/displayName';
import { useStore } from '@/lib/store';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

/**
 * Neutral on purpose: status owns amber, emerald, red and the accent, and a
 * user's marker owns the left edge. Who started whom is neither.
 */
const CHIP =
  'inline-flex max-w-full items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted';

interface SupervisorRelationProps {
  agent: Pick<AgentInfo, 'id' | 'role' | 'spawnedByAgentId'>;
  /** Selects the supervisor; defaults to the store's selection. */
  onSelect?: (agentId: string) => void;
  /** One line in a compact row instead of the card's own line. */
  compact?: boolean;
}

/**
 * A supervisor's chip and its children count, or a child's "via <supervisor>"
 * link. Renders nothing for an ordinary agent. Every selector returns a string
 * or null, so the store hands back the same value until it really changes.
 */
export function SupervisorRelation({ agent, onSelect, compact = false }: SupervisorRelationProps) {
  const isSupervisor = agent.role === 'supervisor';
  const parentId = agent.spawnedByAgentId ?? null;
  const summary = useStore(
    useCallback(
      (s) => (isSupervisor ? supervisorChildSummary(s.agents, agent.id) : null),
      [isSupervisor, agent.id]
    )
  );
  const parentName = useStore(
    useCallback(
      (s) => {
        if (!parentId) return null;
        const parent = s.agents.find((a) => a.id === parentId);
        return parent ? agentDisplayName(parent.name, parent.currentTask) : null;
      },
      [parentId]
    )
  );
  const selectAgent = useStore((s) => s.selectAgent);

  if (isSupervisor) {
    return (
      <span
        data-testid="agent-supervisor-chip"
        className={`flex min-w-0 items-center gap-1.5 ${compact ? '' : 'z-10'}`}
      >
        <span className={CHIP}>
          <AuricIcon name="account_tree" aria-hidden="true" className="text-[11px]" />
          Supervisor
        </span>
        <span className="truncate text-[10px] tabular-nums text-foreground-muted">{summary}</span>
      </span>
    );
  }
  if (!parentId) return null;

  // The supervisor may already be cleared; the child still says who started it.
  const label = parentName ?? 'a supervisor';
  return (
    <button
      type="button"
      data-testid="agent-supervisor-link"
      disabled={!parentName}
      title={
        parentName ? `Started by ${parentName}. Click to select it.` : 'Its supervisor was cleared'
      }
      onClick={(e) => {
        e.stopPropagation();
        (onSelect ?? selectAgent)(parentId);
      }}
      className={`${CHIP} ${compact ? '' : 'z-10 self-start'} transition-colors enabled:hover:border-white/20 enabled:hover:text-foreground`}
    >
      <AuricIcon name="account_tree" aria-hidden="true" className="text-[11px]" />
      <span className="truncate">via {label}</span>
    </button>
  );
}
