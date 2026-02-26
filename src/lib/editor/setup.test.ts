import { describe, expect, it, vi } from 'vitest';

// Mock heavy editor dependencies so this test file stays fast
vi.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ['markdown-ext'],
  markdownLanguage: {},
}));
vi.mock('@codemirror/language-data', () => ({ languages: [] }));
vi.mock('@codemirror/lang-javascript', () => ({
  javascript: (opts?: unknown) => ['js-ext', opts],
}));
vi.mock('@codemirror/lang-rust', () => ({ rust: () => ['rust-ext'] }));
vi.mock('@codemirror/lang-python', () => ({ python: () => ['python-ext'] }));
vi.mock('@codemirror/lang-html', () => ({ html: () => ['html-ext'] }));
vi.mock('@codemirror/lang-css', () => ({ css: () => ['css-ext'] }));
vi.mock('@codemirror/lang-json', () => ({
  json: () => ['json-ext'],
  jsonParseLinter: () => () => [],
}));
vi.mock('@codemirror/lang-xml', () => ({ xml: () => ['xml-ext'] }));
vi.mock('@codemirror/lang-yaml', () => ({ yaml: () => ['yaml-ext'] }));

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({
      headingIndex: new Map(),
      lintConfig: { enabled: true, disabledRules: new Set() },
      allFilePaths: [],
      customSlashCommands: [],
      enableDeepNlp: false,
      setDiagnostics: vi.fn(),
    })),
  }),
}));

// Stub all the editor extensions that pull in heavy deps
vi.mock('@/lib/editor/auricTheme', () => ({ auricTheme: [], auricHighlightStyle: [] }));
vi.mock('@/lib/editor/nlpHighlightExtension', () => ({ nlpHighlightExtension: [] }));
vi.mock('@/lib/nlp/deepHighlightExtension', () => ({ deepHighlightExtension: [] }));
vi.mock('@/lib/editor/mermaidWidgetExtension', () => ({ mermaidWidgetExtension: [] }));
vi.mock('@/lib/editor/wikiLinkExtension', () => ({ wikiLinkExtension: [] }));
vi.mock('@/lib/editor/wikiLinkBrokenExtension', () => ({
  brokenLinksSetFacet: { of: () => [] },
  wikiLinkBrokenExtension: [],
}));
vi.mock('@/lib/editor/wikiLinkCompletionExtension', () => ({
  wikiLinkCompletion: () => null,
  fileListFacet: { of: () => [] },
  headingProviderFacet: { of: () => [] },
}));
vi.mock('@/lib/editor/markdownFoldExtension', () => ({ markdownFoldExtension: [] }));
vi.mock('@/lib/editor/markdownCompletionSource', () => ({
  codeFenceLanguageSource: () => null,
  headingLevelSource: () => null,
  linkTargetSource: () => null,
  imageTargetSource: () => null,
  filePathsFacet: { of: () => [] },
}));
vi.mock('@/lib/editor/wikiLinkHoverExtension', () => ({
  wikiLinkHoverExtension: [],
  previewFetcherFacet: { of: () => [] },
  navigateCallbackFacet: { of: () => [] },
}));
vi.mock('@/lib/editor/renameHeadingExtension', () => ({
  renameHeadingExtension: [],
  renameHeadingCallbackFacet: { of: () => [] },
}));
vi.mock('@/lib/editor/findReferencesExtension', () => ({
  findReferencesKeymap: [],
  showReferencesFacet: { of: () => [] },
}));
vi.mock('@/lib/editor/slashCommandSource', () => ({
  slashCommandSource: () => null,
  slashCommandsFacet: { of: () => [] },
  slashCommandRenderOption: { position: 50, render: () => null },
  mergeSlashCommands: (d: unknown[]) => d,
  slashCommands: [],
}));
vi.mock('@/lib/editor/markdownLintExtension', () => ({
  markdownLintExtension: [],
  lintConfigFacet: { of: () => [] },
  fileListForLintFacet: { of: () => [] },
  headingIndexForLintFacet: { of: () => [] },
  currentFilePathFacet: { of: () => [] },
}));
vi.mock('@/lib/editor/jsonLintExtension', () => ({
  jsonLintExtension: ['json-lint-ext'],
  currentFilePathFacetJson: { of: () => [] },
}));
vi.mock('@/lib/editor/xmlLintExtension', () => ({
  xmlLintExtension: ['xml-lint-ext'],
  currentFilePathFacetXml: { of: () => [] },
}));
vi.mock('@/lib/editor/yamlLintExtension', () => ({
  yamlLintExtension: ['yaml-lint-ext'],
  currentFilePathFacetYaml: { of: () => [] },
}));
vi.mock('@codemirror/autocomplete', () => ({
  autocompletion: () => [],
  completionKeymap: [],
}));
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
vi.mock('@codemirror/lint', () => ({
  lintKeymap: [],
  linter: () => [],
  lintGutter: () => [],
}));
vi.mock('@codemirror/view', () => ({
  EditorView: { lineWrapping: [], updateListener: { of: () => [] } },
  keymap: { of: () => [] },
  lineNumbers: () => [],
}));
vi.mock('@codemirror/state', () => ({
  EditorState: { create: (cfg: unknown) => cfg },
  Compartment: class {
    of() {
      return [];
    }
    reconfigure() {
      return [];
    }
  },
  Facet: { define: () => ({ of: () => [] }) },
}));

