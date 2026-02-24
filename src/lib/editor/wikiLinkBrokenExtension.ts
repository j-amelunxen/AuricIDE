import { Facet, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { parseWikiLinks } from './wikiLinkParser';

// Facet to receive the set of broken target names from React
export const brokenLinksSetFacet = Facet.define<Set<string>, Set<string>>({
  combine: (values) => values[0] ?? new Set(),
});

const brokenMark = Decoration.mark({ class: 'syntax-wikilink-broken' });

class BrokenLinkPluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.startState.facet(brokenLinksSetFacet) !== update.state.facet(brokenLinksSetFacet)
    ) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const brokenSet = view.state.facet(brokenLinksSetFacet);
    if (brokenSet.size === 0) return Decoration.none;

    const ranges: { from: number; to: number }[] = [];

    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      const links = parseWikiLinks(text);

      for (const link of links) {
        if (brokenSet.has(link.target)) {
          ranges.push({
            from: from + link.from,
            to: from + link.to,
          });
        }
      }
    }

    ranges.sort((a, b) => a.from - b.from);
    return Decoration.set(ranges.map((r) => brokenMark.range(r.from, r.to)));
  }
}

export const brokenLinkPlugin = ViewPlugin.fromClass(BrokenLinkPluginValue, {
  decorations: (value) => value.decorations,
});

export const wikiLinkBrokenExtension: Extension[] = [brokenLinkPlugin];
