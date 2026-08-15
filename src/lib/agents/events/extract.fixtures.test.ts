import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createEventExtractor } from './extract';
import type { AgentEvent } from './types';

/**
 * These fixtures are the contract for every provider matcher: hand-authored
 * from the known Claude Code / Codex CLI / generic-shell TUI formats, not
 * captured from a live session (no real project ever ran through this). A
 * matcher change that breaks one of these is a behaviour change, not a typo.
 */
const FIXTURES_ROOT = join(__dirname, '..', '..', '..', '..', 'fixtures', 'agent-events');

interface FixtureCase {
  provider: string;
  name: string;
  raw: string;
  expected: Array<Omit<AgentEvent, 'at'>>;
}

function loadFixtureCases(): FixtureCase[] {
  const cases: FixtureCase[] = [];
  for (const provider of readdirSync(FIXTURES_ROOT)) {
    const dir = join(FIXTURES_ROOT, provider);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.txt')) continue;
      const name = file.replace(/\.txt$/, '');
      const raw = readFileSync(join(dir, file), 'utf8');
      const expected = JSON.parse(readFileSync(join(dir, `${name}.expected.json`), 'utf8'));
      cases.push({ provider, name, raw, expected });
    }
  }
  return cases;
}

/** A small seeded PRNG (mulberry32) so chunk-boundary tests are reproducible. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fixtures assert content, not ordering machinery — `at` is chunking detail
 * and `seq` exists purely to break ties between same-`at` events in the
 * feed, neither is part of the contract these fixtures pin down.
 */
function withoutVolatileFields(events: AgentEvent[]): Array<Omit<AgentEvent, 'at' | 'seq'>> {
  return events.map(({ at: _at, seq: _seq, ...rest }) => rest);
}

function feedAsOneChunk(providerId: string, raw: string): Array<Omit<AgentEvent, 'at' | 'seq'>> {
  const extractor = createEventExtractor(providerId);
  return withoutVolatileFields(extractor.push(raw, 0));
}

/** Splits `raw` at random byte offsets and feeds it chunk by chunk, proving
 * the extractor doesn't depend on where the PTY happened to cut a line. */
function feedInRandomChunks(
  providerId: string,
  raw: string,
  seed: number
): Array<Omit<AgentEvent, 'at' | 'seq'>> {
  const extractor = createEventExtractor(providerId);
  const random = mulberry32(seed);
  const events: AgentEvent[] = [];
  let offset = 0;
  let at = 0;
  while (offset < raw.length) {
    const size = 1 + Math.floor(random() * 24);
    events.push(...extractor.push(raw.slice(offset, offset + size), at));
    offset += size;
    at += 1;
  }
  return withoutVolatileFields(events);
}

const cases = loadFixtureCases();

describe('agent event extraction fixtures', () => {
  it('found fixtures for every provider matcher', () => {
    expect(new Set(cases.map((c) => c.provider))).toEqual(new Set(['claude', 'codex', 'generic']));
  });

  for (const testCase of cases) {
    describe(`${testCase.provider}/${testCase.name}`, () => {
      it('extracts the expected events fed as a single chunk', () => {
        expect(feedAsOneChunk(testCase.provider, testCase.raw)).toEqual(testCase.expected);
      });

      it('extracts the same events regardless of chunk boundaries', () => {
        expect(feedInRandomChunks(testCase.provider, testCase.raw, 42)).toEqual(testCase.expected);
        // A different split shape must not change the result either.
        expect(feedInRandomChunks(testCase.provider, testCase.raw, 1337)).toEqual(
          testCase.expected
        );
      });
    });
  }
});
