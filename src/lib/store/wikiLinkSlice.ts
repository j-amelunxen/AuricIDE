import type { StateCreator } from 'zustand';
import { parseWikiLinks, type WikiLink } from '@/lib/editor/wikiLinkParser';
import { detachString } from '@/lib/detachString';

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
  bulkSetLinkEntries: (entries: Array<{ filePath: string; entry: LinkIndexEntry }>) => void;
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

export function buildLinkIndexEntry(content: string): LinkIndexEntry {
  const links = parseWikiLinks(content).map((l) => ({
    ...l,
    target: detachString(l.target),
    display: detachString(l.display),
    fragment: l.fragment === undefined ? undefined : detachString(l.fragment),
  }));
  const targets = links.map((l) => l.target);
  const fragmentLinks = links
    .filter((l) => l.fragment !== undefined)
    .map((l) => ({ target: l.target, fragment: l.fragment! }));
  return { outgoingLinks: links, targets, fragmentLinks };
}

function brokenTargetsOf(entry: LinkIndexEntry, allFileNames: Set<string>): string[] {
  return entry.targets.filter((t) => !allFileNames.has(t.toLowerCase()));
}

function computeBrokenLinks(
  linkIndex: Map<string, LinkIndexEntry>,
  allFileNames: Set<string>
): Map<string, string[]> {
  const broken = new Map<string, string[]>();
  for (const [filePath, entry] of linkIndex) {
    const brokenTargets = brokenTargetsOf(entry, allFileNames);
    if (brokenTargets.length > 0) {
      broken.set(filePath, brokenTargets);
    }
  }
  return broken;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function sameLinks(a: readonly WikiLink[], b: readonly WikiLink[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (l, i) =>
        l.from === b[i].from &&
        l.to === b[i].to &&
        l.target === b[i].target &&
        l.display === b[i].display &&
        l.fragment === b[i].fragment
    )
  );
}

function sameBrokenLinks(a: Map<string, string[]>, b: Map<string, string[]>): boolean {
  if (a.size !== b.size) return false;
  const bEntries = [...b];
  let i = 0;
  for (const [key, targets] of a) {
    const [otherKey, otherTargets] = bEntries[i++];
    if (key !== otherKey || !sameStrings(targets, otherTargets)) return false;
  }
  return true;
}

/**
 * brokenLinks after `filePath`'s entry changed, without walking every file.
 * Only that file's broken targets can move. Its key keeps its position when it
 * stays or leaves; a file that newly has broken links would be appended here but
 * sits at its linkIndex position in a full recompute — the link graph iterates in
 * that order, so that one case recomputes rather than reorder anything.
 */
function brokenLinksAfterUpdate(
  brokenLinks: Map<string, string[]>,
  linkIndex: Map<string, LinkIndexEntry>,
  allFileNames: Set<string>,
  filePath: string
): Map<string, string[]> {
  const entry = linkIndex.get(filePath);
  const next = entry ? brokenTargetsOf(entry, allFileNames) : [];
  const prev = brokenLinks.get(filePath);
  if (prev === undefined) {
    if (next.length === 0) return brokenLinks;
    return computeBrokenLinks(linkIndex, allFileNames);
  }
  if (sameStrings(prev, next)) return brokenLinks;
  const updated = new Map(brokenLinks);
  if (next.length > 0) updated.set(filePath, next);
  else updated.delete(filePath);
  return updated;
}

export const createWikiLinkSlice: StateCreator<WikiLinkSlice> = (set, get) => ({
  linkIndex: new Map(),
  allFileNames: new Set(),
  allFilePaths: [],
  brokenLinks: new Map(),

  setAllFiles: (paths: string[]) => {
    const current = get();
    if (sameStrings(current.allFilePaths, paths)) return;
    const names = new Set(paths.map((p) => basename(p)));
    const namesUnchanged =
      names.size === current.allFileNames.size &&
      [...names].every((n) => current.allFileNames.has(n));
    if (namesUnchanged) {
      set({ allFilePaths: paths });
      return;
    }
    const brokenLinks = computeBrokenLinks(current.linkIndex, names);
    set({
      allFileNames: names,
      allFilePaths: paths,
      brokenLinks: sameBrokenLinks(brokenLinks, current.brokenLinks)
        ? current.brokenLinks
        : brokenLinks,
    });
  },

  updateFileInIndex: (filePath: string, content: string) => {
    const entry = buildLinkIndexEntry(content);
    const { linkIndex, allFileNames, brokenLinks } = get();
    const prev = linkIndex.get(filePath);
    if (prev && sameLinks(prev.outgoingLinks, entry.outgoingLinks)) return;

    const newIndex = new Map(linkIndex);
    newIndex.set(filePath, entry);
    set({
      linkIndex: newIndex,
      brokenLinks: brokenLinksAfterUpdate(brokenLinks, newIndex, allFileNames, filePath),
    });
  },

  bulkUpdateFilesInIndex: (entries: Array<{ filePath: string; content: string }>) => {
    get().bulkSetLinkEntries(
      entries.map(({ filePath, content }) => ({ filePath, entry: buildLinkIndexEntry(content) }))
    );
  },

  bulkSetLinkEntries: (entries: Array<{ filePath: string; entry: LinkIndexEntry }>) => {
    if (entries.length === 0) return;
    const newIndex = new Map(get().linkIndex);
    for (const { filePath, entry } of entries) {
      newIndex.set(filePath, entry);
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
