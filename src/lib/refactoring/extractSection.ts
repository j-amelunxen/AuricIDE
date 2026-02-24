import { extractHeadings } from '@/lib/editor/markdownHeadingParser';

export interface ExtractSectionResult {
  sectionContent: string;
  sectionFrom: number;
  sectionTo: number;
  suggestedFileName: string;
  replacementText: string;
  headingTitle: string;
}

/**
 * Slugify a heading title into a filename-safe string.
 * Lowercase, spaces to hyphens, strip non-alphanumeric (except hyphens), add .md.
 */
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') + '.md'
  );
}

/**
 * Compute the extraction result for the section at or before the given cursor line.
 *
 * @param content - Full markdown document text
 * @param cursorLine - 1-based line number where the cursor is
 * @returns The extraction result, or null if the cursor is not within any heading section
 */
export function computeSectionExtraction(
  content: string,
  cursorLine: number
): ExtractSectionResult | null {
  const headings = extractHeadings(content);

  if (headings.length === 0) return null;

  // Find the heading at or before cursorLine
  let targetIndex = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].lineNumber <= cursorLine) {
      targetIndex = i;
    } else {
      break;
    }
  }

  if (targetIndex === -1) return null;

  const heading = headings[targetIndex];
  const sectionFrom = heading.from;
  // heading.to from the parser is inclusive (newline before next heading) for mid-sections,
  // or text.length for the last section. Convert to exclusive-end for slicing.
  const sectionTo = heading.to < content.length ? heading.to + 1 : heading.to;
  const sectionContent = content.slice(sectionFrom, sectionTo);

  return {
    sectionContent,
    sectionFrom,
    sectionTo,
    suggestedFileName: slugify(heading.title),
    replacementText: `[[${heading.title}]]\n`,
    headingTitle: heading.title,
  };
}
