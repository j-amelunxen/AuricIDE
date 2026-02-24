'use client';

import { useState, useRef } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface FlowchartNodeData {
  label: string;
  shape: string;
  direction: string;
  onEdit: (id: string, newLabel: string) => void;
}

type HandlePositions = { target: Position; source: Position };

function getHandlePositions(direction: string): HandlePositions {
  switch (direction) {
    case 'LR':
      return { target: Position.Left, source: Position.Right };
    case 'BT':
      return { target: Position.Bottom, source: Position.Top };
    case 'RL':
      return { target: Position.Right, source: Position.Left };
    case 'TD':
    case 'TB':
    default:
      return { target: Position.Top, source: Position.Bottom };
  }
}

function getShapeClass(shape: string): string {
  switch (shape) {
    case 'round':
      return 'flowchart-node-round';
    case 'stadium':
      return 'flowchart-node-stadium';
    case 'subroutine':
      return 'flowchart-node-subroutine';
    case 'cylindrical':
      return 'flowchart-node-cylindrical';
    case 'circle':
      return 'flowchart-node-circle';
    case 'asymmetric':
      return 'flowchart-node-asymmetric';
    case 'rhombus':
      return 'flowchart-node-rhombus';
    case 'hexagon':
      return 'flowchart-node-hexagon';
    case 'double-circle':
      return 'flowchart-node-double-circle';
    case 'rect':
    case 'default':
    default:
      return 'flowchart-node-rect';
  }
}

function getShapeTailwindClasses(shape: string): string {
  switch (shape) {
    case 'round':
      return 'rounded-xl';
    case 'stadium':
      return 'rounded-full px-6';
    case 'subroutine':
      return 'rounded-md border-2 ring-2 ring-[#2a3b4d] ring-offset-1 ring-offset-[#16202c]';
    case 'cylindrical':
      return 'rounded-md rounded-t-[50%] rounded-b-[50%]';
    case 'circle':
      return 'rounded-full aspect-square flex items-center justify-center';
    case 'asymmetric':
      return '[clip-path:polygon(0%_0%,90%_0%,100%_50%,90%_100%,0%_100%)]';
    case 'rhombus':
      return 'rotate-45';
    case 'hexagon':
      return '[clip-path:polygon(25%_0%,75%_0%,100%_50%,75%_100%,25%_100%,0%_50%)]';
    case 'double-circle':
      return 'rounded-full ring-2 ring-[#2a3b4d] ring-offset-2 ring-offset-[#16202c] aspect-square flex items-center justify-center';
    case 'rect':
    case 'default':
    default:
      return 'rounded-md';
  }
}

export function FlowchartNode({ id, data }: NodeProps & { data: FlowchartNodeData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { target, source } = getHandlePositions(data.direction);
  const shapeClass = getShapeClass(data.shape);
  const shapeTailwind = getShapeTailwindClasses(data.shape);
  const isRhombus = data.shape === 'rhombus';

  const startEdit = () => {
    setDraft(data.label);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    if (draft !== data.label) {
      data.onEdit(id, draft);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  const renderContent = () => {
    if (editing) {
      return (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-sm text-white outline-none text-center"
        />
      );
    }
    return (
      <span className="text-sm text-white truncate" title={data.label}>
        {data.label}
      </span>
    );
  };

  return (
    <div
      className={`min-w-[80px] bg-[#16202c] border border-[#2a3b4d] shadow-lg text-white ${shapeClass} ${shapeTailwind}`}
      onDoubleClick={startEdit}
    >
      <Handle type="target" position={target} />
      {isRhombus ? (
        <div className="flowchart-node-rhombus-inner -rotate-45 px-4 py-2 flex items-center justify-center">
          {renderContent()}
        </div>
      ) : (
        <div className="px-4 py-2 flex items-center justify-center">{renderContent()}</div>
      )}
      <Handle type="source" position={source} />
    </div>
  );
}
