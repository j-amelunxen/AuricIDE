'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeBorderStyle, getNodeBorderColor } from './nodeStyles';
import type { ObsidianColor } from '@/lib/obsidian-canvas/types';

export interface ObsidianGroupNodeData {
  label?: string;
  color?: ObsidianColor;
}

export function ObsidianGroupNode({ data, selected }: NodeProps & { data: ObsidianGroupNodeData }) {
  const borderColor = getNodeBorderColor(data.color);
  const containerStyle = getNodeBorderStyle(data.color, selected);

  return (
    <div
      data-testid="group-node-container"
      className={[
        'min-w-[300px] min-h-[200px] border rounded-lg',
        'bg-white/5',
        containerStyle,
      ].join(' ')}
      style={{
        borderColor,
        zIndex: -1,
      }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />

      {data.label && (
        <div className="px-3 pt-2">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            {data.label}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}
