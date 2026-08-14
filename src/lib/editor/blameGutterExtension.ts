import { Facet, type Extension } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import type { BlameHunk } from '@/lib/tauri/git';

export type BlameAnnotation = { kind: 'start'; text: string; title: string } | { kind: 'bar' };

export function blameLabel(hunk: BlameHunk): string {
  return `${hunk.oid.slice(0, 7)} ${hunk.author}`;
}

export function blameTitle(hunk: BlameHunk): string {
  return `${hunk.summary} ${hunk.timestamp}`;
}

export function hunkContainingLine(hunks: BlameHunk[], lineNumber: number): BlameHunk | null {
  return (
    hunks.find(
      (hunk) => lineNumber >= hunk.startLine && lineNumber < hunk.startLine + hunk.lineCount
    ) ?? null
  );
}

export function blameAnnotationForLine(
  hunks: BlameHunk[],
  lineNumber: number
): BlameAnnotation | null {
  const hunk = hunkContainingLine(hunks, lineNumber);
  if (!hunk) return null;
  if (lineNumber === hunk.startLine) {
    return { kind: 'start', text: blameLabel(hunk), title: blameTitle(hunk) };
  }
  return { kind: 'bar' };
}

const BLAME_INK = '#94a3b8';

export class BlameStartMarker extends GutterMarker {
  constructor(
    readonly text: string,
    readonly title: string
  ) {
    super();
  }

  eq(other: BlameStartMarker): boolean {
    return this.text === other.text && this.title === other.title;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.textContent = this.text;
    el.title = this.title;
    el.style.color = BLAME_INK;
    el.style.fontSize = '10px';
    el.style.lineHeight = '1.2';
    el.style.maxWidth = '9em';
    el.style.overflow = 'hidden';
    el.style.textOverflow = 'ellipsis';
    el.style.whiteSpace = 'nowrap';
    el.style.paddingLeft = '4px';
    el.style.cursor = 'pointer';
    return el;
  }
}

export class BlameBarMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.style.backgroundColor = BLAME_INK;
    el.style.width = '2px';
    el.style.height = '100%';
    el.style.marginLeft = '4px';
    return el;
  }
}

export const blameHunks = Facet.define<BlameHunk[], BlameHunk[]>({
  combine: (values) => values.flat(),
});

export function createBlameGutter(
  hunks: BlameHunk[],
  onHunkClick?: (hunk: BlameHunk) => void
): Extension[] {
  return [
    blameHunks.of(hunks),
    gutter({
      class: 'cm-blame-gutter',
      lineMarker(view, line) {
        const all = view.state.facet(blameHunks);
        const lineNumber = view.state.doc.lineAt(line.from).number;
        const annotation = blameAnnotationForLine(all, lineNumber);
        if (!annotation) return null;
        if (annotation.kind === 'start') {
          return new BlameStartMarker(annotation.text, annotation.title);
        }
        return new BlameBarMarker();
      },
      domEventHandlers: {
        click(view, line) {
          if (!onHunkClick) return false;
          const all = view.state.facet(blameHunks);
          const lineNumber = view.state.doc.lineAt(line.from).number;
          const hunk = hunkContainingLine(all, lineNumber);
          if (!hunk) return false;
          onHunkClick(hunk);
          return true;
        },
      },
    }),
  ];
}
