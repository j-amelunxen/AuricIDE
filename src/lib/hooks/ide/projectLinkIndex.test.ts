import { describe, expect, it, vi } from 'vitest';
import { readProjectLinkEntries } from './projectLinkIndex';
import { buildLinkIndexEntry } from '@/lib/store/wikiLinkSlice';

function deferredReader(contents: Record<string, string | Error>) {
  let inFlight = 0;
  let peak = 0;
  const read = vi.fn(async (path: string) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    const value = contents[path];
    if (value instanceof Error) throw value;
    return value;
  });
  return { read, peak: () => peak };
}

// Opening a project used to fire one readFile per markdown file at once and
// keep every file's text until the whole project was parsed.
describe('readProjectLinkEntries', () => {
  const files = Array.from({ length: 30 }, (_, i) => `/p/n${i}.md`);
  const contents = Object.fromEntries(files.map((f, i) => [f, `[[n${(i + 1) % 30}]]`]));

  it('never has more reads in flight than the concurrency limit', async () => {
    const { read, peak } = deferredReader(contents);
    await readProjectLinkEntries(files, read, () => false, 4);
    expect(read).toHaveBeenCalledTimes(30);
    expect(peak()).toBe(4);
  });

  it('returns parsed entries in file order, skipping failed reads', async () => {
    const { read } = deferredReader({ ...contents, '/p/n3.md': new Error('gone') });
    const entries = await readProjectLinkEntries(files, read, () => false, 4);
    const expected = files
      .filter((f) => f !== '/p/n3.md')
      .map((f) => ({ filePath: f, entry: buildLinkIndexEntry(contents[f] as string) }));
    expect(entries).toEqual(expected);
  });

  it('stops reading and returns null once canceled', async () => {
    const { read } = deferredReader(contents);
    let canceled = false;
    read.mockImplementationOnce(async () => {
      canceled = true;
      return '';
    });
    const entries = await readProjectLinkEntries(files, read, () => canceled, 2);
    expect(entries).toBeNull();
    expect(read.mock.calls.length).toBeLessThan(files.length);
  });
});
