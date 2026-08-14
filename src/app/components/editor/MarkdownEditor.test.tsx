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

vi.mock('@/lib/editor/jsonLintExtension', () => ({
  jsonLintExtension: [],
  currentFilePathFacetJson: { of: () => [] },
}));

vi.mock('@/lib/editor/xmlLintExtension', () => ({
  xmlLintExtension: [],
  currentFilePathFacetXml: { of: () => [] },
}));

vi.mock('@/lib/editor/yamlLintExtension', () => ({
  yamlLintExtension: [],
  currentFilePathFacetYaml: { of: () => [] },
}));

const mockGetGitDiff = vi.hoisted(() => vi.fn().mockResolvedValue(''));
const mockGitBlame = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('@/lib/tauri/git', () => ({
  getGitDiff: mockGetGitDiff,
  gitBlame: mockGitBlame,
}));

vi.mock('@/lib/git/parseDiff', () => ({
  parseDiff: (raw: string) =>
    raw ? [{ type: 'added' as const, content: raw, oldLineNo: null, newLineNo: 1 }] : [],
}));

const mockGitGutterReconfigure = vi.hoisted(() => vi.fn());
vi.mock('@/lib/editor/gitGutterExtension', () => ({
  createGitGutter: (changes: unknown[]) => {
    mockGitGutterReconfigure(changes);
    return ['git-gutter-ext', changes];
  },
  diffToLineChanges: (lines: unknown[]) => lines.map((_l, i) => ({ line: i + 1, type: 'added' })),
}));

const mockBlameGutterReconfigure = vi.hoisted(() => vi.fn());
vi.mock('@/lib/editor/blameGutterExtension', () => ({
  createBlameGutter: (hunks: unknown[]) => {
    mockBlameGutterReconfigure(hunks);
    return ['blame-gutter-ext', hunks];
  },
}));

const mockStoreState = vi.hoisted(() => ({
  rootPath: null as string | null,
  openTabs: [] as { id: string; path: string; name: string; isDirty?: boolean }[],
  fileStatuses: [] as { path: string; status: string }[],
  blameVisible: false,
  blameByPath: {} as Record<string, unknown[]>,
  loadBlame: vi.fn(async () => {}),
  toggleBlame: vi.fn(),
}));

