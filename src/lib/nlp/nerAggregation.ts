import type { NerEntity } from './deepAnalysisWorker';

/**
 * Raw per-token output of transformers.js' token-classification pipeline.
 * Unlike the Python library it does NOT aggregate: `entity` is a BIO tag
 * ("B-PER", "I-LOC", …), `word` is a single decoded (sub)word, and there are
 * no character offsets ("TODO: Add support for start and end" upstream).
 */
export interface RawNerToken {
  entity: string;
  score: number;
  index: number;
  word: string;
}

const BIO_TAG_REGEX = /^([BI])-(\w+)$/;
const WORD_CHAR_REGEX = /[\p{L}\p{N}]/u;

interface OpenGroup {
  type: string;
  start: number;
  end: number;
  scores: number[];
  lastIndex: number;
}

/**
 * Aggregate BIO-tagged tokens into entity groups with character offsets.
 *
 * Offsets are reconstructed by walking the source text with a forward cursor:
 * each token word is located at or after the previous one, and "##" WordPiece
 * continuations must sit flush against the cursor. Tokens that cannot be
 * aligned are dropped — a missing hint is fine, a misplaced one is not.
 */
export function aggregateNerTokens(tokens: RawNerToken[], text: string): NerEntity[] {
  const entities: NerEntity[] = [];
  let cursor = 0;
  let current: OpenGroup | null = null;

  const flush = () => {
    if (!current) return;
    // Snap to word boundaries: the model often tags only some subwords of an
    // unusual compound ("Au" of "AuricIDE") — a half-underlined word reads as
    // a rendering bug, not as a hint.
    let { start, end } = current;
    while (start > 0 && WORD_CHAR_REGEX.test(text[start - 1])) start--;
    while (end < text.length && WORD_CHAR_REGEX.test(text[end])) end++;
    entities.push({
      entity_group: current.type,
      score: current.scores.reduce((sum, s) => sum + s, 0) / current.scores.length,
      word: text.slice(start, end),
      start,
      end,
    });
    current = null;
  };

  for (const token of tokens) {
    const match = BIO_TAG_REGEX.exec(token.entity);
    if (!match) {
      flush();
      continue;
    }
    const [, bio, type] = match;

    const isSubwordContinuation = token.word.startsWith('##');
    const raw = isSubwordContinuation ? token.word.slice(2) : token.word;
    if (!raw) continue;

    let start: number;
    if (isSubwordContinuation && text.startsWith(raw, cursor)) {
      start = cursor;
    } else {
      start = text.indexOf(raw, cursor);
      if (start < 0) {
        flush();
        continue;
      }
    }
    const end = start + raw.length;
    cursor = end;

    const continues =
      current !== null &&
      current.type === type &&
      (bio === 'I' || isSubwordContinuation) &&
      token.index === current.lastIndex + 1;

    if (continues && current) {
      current.end = end;
      current.scores.push(token.score);
      current.lastIndex = token.index;
    } else {
      flush();
      current = { type, start, end, scores: [token.score], lastIndex: token.index };
    }
  }

  flush();
  return entities;
}
