'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface ProcessNodeData {
  title: string;
  description: string;
  nodeType: 'trigger' | 'agent' | 'script' | 'output';
  tags?: string[];
}

const TYPE_COLORS: Record<ProcessNodeData['nodeType'], string> = {
  trigger: 'bg-purple-500',
  agent: 'bg-blue-500',
  script: 'bg-orange-500',
  output: 'bg-green-500',
};

const ICONS: Record<ProcessNodeData['nodeType'], string> = {
  trigger: '\u25B6',
  agent: '\uD83E\uDD16',
  script: '\u2728',
  output: '\uD83D\uDCE4',
};

export function ProcessNode({ data, selected }: NodeProps & { data: ProcessNodeData }) {
  const typeColor = TYPE_COLORS[data.nodeType] ?? 'bg-blue-500';
  const icon = ICONS[data.nodeType] ?? '';

  return (
    <div
      className={[
        'min-w-[220px] rounded-lg bg-[#16202c] shadow-lg',
        selected
          ? 'border-2 border-[#137fec] shadow-[0_0_15px_rgba(19,127,236,0.3)]'
          : 'border border-[#2a3b4d]',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Top} />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            data-testid="node-type-indicator"
            aria-hidden="true"
            className={`h-2 w-2 flex-shrink-0 rounded-full ${typeColor}`}
          />
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
