'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidPreview } from './MermaidPreview';

export interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps): React.JSX.Element {
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
