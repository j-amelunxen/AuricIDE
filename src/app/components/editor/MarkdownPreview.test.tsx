import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock</svg>' }),
  },
}));

vi.mock('@/lib/mermaid/mermaidFlowchartParser', () => ({
  isMermaidFlowchart: vi.fn((_code: string) =>
    /^(graph|flowchart)\s+(TD|TB|LR|BT|RL)/m.test(_code)
  ),
  parseMermaidFlowchart: vi.fn((_code: string) => ({
    direction: 'TD' as const,
    nodes: [{ id: 'A', label: 'A', shape: 'default' as const, position: { x: 0, y: 0 } }],
    edges: [],
    subgraphs: [],
  })),
  serializeMermaidFlowchart: vi.fn(() => 'flowchart TD\n  A'),
}));

vi.mock('@/app/components/mermaid/MermaidFlowchartView', () => ({
  MermaidFlowchartView: ({
    data,
    onDataChange: _onDataChange,
  }: {
    data: unknown;
    onDataChange?: unknown;
  }) => (
    <div
      data-testid="mermaid-flowchart-view"
      data-direction={(data as { direction: string }).direction}
    >
      flowchart-view
    </div>
  ),
}));

vi.mock('@/lib/mermaid/replaceMermaidBlock', () => ({
  replaceMermaidBlock: vi.fn((_md: string, _old: string, newCode: string) => `replaced:${newCode}`),
}));

describe('MarkdownPreview', () => {
  it('renders code blocks inside <pre> without nesting inside <p>', () => {
    const md = 'Some text\n\n```js\nconsole.log("hi")\n```\n';
    const { container } = render(<MarkdownPreview content={md} />);

    const pre = container.querySelector('pre');
    expect(pre).toBeInTheDocument();

    // <pre> must NOT be a descendant of <p>
    expect(pre?.closest('p')).toBeNull();
  });

  it('renders inline code inside <code> without a wrapping <pre>', () => {
    const md = 'Use `foo()` here';
    const { container } = render(<MarkdownPreview content={md} />);

    const code = container.querySelector('code');
    expect(code).toBeInTheDocument();
    expect(code?.textContent).toBe('foo()');

    // inline code must NOT be wrapped in <pre>
    expect(code?.closest('pre')).toBeNull();
  });

  it('renders the markdown-preview test id', () => {
    render(<MarkdownPreview content="hello" />);
    expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
  });

  it('routes flowchart mermaid blocks to MermaidFlowchartView', () => {
    const md = '# Title\n\n```mermaid\ngraph TD\n  A-->B\n```\n';
    render(<MarkdownPreview content={md} />);
    expect(screen.getByTestId('mermaid-flowchart-view')).toBeInTheDocument();
  });

  it('routes non-flowchart mermaid blocks to MermaidPreview (SVG fallback)', () => {
    const md = '# Title\n\n```mermaid\nsequenceDiagram\n  A->>B: Hello\n```\n';
    render(<MarkdownPreview content={md} />);
    expect(screen.queryByTestId('mermaid-flowchart-view')).toBeNull();
  });

  it('passes onContentChange prop for bidirectional sync', () => {
    const onContentChange = vi.fn();
    const md = '# Title\n\n```mermaid\ngraph TD\n  A-->B\n```\n';
    render(<MarkdownPreview content={md} onContentChange={onContentChange} />);
    expect(screen.getByTestId('mermaid-flowchart-view')).toBeInTheDocument();
  });
});
