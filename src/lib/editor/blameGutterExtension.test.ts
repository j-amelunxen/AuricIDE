import { describe, expect, it, vi } from 'vitest';
import type { BlameHunk } from '@/lib/tauri/git';
import {
  BlameBarMarker,
  BlameStartMarker,
  blameAnnotationForLine,
  createBlameGutter,
} from './blameGutterExtension';

const hunk: BlameHunk = {
  oid: 'abc123def4567890',
  author: 'Ada Lovelace',
  timestamp: '2026-08-14 10:00:00',
  summary: 'fix the thing',
  startLine: 4,
  lineCount: 3,
};

describe('blameGutterExtension', () => {
  it('places a text marker on the hunk start line', () => {
    const annotation = blameAnnotationForLine([hunk], 4);
    expect(annotation).toEqual({
      kind: 'start',
      text: 'abc123d Ada Lovelace',
      title: 'fix the thing 2026-08-14 10:00:00',
    });
  });

  it('places a bar, not text, on continuation lines', () => {
    expect(blameAnnotationForLine([hunk], 5)).toEqual({ kind: 'bar' });
    expect(blameAnnotationForLine([hunk], 6)).toEqual({ kind: 'bar' });
  });

  it('returns nothing outside a hunk or when there are no hunks', () => {
    expect(blameAnnotationForLine([hunk], 3)).toBeNull();
    expect(blameAnnotationForLine([hunk], 7)).toBeNull();
    expect(blameAnnotationForLine([], 1)).toBeNull();
  });

  it('renders the start marker text and title', () => {
    const el = new BlameStartMarker('abc123d Ada', 'fix the thing 2026-08-14 10:00:00').toDOM();
    expect(el).toBeInstanceOf(HTMLElement);
    const node = el as HTMLElement;
    expect(node.textContent).toBe('abc123d Ada');
    expect(node.title).toBe('fix the thing 2026-08-14 10:00:00');
  });

  it('renders continuation as a 2px bar', () => {
    const el = new BlameBarMarker().toDOM() as HTMLElement;
    expect(el.style.width).toBe('2px');
    expect(el.style.height).toBe('100%');
  });

  it('createBlameGutter returns an extension array even with no hunks', () => {
    expect(createBlameGutter([], vi.fn()).length).toBeGreaterThan(0);
    expect(createBlameGutter([hunk]).length).toBeGreaterThan(0);
  });
});
