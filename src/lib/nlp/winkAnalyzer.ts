import winkNLP, { type ItemEntity } from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import { SpanCollector, type HighlightSpan } from '@/lib/nlp/spanCollector';

// ── Singleton wink-nlp instance ──
const nlp = winkNLP(model);
const its = nlp.its;

// Entity types worth a quiet hint: facts a reader scans a document for —
// commitments (dates, times), amounts, and addresses.
//
// Deliberately absent: ORDINAL/CARDINAL/DURATION/HASHTAG ("first", "500",
// "three weeks") — they decorated half of ordinary prose while answering no
// question. Also absent: verbs, negation, proper nouns and PascalCase — in
// technical markdown every third word is a proper noun (Rust, CodeMirror,
// Tauri …); colouring a word class is recognising, not helping, and it
// painted entire READMEs. Prose reads as prose (Apple: simplicity is
// deciding what NOT to build).
const VALID_ENTITY_TYPES = new Set(['DATE', 'TIME', 'MONEY', 'PERCENT', 'URL', 'EMAIL']);

/**
 * Analyze text using wink-nlp NER.
 * Emits entity spans (DATE, TIME, MONEY, PERCENT, URL, EMAIL) with
 * character offsets.
 */
export function analyzeWithWink(text: string): HighlightSpan[] {
  if (!text || !text.trim()) return [];

  const doc = nlp.readDoc(text);
  const collector = new SpanCollector();

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

  return collector.sorted();
}
