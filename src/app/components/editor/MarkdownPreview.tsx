'use client';

import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidPreview } from './MermaidPreview';
import { MermaidFlowchartView } from '@/app/components/mermaid/MermaidFlowchartView';
import {
  isMermaidFlowchart,
  parseMermaidFlowchart,
  serializeMermaidFlowchart,
  type MermaidFlowchartData,
} from '@/lib/mermaid/mermaidFlowchartParser';
import { replaceMermaidBlock } from '@/lib/mermaid/replaceMermaidBlock';

export interface MarkdownPreviewProps {
  content: string;
  onContentChange?: (content: string) => void;
}

interface MermaidBlockProps {
  code: string;
  canEditAsCanvas: boolean;
  onFlowchartChange: (oldCode: string, newData: MermaidFlowchartData) => void;
}

const CANVAS_SWITCH = 'flowchart-expand-btn';

/**
 * Mermaid is rendered by mermaid itself, the same output as mermaid.live. The React Flow
 * canvas re-lays the graph out on its own and is only an explicit opt-in for editing a
 * plain flowchart; it is never the default view.
 */
function MermaidBlock({ code, canEditAsCanvas, onFlowchartChange }: MermaidBlockProps) {
  const [canvasMode, setCanvasMode] = useState(false);
  const editable = canEditAsCanvas && isMermaidFlowchart(code);

  if (editable && canvasMode) {
    return (
      <div className="my-4">
        <div className="mb-2 flex justify-end">
          <button type="button" className={CANVAS_SWITCH} onClick={() => setCanvasMode(false)}>
            Back to diagram
          </button>
        </div>
        <div style={{ height: 400 }}>
          <MermaidFlowchartView
            data={parseMermaidFlowchart(code)}
            onDataChange={(newData) => onFlowchartChange(code, newData)}
          />
        </div>
      </div>
    );
  }

  return (
    <MermaidPreview
      code={code}
      toolbarExtra={
        editable ? (
          <button type="button" className={CANVAS_SWITCH} onClick={() => setCanvasMode(true)}>
            Edit as canvas
          </button>
        ) : undefined
      }
    />
  );
}

export function MarkdownPreview({
  content,
  onContentChange,
}: MarkdownPreviewProps): React.JSX.Element {
  const handleFlowchartChange = useCallback(
    (oldCode: string, newData: MermaidFlowchartData) => {
      if (!onContentChange) return;
      const newCode = serializeMermaidFlowchart(newData);
      const updated = replaceMermaidBlock(content, oldCode, newCode);
      onContentChange(updated);
    },
    [content, onContentChange]
  );

  return (
    <div
      data-testid="markdown-preview"
      className="h-full w-full overflow-auto bg-editor-bg px-8 py-6 prose prose-invert prose-slate max-w-none"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const isBlock =
              (node?.position && node.position.start.line !== node.position.end.line) ||
              Boolean(match);
            const codeString = String(children).replace(/\n$/, '');

            // Render mermaid diagrams
            if (isBlock && language === 'mermaid') {
              return (
                <MermaidBlock
                  code={codeString}
                  canEditAsCanvas={Boolean(onContentChange)}
                  onFlowchartChange={handleFlowchartChange}
                />
              );
            }

            // Regular code blocks
            if (isBlock) {
              return (
                <pre className="bg-background-dark rounded-lg p-4 overflow-x-auto">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }

            // Inline code
            return (
              <code className="bg-background-dark px-1.5 py-0.5 rounded text-sm" {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
