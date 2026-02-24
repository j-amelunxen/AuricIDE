import { type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { parseWikiLinks } from './wikiLinkParser';

const wikiLinkMark = Decoration.mark({ class: 'syntax-wikilink' });

class WikiLinkPluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }

  private buildDecorations(view: EditorView): DecorationSet {
    const ranges: { from: number; to: number }[] = [];

    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      const links = parseWikiLinks(text);

      for (const link of links) {
        ranges.push({
          from: from + link.from,
          to: from + link.to,
        });
      }
    }

    ranges.sort((a, b) => a.from - b.from);

    return Decoration.set(ranges.map((r) => wikiLinkMark.range(r.from, r.to)));
  }
}

export const wikiLinkPlugin = ViewPlugin.fromClass(WikiLinkPluginValue, {
  decorations: (value) => value.decorations,
});

export const wikiLinkExtension: Extension[] = [wikiLinkPlugin];
