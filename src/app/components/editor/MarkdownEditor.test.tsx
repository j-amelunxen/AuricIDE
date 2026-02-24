import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEditorState = vi.hoisted(() => ({
  onUpdate: undefined as ((update: unknown) => void) | undefined,
}));
import { MarkdownEditor } from './MarkdownEditor';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/editor/auricTheme', () => ({
  auricTheme: [],
  auricHighlightStyle: [],
}));

vi.mock('@/lib/editor/nlpHighlightExtension', () => ({
  nlpHighlightExtension: [],
}));

vi.mock('@/lib/nlp/deepHighlightExtension', () => ({
  deepHighlightExtension: [],
}));

vi.mock('@/lib/editor/mermaidWidgetExtension', () => ({
  mermaidWidgetExtension: [],
}));

vi.mock('@/lib/store/devSubscriptionMonitor', () => ({
  createDevSubscriptionMonitor: () => ({ record: () => {}, destroy: () => {} }),
}));

vi.mock('@/lib/editor/wikiLinkExtension', () => ({
  wikiLinkExtension: [],
}));

vi.mock('@/lib/editor/wikiLinkBrokenExtension', () => ({
  brokenLinksSetFacet: { of: () => [] },
  wikiLinkBrokenExtension: [],
}));

vi.mock('@/lib/editor/wikiLinkCompletionExtension', () => ({
  wikiLinkCompletion: () => null,
  fileListFacet: { of: () => [] },
  headingProviderFacet: { of: () => [] },
}));

vi.mock('@/lib/editor/renameHeadingExtension', () => ({
  renameHeadingExtension: [],
  renameHeadingCallbackFacet: { of: () => [] },
}));

vi.mock('@/lib/refactoring/renameHeading', () => ({
  computeHeadingRenameChanges: () => [],
}));

vi.mock('@/lib/refactoring/applyRenameChanges', () => ({
  applyChangesToContent: (c: string) => c,
}));

vi.mock('@/app/components/refactoring/RenameHeadingDialog', () => ({
  RenameHeadingDialog: () => null,
}));

vi.mock('@/lib/refactoring/extractSection', () => ({
  computeSectionExtraction: () => null,
}));

vi.mock('@/lib/refactoring/applyExtractSection', () => ({
  applyExtractSection: async () => '',
}));

vi.mock('@/lib/editor/findReferencesExtension', () => ({
  findReferencesKeymap: [],
  showReferencesFacet: { of: () => [] },
}));

vi.mock('@/lib/refactoring/findReferences', () => ({
  findAllReferences: () => [],
}));

vi.mock('@/app/components/refactoring/ExtractSectionDialog', () => ({
  ExtractSectionDialog: () => null,
}));

vi.mock('@/lib/editor/wikiLinkHoverExtension', () => ({
  wikiLinkHoverExtension: [],
  previewFetcherFacet: { of: () => [] },
  navigateCallbackFacet: { of: () => [] },
}));

vi.mock('@/lib/editor/markdownFoldExtension', () => ({
  markdownFoldExtension: [],
}));

vi.mock('@/lib/editor/slashCommandSource', () => ({
  slashCommandSource: () => null,
  slashCommandsFacet: { of: () => [] },
  slashCommandRenderOption: { position: 50, render: () => null },
  mergeSlashCommands: (defaults: unknown[]) => defaults,
  slashCommands: [],
}));

vi.mock('@/lib/editor/markdownCompletionSource', () => ({
  codeFenceLanguageSource: () => null,
  headingLevelSource: () => null,
  linkTargetSource: () => null,
  imageTargetSource: () => null,
  filePathsFacet: { of: () => [] },
}));

vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => [],
  completionKeymap: [],
}));

vi.mock('@codemirror/lint', () => ({
  linter: () => [],
  lintGutter: () => [],
  lintKeymap: [],
}));

vi.mock('@/lib/editor/markdownLintExtension', () => ({
  markdownLintExtension: [],
  lintConfigFacet: { of: () => [] },
  fileListForLintFacet: { of: () => [] },
  headingIndexForLintFacet: { of: () => [] },
  currentFilePathFacet: { of: () => [] },
}));

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(() => ({}), {
    getState: () => ({
      allFilePaths: [],
      getBrokenLinkTargets: () => new Set(),
      customSlashCommands: [],
      headingIndex: new Map(),
      lintConfig: { enabled: true, disabledRules: new Set() },
      enableDeepNlp: false,
      setDiagnostics: () => {},
    }),
    subscribe: () => () => {},
  }),
}));

