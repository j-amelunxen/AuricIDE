'use client';

import { useState, useMemo } from 'react';
import { ProjectFileInfo } from '@/lib/tauri/fs';

interface FileSelectorProps {
  files: ProjectFileInfo[];
  isOpen: boolean;
  onClose: () => void;
  rootPath: string | null;
}

export function FileSelector({ files, isOpen, onClose, rootPath }: FileSelectorProps) {
  const [extension, setExtension] = useState('');
  const [minLines, setMinLines] = useState<number | ''>('');
  const [maxLines, setMaxLines] = useState<number | ''>('');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return files.filter((f) => {
      // Filter by extension
      if (extension && f.extension.toLowerCase() !== extension.toLowerCase().replace(/^\./, '')) {
        return false;
      }

      // Filter by min lines
      if (minLines !== '' && f.line_count < minLines) {
        return false;
      }

      // Filter by max lines
      if (maxLines !== '' && f.line_count > maxLines) {
        return false;
      }

      // Filter by name/path query
      if (query && !f.path.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [files, extension, minLines, maxLines, query]);

  const copyToClipboard = () => {
    const paths = filtered.map((f) => f.path).join('\n');
    navigator.clipboard.writeText(paths);
    // Maybe show a toast or temporary "Copied!" state
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-3xl overflow-hidden rounded-xl border border-white/10 shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Advanced File Selection
          </h2>
          <button onClick={onClose} className="text-foreground-muted hover:text-foreground">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="p-4 bg-white/5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-tighter text-foreground-muted font-bold">
                Extension
              </label>
              <input
                type="text"
                placeholder="e.g. ts, rs"
                className="w-full bg-editor-bg border border-white/10 rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-tighter text-foreground-muted font-bold">
                Min Lines
              </label>
              <input
                type="number"
                placeholder="0"
                className="w-full bg-editor-bg border border-white/10 rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
                value={minLines}
                onChange={(e) => setMinLines(e.target.value === '' ? '' : parseInt(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-tighter text-foreground-muted font-bold">
                Max Lines
              </label>
              <input
                type="number"
                placeholder="∞"
                className="w-full bg-editor-bg border border-white/10 rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
                value={maxLines}
                onChange={(e) => setMaxLines(e.target.value === '' ? '' : parseInt(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-tighter text-foreground-muted font-bold">
              Path Query
            </label>
            <input
              type="text"
              placeholder="Filter by filename or path..."
              className="w-full bg-editor-bg border border-white/10 rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary/50"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-foreground-muted italic">
              No files matching these criteria
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map((file) => {
                const displayPath = rootPath ? file.path.replace(rootPath, '') : file.path;
                return (
                  <div
                    key={file.path}
                    className="px-4 py-2 hover:bg-white/5 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">
                          {file.path.split('/').pop()}
                        </span>
                        <span className="text-[10px] text-foreground-muted truncate opacity-60">
                          {displayPath}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[10px] font-mono text-primary-light bg-primary/10 px-1.5 rounded">
                          {file.line_count} lines
                        </span>
                        <span className="text-[10px] uppercase text-foreground-muted font-bold">
                          {file.extension}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 bg-black/20 flex items-center justify-between">
          <span className="text-[10px] text-foreground-muted uppercase tracking-tighter">
            {filtered.length} files found
          </span>
          <button
            onClick={copyToClipboard}
            disabled={filtered.length === 0}
            className="flex items-center gap-2 bg-primary/20 hover:bg-primary/30 disabled:opacity-50 text-primary-light px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
          >
            <span className="material-symbols-outlined text-sm">content_paste</span>
            Copy List to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
}
