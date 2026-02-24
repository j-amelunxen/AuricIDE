'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import fuzzysort from 'fuzzysort';

interface FileSearchProps {
  files: string[];
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  rootPath: string | null;
}

export function FileSearch({ files, isOpen, onClose, onSelect, rootPath }: FileSearchProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [prevOpen, setPrevOpen] = useState(false);

  if (isOpen && !prevOpen) {
    setQuery('');
    setSelectedIndex(0);
    setPrevOpen(true);
  } else if (!isOpen && prevOpen) {
    setPrevOpen(false);
  }

  const results = useMemo(() => {
    if (!query) {
      return files.slice(0, 10).map((f) => ({ path: f, highlight: null }));
    }

    // fuzzysort.go returns an array of results
    const goResults = fuzzysort.go(query, files, {
      limit: 15,
      threshold: -10000,
    });

    return goResults.map((res) => {
      let highlighted = null;
      try {
        // Try various ways to get highlighting based on fuzzysort version/interop
        const resRecord = res as unknown as Record<string, unknown>;
        if (typeof resRecord.highlight === 'function') {
          highlighted = (resRecord.highlight as (open: string, close: string) => string)(
            '<b class="text-primary">',
            '</b>'
          );
        } else if (
          fuzzysort &&
          typeof (fuzzysort as unknown as Record<string, unknown>).highlight === 'function'
        ) {
          highlighted = (
            (fuzzysort as unknown as Record<string, unknown>).highlight as (
              r: typeof res,
              open: string,
              close: string
            ) => string
          )(res, '<b class="text-primary">', '</b>');
        }
      } catch {
        // Fallback to no highlight
      }

      return {
        path: res.target,
        highlight: highlighted,
      };
    });
  }, [query, files]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      onSelect(results[selectedIndex].path);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-white/5">
          <span className="material-symbols-outlined text-foreground-muted">search</span>
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent py-4 text-sm text-foreground outline-none placeholder:text-foreground-muted"
            placeholder="Search files everywhere..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] text-foreground-muted font-mono uppercase tracking-widest">
            <span>Fuzzy</span>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-foreground-muted">
              No files matching &ldquo;<span className="text-foreground">{query}</span>&rdquo;
            </div>
          ) : (
            results.map((res, i) => {
              const isSelected = i === selectedIndex;
              const displayPath = rootPath ? res.path.replace(rootPath, '') : res.path;
              const parts = displayPath.split('/');
              const fileName = parts.pop() || '';
              const dirPath = parts.join('/');

              return (
                <div
                  key={res.path}
                  onClick={() => onSelect(res.path)}
                  className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-primary/10 border-l-2 border-primary'
                      : 'hover:bg-white/5 border-l-2 border-transparent'
                  }`}
                >
                  <span
                    className={`material-symbols-outlined text-lg ${isSelected ? 'text-primary' : 'text-foreground-muted'}`}
                  >
                    description
                  </span>
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <span
                        className={`text-sm font-medium truncate ${isSelected ? 'text-foreground' : 'text-foreground-muted'}`}
                        dangerouslySetInnerHTML={{ __html: res.highlight || fileName }}
                      />
                      <span className="text-[9px] text-foreground-muted font-mono opacity-40 shrink-0">
                        {res.path.split('.').pop()?.toUpperCase()}
                      </span>
                    </div>
                    <span className="text-[10px] text-foreground-muted truncate opacity-60">
                      {dirPath || '/'}
                    </span>
                  </div>
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
          <span>{files.length} Files Indexed</span>
        </div>
      </div>
    </div>
  );
}
