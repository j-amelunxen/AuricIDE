import { invoke } from './invoke';

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  lineText: string;
}

interface RawSearchMatch {
  path: string;
  line: number;
  column: number;
  line_text: string;
}

/** Plain substring search across every text file under `rootPath`. */
export async function searchInFiles(
  rootPath: string,
  query: string,
  caseSensitive: boolean
): Promise<SearchMatch[]> {
  const matches = await invoke<RawSearchMatch[]>('search_in_files', {
    rootPath,
    query,
    caseSensitive,
  });
  return matches.map((m) => ({
    path: m.path,
    line: m.line,
    column: m.column,
    lineText: m.line_text,
  }));
}
