import { describe, expect, it, vi } from 'vitest';

const analyzeText = vi.fn((text: string) => [{ from: 0, to: text.length, type: 'keyword' }]);
vi.mock('@/lib/nlp/highlighter', () => ({ analyzeText: (t: string) => analyzeText(t) }));

import { createVisibleRangeAnalyzer } from './visibleRangeSpans';

// A viewport change that leaves the visible text as it was (a re-measure, an
// edit outside the visible ranges) used to re-run the full NLP pass anyway.
describe('createVisibleRangeAnalyzer', () => {
  it('analyzes each visible text once while it stays visible', () => {
    analyzeText.mockClear();
    const analyze = createVisibleRangeAnalyzer();
    const first = analyze(['alpha', 'beta']);
    const second = analyze(['alpha', 'beta']);
    expect(second).toEqual(first);
    expect(analyzeText).toHaveBeenCalledTimes(2);
  });

  it('analyzes only the texts that changed', () => {
    analyzeText.mockClear();
    const analyze = createVisibleRangeAnalyzer();
    analyze(['alpha', 'beta']);
    analyze(['alpha', 'gamma']);
    expect(analyzeText.mock.calls.map(([t]) => t)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('keeps only the latest build, so scrolled-away text is not retained', () => {
    analyzeText.mockClear();
    const analyze = createVisibleRangeAnalyzer();
    analyze(['alpha']);
    analyze(['beta']);
    analyze(['alpha']);
    expect(analyzeText).toHaveBeenCalledTimes(3);
  });
});