vi.mock('@/lib/store', () => {
  const snapshot = () => ({
    allFilePaths: [],
    getBrokenLinkTargets: () => new Set(),
    customSlashCommands: [],
    headingIndex: new Map(),
    lintConfig: { enabled: true, disabledRules: new Set() },
    enableDeepNlp: false,
    setDiagnostics: () => {},
    rootPath: mockStoreState.rootPath,
    openTabs: mockStoreState.openTabs,
    fileStatuses: mockStoreState.fileStatuses,
    blameVisible: mockStoreState.blameVisible,
    blameByPath: mockStoreState.blameByPath,
    loadBlame: mockStoreState.loadBlame,
    toggleBlame: mockStoreState.toggleBlame,
  });
  return {
    useStore: Object.assign(
      (selector?: (s: ReturnType<typeof snapshot>) => unknown) =>
        selector ? selector(snapshot()) : snapshot(),
      {
        getState: snapshot,
        subscribe: () => () => {},
      }
    ),
  };
});

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
    mockStoreState.rootPath = null;
    mockStoreState.openTabs = [];
    mockStoreState.fileStatuses = [];
    mockStoreState.blameVisible = false;
    mockStoreState.blameByPath = {};
    mockGetGitDiff.mockResolvedValue('');
    mockGitBlame.mockResolvedValue([]);
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

  describe('git gutter', () => {
    it('does not fetch a diff without a project root', async () => {
      render(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);
      await vi.waitFor(() => {
        expect(mockGitGutterReconfigure).toHaveBeenCalledWith([]);
      });
      expect(mockGetGitDiff).not.toHaveBeenCalled();
    });

    it('fetches the diff for the open file relative to the project root and applies it', async () => {
      mockStoreState.rootPath = '/proj';
      mockGetGitDiff.mockResolvedValue('some diff');

      render(
        <MarkdownEditor content="# Hello" filePath="/proj/notes/note.md" onChange={vi.fn()} />
      );

      await vi.waitFor(() => {
        expect(mockGetGitDiff).toHaveBeenCalledWith('/proj', 'notes/note.md');
      });
      await vi.waitFor(() => {
        expect(mockGitGutterReconfigure).toHaveBeenCalledWith([{ line: 1, type: 'added' }]);
      });
    });

    it('clears the gutter when fetching the diff fails', async () => {
      mockStoreState.rootPath = '/proj';
      mockGetGitDiff.mockRejectedValue(new Error('not a git repo'));

      render(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);

      await vi.waitFor(() => {
        expect(mockGitGutterReconfigure).toHaveBeenCalledWith([]);
      });
    });

    it('does not refetch while the tab is dirty', async () => {
      mockStoreState.rootPath = '/proj';
      mockStoreState.openTabs = [
        { id: '/proj/note.md', path: '/proj/note.md', name: 'note.md', isDirty: false },
      ];
      mockGetGitDiff.mockResolvedValue('some diff');

      const { rerender } = render(
        <MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />
      );

      await vi.waitFor(() => {
        expect(mockGetGitDiff).toHaveBeenCalledTimes(1);
      });

      mockGetGitDiff.mockClear();
      mockStoreState.openTabs = [
        { id: '/proj/note.md', path: '/proj/note.md', name: 'note.md', isDirty: true },
      ];
      rerender(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockGetGitDiff).not.toHaveBeenCalled();
    });

    it('refetches when git status for the file changes', async () => {
      mockStoreState.rootPath = '/proj';
      mockStoreState.fileStatuses = [{ path: 'note.md', status: 'modified' }];
      mockGetGitDiff.mockResolvedValue('some diff');

      const { rerender } = render(
        <MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />
      );

      await vi.waitFor(() => {
        expect(mockGetGitDiff).toHaveBeenCalledTimes(1);
      });

      mockGetGitDiff.mockClear();
      mockStoreState.fileStatuses = [];
      rerender(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);

      await vi.waitFor(() => {
        expect(mockGetGitDiff).toHaveBeenCalledWith('/proj', 'note.md');
      });
    });

    it('refetches when isDirty becomes false after save', async () => {
      mockStoreState.rootPath = '/proj';
      mockStoreState.openTabs = [
        { id: '/proj/note.md', path: '/proj/note.md', name: 'note.md', isDirty: true },
      ];

      const { rerender } = render(
        <MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />
      );

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockGetGitDiff).not.toHaveBeenCalled();

      mockStoreState.openTabs = [
        { id: '/proj/note.md', path: '/proj/note.md', name: 'note.md', isDirty: false },
      ];
      rerender(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);

      await vi.waitFor(() => {
        expect(mockGetGitDiff).toHaveBeenCalledWith('/proj', 'note.md');
      });
    });
  });

  describe('blame toggle', () => {
    it('shows the blame toggle on a real file tab when a project is open', () => {
      mockStoreState.rootPath = '/proj';
      render(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);
      expect(screen.getByTestId('blame-toggle')).toBeInTheDocument();
    });

    it('hides the blame toggle without a project', () => {
      render(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);
      expect(screen.queryByTestId('blame-toggle')).not.toBeInTheDocument();
    });

    it('hides the blame toggle on a diff tab', () => {
      mockStoreState.rootPath = '/proj';
      render(<MarkdownEditor content="diff" filePath="diff:unstaged:note.md" onChange={vi.fn()} />);
      expect(screen.queryByTestId('blame-toggle')).not.toBeInTheDocument();
    });

    it('does not load blame while the tab is dirty', async () => {
      mockStoreState.rootPath = '/proj';
      mockStoreState.blameVisible = true;
      mockStoreState.openTabs = [
        { id: '/proj/note.md', path: '/proj/note.md', name: 'note.md', isDirty: true },
      ];

      render(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mockStoreState.loadBlame).not.toHaveBeenCalled();
    });

    it('loads blame when visible and the file is clean', async () => {
      mockStoreState.rootPath = '/proj';
      mockStoreState.blameVisible = true;
      mockStoreState.openTabs = [
        { id: '/proj/note.md', path: '/proj/note.md', name: 'note.md', isDirty: false },
      ];

      render(<MarkdownEditor content="# Hello" filePath="/proj/note.md" onChange={vi.fn()} />);

      await vi.waitFor(() => {
        expect(mockStoreState.loadBlame).toHaveBeenCalledWith('/proj', 'note.md');
      });
    });
  });
});
