import { describe, expect, it, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createHeadingIndexSlice, type HeadingIndexSlice } from './headingIndexSlice';

function createTestStore() {
  return create<HeadingIndexSlice>()((...a) => ({
    ...createHeadingIndexSlice(...a),
  }));
}

describe('headingIndexSlice', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('initial state', () => {
    it('has empty headingIndex', () => {
      expect(store.getState().headingIndex.size).toBe(0);
    });
  });

  describe('updateHeadingsForFile', () => {
    it('extracts headings from markdown content', () => {
      store.getState().updateHeadingsForFile('/project/doc.md', '# Title\n\n## Section\n\nBody');
      const headings = store.getState().getHeadingsForFile('/project/doc.md');
      expect(headings).toHaveLength(2);
      expect(headings[0].title).toBe('Title');
      expect(headings[0].level).toBe(1);
      expect(headings[1].title).toBe('Section');
      expect(headings[1].level).toBe(2);
    });

    it('replaces headings on re-parse', () => {
      store.getState().updateHeadingsForFile('/project/doc.md', '# Old');
      expect(store.getState().getHeadingsForFile('/project/doc.md')).toHaveLength(1);

      store.getState().updateHeadingsForFile('/project/doc.md', '# New\n## Sub');
      const headings = store.getState().getHeadingsForFile('/project/doc.md');
      expect(headings).toHaveLength(2);
      expect(headings[0].title).toBe('New');
    });

    it('handles empty content', () => {
      store.getState().updateHeadingsForFile('/project/empty.md', '');
      expect(store.getState().getHeadingsForFile('/project/empty.md')).toEqual([]);
    });
  });

  describe('removeHeadingsForFile', () => {
    it('removes headings for a file', () => {
      store.getState().updateHeadingsForFile('/project/doc.md', '# Title');
      expect(store.getState().headingIndex.size).toBe(1);

      store.getState().removeHeadingsForFile('/project/doc.md');
      expect(store.getState().headingIndex.size).toBe(0);
    });

    it('does nothing for unknown file', () => {
      store.getState().removeHeadingsForFile('/project/unknown.md');
      expect(store.getState().headingIndex.size).toBe(0);
    });
  });

  describe('getHeadingsForFile', () => {
    it('returns empty array for unknown file', () => {
      expect(store.getState().getHeadingsForFile('/project/unknown.md')).toEqual([]);
    });
  });

  describe('getFilesWithHeading', () => {
    it('finds files containing a specific heading title', () => {
      store.getState().updateHeadingsForFile('/project/a.md', '# Introduction\n## Setup');
      store.getState().updateHeadingsForFile('/project/b.md', '# Getting Started\n## Introduction');
      store.getState().updateHeadingsForFile('/project/c.md', '# Other');

      const results = store.getState().getFilesWithHeading('Introduction');
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.filePath)).toContain('/project/a.md');
      expect(results.map((r) => r.filePath)).toContain('/project/b.md');
    });

    it('returns empty for non-existing heading', () => {
      store.getState().updateHeadingsForFile('/project/a.md', '# Title');
      expect(store.getState().getFilesWithHeading('Nonexistent')).toEqual([]);
    });

    it('matches heading title exactly', () => {
      store.getState().updateHeadingsForFile('/project/a.md', '# Setup Guide');
      expect(store.getState().getFilesWithHeading('Setup')).toEqual([]);
      expect(store.getState().getFilesWithHeading('Setup Guide')).toHaveLength(1);
    });
  });

  describe('clearHeadingIndex', () => {
    it('resets headingIndex to empty Map', () => {
      store.getState().updateHeadingsForFile('/project/a.md', '# Title\n## Section');
      store.getState().updateHeadingsForFile('/project/b.md', '# Other');
      expect(store.getState().headingIndex.size).toBe(2);

      store.getState().clearHeadingIndex();
      expect(store.getState().headingIndex.size).toBe(0);
    });

    it('returns empty headings for files after clearing', () => {
      store.getState().updateHeadingsForFile('/project/a.md', '# Title');
      store.getState().clearHeadingIndex();
      expect(store.getState().getHeadingsForFile('/project/a.md')).toEqual([]);
    });
  });
});
