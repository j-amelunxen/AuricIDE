import { describe, expect, it, vi } from 'vitest';
import type { ConflictSegment } from './conflictModel';
import { buildProposalPrompt, parseProposal, proposeResolution } from './agentProposal';

const conflict: ConflictSegment = {
  kind: 'conflict',
  index: 0,
  ours: ['const limit = 10;'],
  base: ['const limit = 5;'],
  theirs: ['const limit = 20;'],
};

const input = {
  filePath: 'src/config.ts',
  oursLabel: 'main',
  theirsLabel: 'feature/limits',
  conflict,
  before: Array.from({ length: 30 }, (_, i) => `before ${i}`),
  after: Array.from({ length: 30 }, (_, i) => `after ${i}`),
};

function json(value: unknown): string {
  return JSON.stringify(value);
}

const good = {
  resolution: 'const limit = 20;',
  rationale: 'Incoming raised it.',
  confidence: 'high',
};

describe('buildProposalPrompt', () => {
  it('states what each side meant, by its commit subjects, when they are known', () => {
    const prompt = buildProposalPrompt({
      ...input,
      intent: { ours: ['Lower the limit for tests'], theirs: ['Raise limit', 'Tune limits'] },
    });
    expect(prompt).toContain('Side "main" changed this region in: "Lower the limit for tests".');
    expect(prompt).toContain(
      'Side "feature/limits" changed this region in: "Raise limit"; "Tune limits".'
    );
  });

  it('leaves out a side without commits, and is unchanged without intent', () => {
    const plain = buildProposalPrompt(input);
    expect(buildProposalPrompt({ ...input, intent: undefined })).toBe(plain);
    expect(buildProposalPrompt({ ...input, intent: { ours: [], theirs: [] } })).toBe(plain);
    const one = buildProposalPrompt({ ...input, intent: { ours: [], theirs: ['Raise limit'] } });
    expect(one).toContain('Side "feature/limits" changed this region in: "Raise limit".');
    expect(one).not.toContain('Side "main" changed this region in');
  });

  it('names the file and both branches, and includes both sides and the base', () => {
    const prompt = buildProposalPrompt(input);
    expect(prompt).toContain('src/config.ts');
    expect(prompt).toContain('main');
    expect(prompt).toContain('feature/limits');
    expect(prompt).toContain('const limit = 10;');
    expect(prompt).toContain('const limit = 5;');
    expect(prompt).toContain('const limit = 20;');
    expect(prompt).toMatch(/"resolution"/);
    expect(prompt).toMatch(/"confidence"/);
  });

  it('keeps only about 15 lines of context on each side, nearest the conflict', () => {
    const prompt = buildProposalPrompt(input);
    expect(prompt).toContain('before 29');
    expect(prompt).toContain('before 15');
    expect(prompt).not.toContain('before 14\n');
    expect(prompt).toContain('after 0');
    expect(prompt).toContain('after 14');
    expect(prompt).not.toContain('after 15');
  });

  it('says so when there is no common ancestor', () => {
    const prompt = buildProposalPrompt({ ...input, conflict: { ...conflict, base: null } });
    expect(prompt).toMatch(/no common ancestor/i);
  });
});

describe('parseProposal', () => {
  it('accepts strict JSON and splits the resolution into lines', () => {
    const r = parseProposal(json({ ...good, resolution: 'a\nb' }), conflict);
    expect(r).toEqual({
      ok: true,
      lines: ['a', 'b'],
      rationale: good.rationale,
      confidence: 'high',
    });
  });

  it('drops one trailing newline from the resolution', () => {
    const r = parseProposal(json({ ...good, resolution: 'a\n' }), conflict);
    expect(r).toMatchObject({ ok: true, lines: ['a'] });
  });

  it('tolerates a json code fence', () => {
    const r = parseProposal('```json\n' + json(good) + '\n```', conflict);
    expect(r.ok).toBe(true);
  });

  it.each([
    ['prose around the JSON', 'Here you go: ' + json(good)],
    ['invalid JSON', '{resolution: 1'],
    ['a non-object', '"text"'],
    ['missing rationale', json({ resolution: 'x', confidence: 'high' })],
    ['missing resolution', json({ rationale: 'x', confidence: 'high' })],
    ['bad confidence', json({ ...good, confidence: 'certain' })],
    ['a marker line', json({ ...good, resolution: 'a\n=======\nb' })],
    ['an open marker', json({ ...good, resolution: '<<<<<<< main\na' })],
    ['empty resolution while both sides have text', json({ ...good, resolution: '' })],
  ])('rejects %s', (_name, raw) => {
    const r = parseProposal(raw, conflict);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
  });

  it('accepts a separator line that one side really has (a setext heading)', () => {
    const heading = { ...conflict, theirs: ['Title', '======='] };
    const r = parseProposal(json({ ...good, resolution: 'Title\n=======' }), heading);
    expect(r).toMatchObject({ ok: true, lines: ['Title', '======='] });
  });

  it('accepts an empty resolution when one side is empty', () => {
    const r = parseProposal(json({ ...good, resolution: '' }), { ...conflict, theirs: [] });
    expect(r).toMatchObject({ ok: true, lines: [] });
  });

  it('truncates a long rationale instead of rejecting it', () => {
    const r = parseProposal(json({ ...good, rationale: 'x'.repeat(400) }), conflict);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rationale.length).toBeLessThanOrEqual(300);
  });
});

describe('proposeResolution', () => {
  it('asks the model once and parses its answer', async () => {
    const askLlm = vi.fn(async (_prompt: string) => json(good));
    const r = await proposeResolution({ ...input, askLlm });
    expect(askLlm).toHaveBeenCalledTimes(1);
    expect(askLlm.mock.calls[0][0]).toContain('src/config.ts');
    expect(r).toMatchObject({ ok: true, lines: ['const limit = 20;'] });
  });

  it('turns a failed call into a reason', async () => {
    const askLlm = vi.fn(async () => {
      throw new Error('no API key configured');
    });
    const r = await proposeResolution({ ...input, askLlm });
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('no API key configured') });
  });
});
