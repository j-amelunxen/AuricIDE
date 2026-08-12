import { parseWikiLinks } from '@/lib/editor/wikiLinkParser';
import type { HeadingRenameChange } from './applyRenameChanges';

/**
 * Compute the text edits needed to keep [[wiki-links]] pointing at a file
 * that's about to be renamed. Rewrites the link to the new slug rather than
 * trying to preserve the old display text — the new name is the only thing
 * guaranteed to still resolve. Pure function — no side effects.
 */
export function computeFileRenameChanges(
  oldFileName: string,
  newFileName: string,
  referencingFiles: Map<string, string>
): HeadingRenameChange[] {
  const changes: HeadingRenameChange[] = [];
  const targetSlug = oldFileName.toLowerCase();
  const newPagePart = newFileName.replace(/\.\w+$/, '');

  for (const [filePath, content] of referencingFiles) {
    const links = parseWikiLinks(content);
    for (const link of links) {
      if (link.target.toLowerCase() !== targetSlug) continue;
      const newDisplay =
        link.fragment !== undefined ? `${newPagePart}#${link.fragment}` : newPagePart;
      changes.push({
        filePath,
        from: link.from,
        to: link.to,
        oldText: `[[${link.display}]]`,
        newText: `[[${newDisplay}]]`,
      });
    }
  }

  return changes;
}
