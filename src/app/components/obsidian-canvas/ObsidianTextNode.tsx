'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeBorderStyle, getNodeBorderColor } from './nodeStyles';
import type { ObsidianColor } from '@/lib/obsidian-canvas/types';
import { CanvasTicketBadge } from './CanvasTicketBadge';

export interface ObsidianTextNodeData {
  text: string;
  color?: ObsidianColor;
  onTextEdit: (id: string, newText: string) => void;
  onResize: (id: string, width: number, height: number) => void;
  auricTicketId?: string;
  onTicketClick?: (ticketId: string) => void;
}

export function ObsidianTextNode({
  id,
  data,
  selected,
}: NodeProps & { data: ObsidianTextNodeData }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const borderColor = getNodeBorderColor(data.color);
  const containerStyle = getNodeBorderStyle(data.color, selected);

  const startEdit = () => {
    setDraft(data.text);
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    setEditing(false);
    if (draft !== data.text) {
      data.onTextEdit(id, draft);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      cancelEdit();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitEdit();
    }
  };

  return (
    <div
      className={[
        'relative min-w-[200px] min-h-[80px] bg-[#16202c] border border-[#2a3b4d]',
        'border-l-4 p-3',
        containerStyle,
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
    >
      {data.auricTicketId && (
        <CanvasTicketBadge ticketId={data.auricTicketId} onTicketClick={data.onTicketClick} />
      )}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />

      <div data-testid="text-node-content" className="h-full w-full" onDoubleClick={startEdit}>
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            className="w-full h-full bg-transparent text-sm text-white resize-none outline-none focus:ring-1 focus:ring-[#137fec] leading-relaxed"
            rows={4}
            aria-label="Edit text node. Ctrl+Enter to save, Escape to cancel."
          />
        ) : data.text ? (
          <div className="text-gray-200 break-words [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-0.5 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-1 [&_ul]:pl-4 [&_ul]:list-disc [&_ul]:mb-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_ol]:mb-1 [&_li]:text-sm [&_li]:leading-relaxed [&_a]:text-blue-400 [&_strong]:font-semibold [&_em]:italic [&_code]:font-mono [&_code]:text-xs [&_code]:bg-white/10 [&_code]:px-0.5 [&_code]:rounded">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.text}</ReactMarkdown>
          </div>
        ) : (
          <span className="text-gray-500 italic text-sm">(empty)</span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}
