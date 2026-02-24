/**
 * Shared span type and overlap-aware collector for the NLP highlighting pipeline.
 * Used by both the regex layer (highlighter.ts) and the wink-nlp layer (winkAnalyzer.ts).
 */

export interface HighlightSpan {
  from: number;
  to: number;
  type:
    | 'entity'
    | 'action'
    | 'keyword'
    | 'prompt-directive'
    | 'prompt-context'
    | 'prompt-constraint'
    | 'variable-hash'
    | 'negated';
  hashColor?: string;
}

export class SpanCollector {
  private occupied = new Set<number>();
  readonly spans: HighlightSpan[] = [];

  add(
    from: number,
    to: number,
    type: HighlightSpan['type'],
    extra?: { hashColor?: string }
  ): boolean {
    if (from < 0 || from >= to) return false;
    for (let i = from; i < to; i++) {
      if (this.occupied.has(i)) return false;
    }
    for (let i = from; i < to; i++) this.occupied.add(i);
    this.spans.push({ from, to, type, ...extra });
    return true;
  }

  sorted(): HighlightSpan[] {
    return [...this.spans].sort((a, b) => a.from - b.from);
  }
}
