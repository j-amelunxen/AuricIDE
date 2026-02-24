'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { LinkGraphNodeData } from '@/lib/graph/linkGraphLayout';

type LinkGraphNodeProps = NodeProps & { data: LinkGraphNodeData };

function LinkGraphNodeBase({ data }: LinkGraphNodeProps) {
  const { label, isActive, isBroken, linkCount, backlinkCount } = data;

  let borderClass = 'border-[#2a3b4d]';
  let extraClass = '';

  if (isBroken) {
    borderClass = 'border-[#ff4a4a] border-dashed';
    extraClass = 'opacity-70';
  } else if (isActive) {
    borderClass = 'border-primary';
    extraClass = 'neon-glow';
  }

  return (
    <div
      data-testid="link-graph-node"
      className={`rounded-lg bg-[#16202c] border px-4 py-2 font-mono text-xs text-[#e2e8f0] cursor-pointer transition-all duration-150 hover:border-primary/40 hover:shadow-[0_0_8px_rgba(188,19,254,0.2)] ${borderClass} ${extraClass}`}
      style={{ minWidth: 100 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-primary !border-[#0a0a10] !w-2 !h-2"
      />

      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-primary-light">
          {isBroken ? 'broken_image' : 'description'}
        </span>
        <span className="truncate max-w-[140px] font-medium">{label}</span>
      </div>

      {(linkCount > 0 || backlinkCount > 0) && (
        <div className="flex items-center gap-2 mt-1 text-[10px] text-foreground-muted">
          {linkCount > 0 && (
            <span className="flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[10px]">arrow_forward</span>
              {linkCount}
            </span>
          )}
          {backlinkCount > 0 && (
            <span className="flex items-center gap-0.5">
              <span className="material-symbols-outlined text-[10px]">arrow_back</span>
              {backlinkCount}
            </span>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-primary !border-[#0a0a10] !w-2 !h-2"
      />
    </div>
  );
}

export const LinkGraphNode = memo(LinkGraphNodeBase);
