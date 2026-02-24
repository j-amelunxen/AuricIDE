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
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
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
import {
  wikiLinkCompletion,
  fileListFacet,
  headingProviderFacet,
} from '@/lib/editor/wikiLinkCompletionExtension';
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
  filePathsFacet,
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
  fileListForLintFacet,
  headingIndexForLintFacet,
  currentFilePathFacet,
} from '@/lib/editor/markdownLintExtension';
import { useStore } from '@/lib/store';

export type EditorCompartments = Record<string, Compartment>;

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
    case 'md':
    case 'markdown':
      return markdown({ base: markdownLanguage, codeLanguages: languages });
    default:
      return [];
  }
}

export function buildHeadingTitleIndex(): Map<string, string[]> {
  const state = useStore.getState();
  const result = new Map<string, string[]>();
  for (const [fp, headings] of state.headingIndex) {
    result.set(
      fp,
      headings.map((h) => h.title)
    );
  }
  return result;
}

export interface CreateEditorStateOptions {
  content: string;
  filePath?: string;
  projectFiles: string[];
  compartments: EditorCompartments;
  onChange?: (content: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onUpdate?: (update: ViewUpdate) => void;
}

export function createEditorState({
  content,
  filePath,
  projectFiles,
  compartments,
  onUpdate,
}: CreateEditorStateOptions) {
  const isMarkdown = !filePath || filePath.endsWith('.md') || filePath.endsWith('.markdown');
  const store = useStore.getState();

  const extensions = [
    auricTheme,
    auricHighlightStyle,
    lineNumbers(),
    history(),
    compartments.language.of(getLanguageExtension(filePath)),
    compartments.nlp.of(isMarkdown ? nlpHighlightExtension : []),
    compartments.deepNlp.of(isMarkdown && store.enableDeepNlp ? deepHighlightExtension : []),
    compartments.mermaid.of(isMarkdown ? mermaidWidgetExtension : []),
    compartments.wikiLink.of(isMarkdown ? wikiLinkExtension : []),
    compartments.brokenLinks.of(
      isMarkdown ? [...wikiLinkBrokenExtension, brokenLinksSetFacet.of(new Set())] : []
    ),
    compartments.fold.of(isMarkdown ? markdownFoldExtension : []),
    compartments.filePaths.of(filePathsFacet.of(projectFiles)),
    compartments.wikiLinkCompletion.of(isMarkdown ? fileListFacet.of([]) : []),
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
    compartments.lint.of(
      isMarkdown
        ? [
            markdownLintExtension,
            lintConfigFacet.of(store.lintConfig),
            fileListForLintFacet.of(store.allFilePaths),
            headingIndexForLintFacet.of(new Map()),
            currentFilePathFacet.of(filePath ?? ''),
          ]
        : []
    ),
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
