import { parseWikiLinks } from '@/lib/editor/wikiLinkParser';
import { resolveWikiTarget } from '@/lib/editor/wikiLinkParser';

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
      const lines = content.split('\n');
      let offset = 0;
      for (const line of lines) {
        const match = /^(#{1,6})\s+(.*)$/.exec(line);
        if (match && match[2].trim() === oldTitle) {
          const oldText = line;
          const newText = `${match[1]} ${newTitle}`;
          changes.push({
            filePath,
            from: offset,
            to: offset + line.length,
            oldText,
            newText,
          });
        }
        offset += line.length + 1;
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
