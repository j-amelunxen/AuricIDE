import type { HeadingRange } from './markdownHeadingParser';
import type { WikiLink } from './wikiLinkParser';

/** What the project index keeps of one markdown file: its links and its headings. */
export interface LinkIndexEntry {
  outgoingLinks: WikiLink[];
  targets: string[]; // resolved target filenames
  fragmentLinks: Array<{ target: string; fragment: string }>;
  /** Anchor checks in the linter and `[[page#` completion read these. */
  headings: HeadingRange[];
}
