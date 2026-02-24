/**
 * Fix broken ASCII art box diagrams.
 *
 * Detects complete boxes (┌─┐ / │ │ / └─┘) and partial connector structures
 * (┌─┐ / │ │ without └, or │ │ / └─┘ without ┌), then reconstructs each
 * line with correct borders and content alignment.
 *
 * Translated from ascii_fix.py — uses majority voting, fuzzy matching,
 * and full line reconstruction.
 */

// ---------------------------------------------------------------------------
// Box-drawing constants
// ---------------------------------------------------------------------------

const VERTICAL = '│';
const HORIZONTAL = '─';
const TOP_LEFT = '┌';
const TOP_RIGHT = '┐';
const BOTTOM_LEFT = '└';
const BOTTOM_RIGHT = '┘';
const _CONNECTOR_CHARS = new Set(['┬', '┴', '├', '┤', '┼']);

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

interface Box {
  topRow: number;
  bottomRow: number;
  leftCol: number;
  rightCol: number;
  hasTop: boolean;
  hasBottom: boolean;
}

// ---------------------------------------------------------------------------
// Counter helpers (replacement for Python's collections.Counter)
// ---------------------------------------------------------------------------

function counterIncrement(counter: Map<number, number>, key: number, amount = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + amount);
}

function counterMostCommon(counter: Map<number, number>): number {
  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of counter) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

// ---------------------------------------------------------------------------
// Fuzzy character search
// ---------------------------------------------------------------------------

function findCharNear(line: string, target: number, char: string, maxOff = 3): number | null {
  let best: number | null = null;
  let bestDist = maxOff + 1;
  for (let offset = -maxOff; offset <= maxOff; offset++) {
    const col = target + offset;
    if (col >= 0 && col < line.length && line[col] === char) {
      const dist = Math.abs(offset);
      if (dist < bestDist) {
        best = col;
        bestDist = dist;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Box detection
// ---------------------------------------------------------------------------

function findBoxes(lines: string[]): Box[] {
  const boxes: Box[] = [];
  const used = new Set<string>();

  // Pass 1: Find boxes starting from ┌ (complete or top-only partial)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === TOP_LEFT && !used.has(`${i},${j}`)) {
        const box = traceBoxFromTop(lines, i, j);
        if (box) {
          used.add(`${i},${box.leftCol}`);
          boxes.push(box);
        }
      }
    }
  }

  // Pass 2: Find bottom-only partial boxes (└─┘ with │ above, no ┌)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === BOTTOM_LEFT && !used.has(`${i},${j}`)) {
        const alreadyCovered = boxes.some((b) => b.bottomRow === i && Math.abs(b.leftCol - j) <= 3);
        if (!alreadyCovered) {
          const box = traceBoxFromBottom(lines, i, j);
          if (box) {
            used.add(`${i},${j}`);
            boxes.push(box);
          }
        }
      }
    }
  }

  return boxes;
}

// ---------------------------------------------------------------------------
// Box tracing
// ---------------------------------------------------------------------------

function traceBoxFromTop(lines: string[], topRow: number, initialLeft: number): Box | null {
  const contentRows: number[] = [];
  let bottomRow: number | null = null;

  for (let row = topRow + 1; row < lines.length; row++) {
    const line = lines[row];
    if (findCharNear(line, initialLeft, BOTTOM_LEFT, 6) !== null) {
      bottomRow = row;
      break;
    } else if (findCharNear(line, initialLeft, VERTICAL) !== null) {
      contentRows.push(row);
    } else {
      break;
    }
  }

  if (contentRows.length === 0) return null;

  const hasBottom = bottomRow !== null;
  if (!hasBottom) {
    bottomRow = contentRows[contentRows.length - 1];
  }

  // Determine leftCol (majority vote: borders + content)
  const leftVotes = new Map<number, number>();
  counterIncrement(leftVotes, initialLeft);
  if (hasBottom) {
    const bl = findCharNear(lines[bottomRow!], initialLeft, BOTTOM_LEFT);
    if (bl !== null) counterIncrement(leftVotes, bl);
  }
  for (const r of contentRows) {
    const pos = findCharNear(lines[r], initialLeft, VERTICAL);
    if (pos !== null) counterIncrement(leftVotes, pos);
  }
  const leftCol = counterMostCommon(leftVotes);

  const rightCol = determineRightCol(
    lines,
    contentRows,
    topRow,
    hasBottom ? bottomRow : null,
    leftCol
  );
  if (rightCol === null) return null;

  return {
    topRow,
    bottomRow: bottomRow!,
    leftCol,
    rightCol,
    hasTop: true,
    hasBottom,
  };
}

