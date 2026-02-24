'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

export function EpicNode({ data }: NodeProps & { data: { label: string; onSelect?: () => void } }) {
  return (
    <div
      onClick={data.onSelect}
      className={`bg-primary/20 border-primary border-2 rounded p-3 text-white font-bold min-w-[200px] shadow-lg shadow-primary/10 ${
        data.onSelect ? 'cursor-pointer' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary" />
      <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">Epic</div>
      <div className="text-sm">{data.label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary" />
    </div>
  );
}

export function TicketNode({
  data,
}: NodeProps & {
  data: {
    label: string;
    status: string;
    priority?: string;
    modelPower?: string;
    onSpawnAgent?: () => void;
  };
}) {
  const statusColor = getStatusColor(data.status);
  const powerColor = getPowerColor(data.modelPower);
  const priorityColor = getPriorityColor(data.priority);

  return (
    <div className="bg-[#16202c] border border-white/10 rounded p-3 text-white min-w-[200px] shadow-xl group">
      <Handle type="target" position={Position.Top} className="!bg-white/30" />
      <div className="flex justify-between items-start mb-2">
        <div className="flex gap-1 flex-wrap">
          <div className={`text-[10px] px-1.5 py-0.5 rounded border ${statusColor}`}>
            {data.status}
          </div>
          {data.priority && (
            <div className={`text-[10px] px-1.5 py-0.5 rounded border ${priorityColor}`}>
              {data.priority.toUpperCase()}
            </div>
          )}
          {data.modelPower && (
            <div className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${powerColor}`}>
              {data.modelPower.toUpperCase()}
            </div>
          )}
        </div>
        {data.onSpawnAgent && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              data.onSpawnAgent?.();
            }}
            title="Start Agent"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded flex items-center justify-center"
          >
            <span className="material-symbols-outlined text-sm text-primary-light">smart_toy</span>
          </button>
        )}
      </div>
      <div className="text-sm font-medium leading-tight">{data.label}</div>
      <Handle type="source" position={Position.Bottom} className="!bg-white/30" />
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case 'open':
      return 'text-gray-400 border-gray-400/30 bg-gray-400/5';
    case 'in_progress':
      return 'text-blue-400 border-blue-400/30 bg-blue-400/5';
    case 'done':
      return 'text-green-400 border-green-400/30 bg-green-400/5';
    case 'archived':
      return 'text-purple-400 border-purple-400/30 bg-purple-400/5';
    default:
      return 'text-white/50 border-white/10 bg-white/5';
  }
}

function getPriorityColor(priority?: string) {
  switch (priority?.toLowerCase()) {
    case 'low':
      return 'text-blue-300 border-blue-500/30 bg-blue-500/10';
    case 'normal':
      return 'text-white/50 border-white/10 bg-white/5';
    case 'high':
      return 'text-orange-300 border-orange-500/30 bg-orange-500/10';
    case 'critical':
      return 'text-red-300 border-red-500/30 bg-red-500/10';
    default:
      return '';
  }
}

function getPowerColor(power?: string) {
  switch (power?.toLowerCase()) {
    case 'low':
      return 'text-blue-300 border-blue-500/30 bg-blue-500/10';
    case 'medium':
      return 'text-orange-300 border-orange-500/30 bg-orange-500/10';
    case 'high':
      return 'text-red-300 border-red-500/30 bg-red-500/10';
    default:
      return '';
  }
}
