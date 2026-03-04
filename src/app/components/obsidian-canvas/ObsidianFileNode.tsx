'use client';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeBorderStyle, getNodeBorderColor } from './nodeStyles';
import type { ObsidianColor } from '@/lib/obsidian-canvas/types';
import { CanvasTicketBadge } from './CanvasTicketBadge';

export interface ObsidianFileNodeData {
  file: string;
  color?: ObsidianColor;
  onFileOpen?: (filePath: string) => void;
  loadFileContent?: (relativePath: string) => Promise<string>;
  auricTicketId?: string;
  onTicketClick?: (ticketId: string) => void;
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export function ObsidianFileNode({ data, selected }: NodeProps & { data: ObsidianFileNodeData }) {
  const borderColor = getNodeBorderColor(data.color);
  const containerStyle = getNodeBorderStyle(data.color, selected);
  const fileName = basename(data.file);

  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!data.loadFileContent);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!data.loadFileContent) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    data
      .loadFileContent(data.file)
      .then((text) => {
        if (!cancelled) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.file]);

  const handleDoubleClick = () => {
    data.onFileOpen?.(data.file);
  };

  return (
    <div
      data-testid="file-node-card"
      className={[
        'relative min-w-[220px] bg-[#16202c] border border-[#2a3b4d]',
        'border-l-4 flex flex-col h-full',
        containerStyle,
      ].join(' ')}
      style={{ borderLeftColor: borderColor }}
      onDoubleClick={handleDoubleClick}
    >
      {data.auricTicketId && (
        <CanvasTicketBadge ticketId={data.auricTicketId} onTicketClick={data.onTicketClick} />
      )}
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />

      <div className="px-3 py-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span data-testid="file-icon" className="text-base" aria-hidden="true">
            📄
          </span>
          <span className="text-sm font-semibold text-white truncate">{fileName}</span>
        </div>
        <p className="mt-1 text-xs text-gray-400 truncate">{data.file}</p>
      </div>

      {data.loadFileContent && (
        <div className="overflow-y-auto flex-1 px-3 pb-2">
          {loading ? (
            <span className="text-xs text-gray-500">Loading...</span>
          ) : error ? (
            <span className="text-xs text-red-400">Failed to load</span>
          ) : content !== null ? (
            <div className="text-gray-200 break-words [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-0.5 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-1 [&_ul]:pl-4 [&_ul]:list-disc [&_ul]:mb-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_ol]:mb-1 [&_li]:text-sm [&_li]:leading-relaxed [&_a]:text-blue-400 [&_strong]:font-semibold [&_em]:italic [&_code]:font-mono [&_code]:text-xs [&_code]:bg-white/10 [&_code]:px-0.5 [&_code]:rounded">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}
