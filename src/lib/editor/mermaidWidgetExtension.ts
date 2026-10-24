import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { StateEffect, StateField } from '@codemirror/state';
import { extractMermaidBlocks } from './mermaidBlocks';
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

        // Every diagram type, flowcharts included, is drawn by mermaid itself so the
        // layout matches mermaid.live; the React Flow canvas is no longer routed here.
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