import { getLanguageExtension, getLintableFileType } from './setup';

describe('getLanguageExtension', () => {
  it('returns markdown for .md files', () => {
    const ext = getLanguageExtension('readme.md');
    expect(ext).toEqual(['markdown-ext']);
  });

  it('returns markdown for .markdown files', () => {
    const ext = getLanguageExtension('notes.markdown');
    expect(ext).toEqual(['markdown-ext']);
  });

  it('returns markdown when no path given', () => {
    const ext = getLanguageExtension();
    expect(ext).toEqual(['markdown-ext']);
  });

  it('returns javascript for .js files', () => {
    const ext = getLanguageExtension('app.js');
    expect(ext).toBeDefined();
  });

  it('returns typescript for .ts files', () => {
    const ext = getLanguageExtension('app.ts');
    expect(ext).toBeDefined();
  });

  it('returns rust for .rs files', () => {
    const ext = getLanguageExtension('main.rs');
    expect(ext).toEqual(['rust-ext']);
  });

  it('returns python for .py files', () => {
    const ext = getLanguageExtension('script.py');
    expect(ext).toEqual(['python-ext']);
  });

  it('returns html for .html files', () => {
    const ext = getLanguageExtension('index.html');
    expect(ext).toEqual(['html-ext']);
  });

  it('returns css for .css files', () => {
    const ext = getLanguageExtension('styles.css');
    expect(ext).toEqual(['css-ext']);
  });

  it('returns json for .json files', () => {
    const ext = getLanguageExtension('config.json');
    expect(ext).toEqual(['json-ext']);
  });

  it('returns xml for .xml files', () => {
    const ext = getLanguageExtension('data.xml');
    expect(ext).toEqual(['xml-ext']);
  });

  it('returns xml for .svg files', () => {
    const ext = getLanguageExtension('icon.svg');
    expect(ext).toEqual(['xml-ext']);
  });

  it('returns xml for .xsl files', () => {
    const ext = getLanguageExtension('transform.xsl');
    expect(ext).toEqual(['xml-ext']);
  });

  it('returns xml for .xslt files', () => {
    const ext = getLanguageExtension('transform.xslt');
    expect(ext).toEqual(['xml-ext']);
  });

  it('returns xml for .xhtml files', () => {
    const ext = getLanguageExtension('page.xhtml');
    expect(ext).toEqual(['xml-ext']);
  });

  it('returns yaml for .yaml files', () => {
    const ext = getLanguageExtension('config.yaml');
    expect(ext).toEqual(['yaml-ext']);
  });

  it('returns yaml for .yml files', () => {
    const ext = getLanguageExtension('docker-compose.yml');
    expect(ext).toEqual(['yaml-ext']);
  });

  it('returns empty array for unknown extension', () => {
    const ext = getLanguageExtension('binary.exe');
    expect(ext).toEqual([]);
  });
});

describe('getLintableFileType', () => {
  it('returns markdown for .md files', () => {
    expect(getLintableFileType('readme.md')).toBe('markdown');
  });

  it('returns markdown for .markdown files', () => {
    expect(getLintableFileType('notes.markdown')).toBe('markdown');
  });

  it('returns markdown when no path given', () => {
    expect(getLintableFileType()).toBe('markdown');
  });

  it('returns markdown when undefined path given', () => {
    expect(getLintableFileType(undefined)).toBe('markdown');
  });

  it('returns json for .json files', () => {
    expect(getLintableFileType('config.json')).toBe('json');
  });

  it('returns xml for .xml files', () => {
    expect(getLintableFileType('data.xml')).toBe('xml');
  });

  it('returns xml for .svg files', () => {
    expect(getLintableFileType('icon.svg')).toBe('xml');
  });

  it('returns xml for .xsl files', () => {
    expect(getLintableFileType('transform.xsl')).toBe('xml');
  });

  it('returns xml for .xslt files', () => {
    expect(getLintableFileType('transform.xslt')).toBe('xml');
  });

  it('returns xml for .xhtml files', () => {
    expect(getLintableFileType('page.xhtml')).toBe('xml');
  });

  it('returns yaml for .yaml files', () => {
    expect(getLintableFileType('config.yaml')).toBe('yaml');
  });

  it('returns yaml for .yml files', () => {
    expect(getLintableFileType('docker-compose.yml')).toBe('yaml');
  });

  it('returns none for .ts files', () => {
    expect(getLintableFileType('app.ts')).toBe('none');
  });

  it('returns none for unknown extensions', () => {
    expect(getLintableFileType('binary.exe')).toBe('none');
  });

  it('returns none for .py files', () => {
    expect(getLintableFileType('script.py')).toBe('none');
  });
});
