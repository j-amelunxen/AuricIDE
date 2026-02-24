import { Facet, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, type Tooltip } from '@codemirror/view';
import { parseWikiLinks } from './wikiLinkParser';

export type PreviewFetcher = (target: string) => { exists: boolean; preview: string } | null;
export type NavigateCallback = (target: string) => void;

export const previewFetcherFacet = Facet.define<PreviewFetcher, PreviewFetcher>({
  combine: (values) => values[0] ?? (() => null),
});

export const navigateCallbackFacet = Facet.define<NavigateCallback, NavigateCallback>({
  combine: (values) => values[0] ?? (() => {}),
});

function findLinkAtPos(view: EditorView, pos: number) {
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    const links = parseWikiLinks(text);
    for (const link of links) {
      const absFrom = from + link.from;
      const absTo = from + link.to;
      if (pos >= absFrom && pos <= absTo) {
        return { ...link, absFrom, absTo };
      }
    }
  }
  return null;
}

const wikiLinkHover = hoverTooltip((view, pos): Tooltip | null => {
  const link = findLinkAtPos(view, pos);
  if (!link) return null;

  const fetcher = view.state.facet(previewFetcherFacet);
  const info = fetcher(link.target);

  return {
    pos: link.absFrom,
    end: link.absTo,
    above: true,
    create() {
      const dom = document.createElement('div');
      dom.className = 'cm-wikilink-tooltip';

      const header = document.createElement('div');
      header.className = 'cm-wikilink-tooltip-header';
      header.textContent = link.display;

      const badge = document.createElement('span');
      badge.className = info?.exists
        ? 'cm-wikilink-tooltip-badge cm-wikilink-tooltip-badge-ok'
        : 'cm-wikilink-tooltip-badge cm-wikilink-tooltip-badge-broken';
      badge.textContent = info?.exists ? 'exists' : 'not found';
      header.appendChild(badge);

      dom.appendChild(header);

      const body = document.createElement('div');
      body.className = 'cm-wikilink-tooltip-body';
      body.textContent = info?.exists ? info.preview || 'Empty file' : 'File does not exist';
      dom.appendChild(body);

      const footer = document.createElement('div');
      footer.className = 'cm-wikilink-tooltip-footer';
      const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
      footer.textContent = `${isMac ? 'Cmd' : 'Ctrl'}+Click to open`;
      dom.appendChild(footer);

      return { dom };
    },
  };
});

// Click-to-navigate handler
const clickToNavigate = EditorView.domEventHandlers({
  click(event: MouseEvent, view: EditorView) {
    if (!(event.metaKey || event.ctrlKey)) return false;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;

    const link = findLinkAtPos(view, pos);
    if (!link) return false;

    const navigate = view.state.facet(navigateCallbackFacet);
    navigate(link.target);
    return true;
  },
});

export const wikiLinkHoverExtension: Extension[] = [wikiLinkHover, clickToNavigate];
