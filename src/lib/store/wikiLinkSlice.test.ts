import { describe, expect, it, vi, beforeEach } from 'vitest';
import { create } from 'zustand';
import { buildLinkIndexEntry, createWikiLinkSlice, type WikiLinkSlice } from './wikiLinkSlice';

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
  // Autosave calls updateFileInIndex on every save. A save that leaves the links
  // alone must not hand every subscriber (graph layout, editor facets) new maps.
  describe('write avoidance', () => {
    it('skips the store write when a re-saved file has identical links', () => {
      store.getState().setAllFiles(['/p/a.md', '/p/b.md']);
      store.getState().updateFileInIndex('/p/a.md', 'See [[b]] and [[missing]].');
      const before = store.getState();
      store.getState().updateFileInIndex('/p/a.md', 'See [[b]] and [[missing]].');
      expect(store.getState().linkIndex).toBe(before.linkIndex);
      expect(store.getState().brokenLinks).toBe(before.brokenLinks);
    });

    it('still indexes a new file that has no links', () => {
      store.getState().updateFileInIndex('/p/empty.md', 'no links here');
      expect(store.getState().linkIndex.has('/p/empty.md')).toBe(true);
    });

    it('keeps brokenLinks when only link positions moved', () => {
      store.getState().setAllFiles(['/p/a.md']);
      store.getState().updateFileInIndex('/p/a.md', '[[missing]]');
      const broken = store.getState().brokenLinks;
      store.getState().updateFileInIndex('/p/a.md', 'intro [[missing]]');
      expect(store.getState().linkIndex.get('/p/a.md')?.outgoingLinks[0].from).toBe(6);
      expect(store.getState().brokenLinks).toBe(broken);
    });

    it('skips setAllFiles when the path list is unchanged', () => {
      store.getState().setAllFiles(['/p/a.md', '/p/b.md']);
      const before = store.getState();
      store.getState().setAllFiles(['/p/a.md', '/p/b.md']);
      expect(store.getState().allFilePaths).toBe(before.allFilePaths);
      expect(store.getState().allFileNames).toBe(before.allFileNames);
      expect(store.getState().brokenLinks).toBe(before.brokenLinks);
    });
  });

  // updateFileInIndex no longer recomputes brokenLinks across all files. The
  // incremental answer has to equal the full recompute — key order included,
  // because the link graph lays out broken targets in iteration order.
  describe('incremental broken links equal a full recompute', () => {
    const names = ['a', 'b', 'c', 'd'];
    const contents = ['', '[[a]]', '[[x]]', '[[a]] [[y]]', '[[b]] [[c]] [[z]]', 'pad [[x]]'];

    function reference(state: WikiLinkSlice): Array<[string, string[]]> {
      const out: Array<[string, string[]]> = [];
      for (const [fp, entry] of state.linkIndex) {
        const broken = entry.targets.filter((t) => !state.allFileNames.has(t.toLowerCase()));
        if (broken.length > 0) out.push([fp, broken]);
      }
      return out;
    }

    it('holds over a deterministic pseudo-random sequence of operations', () => {
      let seed = 7;
      const rand = (n: number) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return Math.floor(seed / 65536) % n;
      };
      for (let step = 0; step < 400; step++) {
        const op = rand(10);
        const file = `/p/${names[rand(names.length)]}`;
        if (op < 6) {
          store.getState().updateFileInIndex(file, contents[rand(contents.length)]);
        } else if (op < 7) {
          store.getState().removeFileFromIndex(file);
        } else if (op < 9) {
          const files = names.filter(() => rand(2) === 0).map((n) => `/p/${n}`);
          store.getState().setAllFiles(files);
        } else {
          store
            .getState()
            .bulkUpdateFilesInIndex([{ filePath: file, content: contents[rand(contents.length)] }]);
        }
        expect([...store.getState().brokenLinks]).toEqual(reference(store.getState()));
      }
    });
  });

  it('keeps linkIndex order when a file newly gains a broken link', () => {
    store.getState().setAllFiles(['/p/a.md', '/p/b.md']);
    store.getState().updateFileInIndex('/p/a.md', '[[b]]');
    store.getState().updateFileInIndex('/p/b.md', '[[missing]]');
    store.getState().updateFileInIndex('/p/a.md', '[[gone]]');
    expect([...store.getState().brokenLinks.keys()]).toEqual(['/p/a.md', '/p/b.md']);
  });

  describe('bulkSetLinkEntries', () => {
    it('matches bulkUpdateFilesInIndex for the same contents', () => {
      const other = createTestStore();
      store.getState().setAllFiles(['/p/a.md']);
      other.getState().setAllFiles(['/p/a.md']);
      const files = [
        { filePath: '/p/a.md', content: '[[b]]' },
        { filePath: '/p/b.md', content: '[[a]] [[c#H]]' },
      ];
      store.getState().bulkUpdateFilesInIndex(files);
      other
        .getState()
        .bulkSetLinkEntries(
          files.map((f) => ({ filePath: f.filePath, entry: buildLinkIndexEntry(f.content) }))
        );
      expect([...other.getState().linkIndex]).toEqual([...store.getState().linkIndex]);
      expect([...other.getState().brokenLinks]).toEqual([...store.getState().brokenLinks]);
    });
  });
});
