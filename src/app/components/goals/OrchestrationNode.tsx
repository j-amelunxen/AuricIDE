'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { OrchestrationNodeData } from '@/lib/orchestration/graphBuilder';

const KIND_META: Record<
  OrchestrationNodeData['kind'],
  { icon: string; border: string; iconCls: string }
> = {
  goal: { icon: 'flag', border: 'border-primary/40', iconCls: 'text-primary-light' },
  ticket: { icon: 'confirmation_number', border: 'border-sky-500/40', iconCls: 'text-sky-300' },
  agent: { icon: 'smart_toy', border: 'border-green-500/40', iconCls: 'text-green-300' },
};

const STATUS_DOTS: Record<string, string> = {
  draft: 'bg-gray-400',
  active: 'bg-sky-400',
  open: 'bg-gray-400',
  in_progress: 'bg-amber-400 animate-pulse',
  running: 'bg-green-400 animate-pulse',
  done: 'bg-green-400',
  achieved: 'bg-green-400',
  failed: 'bg-red-400',
  error: 'bg-red-400',
  archived: 'bg-gray-600',
  idle: 'bg-gray-500',
};

function OrchestrationNodeInner({ data }: NodeProps) {
  const d = data as OrchestrationNodeData;
  const meta = KIND_META[d.kind];
  const percent =
    d.progress && d.progress.total > 0
      ? Math.round((d.progress.done / d.progress.total) * 100)
      : null;

  return (
    <div
      data-testid={`orch-node-${d.kind}-${d.entityId}`}
      className={`w-[260px] rounded-xl border ${meta.border} bg-background-dark/95 px-3 py-2 shadow-lg backdrop-blur-sm`}
    >
      <Handle type="target" position={Position.Left} className="!bg-white/30 !border-0 !h-2 !w-2" />
      <div className="flex items-center gap-2">
        <span className={`material-symbols-outlined text-base ${meta.iconCls}`}>{meta.icon}</span>
        <span className="flex-1 truncate text-[11px] font-semibold text-foreground">{d.label}</span>
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[d.status] ?? 'bg-gray-400'}`}
          title={d.status}
        />
      </div>
      {(d.detail || percent !== null) && (
        <div className="mt-1.5 flex items-center gap-2">
          {d.detail && <span className="text-[9px] text-foreground-muted">{d.detail}</span>}
          {percent !== null && (
            <span className="flex flex-1 items-center gap-1.5">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                <span
                  className={`block h-full rounded-full ${percent === 100 ? 'bg-green-400' : 'bg-primary'}`}
                  style={{ width: `${percent}%` }}
                />
              </span>
              <span className="text-[9px] tabular-nums text-foreground-muted">
                {d.progress!.done}/{d.progress!.total}
              </span>
            </span>
          )}
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-white/30 !border-0 !h-2 !w-2"
      />
    </div>
  );
}

export const OrchestrationNode = memo(OrchestrationNodeInner);
