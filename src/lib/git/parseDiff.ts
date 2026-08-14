export interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

export interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
  isHeader?: boolean;
}

const GIT_METADATA_PREFIXES = [
  'diff --git',
  'index ',
  'old file mode',
  'new file mode',
  'deleted file mode',
  'similarity index',
  'dissimilarity index',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
  'Binary files',
  'GIT binary patch',
] as const;

const NO_NEWLINE_MARKER = '\\ No newline at end of file';

export function isGitMetadataLine(line: string): boolean {
  if (line === NO_NEWLINE_MARKER) return true;
  return GIT_METADATA_PREFIXES.some((prefix) => line.startsWith(prefix));
}

export function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (isGitMetadataLine(line)) continue;

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: 'header', content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      result.push({ type: 'header', content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith('+')) {
      result.push({ type: 'added', content: line.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (line.startsWith('-')) {
      result.push({ type: 'removed', content: line.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (line.length > 0) {
      result.push({
        type: 'context',
        content: line.startsWith(' ') ? line.slice(1) : line,
        oldLineNo: oldLine,
        newLineNo: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

export function buildSideBySideRows(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === 'header') {
      rows.push({ left: line, right: line, isHeader: true });
      i++;
      continue;
    }

    if (line.type === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];

    while (i < lines.length && lines[i].type === 'removed') {
      removed.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].type === 'added') {
      added.push(lines[i]);
      i++;
    }

    const maxLen = Math.max(removed.length, added.length);
    for (let j = 0; j < maxLen; j++) {
      rows.push({
        left: j < removed.length ? removed[j] : null,
        right: j < added.length ? added[j] : null,
      });
    }
  }

  return rows;
}
