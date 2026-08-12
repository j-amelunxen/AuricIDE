import { describe, expect, it } from 'vitest';
import {
  AddedMarker,
  ModifiedMarker,
  DeletedMarker,
  gitChanges,
  gitGutterExtension,
  createGitGutter,
  diffToLineChanges,
  type LineChange,
  type LineChangeType,
  type DiffLineLike,
} from './gitGutterExtension';

describe('gitGutterExtension', () => {
  describe('LineChangeType', () => {
    it('supports added, modified, and deleted types', () => {
      const types: LineChangeType[] = ['added', 'modified', 'deleted'];
      expect(types).toHaveLength(3);
    });
  });

  describe('AddedMarker', () => {
    it('creates a DOM element with green (#4ade80) background', () => {
      const marker = new AddedMarker();
      const el = marker.toDOM();
      expect(el).toBeInstanceOf(HTMLElement);
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      expect(style).toContain('background-color: rgb(74, 222, 128)');
    });

    it('creates a 3px wide element', () => {
      const marker = new AddedMarker();
      const el = marker.toDOM() as HTMLElement;
      expect(el.style.width).toBe('3px');
    });
  });

  describe('ModifiedMarker', () => {
    it('creates a DOM element with amber (#fbbf24) background', () => {
      const marker = new ModifiedMarker();
      const el = marker.toDOM();
      expect(el).toBeInstanceOf(HTMLElement);
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      expect(style).toContain('background-color: rgb(251, 191, 36)');
    });

    it('creates a 3px wide element', () => {
      const marker = new ModifiedMarker();
      const el = marker.toDOM() as HTMLElement;
      expect(el.style.width).toBe('3px');
    });
  });

  describe('DeletedMarker', () => {
    it('creates a DOM element with red (#f87171) background', () => {
      const marker = new DeletedMarker();
      const el = marker.toDOM();
      expect(el).toBeInstanceOf(HTMLElement);
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      expect(style).toContain('background-color: rgb(248, 113, 113)');
    });

    it('creates a 3px wide element', () => {
      const marker = new DeletedMarker();
      const el = marker.toDOM() as HTMLElement;
      expect(el.style.width).toBe('3px');
    });
  });

  describe('Marker toDOM element styling', () => {
    it('renders markers with full height', () => {
      const addedEl = new AddedMarker().toDOM() as HTMLElement;
      const modifiedEl = new ModifiedMarker().toDOM() as HTMLElement;
      const deletedEl = new DeletedMarker().toDOM() as HTMLElement;

      expect(addedEl.style.height).toBe('100%');
      expect(modifiedEl.style.height).toBe('100%');
      expect(deletedEl.style.height).toBe('100%');
    });
  });

  describe('gitChanges Facet', () => {
    it('is defined', () => {
      expect(gitChanges).toBeDefined();
    });
  });

  describe('gitGutterExtension', () => {
    it('is defined as a valid Extension', () => {
      expect(gitGutterExtension).toBeDefined();
    });
  });

  describe('createGitGutter', () => {
    it('returns a valid Extension array', () => {
      const changes: LineChange[] = [
        { line: 1, type: 'added' },
        { line: 3, type: 'modified' },
      ];
      const extensions = createGitGutter(changes);
      expect(extensions).toBeDefined();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
    });

    it('handles empty changes array gracefully', () => {
      const extensions = createGitGutter([]);
      expect(extensions).toBeDefined();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
    });

    it('handles all three change types', () => {
      const changes: LineChange[] = [
        { line: 1, type: 'added' },
        { line: 2, type: 'modified' },
        { line: 3, type: 'deleted' },
      ];
      const extensions = createGitGutter(changes);
      expect(extensions).toBeDefined();
      expect(Array.isArray(extensions)).toBe(true);
    });
  });

  describe('diffToLineChanges', () => {
    const line = (type: DiffLineLike['type'], newLineNo: number | null = null): DiffLineLike => ({
      type,
      newLineNo,
    });

    it('marks pure additions as added', () => {
      const diff: DiffLineLike[] = [line('header'), line('added', 5), line('added', 6)];
      expect(diffToLineChanges(diff)).toEqual([
        { line: 5, type: 'added' },
        { line: 6, type: 'added' },
      ]);
    });

    it('pairs equal-count removed/added runs as modified', () => {
      const diff: DiffLineLike[] = [
        line('context', 1),
        line('removed'),
        line('removed'),
        line('added', 2),
        line('added', 3),
        line('context', 4),
      ];
      expect(diffToLineChanges(diff)).toEqual([
        { line: 2, type: 'modified' },
        { line: 3, type: 'modified' },
      ]);
    });

    it('treats extra added lines beyond the removed count as added', () => {
      const diff: DiffLineLike[] = [
        line('removed'),
        line('added', 10),
        line('added', 11),
        line('added', 12),
      ];
      expect(diffToLineChanges(diff)).toEqual([
        { line: 10, type: 'modified' },
        { line: 11, type: 'added' },
        { line: 12, type: 'added' },
      ]);
    });

    it('anchors a pure deletion to the next line in the new file', () => {
      const diff: DiffLineLike[] = [
        line('context', 4),
        line('removed'),
        line('removed'),
        line('context', 5),
      ];
      expect(diffToLineChanges(diff)).toEqual([{ line: 5, type: 'deleted' }]);
    });

    it('anchors a deletion at end-of-file to the last added line + 1', () => {
      const diff: DiffLineLike[] = [
        line('context', 5),
        line('added', 9),
        line('context', 10),
        line('removed'),
        line('removed'),
      ];
      expect(diffToLineChanges(diff)).toEqual([
        { line: 9, type: 'added' },
        { line: 11, type: 'deleted' },
      ]);
    });

    it('falls back to line 1 for a deletion with nothing before or after it', () => {
      const diff: DiffLineLike[] = [line('removed')];
      expect(diffToLineChanges(diff)).toEqual([{ line: 1, type: 'deleted' }]);
    });

    it('handles multiple change blocks separated by context lines', () => {
      const diff: DiffLineLike[] = [
        line('context', 1),
        line('added', 2),
        line('context', 3),
        line('removed'),
        line('context', 4),
      ];
      expect(diffToLineChanges(diff)).toEqual([
        { line: 2, type: 'added' },
        { line: 4, type: 'deleted' },
      ]);
    });

    it('returns an empty array for a diff with no changes', () => {
      const diff: DiffLineLike[] = [line('context', 1), line('header')];
      expect(diffToLineChanges(diff)).toEqual([]);
    });
  });
});
