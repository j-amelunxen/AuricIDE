export interface WikiLink {
  from: number; // start index of [[ in source
  to: number; // end index after ]] in source
  target: string; // resolved filename (e.g. "my-document.md")
  display: string; // raw text inside [[ ]] (e.g. "My Document")
  fragment?: string; // heading fragment after # (e.g. "Heading" from "Page#Heading")
}

/**
 * Extract all [[wiki-links]] from text.
 * Matches the first complete [[ ... ]] pair found at each position.
 */
export function parseWikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = [];
  const OPEN = '[[';
  const CLOSE = ']]';

  let searchFrom = 0;

  while (searchFrom < text.length) {
    const openIdx = text.indexOf(OPEN, searchFrom);
    if (openIdx === -1) break;

    const contentStart = openIdx + OPEN.length;
    const closeIdx = text.indexOf(CLOSE, contentStart);
    if (closeIdx === -1) break;

    const display = text.slice(contentStart, closeIdx);
    const from = openIdx;
    const to = closeIdx + CLOSE.length;

    const { pagePart, fragment } = resolveFragment(display);
    const target = pagePart === '' && fragment !== undefined ? '' : resolveWikiTarget(pagePart);

    links.push({
      from,
      to,
      target,
      display,
      fragment,
    });

    searchFrom = to;
  }

  return links;
}

/**
 * Convert display text to a filename slug.
 * "My Document" -> "my-document.md"
 * "folder/My Doc" -> "folder/my-doc.md"
 * Preserves existing file extensions.
 */
export function resolveWikiTarget(display: string): string {
  const trimmed = display.trim();

  const lastSlash = trimmed.lastIndexOf('/');
  const pathPrefix = lastSlash >= 0 ? trimmed.slice(0, lastSlash + 1) : '';
  const filename = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;

  const hasExtension = /\.\w+$/.test(filename);

  const slugified = filename.toLowerCase().replace(/\s+/g, '-');
  const pathPrefixLower = pathPrefix.toLowerCase();

  if (hasExtension) {
    return pathPrefixLower + slugified;
  }

  return pathPrefixLower + slugified + '.md';
}

/**
 * Split display text on the first `#` to extract page and heading fragment.
 * - "Page#Heading" → { pagePart: "Page", fragment: "Heading" }
 * - "#Heading"     → { pagePart: "", fragment: "Heading" }
 * - "Page"         → { pagePart: "Page", fragment: undefined }
 * - "Page#"        → { pagePart: "Page", fragment: undefined } (empty = ignored)
 */
export function resolveFragment(display: string): { pagePart: string; fragment?: string } {
  const hashIdx = display.indexOf('#');
  if (hashIdx === -1) return { pagePart: display };

  const pagePart = display.slice(0, hashIdx);
  const fragmentPart = display.slice(hashIdx + 1);

  if (fragmentPart === '') return { pagePart, fragment: undefined };

  return { pagePart, fragment: fragmentPart };
}

/**
 * Find all files that contain a [[link]] to the given target name.
 */
export function findBacklinks(files: Map<string, string>, targetName: string): string[] {
  const results: string[] = [];

  for (const [filename, content] of files) {
    const links = parseWikiLinks(content);
    if (links.some((link) => link.display === targetName)) {
      results.push(filename);
    }
  }

  return results;
}
