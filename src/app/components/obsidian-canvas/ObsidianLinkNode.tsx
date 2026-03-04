'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeBorderStyle, getNodeBorderColor } from './nodeStyles';
import type { ObsidianColor } from '@/lib/obsidian-canvas/types';

export interface ObsidianLinkNodeData {
  url: string;
  color?: ObsidianColor;
}

export function ObsidianLinkNode({ data, selected }: NodeProps & { data: ObsidianLinkNodeData }) {
  const borderColor = getNodeBorderColor(data.color);
  const containerStyle = getNodeBorderStyle(data.color, selected);

  return (
    <div
      className={[
        'min-w-[220px] bg-[#16202c] border border-[#2a3b4d]',
        'border-l-4',
        containerStyle,
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />

      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span data-testid="link-icon" className="text-base" aria-hidden="true">
            🔗
          </span>
          <p data-testid="link-url" className="text-sm text-blue-400 truncate" title={data.url}>
            {data.url}
          </p>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}
