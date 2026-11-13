import { extractHeadings } from '@/lib/markdown/markdownHeadingParser';
import { parseWikiLinks } from '@/lib/markdown/wikiLinkParser';
import { resolveWikiTarget } from '@/lib/markdown/wikiLinkParser';

export interface HeadingRenameChange {
  filePath: string;
  from: number;
  to: number;
  oldText: string;
  newText: string;
}

/**
 * Compute all text changes needed to rename a heading and update its references.
 * Pure function — no side effects.
 */
export function computeHeadingRenameChanges(
  currentFilePath: string,
  currentFileName: string,
  oldTitle: string,
  newTitle: string,
  workspaceFiles: Map<string, string>
): HeadingRenameChange[] {
  const changes: HeadingRenameChange[] = [];
  const targetSlug = currentFileName.toLowerCase();

  for (const [filePath, content] of workspaceFiles) {
    // 1. Rename the heading line itself in the source file
    if (filePath === currentFilePath) {
      for (const heading of extractHeadings(content)) {
        if (heading.title !== oldTitle) continue;
        const lineEnd = content.indexOf('\n', heading.from);
        const to = lineEnd === -1 ? content.length : lineEnd;
        changes.push({
          filePath,
          from: heading.from,
          to,
          oldText: content.slice(heading.from, to),
          newText: `${'#'.repeat(heading.level)} ${newTitle}`,
        });
      }
    }

    // 2. Update [[Page#OldTitle]] and [[#OldTitle]] references in all files
    const links = parseWikiLinks(content);
    for (const link of links) {
      if (!link.fragment) continue;
      if (link.fragment !== oldTitle) continue;

      const isSameFile = filePath === currentFilePath && link.target === '';
      const isTargetFile =
        link.target !== '' &&
        resolveWikiTarget(link.display.split('#')[0]).toLowerCase() === targetSlug;

      if (isSameFile || isTargetFile) {
        const pagePart = link.display.split('#')[0];
        const oldText = `[[${link.display}]]`;
        const newText = `[[${pagePart}#${newTitle}]]`;
        changes.push({
          filePath,
          from: link.from,
          to: link.to,
          oldText,
          newText,
        });
      }
    }
  }

  return changes;
}
