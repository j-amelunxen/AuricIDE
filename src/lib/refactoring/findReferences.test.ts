import { describe, expect, it } from 'vitest';
import { findAllReferences } from './findReferences';
import type { EntityOccurrence } from '@/lib/store/entityIndexSlice';
import type { LinkIndexEntry } from '@/lib/store/wikiLinkSlice';

describe('findAllReferences', () => {
  describe('heading references', () => {
    it('finds [[Page#Heading]] references matching the query', () => {
      const workspaceContent = new Map<string, string>([
        ['/project/a.md', 'See [[Guide#Setup]] for details'],
        ['/project/b.md', 'Also check [[Guide#Setup]] here'],
        ['/project/c.md', 'Unrelated [[Guide#Install]] link'],
      ]);

      const results = findAllReferences('Setup', 'heading', {
        headingTarget: 'guide.md',
        workspaceContent,
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.type === 'heading')).toBe(true);
      expect(results.map((r) => r.filePath)).toContain('/project/a.md');
      expect(results.map((r) => r.filePath)).toContain('/project/b.md');
    });

    it('finds [[#Heading]] self-references', () => {
      const workspaceContent = new Map<string, string>([
        ['/project/doc.md', 'Jump to [[#Introduction]] below'],
      ]);

      const results = findAllReferences('Introduction', 'heading', {
        workspaceContent,
      });

      expect(results).toHaveLength(1);
      expect(results[0].filePath).toBe('/project/doc.md');
      expect(results[0].type).toBe('heading');
    });

    it('returns correct line numbers and character positions', () => {
      const workspaceContent = new Map<string, string>([
        ['/project/doc.md', 'line 1\nSee [[Guide#Setup]] ok\nline 3'],
      ]);

      const results = findAllReferences('Setup', 'heading', {
        headingTarget: 'guide.md',
        workspaceContent,
      });

      expect(results).toHaveLength(1);
      expect(results[0].lineNumber).toBe(2);
      expect(results[0].charFrom).toBe(4);
      expect(results[0].charTo).toBe(19); // [[Guide#Setup]] = 15 chars, starts at 4
    });

    it('returns empty for no matches', () => {
      const workspaceContent = new Map<string, string>([
        ['/project/doc.md', 'No heading refs here'],
      ]);

      const results = findAllReferences('Missing', 'heading', {
        workspaceContent,
      });

      expect(results).toEqual([]);
    });
  });

  describe('entity references', () => {
    it('returns entity occurrences from the entity index', () => {
      const entityIndex = new Map<string, EntityOccurrence[]>([
        [
          'DataPipeline',
          [
            {
              filePath: '/project/a.md',
              lineNumber: 3,
              lineText: 'Use DataPipeline here',
              charFrom: 4,
              charTo: 16,
            },
            {
              filePath: '/project/b.md',
              lineNumber: 1,
              lineText: 'DataPipeline is great',
              charFrom: 0,
              charTo: 12,
            },
          ],
        ],
      ]);

      const results = findAllReferences('DataPipeline', 'entity', {
        entityIndex,
      });

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.type === 'entity')).toBe(true);
      expect(results[0].filePath).toBe('/project/a.md');
      expect(results[1].filePath).toBe('/project/b.md');
    });

    it('returns empty for unknown entity', () => {
      const entityIndex = new Map<string, EntityOccurrence[]>();

      const results = findAllReferences('Unknown', 'entity', {
        entityIndex,
      });

      expect(results).toEqual([]);
    });
  });

  describe('wikilink backlink references', () => {
    it('finds files that link to a target via linkIndex', () => {
      const linkIndex = new Map<string, LinkIndexEntry>([
        [
          '/project/a.md',
          {
            outgoingLinks: [{ target: 'guide.md', display: 'Guide', from: 4, to: 13 }],
            targets: ['guide.md'],
            fragmentLinks: [],
          },
        ],
        [
          '/project/b.md',
          {
            outgoingLinks: [{ target: 'other.md', display: 'Other', from: 0, to: 9 }],
            targets: ['other.md'],
            fragmentLinks: [],
          },
        ],
      ]);

      const workspaceContent = new Map<string, string>([
        ['/project/a.md', 'See [[Guide]] for more'],
        ['/project/b.md', '[[Other]] stuff'],
      ]);

      const results = findAllReferences('guide.md', 'wikilink', {
        linkIndex,
        workspaceContent,
      });

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('wikilink');
      expect(results[0].filePath).toBe('/project/a.md');
    });

    it('returns empty when no files link to target', () => {
      const linkIndex = new Map<string, LinkIndexEntry>();

      const results = findAllReferences('missing.md', 'wikilink', {
        linkIndex,
      });

      expect(results).toEqual([]);
    });

    it('finds multiple backlinks from different files', () => {
      const linkIndex = new Map<string, LinkIndexEntry>([
        [
          '/project/a.md',
          {
            outgoingLinks: [{ target: 'guide.md', display: 'Guide', from: 4, to: 13 }],
            targets: ['guide.md'],
            fragmentLinks: [],
          },
        ],
        [
          '/project/b.md',
          {
            outgoingLinks: [{ target: 'guide.md', display: 'Guide', from: 0, to: 9 }],
            targets: ['guide.md'],
            fragmentLinks: [],
          },
        ],
      ]);

      const workspaceContent = new Map<string, string>([
        ['/project/a.md', 'See [[Guide]] info'],
        ['/project/b.md', '[[Guide]] is here'],
      ]);

      const results = findAllReferences('guide.md', 'wikilink', {
        linkIndex,
        workspaceContent,
      });

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.filePath)).toContain('/project/a.md');
      expect(results.map((r) => r.filePath)).toContain('/project/b.md');
    });
  });

  describe('results sorting', () => {
    it('sorts results by filePath then lineNumber', () => {
      const entityIndex = new Map<string, EntityOccurrence[]>([
        [
          'DataPipeline',
          [
            {
              filePath: '/project/b.md',
              lineNumber: 5,
              lineText: 'DataPipeline line 5',
              charFrom: 0,
              charTo: 12,
            },
            {
              filePath: '/project/a.md',
              lineNumber: 3,
              lineText: 'DataPipeline line 3',
              charFrom: 0,
              charTo: 12,
            },
            {
              filePath: '/project/a.md',
              lineNumber: 1,
              lineText: 'DataPipeline line 1',
              charFrom: 0,
              charTo: 12,
            },
          ],
        ],
      ]);

      const results = findAllReferences('DataPipeline', 'entity', {
        entityIndex,
      });

      expect(results[0].filePath).toBe('/project/a.md');
      expect(results[0].lineNumber).toBe(1);
      expect(results[1].filePath).toBe('/project/a.md');
      expect(results[1].lineNumber).toBe(3);
      expect(results[2].filePath).toBe('/project/b.md');
      expect(results[2].lineNumber).toBe(5);
    });
  });
});