vi.mock('@codemirror/view', () => {
  class MockEditorView {
    dom: HTMLDivElement;
    state = {
      doc: { toString: () => 'mock content', length: 12 },
    };

    static updateListener = {
      of: (fn: (u: unknown) => void) => {
        mockEditorState.onUpdate = fn;
        return [];
      },
    };
    static lineWrapping = [];

    constructor(config: { parent?: HTMLElement; state?: { doc?: unknown } }) {
      this.dom = document.createElement('div');
      this.dom.setAttribute('data-testid', 'cm-editor');
      const doc = (config.state as { doc?: string })?.doc ?? '';
      this.dom.textContent = typeof doc === 'string' ? doc : '';
      config.parent?.appendChild(this.dom);
    }
    destroy() {}
    dispatch(tr?: { changes?: unknown }) {
      if (tr?.changes !== undefined && mockEditorState.onUpdate) {
        mockEditorState.onUpdate({
          docChanged: true,
          selectionSet: false,
          state: {
            doc: {
              toString: () => 'mock content',
              lineAt: (_pos: number) => ({ number: 1, from: 0 }),
            },
            selection: { main: { head: 0, empty: true, from: 0, to: 0 } },
          },
        });
      }
    }
  }

  return {
    EditorView: MockEditorView,
    Decoration: {
      mark: () => ({ range: () => ({}) }),
      set: () => ({}),
      widget: () => ({ range: () => ({}) }),
      none: {},
    },
    WidgetType: class {},
    ViewPlugin: { fromClass: () => ({}) },
    hoverTooltip: () => [],
    lineNumbers: () => [],
    keymap: { of: () => [] },
  };
});

vi.mock('@codemirror/state', () => ({
  EditorState: {
    create: (config: { doc?: string }) => ({
      doc: config.doc ?? '',
    }),
  },
  Compartment: class {
    of() {
      return [];
    }
    reconfigure() {
      return [];
    }
  },
  Facet: {
    define: () => ({ of: () => [] }),
  },
}));

vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => [],
  markdownLanguage: {},
}));

vi.mock('@codemirror/language-data', () => ({
  languages: [],
}));

vi.mock('@codemirror/lang-javascript', () => ({ javascript: () => [] }));
vi.mock('@codemirror/lang-rust', () => ({ rust: () => [] }));
vi.mock('@codemirror/lang-html', () => ({ html: () => [] }));
vi.mock('@codemirror/lang-css', () => ({ css: () => [] }));
vi.mock('@codemirror/lang-json', () => ({ json: () => [] }));
vi.mock('@codemirror/lang-python', () => ({ python: () => [] }));

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  history: () => [],
  historyKeymap: [],
}));

vi.mock('@codemirror/search', () => ({
  search: () => [],
  searchKeymap: [],
  highlightSelectionMatches: () => [],
}));

describe('MarkdownEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the editor container', () => {
    render(<MarkdownEditor content="# Hello" onChange={vi.fn()} />);
    expect(screen.getByTestId('markdown-editor')).toBeInTheDocument();
  });

  it('applies the correct background class on wrapper', () => {
    render(<MarkdownEditor content="# Hello" onChange={vi.fn()} />);
    // bg-editor-bg is on the outermost wrapper (grandparent due to split-view flex container)
    const editor = screen.getByTestId('markdown-editor');
    const wrapper = editor.closest('.bg-editor-bg');
    expect(wrapper).not.toBeNull();
  });

  it('mounts the CodeMirror editor', () => {
    render(<MarkdownEditor content="# Hello" onChange={vi.fn()} />);
    expect(screen.getByTestId('cm-editor')).toBeInTheDocument();
  });

  it('passes initial content to the editor', () => {
    render(<MarkdownEditor content="# Test Content" onChange={vi.fn()} />);
    expect(screen.getByTestId('cm-editor')).toHaveTextContent('# Test Content');
  });

  it('calls the latest onChange when content changes after tab switch', async () => {
    // Regression test: stale closure bug caused onChange from the first-opened file
    // to be used for all subsequent files. Typing in file B would write to file A.
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const { rerender } = render(<MarkdownEditor content="content A" onChange={fn1} />);
    fn1.mockClear();

    // Simulate switching to a new file: new onChange + new content
    rerender(<MarkdownEditor content="content B" onChange={fn2} />);

    // fn2 must be called (latest handler), fn1 must NOT be called (stale)
    await vi.waitFor(() => {
      expect(fn2).toHaveBeenCalled();
    });
    expect(fn1).not.toHaveBeenCalled();
  });
});
