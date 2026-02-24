'use client';

import { useCallback } from 'react';
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
              if (isMermaidFlowchart(codeString)) {
                const data = parseMermaidFlowchart(codeString);
                return (
                  <div className="my-4" style={{ height: 400 }}>
                    <MermaidFlowchartView
                      data={data}
                      onDataChange={(newData) => handleFlowchartChange(codeString, newData)}
                    />
                  </div>
                );
              }
              return <MermaidPreview code={codeString} />;
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
