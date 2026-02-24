import winkNLP, { type ItemEntity, type ItemToken } from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import { PASCAL_CASE_REGEX } from '@/lib/nlp/patterns';
import { SpanCollector, type HighlightSpan } from '@/lib/nlp/spanCollector';

// ── Singleton wink-nlp instance ──
const nlp = winkNLP(model);
const its = nlp.its;

// ── HSL to Hex helper for variable hashing ──
function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getHashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash % 360);
  return hslToHex(h, 80, 65);
}

// Entity types that make sense for highlighting (hoisted for perf)
const VALID_ENTITY_TYPES = new Set([
  'DATE',
  'TIME',
  'DURATION',
  'MONEY',
  'PERCENT',
  'URL',
  'EMAIL',
  'HASHTAG',
  'ORDINAL',
  'CARDINAL',
]);

/**
 * Analyze text using wink-nlp's full pipeline (POS-tagging, NER, negation).
 * Returns HighlightSpan-compatible spans with character offsets.
 */
export function analyzeWithWink(text: string): HighlightSpan[] {
  if (!text || !text.trim()) return [];

  const doc = nlp.readDoc(text);
  const collector = new SpanCollector();

  // ── 1. Named Entities from wink-nlp (DATE, TIME, MONEY, URL, EMAIL, etc.) ──
  let entitySearchOffset = 0;
  doc.entities().each((entity: ItemEntity) => {
    const entityText = entity.out();
    const entityType = entity.out(its.type);

    if (!VALID_ENTITY_TYPES.has(entityType)) return;

    // Track search offset to handle duplicate entity text correctly
    const idx = text.indexOf(entityText, entitySearchOffset);
    if (idx >= 0) {
      collector.add(idx, idx + entityText.length, 'entity');
      entitySearchOffset = idx + entityText.length;
    }
  });

  // ── 2. Token-level analysis: POS, negation ──
  let cursor = 0;

  doc.tokens().each((token: ItemToken) => {
    const tokenValue = token.out();
    const pos = token.out(its.pos);
    const negationFlag = token.out(its.negationFlag);
    const precedingSpaces = token.out(its.precedingSpaces);

    cursor += precedingSpaces.length;

    const tokenFrom = cursor;
    const tokenTo = cursor + tokenValue.length;

    if (pos === 'PUNCT' || pos === 'DET' || pos === 'SPACE') {
      cursor = tokenTo;
      return;
    }

    // Negated verbs/adjectives get 'negated' type (highest priority among token-level)
    if (negationFlag && (pos === 'VERB' || pos === 'ADJ' || pos === 'AUX')) {
      collector.add(tokenFrom, tokenTo, 'negated');
      cursor = tokenTo;
      return;
    }

    // VERB → action
    if (pos === 'VERB') {
      collector.add(tokenFrom, tokenTo, 'action');
    }

    // PROPN or PascalCase → variable-hash with color
    if (pos === 'PROPN' || PASCAL_CASE_REGEX.test(tokenValue)) {
      collector.add(tokenFrom, tokenTo, 'variable-hash', { hashColor: getHashColor(tokenValue) });
    }

    cursor = tokenTo;
  });

  return collector.sorted();
}
