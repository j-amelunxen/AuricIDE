/**
 * Turning a pasted block of text — most often a whole email — into an inbox
 * attachment.
 *
 * The capture bar is one line on purpose, and a mail pasted into it would be
 * a title nobody can read. So a paste that is clearly a document is not typed
 * into the field at all: it is staged as a text attachment, and the field is
 * seeded with a title derived from it. The derivation lives here, away from
 * the component, because the capture bar and the overlay both do it and must
 * not disagree about what a pasted mail is called.
 */

/** Past this many characters, a single line is a document rather than a title. */
export const PASTED_DOCUMENT_MIN_LENGTH = 280;

/** Above this many non-empty lines, a paste is a document whatever its length. */
const PASTED_DOCUMENT_MIN_LINES = 3;

/** How far into a paste a `Subject:` line still counts as a mail header. */
const HEADER_SCAN_LINES = 40;

const MAX_TITLE_LENGTH = 120;
const MAX_SLUG_LENGTH = 60;

const SUBJECT_LINE = /^\s*(?:subject|betreff)\s*:\s*(\S.*)$/i;

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Whether a paste should become an attachment instead of the item's title.
 *
 * Two lines stay a title — people paste wrapped sentences all the time, and
 * silently filing one away as a document would hide it. Three lines, or a
 * line longer than any title anyone reads, is a document.
 */
export function looksLikePastedDocument(text: string): boolean {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return false;
  if (lines.length >= PASTED_DOCUMENT_MIN_LINES) return true;
  return text.trim().length > PASTED_DOCUMENT_MIN_LENGTH;
}

function shorten(line: string): string {
  if (line.length <= MAX_TITLE_LENGTH) return line;
  const cut = line.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace > MAX_TITLE_LENGTH / 3 ? cut.slice(0, lastSpace) : cut;
  return `${head.trimEnd()}…`;
}

/**
 * A name for the item the paste becomes. A mail's `Subject:` wins over its
 * first line, which would otherwise be `From: …` — the one thing about the
 * mail that says nothing about the work.
 */
export function titleForPastedText(text: string): string {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return 'Pasted note';

  for (const line of lines.slice(0, HEADER_SCAN_LINES)) {
    const match = SUBJECT_LINE.exec(line);
    if (match) return shorten(match[1].trim());
  }

  const first = lines[0].replace(/^[#>\s]+/, '').trim();
  return first === '' ? 'Pasted note' : shorten(first);
}

const TRANSLITERATIONS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  œ: 'oe',
  đ: 'd',
  ł: 'l',
};

function slug(title: string): string {
  const folded = title
    .toLowerCase()
    .replace(/[ßæøœđł]/g, (char) => TRANSLITERATIONS[char] ?? char)
    // Decomposing first turns "ö" into "o" plus a combining mark, so stripping
    // the marks leaves a plain letter rather than dropping the whole character.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const dashed = folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (dashed.length <= MAX_SLUG_LENGTH) return dashed;

  const cut = dashed.slice(0, MAX_SLUG_LENGTH);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > MAX_SLUG_LENGTH / 3 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

/**
 * The file the pasted text is stored as. Markdown, because that is what the
 * editor opens it with once the item becomes a ticket and the file lands in
 * the project.
 */
export function fileNameForPastedText(text: string): string {
  const name = slug(titleForPastedText(text));
  return `${name === '' ? 'note' : name}.md`;
}
