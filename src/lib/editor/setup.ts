import { isMarkdownPath } from '@/lib/markdown/markdownPath';
import { type ViewUpdate, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { editorHistory } from './externalContentSync';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
import { auricHighlightStyle, auricTheme } from '@/lib/editor/auricTheme';
import { nlpHighlightExtension } from '@/lib/editor/nlpHighlightExtension';
import { deepHighlightExtension } from '@/lib/nlp/deepHighlightExtension';
import { mermaidWidgetExtension } from '@/lib/editor/mermaidWidgetExtension';
import { wikiLinkExtension } from '@/lib/editor/wikiLinkExtension';
import { brokenLinksSetFacet, wikiLinkBrokenExtension } from '@/lib/editor/wikiLinkBrokenExtension';
import { markdownFoldExtension } from '@/lib/editor/markdownFoldExtension';
import { wikiLinkCompletion, headingProviderFacet } from '@/lib/editor/wikiLinkCompletionExtension';
import { currentFilePathFacet, projectFilesFacet } from '@/lib/editor/editorFacets';
import {
  slashCommandSource,
  slashCommandsFacet,
  slashCommandRenderOption,
  mergeSlashCommands,
  slashCommands as defaultSlashCommands,
} from '@/lib/editor/slashCommandSource';
import {
  codeFenceLanguageSource,
  headingLevelSource,
  linkTargetSource,
  imageTargetSource,
} from '@/lib/editor/markdownCompletionSource';
import {
  wikiLinkHoverExtension,
  previewFetcherFacet,
  navigateCallbackFacet,
} from '@/lib/editor/wikiLinkHoverExtension';
import {
  renameHeadingExtension,
  renameHeadingCallbackFacet,
} from '@/lib/editor/renameHeadingExtension';
import { findReferencesKeymap, showReferencesFacet } from '@/lib/editor/findReferencesExtension';
import {
  markdownLintExtension,
  lintConfigFacet,
  headingIndexForLintFacet,
} from '@/lib/editor/markdownLintExtension';
import { jsonLintExtension } from '@/lib/editor/jsonLintExtension';
import { xmlLintExtension } from '@/lib/editor/xmlLintExtension';
import { yamlLintExtension } from '@/lib/editor/yamlLintExtension';
import { createGitGutter } from '@/lib/editor/gitGutterExtension';
import { useStore } from '@/lib/store';

export type EditorCompartments = Record<string, Compartment>;

const shellLanguage = StreamLanguage.define(shell);
const dockerfileLanguage = StreamLanguage.define(dockerFile);
const groovyLanguage = StreamLanguage.define(groovy);

export function getLanguageExtension(path?: string) {
  if (!path) return markdown({ base: markdownLanguage, codeLanguages: languages });
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
      return javascript();
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true });
    case 'rs':
      return rust();
    case 'py':
      return python();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'json':
      return json();
    case 'xml':
    case 'xsl':
    case 'xslt':
    case 'svg':
    case 'xhtml':
      return xml();
    case 'yaml':
    case 'yml':
      return yaml();
    case 'sh':
    case 'bash':
    case 'ksh':
    case 'zsh':
      return shellLanguage;
    case 'dockerfile':
      return dockerfileLanguage;
    case 'jenkinsfile':
    case 'groovy':
    case 'gradle':
      return groovyLanguage;
    case 'md':
    case 'markdown':
      return markdown({ base: markdownLanguage, codeLanguages: languages });
    default:
      return [];
  }
}

export type LintableFileType = 'markdown' | 'json' | 'xml' | 'yaml' | 'none';

export function getLintableFileType(filePath?: string): LintableFileType {
  if (!filePath) return 'markdown';
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'json':
      return 'json';
    case 'xml':
    case 'xsl':
    case 'xslt':
    case 'svg':
    case 'xhtml':
      return 'xml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    default:
      return 'none';
  }
}

/**
 * The lint wiring for a file: the linter for its type plus the facets it
 * reads. The one definition for both the editor's first state and every
 * reconfiguration on a file switch or a lint setting change.
 */
