'use client';

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface MindmapNodeData {
  content: string;
  level: number;
  onEdit: (id: string, newContent: string) => void;
}

const LEVEL_STYLES: Record<number, string> = {
  1: 'border-l-purple-500',
  2: 'border-l-blue-500',
  3: 'border-l-teal-500',
  4: 'border-l-green-500',
  5: 'border-l-yellow-500',
  6: 'border-l-orange-500',
  7: 'border-l-gray-400',
};

interface LeafModalProps {
  content: string;
  onSave: (content: string) => void;
  onClose: () => void;
}

function LeafModal({ content, onSave, onClose }: LeafModalProps) {
  const [draft, setDraft] = useState(content);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSave(draft);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[600px] max-w-[90vw] rounded-xl border border-white/10 bg-[#0f1923] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
            Edit Node
          </span>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            ✕
          </button>
        </div>
        <div className="p-4">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-48 w-full rounded-lg bg-[#16202c] p-3 text-sm text-white resize-none outline-none border border-white/5 focus:border-white/20 leading-relaxed"
          />
          <p className="mt-1.5 text-[10px] text-gray-600">Cmd+S to save · Esc to cancel</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/5 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(draft)}
            className="rounded bg-purple-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-purple-600 transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function MindmapNode({ id, data }: NodeProps & { data: MindmapNodeData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isLeaf = data.level === 7;
  const levelStyle = LEVEL_STYLES[data.level] ?? LEVEL_STYLES[7];

  // --- Heading node inline edit ---
  const startEdit = () => {
    setDraft(data.content);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    if (draft !== data.content) {
      data.onEdit(id, draft);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      setEditing(false);
    }
  };

  // --- Leaf node: subsection preview card + modal ---
  if (isLeaf) {
    return (
      <>
        <div
          role="button"
          data-testid="leaf-node"
          className={`w-[320px] cursor-pointer rounded-lg border-l-4 bg-[#16202c] border border-[#2a3b4d] shadow-lg hover:border-white/25 transition-colors ${levelStyle}`}
          onClick={() => setModalOpen(true)}
        >
          <Handle type="target" position={Position.Left} />
          <div className="relative h-[96px] overflow-hidden px-3 pt-3 pb-1">
            <p className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed">
              {data.content}
            </p>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#16202c] to-transparent"
            />
          </div>
          <Handle type="source" position={Position.Right} />
        </div>
        {modalOpen && (
          <LeafModal
            content={data.content}
            onSave={(newContent) => {
              if (newContent !== data.content) data.onEdit(id, newContent);
              setModalOpen(false);
            }}
            onClose={() => setModalOpen(false)}
          />
        )}
      </>
    );
  }

  // --- Heading node: compact single-line, double-click to edit inline ---
  return (
    <div
      className={`min-w-[150px] max-w-[250px] rounded-lg border-l-4 bg-[#16202c] border border-[#2a3b4d] shadow-lg ${levelStyle}`}
      onDoubleClick={startEdit}
    >
      <Handle type="target" position={Position.Left} />
      <div className="px-3 py-2">
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm text-white resize-none outline-none"
            rows={2}
          />
        ) : (
          <p className="text-sm text-white truncate" title={data.content}>
            {data.content}
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
