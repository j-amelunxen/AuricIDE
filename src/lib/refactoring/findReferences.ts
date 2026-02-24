import type { EntityOccurrence } from '@/lib/store/entityIndexSlice';
import type { LinkIndexEntry } from '@/lib/store/wikiLinkSlice';

export interface ReferenceResult {
  type: 'heading' | 'entity' | 'wikilink';
  filePath: string;
  lineNumber: number;
  lineText: string;
  charFrom: number;
  charTo: number;
}

function sortResults(results: ReferenceResult[]): ReferenceResult[] {
  return results.sort((a, b) => {
    const pathCmp = a.filePath.localeCompare(b.filePath);
    if (pathCmp !== 0) return pathCmp;
    return a.lineNumber - b.lineNumber;
  });
}

function findHeadingReferences(
  query: string,
  headingTarget: string | undefined,
  workspaceContent: Map<string, string>
): ReferenceResult[] {
  const results: ReferenceResult[] = [];

  // Build patterns for matching [[Target#Heading]] and [[#Heading]]
  // We need to find both [[Page#Query]] (where Page resolves to headingTarget)
  // and [[#Query]] (self-references)
  for (const [filePath, content] of workspaceContent) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match all wiki-link patterns in this line
      const wikiLinkRegex = /\[\[([^\]]*?)#([^\]]*?)\]\]/g;
      let match;
      while ((match = wikiLinkRegex.exec(line)) !== null) {
        const linkTarget = match[1];
        const fragment = match[2];

        if (fragment !== query) continue;

        // Match [[#Heading]] (self-reference, empty target)
        if (linkTarget === '') {
          results.push({
            type: 'heading',
            filePath,
            lineNumber: i + 1,
            lineText: line,
            charFrom: match.index,
            charTo: match.index + match[0].length,
          });
          continue;
        }

        // Match [[Page#Heading]] where page resolves to headingTarget
        if (headingTarget) {
          // Resolve the link target to a filename (lowercase, slugify spaces to hyphens)
          const resolved = linkTarget.toLowerCase().replace(/\s+/g, '-') + '.md';
          if (resolved === headingTarget.toLowerCase()) {
            results.push({
              type: 'heading',
              filePath,
              lineNumber: i + 1,
              lineText: line,
              charFrom: match.index,
              charTo: match.index + match[0].length,
            });
          }
        }
      }
    }
  }

  return results;
}

function findEntityReferences(
  query: string,
  entityIndex: Map<string, EntityOccurrence[]>
): ReferenceResult[] {
  const occurrences = entityIndex.get(query) ?? [];
  return occurrences.map((o) => ({
    type: 'entity' as const,
    filePath: o.filePath,
    lineNumber: o.lineNumber,
    lineText: o.lineText,
    charFrom: o.charFrom,
    charTo: o.charTo,
  }));
}

function findWikiLinkBacklinks(
  query: string,
  linkIndex: Map<string, LinkIndexEntry>,
  workspaceContent?: Map<string, string>
): ReferenceResult[] {
  const results: ReferenceResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const [filePath, entry] of linkIndex) {
    const matchingLinks = entry.outgoingLinks.filter((l) => l.target.toLowerCase() === lowerQuery);

    for (const link of matchingLinks) {
      // If we have workspace content, find the actual line info
      if (workspaceContent?.has(filePath)) {
        const content = workspaceContent.get(filePath)!;
        const lines = content.split('\n');
        let offset = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineEnd = offset + lines[i].length;
          if (link.from >= offset && link.from < lineEnd + 1) {
            results.push({
              type: 'wikilink',
              filePath,
              lineNumber: i + 1,
              lineText: lines[i],
              charFrom: link.from - offset,
              charTo: link.to - offset,
            });
            break;
          }
          offset = lineEnd + 1; // +1 for newline
        }
      } else {
        // Fallback: no content available, use link positions
        results.push({
          type: 'wikilink',
          filePath,
          lineNumber: 1,
          lineText: '',
          charFrom: link.from,
          charTo: link.to,
        });
      }
    }
  }

  return results;
}

export function findAllReferences(
  query: string,
  queryType: 'heading' | 'entity' | 'wikilink',
  options: {
    headingTarget?: string;
    entityIndex?: Map<string, EntityOccurrence[]>;
    linkIndex?: Map<string, LinkIndexEntry>;
    workspaceContent?: Map<string, string>;
  }
): ReferenceResult[] {
  let results: ReferenceResult[] = [];

  switch (queryType) {
    case 'heading':
      results = findHeadingReferences(
        query,
        options.headingTarget,
        options.workspaceContent ?? new Map()
      );
      break;
    case 'entity':
      results = findEntityReferences(query, options.entityIndex ?? new Map());
      break;
    case 'wikilink':
      results = findWikiLinkBacklinks(
        query,
        options.linkIndex ?? new Map(),
        options.workspaceContent
      );
      break;
  }

  return sortResults(results);
}
