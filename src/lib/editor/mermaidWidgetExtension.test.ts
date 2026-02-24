import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  mermaidWidgetExtension,
  MermaidWidget,
  MermaidFlowchartWidget,
  mermaidSelfUpdate,
} from './mermaidWidgetExtension';
import type { MermaidFlowchartData } from '@/lib/mermaid/mermaidFlowchartParser';

const { mockParseMermaidFlowchart } = vi.hoisted(() => ({
  mockParseMermaidFlowchart: vi.fn<() => MermaidFlowchartData>(() => ({
    direction: 'TD',
    nodes: [{ id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } }],
    edges: [],
    subgraphs: [],
    bounds: { width: 300, height: 250 },
  })),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock</svg>' }),
  },
}));

vi.mock('@/lib/mermaid/mermaidFlowchartParser', () => ({
  isMermaidFlowchart: vi.fn((code: string) => /^(graph|flowchart)\s+(TD|TB|LR|BT|RL)/m.test(code)),
  parseMermaidFlowchart: mockParseMermaidFlowchart,
  serializeMermaidFlowchart: vi.fn(() => 'flowchart TD\n  A'),
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

describe('MermaidFlowchartWidget', () => {
  it('creates a DOM element with the flowchart widget class', () => {
    const widget = new MermaidFlowchartWidget('graph TD\n  A-->B', 0, 30);
    const dom = widget.toDOM();
    expect(dom.classList.contains('cm-mermaid-flowchart-widget')).toBe(true);
  });

  it('compares equal when code, from, and to match', () => {
    const w1 = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    const w2 = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    expect(w1.eq(w2)).toBe(true);
  });

  it('compares not equal when code differs', () => {
    const w1 = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    const w2 = new MermaidFlowchartWidget('graph LR\n  A', 0, 20);
    expect(w1.eq(w2)).toBe(false);
  });

  it('ignores events to allow interaction', () => {
    const widget = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    expect(widget.ignoreEvent()).toBe(true);
  });

  it('sets dynamic height based on bounds', () => {
    mockParseMermaidFlowchart.mockReturnValueOnce({
      direction: 'TD',
      nodes: [{ id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
      bounds: { width: 300, height: 250 },
    });
    const widget = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    const dom = widget.toDOM();
    // bounds.height (250) + PADDING (80) = 330px
    expect(dom.style.height).toBe('330px');
  });

  it('enforces minimum height of 200px', () => {
    mockParseMermaidFlowchart.mockReturnValueOnce({
      direction: 'TD',
      nodes: [{ id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
      bounds: { width: 100, height: 50 },
    });
    const widget = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    const dom = widget.toDOM();
    expect(dom.style.height).toBe('200px');
  });

  it('caps height at 600px by default', () => {
    mockParseMermaidFlowchart.mockReturnValueOnce({
      direction: 'TD',
      nodes: [{ id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
      bounds: { width: 800, height: 1000 },
    });
    const widget = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    const dom = widget.toDOM();
    expect(dom.style.height).toBe('600px');
  });

  it('falls back to 400px when bounds are not available', () => {
    mockParseMermaidFlowchart.mockReturnValueOnce({
      direction: 'TD',
      nodes: [{ id: 'A', label: 'A', shape: 'default', position: { x: 0, y: 0 } }],
      edges: [],
      subgraphs: [],
    });
    const widget = new MermaidFlowchartWidget('graph TD\n  A', 0, 20);
    const dom = widget.toDOM();
    expect(dom.style.height).toBe('400px');
  });
});

describe('mermaidSelfUpdate annotation', () => {
  it('is defined as an Annotation', () => {
    expect(mermaidSelfUpdate).toBeDefined();
  });

  it('can be used in a transaction', () => {
    const doc = '# Title\n```mermaid\ngraph TD\n  A-->B\n```\n';
    const view = createView(doc);
    expect(() => {
      view.dispatch({
        annotations: mermaidSelfUpdate.of(true),
      });
    }).not.toThrow();
    view.destroy();
  });
});
