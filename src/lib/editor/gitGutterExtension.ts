import { Facet, type Extension } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';

export type LineChangeType = 'added' | 'modified' | 'deleted';

export interface LineChange {
  line: number; // 1-based line number
  type: LineChangeType;
}

const COLORS: Record<LineChangeType, string> = {
  added: '#4ade80',
  modified: '#fbbf24',
  deleted: '#f87171',
};

function createMarkerElement(color: string): HTMLElement {
  const el = document.createElement('div');
  el.style.backgroundColor = color;
  el.style.width = '3px';
  el.style.height = '100%';
  return el;
}

export class AddedMarker extends GutterMarker {
  toDOM(): Node {
    return createMarkerElement(COLORS.added);
  }
}

export class ModifiedMarker extends GutterMarker {
  toDOM(): Node {
    return createMarkerElement(COLORS.modified);
  }
}

export class DeletedMarker extends GutterMarker {
  toDOM(): Node {
    return createMarkerElement(COLORS.deleted);
  }
}

const markerByType: Record<LineChangeType, GutterMarker> = {
  added: new AddedMarker(),
  modified: new ModifiedMarker(),
  deleted: new DeletedMarker(),
};

export const gitChanges = Facet.define<LineChange[], LineChange[]>({
  combine: (values: readonly LineChange[][]): LineChange[] => values.flat(),
});

export const gitGutterExtension: Extension = gutter({
  class: 'cm-git-gutter',
  lineMarker(view, line) {
    const changes = view.state.facet(gitChanges);
    const doc = view.state.doc;
    const lineNumber = doc.lineAt(line.from).number;
    const change = changes.find((c) => c.line === lineNumber);
    if (change) {
      return markerByType[change.type];
    }
    return null;
  },
});

export function createGitGutter(changes: LineChange[]): Extension[] {
  return [gitChanges.of(changes), gitGutterExtension];
}

/** Structural subset of DiffViewer's DiffLine — avoids a lib -> app import. */
export interface DiffLineLike {
  type: 'added' | 'removed' | 'context' | 'header';
  newLineNo: number | null;
}

/**
 * Turns a parsed unified diff into per-line gutter markers. A removed/added
 * run is a single edit: lines pair up 1:1 as modifications, any surplus
 * added lines are pure additions, and a surplus of removed lines with no
 * added counterpart is a pure deletion — anchored to the next surviving
 * line in the new file, since there's no line of its own to mark.
 */
export function diffToLineChanges(diffLines: DiffLineLike[]): LineChange[] {
  const changes: LineChange[] = [];
  let i = 0;
  let lastNewLine = 0;

  while (i < diffLines.length) {
    const cur = diffLines[i];
    if (cur.type !== 'removed' && cur.type !== 'added') {
      if (cur.newLineNo !== null) lastNewLine = cur.newLineNo;
      i++;
      continue;
    }

    const removed: DiffLineLike[] = [];
    const added: DiffLineLike[] = [];
    while (
      i < diffLines.length &&
      (diffLines[i].type === 'removed' || diffLines[i].type === 'added')
    ) {
      (diffLines[i].type === 'removed' ? removed : added).push(diffLines[i]);
      i++;
    }

    const pairCount = Math.min(removed.length, added.length);
    added.forEach((l, idx) => {
      if (l.newLineNo !== null) {
        changes.push({ line: l.newLineNo, type: idx < pairCount ? 'modified' : 'added' });
        lastNewLine = l.newLineNo;
      }
    });

    if (removed.length > added.length) {
      const anchor = diffLines[i]?.newLineNo ?? lastNewLine + 1;
      changes.push({ line: anchor, type: 'deleted' });
    }
  }

  return changes;
}
