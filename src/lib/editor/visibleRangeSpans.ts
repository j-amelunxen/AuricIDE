import { analyzeText, type HighlightSpan } from '@/lib/nlp/highlighter';

/**
 * `analyzeText` per visible range, reusing the previous build's result for a
 * range whose text is unchanged. The analysis is a pure function of the text,
 * so the spans are identical; only the previous build is kept, which bounds
 * the memo to what was on screen a moment ago.
 */
export function createVisibleRangeAnalyzer(): (texts: string[]) => HighlightSpan[][] {
  let previous = new Map<string, HighlightSpan[]>();
  return (texts) => {
    const current = new Map<string, HighlightSpan[]>();
    const result = texts.map((text) => {
      const spans = current.get(text) ?? previous.get(text) ?? analyzeText(text);
      current.set(text, spans);
      return spans;
    });
    previous = current;
    return result;
  };
}
