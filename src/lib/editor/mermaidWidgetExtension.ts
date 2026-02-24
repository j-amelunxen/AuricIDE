import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { Annotation, StateEffect, StateField } from '@codemirror/state';
import { extractMermaidBlocks } from './mermaidBlocks';
import {
  isMermaidFlowchart,
  parseMermaidFlowchart,
  serializeMermaidFlowchart,
} from '@/lib/mermaid/mermaidFlowchartParser';

export const mermaidSelfUpdate = Annotation.define<boolean>();

const DEBOUNCE_MS = 300;

const setMermaidDecorations = StateEffect.define<DecorationSet>();

const mermaidDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setMermaidDecorations)) {
        return e.value;
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

let idCounter = 0;

const mermaidThemeConfig = {
  startOnLoad: false,
  theme: 'dark' as const,
  themeVariables: {
    darkMode: true,
    background: '#0c1219',
    primaryColor: '#137fec',
    primaryTextColor: '#e2e8f0',
    lineColor: '#2a3b4d',
    secondaryColor: '#151e29',
  },
};

// Lazy-load mermaid to avoid pulling 68MB into the initial bundle
let mermaidInstance: typeof import('mermaid').default | null = null;
async function getMermaid() {
  if (!mermaidInstance) {
    const mod = await import('mermaid');
    mermaidInstance = mod.default;
  }
  return mermaidInstance;
}

export class MermaidWidget extends WidgetType {
  constructor(
    readonly svg: string | null,
    readonly error: string | null
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.classList.add('cm-mermaid-widget');

    if (this.svg) {
      container.innerHTML = this.svg;
    } else if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'cm-mermaid-error';
      errorEl.textContent = this.error;
      container.appendChild(errorEl);
    } else {
      const loadingEl = document.createElement('div');
      loadingEl.className = 'cm-mermaid-loading';
      loadingEl.textContent = 'Rendering diagram\u2026';
      container.appendChild(loadingEl);
    }

    return container;
  }

  eq(other: MermaidWidget): boolean {
    return this.svg === other.svg && this.error === other.error;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export class MermaidFlowchartWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }

  toDOM(view?: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.classList.add('cm-mermaid-flowchart-widget');

    const data = parseMermaidFlowchart(this.code);

    const MIN_HEIGHT = 200;
    const MAX_DEFAULT_HEIGHT = 600;
    const PADDING = 80;
    const computedHeight = data.bounds
      ? Math.min(Math.max(data.bounds.height + PADDING, MIN_HEIGHT), MAX_DEFAULT_HEIGHT)
      : 400;
    container.style.height = `${computedHeight}px`;

    if (!view) return container;

    const blockFrom = this.from;
    const blockTo = this.to;

    void Promise.all([
      import('react-dom/client'),
      import('react'),
      import('@/app/components/mermaid/MermaidFlowchartView'),
    ])
      .then(([{ createRoot }, React, { MermaidFlowchartView }]) => {
        const onDataChange = (newData: ReturnType<typeof parseMermaidFlowchart>) => {
          const newCode = serializeMermaidFlowchart(newData);
          view.dispatch({
            changes: {
              from: blockFrom,
              to: blockTo,
              insert: `\`\`\`mermaid\n${newCode}\n\`\`\``,
            },
            annotations: mermaidSelfUpdate.of(true),
          });
        };

        const root = createRoot(container);
        root.render(React.createElement(MermaidFlowchartView, { data, onDataChange }));
      })
      .catch(() => {
        container.textContent = 'Failed to render flowchart';
      });

    return container;
  }

  eq(other: MermaidFlowchartWidget): boolean {
    return this.code === other.code && this.from === other.from && this.to === other.to;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

interface CacheEntry {
  svg: string | null;
  error: string | null;
}

class MermaidWidgetPlugin {
  private cache = new Map<string, CacheEntry>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private rendering = false;

  constructor(private view: EditorView) {
    this.scheduleRender();
  }

  update(update: ViewUpdate) {
    if (update.docChanged) {
      // Skip re-render if the change came from a flowchart widget self-update
      const isSelfUpdate = update.transactions.some((tr) => tr.annotation(mermaidSelfUpdate));
      if (isSelfUpdate) return;
      this.scheduleRender();
    }
  }

  private scheduleRender() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.renderBlocks();
    }, DEBOUNCE_MS);
  }

  private async renderBlocks() {
    if (this.rendering) return;
    this.rendering = true;

    try {
      const doc = this.view.state.doc.toString();
      const blocks = extractMermaidBlocks(doc);

      if (blocks.length === 0) {
        this.view.dispatch({
          effects: setMermaidDecorations.of(Decoration.none),
        });
        return;
      }

      let needsUpdate = false;

      // Build decorations
      const ranges: { pos: number; widget: ReturnType<typeof Decoration.widget> }[] = [];

      for (const block of blocks) {
        const code = block.code.trim();
        if (!code) continue;

        // Route flowcharts to the interactive React Flow widget
        if (isMermaidFlowchart(code)) {
          const widget = Decoration.widget({
            widget: new MermaidFlowchartWidget(code, block.from, block.to),
            block: true,
          });
          ranges.push({ pos: block.to, widget });
          continue;
        }

        // Non-flowchart: render as SVG via mermaid library (lazy-loaded)
        if (!this.cache.has(code)) {
          needsUpdate = true;
          try {
            const mermaid = await getMermaid();
            mermaid.initialize(mermaidThemeConfig);
            const id = `cm-mermaid-${idCounter++}`;
            const result = await mermaid.render(id, code);
            this.cache.set(code, { svg: result.svg, error: null });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to render diagram';
            this.cache.set(code, { svg: null, error: message });
          }
        }

        const cached = this.cache.get(code);
        if (!cached) continue;

        const widget = Decoration.widget({
          widget: new MermaidWidget(cached.svg, cached.error),
          block: true,
        });

        ranges.push({ pos: block.to, widget });
      }

      // Sort by position and build decoration set
      ranges.sort((a, b) => a.pos - b.pos);
      const decos = Decoration.set(ranges.map((r) => r.widget.range(r.pos)));

      if (needsUpdate || ranges.length > 0) {
        this.view.dispatch({
          effects: setMermaidDecorations.of(decos),
        });
      }
    } finally {
      this.rendering = false;
    }
  }

  destroy() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
  }
}

const mermaidWidgetPlugin = ViewPlugin.fromClass(MermaidWidgetPlugin);

export const mermaidWidgetExtension = [mermaidDecorationField, mermaidWidgetPlugin];
