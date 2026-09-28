import { buildLinkIndexEntry, type LinkIndexEntry } from '@/lib/store/wikiLinkSlice';

/**
 * Reads in flight while a project is indexed. Each response is deserialized on
 * the main thread as it lands, so a few at a time keeps the pipe full without
 * one burst of thousands of IPC replies.
 */
const PROJECT_INDEX_READ_CONCURRENCY = 8;

/**
 * Reads every markdown file and parses its wiki links as soon as it arrives, so
 * a file's text is dropped right after parsing instead of being held until the
 * whole project has been read. Entries come back in `mdFiles` order (the link
 * index keeps insertion order); failed reads are skipped. `null` means the
 * project was closed meanwhile.
 */
export async function readProjectLinkEntries(
  mdFiles: string[],
  readFile: (path: string) => Promise<string>,
  isCanceled: () => boolean,
  concurrency = PROJECT_INDEX_READ_CONCURRENCY
): Promise<Array<{ filePath: string; entry: LinkIndexEntry }> | null> {
  const entries: Array<LinkIndexEntry | undefined> = new Array(mdFiles.length);
  let next = 0;

  const worker = async () => {
    while (next < mdFiles.length && !isCanceled()) {
      const index = next++;
      try {
        entries[index] = buildLinkIndexEntry(await readFile(mdFiles[index]));
      } catch {
        // Unreadable file: left out of the index, as before.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, mdFiles.length) }, worker));
  if (isCanceled()) return null;

  const result: Array<{ filePath: string; entry: LinkIndexEntry }> = [];
  entries.forEach((entry, i) => {
    if (entry) result.push({ filePath: mdFiles[i], entry });
  });
  return result;
}
