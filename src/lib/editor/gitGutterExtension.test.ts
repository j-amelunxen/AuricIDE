import { describe, expect, it } from 'vitest';
import {
  AddedMarker,
  ModifiedMarker,
  DeletedMarker,
  gitChanges,
  gitGutterExtension,
  createGitGutter,
  type LineChange,
  type LineChangeType,
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
});
