import winkNLP, { type ItemEntity, type ItemToken } from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import { PASCAL_CASE_REGEX } from '@/lib/nlp/patterns';
import { SpanCollector, type HighlightSpan } from '@/lib/nlp/spanCollector';

// ── Singleton wink-nlp instance ──
const nlp = winkNLP(model);
const its = nlp.its;

// ── Curated palette for recurring entity/variable colors ──
// Same word → same color (stable hash), but drawn from a tight, desaturated
// tonal set that harmonises with the dark theme — instead of sampling the full
// 360° neon colour wheel at 80% saturation. "Nothing is random." (Apple Craft.)
const VARIABLE_PALETTE = [
  '#b3a4e0', // lavender  (brand-adjacent)
  '#7fc9c2', // teal
  '#9dc8a0', // sage
  '#d8c08a', // sand
  '#d8a0b4', // rose
  '#93b4d8', // slate-blue
];

function getHashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return VARIABLE_PALETTE[Math.abs(hash) % VARIABLE_PALETTE.length];
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
 * Analyze text using wink-nlp's pipeline (NER + POS-tagging).
 * Emits entity spans (DATE, MONEY, URL, …) and variable-hash spans for
 * proper nouns / PascalCase identifiers. Returns HighlightSpan-compatible
 * spans with character offsets.
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

  // ── 2. Token-level analysis: proper-noun / PascalCase → variable-hash ──
  //
  // NOTE: plain verbs and *negation* are intentionally NOT highlighted.
  //   - Colouring every verb in prose is ink over the whole page (noise).
  //   - wink's negation flag marks the whole grammatical *scope*, not just the
  //     negated word, so a single "not" in a dense sentence struck through half
  //     a paragraph — including words that aren't negated in meaning (covered,
  //     legal, individual, other …). A hint that is both loud (strike-through
  //     reads as "deleted") and wrong is worse than no hint (Apple: cut it).
  let cursor = 0;

  doc.tokens().each((token: ItemToken) => {
    const tokenValue = token.out();
    const pos = token.out(its.pos);
    const precedingSpaces = token.out(its.precedingSpaces);

    cursor += precedingSpaces.length;

    const tokenFrom = cursor;
    const tokenTo = cursor + tokenValue.length;

    if (pos === 'PUNCT' || pos === 'DET' || pos === 'SPACE') {
      cursor = tokenTo;
      return;
    }

    // PROPN or PascalCase → variable-hash with color
    if (pos === 'PROPN' || PASCAL_CASE_REGEX.test(tokenValue)) {
      collector.add(tokenFrom, tokenTo, 'variable-hash', { hashColor: getHashColor(tokenValue) });
    }

    cursor = tokenTo;
  });

  return collector.sorted();
}
