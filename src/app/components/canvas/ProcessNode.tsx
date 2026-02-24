'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface ProcessNodeData {
  title: string;
  description: string;
  nodeType: 'trigger' | 'agent' | 'script' | 'output';
  tags?: string[];
}

const BORDER_COLORS: Record<ProcessNodeData['nodeType'], string> = {
  trigger: 'border-l-purple-500',
  agent: 'border-l-blue-500',
  script: 'border-l-orange-500',
  output: 'border-l-green-500',
};

const ICONS: Record<ProcessNodeData['nodeType'], string> = {
  trigger: '\u25B6',
  agent: '\uD83E\uDD16',
  script: '\u2728',
  output: '\uD83D\uDCE4',
};

export function ProcessNode({ data, selected }: NodeProps & { data: ProcessNodeData }) {
  const borderColor = BORDER_COLORS[data.nodeType] ?? 'border-l-blue-500';
  const icon = ICONS[data.nodeType] ?? '';

  return (
    <div
      className={[
        'min-w-[220px] rounded-lg border-l-4 bg-[#16202c] shadow-lg',
        borderColor,
        selected
          ? 'border-2 border-[#137fec] shadow-[0_0_15px_rgba(19,127,236,0.3)]'
          : 'border border-[#2a3b4d]',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-semibold text-white">{data.title}</span>
        </div>
        {data.description && <p className="mt-1 text-xs text-gray-400">{data.description}</p>}
        {data.tags && data.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-[#1e2d3d] px-1.5 py-0.5 text-[10px] text-gray-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