export function lintExtensionFor(filePath: string | undefined) {
  const forFile = currentFilePathFacet.of(filePath ?? '');
  switch (getLintableFileType(filePath)) {
    case 'markdown':
      return [
        markdownLintExtension,
        lintConfigFacet.of(useStore.getState().lintConfig),
        headingIndexForLintFacet.of(buildHeadingTitleIndex()),
        forFile,
      ];
    case 'json':
      return [jsonLintExtension, forFile];
    case 'xml':
      return [xmlLintExtension, forFile];
    case 'yaml':
      return [yamlLintExtension, forFile];
    default:
      return [];
  }
}

let headingTitleCache: {
  source: ReturnType<typeof useStore.getState>['linkIndex'];
  titles: Map<string, string[]>;
} | null = null;

/** Heading titles per file for the lint facet, rebuilt only when the index is replaced. */
export function buildHeadingTitleIndex(): Map<string, string[]> {
  const { linkIndex } = useStore.getState();
  if (headingTitleCache && headingTitleCache.source === linkIndex) return headingTitleCache.titles;
  const titles = new Map<string, string[]>();
  for (const [fp, entry] of linkIndex) {
    titles.set(
      fp,
      entry.headings.map((h) => h.title)
    );
  }
  headingTitleCache = { source: linkIndex, titles };
  return titles;
}

export interface CreateEditorStateOptions {
  content: string;
  filePath?: string;
  compartments: EditorCompartments;
  onUpdate?: (update: ViewUpdate) => void;
}

export function createEditorState({
  content,
  filePath,
  compartments,
  onUpdate,
}: CreateEditorStateOptions) {
  const isMarkdown = !filePath || isMarkdownPath(filePath);
  const store = useStore.getState();

  const extensions = [
    auricTheme,
    auricHighlightStyle,
    lineNumbers(),
    editorHistory(),
    compartments.language.of(getLanguageExtension(filePath)),
    compartments.nlp.of(isMarkdown ? nlpHighlightExtension : []),
    compartments.deepNlp.of(isMarkdown && store.enableDeepNlp ? deepHighlightExtension : []),
    compartments.mermaid.of(isMarkdown ? mermaidWidgetExtension : []),
    compartments.wikiLink.of(isMarkdown ? wikiLinkExtension : []),
    compartments.brokenLinks.of(
      isMarkdown ? [...wikiLinkBrokenExtension, brokenLinksSetFacet.of(new Set())] : []
    ),
    compartments.fold.of(isMarkdown ? markdownFoldExtension : []),
    compartments.filePaths.of(projectFilesFacet.of(store.allFilePaths)),
    compartments.headingProvider.of(isMarkdown ? headingProviderFacet.of(() => []) : []),
    compartments.hover.of(
      isMarkdown
        ? [
            ...wikiLinkHoverExtension,
            previewFetcherFacet.of(() => null),
            navigateCallbackFacet.of(() => {}),
          ]
        : []
    ),
    compartments.slashCmds.of(
      isMarkdown
        ? slashCommandsFacet.of(mergeSlashCommands(defaultSlashCommands, store.customSlashCommands))
        : []
    ),
    compartments.autocomplete.of(
      isMarkdown
        ? autocompletion({
            override: [
              slashCommandSource,
              codeFenceLanguageSource,
              headingLevelSource,
              linkTargetSource,
              imageTargetSource,
              wikiLinkCompletion,
            ],
            activateOnTyping: true,
            addToOptions: [slashCommandRenderOption],
          })
        : []
    ),
    compartments.renameHeading.of(
      isMarkdown ? [renameHeadingExtension, renameHeadingCallbackFacet.of(() => {})] : []
    ),
    compartments.findReferences.of(isMarkdown ? showReferencesFacet.of(() => {}) : []),
    compartments.lint.of(lintExtensionFor(filePath)),
    compartments.gitGutter.of(createGitGutter([])),
    ...(compartments.blameGutter ? [compartments.blameGutter.of([])] : []),
    search({ top: true }),
    highlightSelectionMatches(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...findReferencesKeymap,
      ...lintKeymap,
    ]),
    EditorView.lineWrapping,
  ];

  if (onUpdate) {
    extensions.push(EditorView.updateListener.of(onUpdate));
  }

  return EditorState.create({
    doc: content,
    extensions,
  });
}
