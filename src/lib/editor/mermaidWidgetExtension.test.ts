import { describe, expect, it, vi, beforeEach } from 'vitest';
import mermaid from 'mermaid';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { mermaidWidgetExtension, MermaidWidget } from './mermaidWidgetExtension';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock</svg>' }),
  },
}));

function createView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [mermaidWidgetExtension],
  });
  const container = document.createElement('div');
  return new EditorView({ state, parent: container });
}

describe('mermaidWidgetExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a valid CodeMirror extension', () => {
    expect(mermaidWidgetExtension).toBeDefined();
  });

  it('creates a view without errors when document has mermaid blocks', () => {
    const doc = '# Title\n```mermaid\ngraph TD\n  A-->B\n```\n';
    const view = createView(doc);
    expect(view).toBeDefined();
    view.destroy();
  });

  it('creates a view without errors when document has no mermaid blocks', () => {
    const doc = '# Title\n\nJust regular markdown.\n```js\nconst x = 1;\n```\n';
    const view = createView(doc);
    expect(view).toBeDefined();
    view.destroy();
  });

  it('draws flowcharts with the real mermaid renderer, not the canvas widget', async () => {
    const view = createView('# Title\n```mermaid\ngraph TD\n  A-->B\n```\n');
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    expect(vi.mocked(mermaid.render).mock.calls[0][1]).toBe('graph TD\n  A-->B');
    view.destroy();
  });

  it('handles empty documents', () => {
    const view = createView('');
    expect(view).toBeDefined();
    view.destroy();
  });
});

describe('MermaidWidget', () => {
  it('renders SVG content into a DOM element', () => {
    const widget = new MermaidWidget('<svg>test diagram</svg>', null);
    const dom = widget.toDOM();

    expect(dom.classList.contains('cm-mermaid-widget')).toBe(true);
    expect(dom.querySelector('svg')).not.toBeNull();
    expect(dom.innerHTML).toContain('test diagram');
  });

  it('renders error message when error is provided', () => {
    const widget = new MermaidWidget(null, 'Parse error: unexpected token');
    const dom = widget.toDOM();

    expect(dom.classList.contains('cm-mermaid-widget')).toBe(true);
    const errorEl = dom.querySelector('.cm-mermaid-error');
    expect(errorEl).not.toBeNull();
    expect(errorEl!.textContent).toContain('Parse error: unexpected token');
  });

  it('renders loading state when both svg and error are null', () => {
    const widget = new MermaidWidget(null, null);
    const dom = widget.toDOM();

    expect(dom.classList.contains('cm-mermaid-widget')).toBe(true);
    expect(dom.textContent).toContain('Rendering');
  });

  it('compares equal when svg and error match', () => {
    const w1 = new MermaidWidget('<svg>a</svg>', null);
    const w2 = new MermaidWidget('<svg>a</svg>', null);
    expect(w1.eq(w2)).toBe(true);
  });

  it('compares not equal when svg differs', () => {
    const w1 = new MermaidWidget('<svg>a</svg>', null);
    const w2 = new MermaidWidget('<svg>b</svg>', null);
    expect(w1.eq(w2)).toBe(false);
  });

  it('compares not equal when error differs', () => {
    const w1 = new MermaidWidget(null, 'error A');
    const w2 = new MermaidWidget(null, 'error B');
    expect(w1.eq(w2)).toBe(false);
  });
});
