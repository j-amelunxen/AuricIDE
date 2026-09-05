'use client';

import { useState, useEffect, useMemo } from 'react';
import { searchInFiles, type SearchMatch } from '@/lib/tauri/search';
import { SearchPaletteModal } from './SearchPaletteModal';

/** Long enough to collapse a typing burst without feeling laggy. */
const SEARCH_DEBOUNCE_MS = 250;

interface FindInFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  rootPath: string | null;
  onNavigate: (path: string, line: number) => void;
}

export function FindInFilesModal({ isOpen, onClose, rootPath, onNavigate }: FindInFilesModalProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  // The query `results` was fetched for. Comparing it to the live `query`
  // derives the loading flag instead of tracking it as its own state.
  const [resultsQuery, setResultsQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const loading = query !== '' && query !== resultsQuery;

  useEffect(() => {
    if (!query || !rootPath) return;
    const timer = setTimeout(() => {
      searchInFiles(rootPath, query, caseSensitive)
        .then((matches) => {
          setResults(matches);
          setResultsQuery(query);
          setSelectedIndex(0);
        })
        .catch(() => {
          setResults([]);
          setResultsQuery(query);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, caseSensitive, rootPath]);

  const groups = useMemo(() => {
    const byFile = new Map<string, SearchMatch[]>();
    for (const match of results) {
      const list = byFile.get(match.path) ?? [];
      list.push(match);
      byFile.set(match.path, list);
    }
    return Array.from(byFile.entries());
  }, [results]);

  if (!isOpen || !rootPath) return null;

  const navigate = (match: SearchMatch) => {
    onNavigate(match.path, match.line);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0)
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      navigate(results[selectedIndex]);
    }
  };

  const fileCount = groups.length;
  let rowIndex = -1;

  return (
    <SearchPaletteModal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Find in Files"
      overlayId="find-in-files"
      topOffsetClass="pt-[10vh]"
      placeholder="Find in files..."
      query={query}
      onQueryChange={setQuery}
      onKeyDown={handleKeyDown}
      headerExtra={
        <button
          type="button"
          aria-pressed={caseSensitive}
          onClick={() => setCaseSensitive((v) => !v)}
          title="Match case"
          className={`shrink-0 px-2 py-0.5 rounded border text-[9px] font-mono uppercase tracking-widest transition-colors ${
            caseSensitive
              ? 'border-primary/50 bg-primary/10 text-primary'
              : 'border-white/10 bg-white/5 text-foreground-muted'
          }`}
        >
          Aa
        </button>
      }
      footerRight={`${results.length} match${results.length === 1 ? '' : 'es'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`}
    >
      {!query ? (
        <div className="px-4 py-8 text-center text-xs text-foreground-muted">
          Type to search file contents across the project.
        </div>
      ) : loading ? (
        <div className="px-4 py-8 text-center text-xs text-foreground-muted">Searching…</div>
      ) : results.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-foreground-muted">
          No matches for &ldquo;<span className="text-foreground">{query}</span>&rdquo;
        </div>
      ) : (
        groups.map(([path, matches]) => {
          const rel = path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path;
          const parts = rel.split('/');
          const fileName = parts.pop() || rel;
          const dirPath = parts.join('/');

          return (
            <div key={path}>
              <div className="flex items-baseline gap-2 px-4 pt-3 pb-1">
                <span className="text-xs font-medium text-foreground truncate">{fileName}</span>
                <span className="text-[10px] text-foreground-muted truncate opacity-60">
                  {dirPath || '/'}
                </span>
              </div>
              {matches.map((match) => {
                rowIndex += 1;
                const isSelected = rowIndex === selectedIndex;
                return (
                  <div
                    key={`${match.path}:${match.line}:${match.column}`}
                    onClick={() => navigate(match)}
                    className={`flex items-center gap-3 px-4 py-1.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-primary/10 border-l-2 border-primary'
                        : 'hover:bg-white/5 border-l-2 border-transparent'
                    }`}
                  >
                    <span className="w-10 shrink-0 text-right text-[10px] font-mono text-foreground-muted opacity-60">
                      {match.line}
                    </span>
                    <span className="text-xs font-mono text-foreground-muted truncate">
                      {match.lineText}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </SearchPaletteModal>
  );
}
