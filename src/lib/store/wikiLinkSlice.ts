import type { StateCreator } from 'zustand';
import { parseWikiLinks, type WikiLink } from '@/lib/editor/wikiLinkParser';

export interface LinkIndexEntry {
  outgoingLinks: WikiLink[];
  targets: string[]; // resolved target filenames
  fragmentLinks: Array<{ target: string; fragment: string }>;
}

export interface WikiLinkSlice {
  linkIndex: Map<string, LinkIndexEntry>;
  allFileNames: Set<string>; // lowercased basenames for existence checks
  allFilePaths: string[];
  brokenLinks: Map<string, string[]>; // filePath -> broken target names

  setAllFiles: (paths: string[]) => void;
  updateFileInIndex: (filePath: string, content: string) => void;
  bulkUpdateFilesInIndex: (entries: Array<{ filePath: string; content: string }>) => void;
  removeFileFromIndex: (filePath: string) => void;
  getBacklinksFor: (targetFileName: string) => string[];
  getBacklinksForHeading: (targetFileName: string, headingTitle: string) => string[];
  isBrokenLink: (targetFileName: string) => boolean;
  getBrokenLinkTargets: () => Set<string>;
  clearLinkIndex: () => void;
}

function basename(filePath: string): string {
  return filePath.split('/').pop()?.toLowerCase() ?? '';
}

function computeBrokenLinks(
  linkIndex: Map<string, LinkIndexEntry>,
  allFileNames: Set<string>
): Map<string, string[]> {
  const broken = new Map<string, string[]>();
  for (const [filePath, entry] of linkIndex) {
    const brokenTargets = entry.targets.filter((t) => !allFileNames.has(t.toLowerCase()));
    if (brokenTargets.length > 0) {
      broken.set(filePath, brokenTargets);
    }
  }
  return broken;
}

export const createWikiLinkSlice: StateCreator<WikiLinkSlice> = (set, get) => ({
  linkIndex: new Map(),
  allFileNames: new Set(),
  allFilePaths: [],
  brokenLinks: new Map(),

  setAllFiles: (paths: string[]) => {
    const names = new Set(paths.map((p) => basename(p)));
    const linkIndex = get().linkIndex;
    const brokenLinks = computeBrokenLinks(linkIndex, names);
    set({ allFileNames: names, allFilePaths: paths, brokenLinks });
  },

  updateFileInIndex: (filePath: string, content: string) => {
    const links = parseWikiLinks(content);
    const targets = links.map((l) => l.target);
    const fragmentLinks = links
      .filter((l) => l.fragment !== undefined)
      .map((l) => ({ target: l.target, fragment: l.fragment! }));
    const entry: LinkIndexEntry = { outgoingLinks: links, targets, fragmentLinks };

    const newIndex = new Map(get().linkIndex);
    newIndex.set(filePath, entry);

    const allFileNames = get().allFileNames;
    const brokenLinks = computeBrokenLinks(newIndex, allFileNames);

    set({ linkIndex: newIndex, brokenLinks });
  },

  bulkUpdateFilesInIndex: (entries: Array<{ filePath: string; content: string }>) => {
    if (entries.length === 0) return;
    const newIndex = new Map(get().linkIndex);
    for (const { filePath, content } of entries) {
      const links = parseWikiLinks(content);
      const targets = links.map((l) => l.target);
      const fragmentLinks = links
        .filter((l) => l.fragment !== undefined)
        .map((l) => ({ target: l.target, fragment: l.fragment! }));
      newIndex.set(filePath, { outgoingLinks: links, targets, fragmentLinks });
    }
    const allFileNames = get().allFileNames;
    const brokenLinks = computeBrokenLinks(newIndex, allFileNames);
    set({ linkIndex: newIndex, brokenLinks });
  },

  removeFileFromIndex: (filePath: string) => {
    const newIndex = new Map(get().linkIndex);
    newIndex.delete(filePath);

    const newBroken = new Map(get().brokenLinks);
    newBroken.delete(filePath);

    set({ linkIndex: newIndex, brokenLinks: newBroken });
  },

  getBacklinksFor: (targetFileName: string) => {
    const results: string[] = [];
    const lower = targetFileName.toLowerCase();
    for (const [filePath, entry] of get().linkIndex) {
      if (entry.targets.some((t) => t.toLowerCase() === lower)) {
        results.push(filePath);
      }
    }
    return results;
  },

  getBacklinksForHeading: (targetFileName: string, headingTitle: string) => {
    const results: string[] = [];
    const lowerTarget = targetFileName.toLowerCase();
    for (const [filePath, entry] of get().linkIndex) {
      if (
        entry.fragmentLinks.some(
          (fl) => fl.target.toLowerCase() === lowerTarget && fl.fragment === headingTitle
        )
      ) {
        results.push(filePath);
      }
    }
    return results;
  },

  isBrokenLink: (targetFileName: string) => {
    const allFileNames = get().allFileNames;
    if (allFileNames.size === 0) return false;
    return !allFileNames.has(targetFileName.toLowerCase());
  },

  getBrokenLinkTargets: () => {
    const targets = new Set<string>();
    for (const brokenList of get().brokenLinks.values()) {
      for (const t of brokenList) {
        targets.add(t);
      }
    }
    return targets;
  },

  clearLinkIndex: () =>
    set({
      linkIndex: new Map(),
      allFileNames: new Set(),
      allFilePaths: [],
      brokenLinks: new Map(),
    }),
});
