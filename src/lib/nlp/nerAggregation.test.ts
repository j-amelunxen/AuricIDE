import { describe, expect, it } from 'vitest';
import { aggregateNerTokens, type RawNerToken } from './nerAggregation';

function t(entity: string, word: string, index: number, score = 0.99): RawNerToken {
  return { entity, word, index, score };
}

describe('aggregateNerTokens', () => {
  it('maps single-token entities to groups with character offsets', () => {
    const text = 'My name is Sarah and I live in London';
    const out = aggregateNerTokens([t('B-PER', 'Sarah', 4), t('B-LOC', 'London', 9)], text);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ entity_group: 'PER', word: 'Sarah', start: 11, end: 16 });
    expect(out[1]).toMatchObject({ entity_group: 'LOC', word: 'London', start: 31, end: 37 });
  });

  it('merges consecutive B-/I- tokens into one entity ("New York")', () => {
    const text = 'She flew to New York yesterday';
    const out = aggregateNerTokens([t('B-LOC', 'New', 4), t('I-LOC', 'York', 5)], text);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ entity_group: 'LOC', word: 'New York', start: 12, end: 20 });
  });

  it('glues ## subword continuations without whitespace ("Merkel" = Mer + ##kel)', () => {
    const text = 'Angela Merkel spoke';
    const out = aggregateNerTokens(
      [t('B-PER', 'Angela', 1), t('I-PER', 'Mer', 2), t('I-PER', '##kel', 3)],
      text
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ entity_group: 'PER', word: 'Angela Merkel', start: 0, end: 13 });
  });

  it('splits same-type entities separated by a token-index gap', () => {
    const text = 'Paris and later Berlin';
    const out = aggregateNerTokens([t('B-LOC', 'Paris', 1), t('B-LOC', 'Berlin', 4)], text);
    expect(out).toHaveLength(2);
    expect(out[0].word).toBe('Paris');
    expect(out[1].word).toBe('Berlin');
  });

  it('averages the scores of merged tokens', () => {
    const text = 'New York';
    const out = aggregateNerTokens([t('B-LOC', 'New', 0, 0.8), t('I-LOC', 'York', 1, 0.6)], text);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBeCloseTo(0.7);
  });

  it('resolves duplicate words to successive occurrences', () => {
    const text = 'Paris met Paris';
    const out = aggregateNerTokens([t('B-LOC', 'Paris', 0), t('B-LOC', 'Paris', 2)], text);
    expect(out).toHaveLength(2);
    expect(out[0].start).toBe(0);
    expect(out[1].start).toBe(10);
  });

  it('drops tokens that cannot be aligned with the text without crashing', () => {
    const text = 'plain text';
    const out = aggregateNerTokens([t('B-PER', 'Ghost', 0)], text);
    expect(out).toEqual([]);
  });

  it('ignores O and malformed labels', () => {
    const text = 'Sarah runs';
    const out = aggregateNerTokens([t('O', 'runs', 2), t('LABEL_5', 'Sarah', 1)], text);
    expect(out).toEqual([]);
  });

  it('snaps a group that ends mid-word out to the full word', () => {
    // The model often tags only the first subwords of an unusual compound
    // ("Au" of "AuricIDE") — a half-underlined word reads as a rendering bug.
    const text = 'The AuricIDE roadmap and the FluxCapacitor service';
    const out = aggregateNerTokens(
      [
        t('B-ORG', 'Au', 1),
        t('B-MISC', 'Flux', 6),
        t('I-MISC', '##Capa', 7),
        t('I-MISC', '##ci', 8),
      ],
      text
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ entity_group: 'ORG', word: 'AuricIDE', start: 4, end: 12 });
    expect(out[1]).toMatchObject({
      entity_group: 'MISC',
      word: 'FluxCapacitor',
      start: 29,
      end: 42,
    });
  });

  it('snaps a group that starts mid-word back to the word start', () => {
    const text = 'The AuricIDE roadmap';
    const out = aggregateNerTokens([t('B-ORG', '##ric', 2)], text);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ word: 'AuricIDE', start: 4, end: 12 });
  });
});
