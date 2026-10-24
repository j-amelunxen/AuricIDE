import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock</svg>' }),
  },
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

  it('renders flowchart mermaid blocks with the real mermaid renderer', () => {
    const md = '# Title\n\n```mermaid\ngraph TD\n  A-->B\n```\n';
    render(<MarkdownPreview content={md} />);
    expect(screen.getByTestId('mermaid-preview')).toBeInTheDocument();
  });

  it('renders non-flowchart mermaid blocks with the same renderer', () => {
    const md = '# Title\n\n```mermaid\nsequenceDiagram\n  A->>B: Hello\n```\n';
    render(<MarkdownPreview content={md} />);
    expect(screen.getByTestId('mermaid-preview')).toBeInTheDocument();
  });
});
