import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createWikiLinkSlice, type WikiLinkSlice } from './wikiLinkSlice';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function createTestStore() {
  return create<WikiLinkSlice>()((...a) => ({
    ...createWikiLinkSlice(...a),
  }));
}

describe('wikiLinkSlice', () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  describe('initial state', () => {
    it('has empty linkIndex', () => {
      expect(store.getState().linkIndex.size).toBe(0);
    });

    it('has empty allFileNames', () => {
      expect(store.getState().allFileNames.size).toBe(0);
    });

    it('has empty allFilePaths', () => {
      expect(store.getState().allFilePaths).toEqual([]);
    });

    it('has empty brokenLinks', () => {
      expect(store.getState().brokenLinks.size).toBe(0);
    });
  });

  describe('updateFileInIndex', () => {
    it('parses wiki-links and adds them to the index', () => {
      store.getState().updateFileInIndex('/project/notes.md', 'See [[My Doc]] and [[Other]].');
      const entry = store.getState().linkIndex.get('/project/notes.md');
      expect(entry).toBeDefined();
      expect(entry!.outgoingLinks).toHaveLength(2);
      expect(entry!.outgoingLinks[0].target).toBe('my-doc.md');
      expect(entry!.outgoingLinks[1].target).toBe('other.md');
    });

    it('replaces previous index entry on re-parse', () => {
      store.getState().updateFileInIndex('/project/notes.md', '[[Alpha]]');
      expect(store.getState().linkIndex.get('/project/notes.md')!.outgoingLinks).toHaveLength(1);

      store.getState().updateFileInIndex('/project/notes.md', '[[Beta]] and [[Gamma]]');
      expect(store.getState().linkIndex.get('/project/notes.md')!.outgoingLinks).toHaveLength(2);
    });

    it('detects broken links based on allFileNames', () => {
      // First set up known files
      store.getState().setAllFiles(['/project/existing.md', '/project/another.md']);
      // Parse a file that links to both existing and non-existing
      store.getState().updateFileInIndex('/project/notes.md', '[[Existing]] and [[Missing]]');

      const broken = store.getState().brokenLinks.get('/project/notes.md');
      expect(broken).toBeDefined();
      expect(broken).toContain('missing.md');
      expect(broken).not.toContain('existing.md');
    });
  });

  describe('removeFileFromIndex', () => {
    it('removes a file from the index', () => {
      store.getState().updateFileInIndex('/project/notes.md', '[[Link]]');
      expect(store.getState().linkIndex.has('/project/notes.md')).toBe(true);

      store.getState().removeFileFromIndex('/project/notes.md');
      expect(store.getState().linkIndex.has('/project/notes.md')).toBe(false);
    });

    it('removes broken links for the file', () => {
      store.getState().updateFileInIndex('/project/notes.md', '[[Missing]]');
      expect(store.getState().brokenLinks.has('/project/notes.md')).toBe(true);

      store.getState().removeFileFromIndex('/project/notes.md');
      expect(store.getState().brokenLinks.has('/project/notes.md')).toBe(false);
    });
  });

  describe('setAllFiles', () => {
    it('populates allFileNames and allFilePaths', () => {
      store.getState().setAllFiles(['/project/readme.md', '/project/docs/guide.md']);
      expect(store.getState().allFileNames.has('readme.md')).toBe(true);
      expect(store.getState().allFileNames.has('guide.md')).toBe(true);
      expect(store.getState().allFilePaths).toEqual([
        '/project/readme.md',
        '/project/docs/guide.md',
      ]);
    });

    it('recomputes broken links when file list changes', () => {
      // Link to a file that does not exist yet
      store.getState().updateFileInIndex('/project/notes.md', '[[New Page]]');
      expect(store.getState().brokenLinks.get('/project/notes.md')).toContain('new-page.md');

      // Now add the file
      store.getState().setAllFiles(['/project/new-page.md']);
      expect(store.getState().brokenLinks.get('/project/notes.md') ?? []).not.toContain(
        'new-page.md'
      );
    });
  });

  describe('getBacklinksFor', () => {
    it('returns files that link to a target', () => {
      store.getState().updateFileInIndex('/project/a.md', '[[Target]]');
      store.getState().updateFileInIndex('/project/b.md', '[[Target]]');
      store.getState().updateFileInIndex('/project/c.md', '[[Other]]');

      const backlinks = store.getState().getBacklinksFor('target.md');
      expect(backlinks).toContain('/project/a.md');
      expect(backlinks).toContain('/project/b.md');
      expect(backlinks).not.toContain('/project/c.md');
    });

    it('returns empty array for unknown target', () => {
      expect(store.getState().getBacklinksFor('nonexistent.md')).toEqual([]);
    });
  });

  describe('isBrokenLink', () => {
    it('returns true for non-existing targets', () => {
      store.getState().setAllFiles(['/project/exists.md']);
      expect(store.getState().isBrokenLink('missing.md')).toBe(true);
    });

    it('returns false for existing targets', () => {
      store.getState().setAllFiles(['/project/exists.md']);
      expect(store.getState().isBrokenLink('exists.md')).toBe(false);
    });

    it('returns false when no files are indexed (empty project)', () => {
      // With empty file list and no index, nothing is "broken"
      expect(store.getState().isBrokenLink('anything.md')).toBe(false);
    });
  });

  describe('fragment links', () => {
    it('tracks fragment links from [[Page#Heading]] syntax', () => {
      store
        .getState()
        .updateFileInIndex('/project/notes.md', 'See [[Guide#Setup]] and [[Guide#Install]]');
      const entry = store.getState().linkIndex.get('/project/notes.md');
      expect(entry!.fragmentLinks).toHaveLength(2);
      expect(entry!.fragmentLinks[0]).toEqual({ target: 'guide.md', fragment: 'Setup' });
      expect(entry!.fragmentLinks[1]).toEqual({ target: 'guide.md', fragment: 'Install' });
    });

    it('tracks current-file fragment links from [[#Heading]]', () => {
      store.getState().updateFileInIndex('/project/notes.md', 'Jump to [[#Introduction]]');
      const entry = store.getState().linkIndex.get('/project/notes.md');
      expect(entry!.fragmentLinks).toHaveLength(1);
      expect(entry!.fragmentLinks[0]).toEqual({ target: '', fragment: 'Introduction' });
    });

    it('returns empty fragmentLinks for links without fragments', () => {
      store.getState().updateFileInIndex('/project/notes.md', 'See [[Simple Page]]');
      const entry = store.getState().linkIndex.get('/project/notes.md');
      expect(entry!.fragmentLinks).toEqual([]);
    });
  });

  describe('getBacklinksForHeading', () => {
    it('finds files linking to a specific heading in a target file', () => {
      store.getState().updateFileInIndex('/project/a.md', 'See [[Guide#Setup]]');
      store.getState().updateFileInIndex('/project/b.md', 'See [[Guide#Install]]');
      store.getState().updateFileInIndex('/project/c.md', 'See [[Guide#Setup]]');

      const backlinks = store.getState().getBacklinksForHeading('guide.md', 'Setup');
      expect(backlinks).toContain('/project/a.md');
      expect(backlinks).toContain('/project/c.md');
      expect(backlinks).not.toContain('/project/b.md');
    });

    it('finds current-file heading references', () => {
      store.getState().updateFileInIndex('/project/doc.md', 'See [[#Overview]]');

      const backlinks = store.getState().getBacklinksForHeading('', 'Overview');
      expect(backlinks).toContain('/project/doc.md');
    });

    it('returns empty for non-existing heading references', () => {
      store.getState().updateFileInIndex('/project/a.md', 'See [[Guide#Setup]]');
      expect(store.getState().getBacklinksForHeading('guide.md', 'Unknown')).toEqual([]);
    });
  });

  describe('getBrokenLinkTargets', () => {
    it('returns a set of all broken target names across files', () => {
      store.getState().setAllFiles(['/project/exists.md']);
      store.getState().updateFileInIndex('/project/a.md', '[[Missing]] and [[Also Missing]]');
      store.getState().updateFileInIndex('/project/b.md', '[[Exists]]');

      const broken = store.getState().getBrokenLinkTargets();
      expect(broken.has('missing.md')).toBe(true);
      expect(broken.has('also-missing.md')).toBe(true);
      expect(broken.has('exists.md')).toBe(false);
    });
  });

  describe('bulkUpdateFilesInIndex', () => {
    it('indexes multiple files in one call', () => {
      store.getState().bulkUpdateFilesInIndex([
        { filePath: '/project/a.md', content: '[[Target]]' },
        { filePath: '/project/b.md', content: '[[Other]]' },
      ]);

      expect(store.getState().linkIndex.has('/project/a.md')).toBe(true);
      expect(store.getState().linkIndex.has('/project/b.md')).toBe(true);
      expect(store.getState().linkIndex.get('/project/a.md')!.targets).toContain('target.md');
      expect(store.getState().linkIndex.get('/project/b.md')!.targets).toContain('other.md');
    });

    it('produces the same result as calling updateFileInIndex for each entry', () => {
      const entries = [
        { filePath: '/project/a.md', content: '[[Alpha]] and [[Beta]]' },
        { filePath: '/project/b.md', content: '[[Alpha]]' },
      ];

      const storeA = createTestStore();
      storeA.getState().bulkUpdateFilesInIndex(entries);

      const storeB = createTestStore();
      for (const e of entries) storeB.getState().updateFileInIndex(e.filePath, e.content);

      expect(storeA.getState().linkIndex.size).toBe(storeB.getState().linkIndex.size);
      expect(storeA.getState().linkIndex.get('/project/a.md')!.targets).toEqual(
        storeB.getState().linkIndex.get('/project/a.md')!.targets
      );
    });

    it('detects broken links across all bulk-indexed files', () => {
      store.getState().setAllFiles(['/project/exists.md']);
      store.getState().bulkUpdateFilesInIndex([
        { filePath: '/project/a.md', content: '[[Exists]] and [[Missing]]' },
        { filePath: '/project/b.md', content: '[[Also Missing]]' },
      ]);

      expect(store.getState().brokenLinks.get('/project/a.md')).toContain('missing.md');
      expect(store.getState().brokenLinks.get('/project/b.md')).toContain('also-missing.md');
      expect(store.getState().brokenLinks.get('/project/a.md')).not.toContain('exists.md');
    });

    it('does nothing when given an empty array', () => {
      store.getState().updateFileInIndex('/project/existing.md', '[[Link]]');
      store.getState().bulkUpdateFilesInIndex([]);
      expect(store.getState().linkIndex.size).toBe(1);
    });
  });

  describe('clearLinkIndex', () => {
    it('resets all link state', () => {
      store.getState().setAllFiles(['/project/exists.md', '/project/other.md']);
      store.getState().updateFileInIndex('/project/notes.md', '[[Exists]] and [[Missing]]');

      expect(store.getState().linkIndex.size).toBeGreaterThan(0);
      expect(store.getState().allFileNames.size).toBeGreaterThan(0);
      expect(store.getState().allFilePaths.length).toBeGreaterThan(0);
      expect(store.getState().brokenLinks.size).toBeGreaterThan(0);

      store.getState().clearLinkIndex();

      expect(store.getState().linkIndex.size).toBe(0);
      expect(store.getState().allFileNames.size).toBe(0);
      expect(store.getState().allFilePaths).toEqual([]);
      expect(store.getState().brokenLinks.size).toBe(0);
    });

    it('returns empty backlinks after clearing', () => {
      store.getState().updateFileInIndex('/project/a.md', '[[Target]]');
      store.getState().clearLinkIndex();
      expect(store.getState().getBacklinksFor('target.md')).toEqual([]);
    });
  });
});
