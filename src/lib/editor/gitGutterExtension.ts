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
