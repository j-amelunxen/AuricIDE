'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { searchInFiles, type SearchMatch } from '@/lib/tauri/search';

/** Long enough to collapse a typing burst without feeling laggy. */
const SEARCH_DEBOUNCE_MS = 250;

interface FindInFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
  rootPath: string | null;
  onNavigate: (path: string, line: number) => void;
}

export function FindInFilesModal({ isOpen, onClose, rootPath, onNavigate }: FindInFilesModalProps) {
  if (!isOpen || !rootPath) return null;
  return <FindInFilesDialog rootPath={rootPath} onClose={onClose} onNavigate={onNavigate} />;
}

function relativePath(path: string, rootPath: string): string {
  return path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path;
}

function FindInFilesDialog({
  rootPath,
  onClose,
  onNavigate,
}: Omit<FindInFilesModalProps, 'isOpen' | 'rootPath'> & { rootPath: string }) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  // The query `results` was fetched for. Comparing it to the live `query`
  // derives the loading flag instead of tracking it as its own state.
  const [resultsQuery, setResultsQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const loading = query !== '' && query !== resultsQuery;

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 10);
  }, []);

  useEffect(() => {
    if (!query) return;
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

  const navigate = (match: SearchMatch) => {
    onNavigate(match.path, match.line);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const fileCount = groups.length;
  let rowIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Find in Files"
        className="glass-card w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-white/5">
          <AuricIcon name="search" className="text-foreground-muted" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent py-4 text-sm text-foreground outline-none placeholder:text-foreground-muted"
            placeholder="Find in files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
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
        </div>

        <div className="max-h-[400px] overflow-y-auto py-2">
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
              const rel = relativePath(path, rootPath);
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
        </div>

        <div className="flex items-center justify-between px-4 py-2 bg-black/20 border-t border-white/5 text-[9px] text-foreground-muted uppercase tracking-tighter">
          <div className="flex gap-4">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-white/5 px-1 font-mono">↑↓</kbd> Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-white/5 px-1 font-mono">↵</kbd> Open
            </span>
          </div>
          <span>
            {results.length} match{results.length === 1 ? '' : 'es'} in {fileCount} file
            {fileCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}
