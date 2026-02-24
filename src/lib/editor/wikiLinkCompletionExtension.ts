import { Facet, type Extension } from '@codemirror/state';
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from '@codemirror/autocomplete';
import fuzzysort from 'fuzzysort';
import type { HeadingRange } from '@/lib/editor/markdownHeadingParser';

// Facet to provide file paths from React
export const fileListFacet = Facet.define<string[], string[]>({
  combine: (values) => values[0] ?? [],
});

// Facet to provide headings for a given file path (or '' for current file)
export type HeadingProvider = (filePath: string) => HeadingRange[];

export const headingProviderFacet = Facet.define<HeadingProvider, HeadingProvider>({
  combine: (values) => values[0] ?? (() => []),
});

export function wikiLinkCompletion(context: CompletionContext): CompletionResult | null {
  // Look for [[ before cursor with no ]] between [[ and cursor
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);

  const openIdx = textBefore.lastIndexOf('[[');
  if (openIdx === -1) return null;

  // Check there's no ]] after the [[
  const afterOpen = textBefore.slice(openIdx + 2);
  if (afterOpen.includes(']]')) return null;

  // Check for heading mode: does afterOpen contain a #?
  const hashIdx = afterOpen.indexOf('#');
  if (hashIdx !== -1) {
    return headingCompletion(context, afterOpen, hashIdx, line.from + openIdx + 2);
  }

  return fileCompletion(context, afterOpen, line.from + openIdx + 2);
}

function headingCompletion(
  context: CompletionContext,
  afterOpen: string,
  hashIdx: number,
  wikiLinkContentFrom: number
): CompletionResult | null {
  const pagePart = afterOpen.slice(0, hashIdx);
  const headingQuery = afterOpen.slice(hashIdx + 1);
  const from = wikiLinkContentFrom + hashIdx + 1;

  const headingProvider = context.state.facet(headingProviderFacet);
  const headings = headingProvider(pagePart);

  const items = headings.map((h) => ({
    title: h.title,
    level: h.level,
  }));

  let filtered: { title: string; level: number }[];
  if (headingQuery.length === 0) {
    filtered = items.slice(0, 50);
  } else {
    const results = fuzzysort.go(headingQuery, items, { key: 'title', limit: 50 });
    filtered = results.map((r) => r.obj);
  }

  const options: Completion[] = filtered.map((item) => ({
    label: item.title,
    detail: `H${item.level}`,
    apply: (view, completion, from, to) => {
      view.dispatch({
        changes: { from, to, insert: `${item.title}]]` },
      });
    },
  }));

  return {
    from,
    options,
    filter: false,
  };
}

function fileCompletion(
  context: CompletionContext,
  query: string,
  from: number
): CompletionResult | null {
  const filePaths = context.state.facet(fileListFacet);

  // Extract display names (basenames without extension for .md files)
  const items = filePaths.map((p) => {
    const base = p.split('/').pop() ?? p;
    const display = base.endsWith('.md') ? base.slice(0, -3) : base;
    return { path: p, display, base };
  });

  let filtered: { path: string; display: string; base: string }[];
  if (query.length === 0) {
    filtered = items.slice(0, 50); // Show first 50 when no query
  } else {
    const results = fuzzysort.go(query, items, { key: 'display', limit: 50 });
    filtered = results.map((r) => r.obj);
  }

  const options: Completion[] = filtered.map((item) => ({
    label: item.display,
    detail: item.base !== item.display ? item.base : undefined,
    apply: (view, completion, from, to) => {
      // Insert the display text + closing ]]
      view.dispatch({
        changes: { from, to, insert: `${item.display}]]` },
      });
    },
  }));

  return {
    from,
    options,
    filter: false, // We handle filtering with fuzzysort
  };
}

export const wikiLinkCompletionExtension: Extension = autocompletion({
  override: [wikiLinkCompletion],
  activateOnTyping: true,
});
