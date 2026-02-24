import {
  PROMPT_CONSTRAINT_REGEX,
  PROMPT_CONTEXT_REGEX,
  PROMPT_DIRECTIVE_REGEX,
  STRUCTURE_REGEX,
} from '@/lib/nlp/patterns';
import { analyzeWithWink } from '@/lib/nlp/winkAnalyzer';
import { SpanCollector } from '@/lib/nlp/spanCollector';

// Re-export for existing consumers
export type { HighlightSpan } from '@/lib/nlp/spanCollector';
import type { HighlightSpan } from '@/lib/nlp/spanCollector';

export function analyzeText(text: string): HighlightSpan[] {
  if (!text || !text.trim()) return [];

  const collector = new SpanCollector();

  // ── Layer 1: Structural / Domain-Specific Patterns (Highest Priority) ──

  STRUCTURE_REGEX.lastIndex = 0;
  let match;
  while ((match = STRUCTURE_REGEX.exec(text)) !== null) {
    collector.add(match.index, match.index + match[0].length, 'keyword');
  }

  const promptRegexes: [RegExp, HighlightSpan['type']][] = [
    [PROMPT_DIRECTIVE_REGEX, 'prompt-directive'],
    [PROMPT_CONTEXT_REGEX, 'prompt-context'],
    [PROMPT_CONSTRAINT_REGEX, 'prompt-constraint'],
  ];

  for (const [regex, type] of promptRegexes) {
    regex.lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
      const labelEnd = match.index + match[0].indexOf(':') + 1;
      collector.add(match.index, labelEnd, type);
    }
  }

  // ── Layer 2: wink-nlp Analysis (POS, NER, Negation) ──
  const winkSpans = analyzeWithWink(text);

  for (const ws of winkSpans) {
    collector.add(ws.from, ws.to, ws.type, ws.hashColor ? { hashColor: ws.hashColor } : undefined);
  }

  return collector.sorted();
}
