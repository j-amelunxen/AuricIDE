import { describe, expect, it, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createEntityIndexSlice, type EntityIndexSlice } from './entityIndexSlice';

function createTestStore() {
  return create<EntityIndexSlice>()((...a) => ({
    ...createEntityIndexSlice(...a),
  }));
}

describe('entityIndexSlice', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('initial state', () => {
    it('has empty entityIndex', () => {
      expect(store.getState().entityIndex.size).toBe(0);
    });
  });

  describe('updateEntitiesForFile', () => {
    it('indexes PascalCase entities from file content', () => {
      store
        .getState()
        .updateEntitiesForFile('/project/doc.md', 'The CustomerSupportBot handles requests');
      const refs = store.getState().findAllReferences('CustomerSupportBot');
      expect(refs).toHaveLength(1);
      expect(refs[0].filePath).toBe('/project/doc.md');
      expect(refs[0].lineNumber).toBe(1);
      expect(refs[0].lineText).toBe('The CustomerSupportBot handles requests');
    });

    it('indexes UPPER_CASE entities', () => {
      store.getState().updateEntitiesForFile('/project/doc.md', 'Open the README file');
      const refs = store.getState().findAllReferences('README');
      expect(refs).toHaveLength(1);
    });

    it('tracks correct line numbers', () => {
      const content = 'Line one\nDataPipeline here\nLine three\nDataPipeline again';
      store.getState().updateEntitiesForFile('/project/doc.md', content);
      const refs = store.getState().findAllReferences('DataPipeline');
      expect(refs).toHaveLength(2);
      expect(refs[0].lineNumber).toBe(2);
      expect(refs[1].lineNumber).toBe(4);
    });

    it('tracks correct character positions within lines', () => {
      store.getState().updateEntitiesForFile('/project/doc.md', 'The DataPipeline is great');
      const refs = store.getState().findAllReferences('DataPipeline');
      expect(refs).toHaveLength(1);
      expect(refs[0].charFrom).toBe(4);
      expect(refs[0].charTo).toBe(16);
    });

    it('indexes multiple entities from the same line', () => {
      store
        .getState()
        .updateEntitiesForFile('/project/doc.md', 'IntentClassifier calls DataPipeline');
      const classifierRefs = store.getState().findAllReferences('IntentClassifier');
      const pipelineRefs = store.getState().findAllReferences('DataPipeline');
      expect(classifierRefs).toHaveLength(1);
      expect(pipelineRefs).toHaveLength(1);
    });

    it('indexes entities across multiple files', () => {
      store.getState().updateEntitiesForFile('/project/a.md', 'Use DataPipeline here');
      store.getState().updateEntitiesForFile('/project/b.md', 'DataPipeline is used again');
      const refs = store.getState().findAllReferences('DataPipeline');
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.filePath)).toContain('/project/a.md');
      expect(refs.map((r) => r.filePath)).toContain('/project/b.md');
    });

    it('replaces entities on re-parse of the same file', () => {
      store.getState().updateEntitiesForFile('/project/doc.md', 'Use DataPipeline');
      expect(store.getState().findAllReferences('DataPipeline')).toHaveLength(1);

      store.getState().updateEntitiesForFile('/project/doc.md', 'Now use IntentClassifier');
      expect(store.getState().findAllReferences('DataPipeline')).toHaveLength(0);
      expect(store.getState().findAllReferences('IntentClassifier')).toHaveLength(1);
    });

    it('handles empty content', () => {
      store.getState().updateEntitiesForFile('/project/doc.md', '');
      expect(store.getState().entityIndex.size).toBe(0);
      expect(store.getState().findAllReferences('DataPipeline')).toHaveLength(0);
    });
  });

  describe('removeEntitiesForFile', () => {
    it('removes all entities for a file', () => {
      store.getState().updateEntitiesForFile('/project/doc.md', 'The DataPipeline is running');
      expect(store.getState().findAllReferences('DataPipeline')).toHaveLength(1);

      store.getState().removeEntitiesForFile('/project/doc.md');
      expect(store.getState().findAllReferences('DataPipeline')).toHaveLength(0);
    });

    it('does nothing for unknown file', () => {
      store.getState().removeEntitiesForFile('/project/unknown.md');
      expect(store.getState().entityIndex.size).toBe(0);
    });

    it('does not affect entities from other files', () => {
      store.getState().updateEntitiesForFile('/project/a.md', 'DataPipeline here');
      store.getState().updateEntitiesForFile('/project/b.md', 'DataPipeline there');

      store.getState().removeEntitiesForFile('/project/a.md');
      const refs = store.getState().findAllReferences('DataPipeline');
      expect(refs).toHaveLength(1);
      expect(refs[0].filePath).toBe('/project/b.md');
    });
  });

  describe('findAllReferences', () => {
    it('returns empty array for unknown entity', () => {
      expect(store.getState().findAllReferences('NonExistent')).toEqual([]);
    });

    it('returns occurrences sorted by filePath and lineNumber', () => {
      store.getState().updateEntitiesForFile('/project/b.md', 'DataPipeline line 1');
      store.getState().updateEntitiesForFile('/project/a.md', 'line 1\nDataPipeline line 2');

      const refs = store.getState().findAllReferences('DataPipeline');
      expect(refs).toHaveLength(2);
      // Should be sorted by filePath
      expect(refs[0].filePath).toBe('/project/a.md');
      expect(refs[1].filePath).toBe('/project/b.md');
    });
  });

  describe('clearEntityIndex', () => {
    it('resets entityIndex to empty Map', () => {
      store.getState().updateEntitiesForFile('/project/a.md', 'DataPipeline here');
      store.getState().updateEntitiesForFile('/project/b.md', 'IntentClassifier there');
      expect(store.getState().entityIndex.size).toBeGreaterThan(0);

      store.getState().clearEntityIndex();
      expect(store.getState().entityIndex.size).toBe(0);
    });

    it('clears all references after clearing', () => {
      store.getState().updateEntitiesForFile('/project/a.md', 'DataPipeline here');
      store.getState().clearEntityIndex();
      expect(store.getState().findAllReferences('DataPipeline')).toEqual([]);
    });
  });
});
