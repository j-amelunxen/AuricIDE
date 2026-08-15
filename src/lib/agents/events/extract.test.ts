import { describe, expect, it } from 'vitest';
import { createEventExtractor, MAX_PARTIAL_LINE_BYTES } from './extract';
import type { AgentEvent } from './types';

describe('createEventExtractor', () => {
  it('emits nothing until a line is completed by a newline', () => {
    const extractor = createEventExtractor('generic');
    expect(extractor.push('$ pnpm te', 0)).toEqual([]);
  });

  it('emits the event once the rest of the line arrives in a later chunk', () => {
    const extractor = createEventExtractor('generic');
    extractor.push('$ pnpm te', 0);
    const events = extractor.push('st:run\n', 1);
    expect(events).toEqual([{ kind: 'run', label: 'Ran pnpm test:run', at: 1, seq: 0 }]);
  });

  it('handles a line split across three separate chunks', () => {
    const extractor = createEventExtractor('generic');
    extractor.push('$ pn', 0);
    extractor.push('pm lin', 1);
    const events = extractor.push('t\n', 2);
    expect(events).toEqual([{ kind: 'run', label: 'Ran pnpm lint', at: 2, seq: 0 }]);
  });

  it('emits every complete line in a single multi-line chunk', () => {
    const extractor = createEventExtractor('generic');
    const events = extractor.push('$ pnpm lint\n$ pnpm test:run\n', 0);
    expect(events.map((e) => e.label)).toEqual(['Ran pnpm lint', 'Ran pnpm test:run']);
  });

  it('treats a lone carriage return as a line break, like a redrawn progress bar', () => {
    const extractor = createEventExtractor('generic');
    const events = extractor.push('$ pnpm lint\r$ pnpm test:run\n', 0);
    expect(events.map((e) => e.label)).toEqual(['Ran pnpm lint', 'Ran pnpm test:run']);
  });

  it('stamps every event in a chunk with that chunk\'s "at" timestamp', () => {
    const extractor = createEventExtractor('generic');
    const events = extractor.push('$ pnpm lint\n$ pnpm test:run\n', 555);
    expect(events.every((e) => e.at === 555)).toBe(true);
  });

  it('drops a redrawn identical line rather than emitting it twice', () => {
    const extractor = createEventExtractor('claude');
    extractor.push('⏺ Read(src/lib/example.ts)\n', 0);
    const events = extractor.push('⏺ Read(src/lib/example.ts)\n', 1);
    expect(events).toEqual([]);
  });

  it('does not dedupe once a different event has come in between', () => {
    const extractor = createEventExtractor('generic');
    extractor.push('Wrote src/lib/example.ts\n', 0);
    extractor.push('Reading src/lib/other.ts\n', 1);
    const events = extractor.push('Wrote src/lib/example.ts\n', 2);
    expect(events).toEqual([
      {
        kind: 'edit',
        label: 'Edited src/lib/example.ts',
        path: 'src/lib/example.ts',
        at: 2,
        seq: 2,
      },
    ]);
  });

  it('falls back to the generic matcher for an unknown provider id', () => {
    const extractor = createEventExtractor('some-future-cli');
    const events = extractor.push('$ pnpm build\n', 0);
    expect(events).toEqual([{ kind: 'run', label: 'Ran pnpm build', at: 0, seq: 0 }]);
  });

  it('keeps separate extractor instances independent', () => {
    const first = createEventExtractor('claude');
    const second = createEventExtractor('claude');
    first.push('⏺ Bash(pnpm lint)\n', 0);
    // The second extractor never saw a tool line, so it has no "last tool
    // call" memory — its permission label must fall back to the question.
    const events = second.push('Do you want to proceed?\n', 0);
    expect(events).toEqual([
      { kind: 'ask', label: 'Permission requested: Do you want to proceed?', at: 0, seq: 0 },
    ]);
  });

  it('assigns a monotonically increasing seq to each emitted event, resetting per instance', () => {
    const extractor = createEventExtractor('generic');
    const events = extractor.push('$ pnpm lint\n$ pnpm test:run\n', 0);
    expect(events.map((e) => e.seq)).toEqual([0, 1]);

    const fresh = createEventExtractor('generic');
    expect(fresh.push('$ pnpm build\n', 0)[0].seq).toBe(0);
  });

  it('caps the unterminated partial-line buffer, evicting old content from the front', () => {
    const extractor = createEventExtractor('generic');
    // No newline yet — this text sits in the buffer as one growing incomplete
    // line. Once enough filler arrives after it, the cap must have pushed
    // this recognizable prefix out the front.
    extractor.push('Wrote src/lib/early.ts', 0);
    extractor.push('x'.repeat(MAX_PARTIAL_LINE_BYTES + 10_000), 1);
    const events = extractor.push('\n', 2);
    expect(events).toEqual([]);
  });

  it('still parses normally when content stays under the partial-line cap', () => {
    const extractor = createEventExtractor('generic');
    extractor.push('x'.repeat(MAX_PARTIAL_LINE_BYTES - 10), 0);
    const events = extractor.push('\n$ pnpm lint\n', 1);
    expect(events.map((e) => e.label)).toEqual(['Ran pnpm lint']);
  });

  it('collapses an alternating permission-menu redraw, not just literally-adjacent repeats', () => {
    // Reproduces a real Claude Code menu: two option lines print every
    // redraw, so the same text is never *immediately* repeated even though
    // the whole menu clearly is. No prior tool line means the label falls
    // back to each option line's own text — genuinely different labels.
    const extractor = createEventExtractor('claude');
    const all: AgentEvent[] = [];
    for (let redraw = 0; redraw < 3; redraw++) {
      all.push(...extractor.push('❯ 1. Yes\n', redraw));
      all.push(...extractor.push('  2. No\n', redraw));
    }
    expect(all).toHaveLength(2);
    expect(all.every((e) => e.kind === 'ask')).toBe(true);
  });

  it('never applies the wide redraw window to edit/read/run kinds, even within it', () => {
    // The ring widens the dedupe window to ~5 for the chatty kinds
    // (ask/note) only. Five intervening reads sit fully inside that window —
    // if edits were caught by the same wide net, this repeat would wrongly
    // vanish. Edits keep the tighter "only the immediately preceding match"
    // rule, so a real repeated action must still show up.
    const extractor = createEventExtractor('generic');
    extractor.push('Wrote src/lib/example.ts\n', 0);
    for (const path of ['a', 'b', 'c', 'd', 'e']) {
      extractor.push(`Reading src/lib/${path}.ts\n`, 1);
    }
    const events = extractor.push('Wrote src/lib/example.ts\n', 2);
    expect(events).toEqual([
      {
        kind: 'edit',
        label: 'Edited src/lib/example.ts',
        path: 'src/lib/example.ts',
        at: 2,
        seq: 6,
      },
    ]);
  });
});