function traceBoxFromBottom(lines: string[], bottomRow: number, initialLeft: number): Box | null {
  const contentRows: number[] = [];

  for (let row = bottomRow - 1; row >= 0; row--) {
    const line = lines[row];
    if (findCharNear(line, initialLeft, VERTICAL) !== null) {
      contentRows.push(row);
    } else {
      break;
    }
  }

  if (contentRows.length === 0) return null;

  contentRows.reverse();
  const topRow = contentRows[0];

  // Determine leftCol
  const leftVotes = new Map<number, number>();
  counterIncrement(leftVotes, initialLeft);
  for (const r of contentRows) {
    const pos = findCharNear(lines[r], initialLeft, VERTICAL);
    if (pos !== null) counterIncrement(leftVotes, pos);
  }
  const leftCol = counterMostCommon(leftVotes);

  const rightCol = determineRightCol(lines, contentRows, null, bottomRow, leftCol);
  if (rightCol === null) return null;

  return {
    topRow,
    bottomRow,
    leftCol,
    rightCol,
    hasTop: false,
    hasBottom: true,
  };
}

// ---------------------------------------------------------------------------
// Right column detection (weighted voting)
// ---------------------------------------------------------------------------

function determineRightCol(
  lines: string[],
  contentRows: number[],
  topRow: number | null,
  bottomRow: number | null,
  leftCol: number
): number | null {
  const contentVotes = new Map<number, number>();
  for (const r of contentRows) {
    const line = lines[r];
    const leftPipe = findCharNear(line, leftCol, VERTICAL);
    if (leftPipe === null) continue;

    let extraLeft = 0;
    let pos = leftPipe + 1;
    while (pos < line.length && line[pos] === VERTICAL) {
      extraLeft++;
      pos++;
    }

    const contentStart = leftPipe + 1 + extraLeft;
    for (let j = contentStart; j < line.length; j++) {
      if (line[j] === VERTICAL) {
        counterIncrement(contentVotes, j - extraLeft);
        break;
      }
    }
  }

  const borderVotes = new Map<number, number>();
  if (topRow !== null) {
    const topLine = lines[topRow];
    for (let j = leftCol + 1; j < topLine.length; j++) {
      if (topLine[j] === TOP_RIGHT) {
        counterIncrement(borderVotes, j);
        break;
      }
    }
  }

  if (bottomRow !== null) {
    const bottomLine = lines[bottomRow];
    const bl = findCharNear(bottomLine, leftCol, BOTTOM_LEFT);
    if (bl !== null) {
      for (let j = bl + 1; j < bottomLine.length; j++) {
        if (bottomLine[j] === BOTTOM_RIGHT) {
          counterIncrement(borderVotes, j);
          break;
        }
      }
    }
  }

  const combined = new Map<number, number>();
  for (const [col, count] of contentVotes) {
    counterIncrement(combined, col, count * 3);
  }
  for (const [col, count] of borderVotes) {
    counterIncrement(combined, col, count);
  }

  if (combined.size > 0) {
    return counterMostCommon(combined);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Line reconstruction
// ---------------------------------------------------------------------------

function reconstructLine(lines: string[], boxes: Box[], row: number): string {
  const original = lines[row];
  const maxEnd = Math.max(...boxes.map((b) => b.rightCol)) + 1;
  const result = new Array(Math.max(original.length, maxEnd)).fill(' ');

  const sorted = [...boxes].sort((a, b) => a.leftCol - b.leftCol);
  for (const box of sorted) {
    let region: string;
    if (row === box.topRow && box.hasTop) {
      region = buildTopBorder(box, lines, row);
    } else if (row === box.bottomRow && box.hasBottom) {
      region = buildBottomBorder(box, lines, row);
    } else {
      region = buildContent(box, original);
    }

    for (let i = 0; i < region.length; i++) {
      result[box.leftCol + i] = region[i];
    }
  }

  return result.join('').trimEnd();
}

// ---------------------------------------------------------------------------
// Border builders
// ---------------------------------------------------------------------------

function buildTopBorder(box: Box, lines: string[], row: number): string {
  const width = box.rightCol - box.leftCol + 1;
  const connectors = connectorsFromAdjacent(lines, row - 1, box.leftCol, width, '┴');
  const border = (TOP_LEFT + HORIZONTAL.repeat(width - 2) + TOP_RIGHT).split('');
  for (const [pos, ch] of Object.entries(connectors)) {
    border[Number(pos)] = ch;
  }
  return border.join('');
}

function buildBottomBorder(box: Box, lines: string[], row: number): string {
  const width = box.rightCol - box.leftCol + 1;
  const connectors = connectorsFromAdjacent(lines, row + 1, box.leftCol, width, '┬');
  const border = (BOTTOM_LEFT + HORIZONTAL.repeat(width - 2) + BOTTOM_RIGHT).split('');
  for (const [pos, ch] of Object.entries(connectors)) {
    border[Number(pos)] = ch;
  }
  return border.join('');
}

// ---------------------------------------------------------------------------
// Connector detection from adjacent lines
// ---------------------------------------------------------------------------

function connectorsFromAdjacent(
  lines: string[],
  adjRow: number,
  boxLeft: number,
  width: number,
  connectorChar: string
): Record<number, string> {
  const connectors: Record<number, string> = {};
  if (adjRow < 0 || adjRow >= lines.length) return connectors;

  const adjLine = lines[adjRow];
  const pipeChars = new Set([VERTICAL, '┬', '┴', '├', '┤', '┼']);
  let prevWasPipe = false;

  for (let col = boxLeft + 1; col < boxLeft + width - 1; col++) {
    if (col < adjLine.length && pipeChars.has(adjLine[col])) {
      if (!prevWasPipe) {
        connectors[col - boxLeft] = connectorChar;
      }
      prevWasPipe = true;
    } else {
      prevWasPipe = false;
    }
  }

  return connectors;
}

// ---------------------------------------------------------------------------
// Content line builder
// ---------------------------------------------------------------------------

function buildContent(box: Box, original: string): string {
  const width = box.rightCol - box.leftCol + 1;
  const innerWidth = width - 2;

  const leftPipe = findCharNear(original, box.leftCol, VERTICAL);
  if (leftPipe === null) {
    return VERTICAL + ' '.repeat(innerWidth) + VERTICAL;
  }

  let contentStart = leftPipe + 1;
  while (contentStart < original.length && original[contentStart] === VERTICAL) {
    contentStart++;
  }

  const rightPipe = findCharNear(original, box.rightCol, VERTICAL);
  let content: string;
  if (rightPipe !== null && rightPipe > contentStart) {
    content = original.slice(contentStart, rightPipe);
  } else {
    content = original.slice(contentStart).trimEnd();
  }

  if (content.length < innerWidth) {
    content = content + ' '.repeat(innerWidth - content.length);
  } else if (content.length > innerWidth) {
    content = content.trimEnd();
    if (content.length < innerWidth) {
      content = content + ' '.repeat(innerWidth - content.length);
    } else {
      content = content.slice(0, innerWidth);
    }
  }

  return VERTICAL + content + VERTICAL;
}

// ---------------------------------------------------------------------------
// Connector line cleanup
// ---------------------------------------------------------------------------

function cleanConnectorLines(lines: string[], boxRows: Map<number, Box[]>): void {
  for (let i = 0; i < lines.length; i++) {
    if (boxRows.has(i)) continue;

    const line = lines[i];
    if ([...line].some((ch) => ch !== ' ' && ch !== VERTICAL && ch !== '▼' && ch !== '▲')) {
      continue;
    }

    const pipePositions: number[] = [];
    for (let j = 0; j < line.length; j++) {
      if (line[j] === VERTICAL) pipePositions.push(j);
    }
    if (pipePositions.length === 0) continue;

    const validChars = new Set([VERTICAL, '┬', '┴', '├', '┤', '┼', '▼', '▲']);
    const valid = new Set<number>();
    for (const pos of pipePositions) {
      for (const adj of [i - 1, i + 1]) {
        if (adj >= 0 && adj < lines.length && pos < lines[adj].length) {
          if (validChars.has(lines[adj][pos])) {
            valid.add(pos);
            break;
          }
        }
      }
    }

    const pipeSet = new Set(pipePositions);
    if (valid.size !== pipeSet.size || [...valid].some((v) => !pipeSet.has(v))) {
      const newLine = new Array(line.length).fill(' ');
      for (const pos of valid) {
        newLine[pos] = VERTICAL;
      }
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '▼' || line[j] === '▲') {
          newLine[j] = line[j];
        }
      }
      lines[i] = newLine.join('').trimEnd();
    }
  }
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

function fixAsciiArt(text: string): string {
  const lines = text.split('\n');
  const boxes = findBoxes(lines);
  if (boxes.length === 0) return text;

  const boxRows = new Map<number, Box[]>();
  for (const box of boxes) {
    for (let row = box.topRow; row <= box.bottomRow; row++) {
      if (!boxRows.has(row)) boxRows.set(row, []);
      boxRows.get(row)!.push(box);
    }
  }

  // Clean standalone connector lines FIRST so border reconstruction
  // sees correct │ positions when computing ┬/┴ connectors
  cleanConnectorLines(lines, boxRows);

  const sortedRows = [...boxRows.keys()].sort((a, b) => a - b);
  for (const row of sortedRows) {
    lines[row] = reconstructLine(lines, boxRows.get(row)!, row);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API (unchanged export contract)
// ---------------------------------------------------------------------------

export function repairAsciiArt(text: string): string {
  return fixAsciiArt(text);
}
