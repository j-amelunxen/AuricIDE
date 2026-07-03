import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { searchNotes, readNote, writeFinding, getBacklinks } from './knowledge';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'auric-knowledge-'));
  await writeFile(join(root, 'index.md'), '# Index\n\nSee [[Architecture]] and [[Auth#Login]].\n');
  await mkdir(join(root, 'docs'));
  await writeFile(
    join(root, 'docs', 'architecture.md'),
    '# Architecture\n\nThe conductor loop spawns agents.\nBacklink to [[Index|the index]].\n'
  );
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'node_modules', 'junk.md'), 'conductor conductor conductor\n');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('searchNotes', () => {
  it('finds matching lines across markdown files, case-insensitive', async () => {
    const hits = await searchNotes(root, 'CONDUCTOR');
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe('docs/architecture.md');
    expect(hits[0].line).toBe(3);
    expect(hits[0].text).toContain('conductor loop');
  });

  it('skips node_modules and similar directories', async () => {
    const hits = await searchNotes(root, 'conductor');
    expect(hits.every((h) => !h.file.includes('node_modules'))).toBe(true);
  });

  it('caps the number of results', async () => {
    const lines = Array.from({ length: 300 }, (_, i) => `hit line ${i}`).join('\n');
    await writeFile(join(root, 'big.md'), lines);
    const hits = await searchNotes(root, 'hit line');
    expect(hits.length).toBeLessThanOrEqual(100);
  });
});

describe('readNote', () => {
  it('reads a note relative to root', async () => {
    const content = await readNote(root, 'docs/architecture.md');
    expect(content).toContain('# Architecture');
  });

  it('refuses paths outside the project root', async () => {
    await expect(readNote(root, '../outside.md')).rejects.toThrow(/outside/i);
  });
});

describe('writeFinding', () => {
  it('writes a markdown finding with provenance and wiki links', async () => {
    const result = await writeFinding(root, {
      title: 'Conductor Bottleneck',
      content: 'The loop saturates at 8 agents.',
      agentId: 'agent-7',
      goalId: 'g1',
      links: ['Architecture'],
    });
    expect(result.file).toBe('findings/conductor-bottleneck.md');
    const written = await readFile(join(root, 'findings', 'conductor-bottleneck.md'), 'utf8');
    expect(written).toContain('# Conductor Bottleneck');
    expect(written).toContain('agent-7');
    expect(written).toContain('g1');
    expect(written).toContain('[[Architecture]]');
    expect(written).toContain('saturates');
  });

  it('does not overwrite an existing finding — appends a counter', async () => {
    await writeFinding(root, { title: 'Dup', content: 'first' });
    const second = await writeFinding(root, { title: 'Dup', content: 'second' });
    expect(second.file).toBe('findings/dup-2.md');
  });
});

describe('getBacklinks', () => {
  it('finds wiki links including heading and alias forms', async () => {
    const backlinks = await getBacklinks(root, 'Architecture');
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].file).toBe('index.md');

    const authLinks = await getBacklinks(root, 'Auth');
    expect(authLinks).toHaveLength(1);

    const indexLinks = await getBacklinks(root, 'Index');
    expect(indexLinks.some((b) => b.file === 'docs/architecture.md')).toBe(true);
  });

  it('returns empty for unlinked notes', async () => {
    expect(await getBacklinks(root, 'Nothing')).toEqual([]);
  });
});
