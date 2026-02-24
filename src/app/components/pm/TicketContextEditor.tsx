'use client';

import { useStore } from '@/lib/store';
import type { PmContextItem } from '@/lib/tauri/pm';

interface TicketContextEditorProps {
  context: PmContextItem[] | undefined;
  onUpdate: (context: PmContextItem[]) => void;
}

export function TicketContextEditor({ context = [], onUpdate }: TicketContextEditorProps) {
  const rootPath = useStore((s) => s.rootPath);

  const handleAddSnippet = () => {
    const newItem: PmContextItem = {
      id: crypto.randomUUID(),
      type: 'snippet',
      value: '',
    };
    onUpdate([...context, newItem]);
  };

  const handleLinkFile = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
      });

      if (selected && typeof selected === 'string') {
        let relPath = selected;
        if (rootPath && selected.startsWith(rootPath)) {
          relPath = selected.substring(rootPath.length);
          if (relPath.startsWith('/') || relPath.startsWith('')) {
            relPath = relPath.substring(1);
          }
        }

        const newItem: PmContextItem = {
          id: crypto.randomUUID(),
          type: 'file',
          value: relPath,
        };
        onUpdate([...context, newItem]);
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
    }
  };

  const handleUpdateItem = (id: string, value: string) => {
    onUpdate(context.map((item) => (item.id === id ? { ...item, value } : item)));
  };

  const handleRemoveItem = (id: string) => {
    onUpdate(context.filter((item) => item.id !== id));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-foreground">Context Items</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleAddSnippet}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add Snippet
          </button>
          <button
            type="button"
            onClick={handleLinkFile}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
          >
            <span className="material-symbols-outlined text-[16px]">link</span>
            Link File
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {context.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-8 text-center">
            <p className="text-xs text-foreground-muted">
              No context items yet. Add snippets or link files to provide more context to agents.
            </p>
          </div>
        ) : (
          context.map((item) => (
            <div
              key={item.id}
              className="group relative flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3 transition-colors hover:border-white/20"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[16px] text-foreground-muted">
                    {item.type === 'snippet' ? 'description' : 'insert_drive_file'}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                    {item.type}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Remove context item"
                  onClick={() => handleRemoveItem(item.id)}
                  className="rounded p-1 text-foreground-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 transition-all"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                </button>
              </div>

              {item.type === 'snippet' ? (
                <textarea
                  value={item.value}
                  onChange={(e) => handleUpdateItem(item.id, e.target.value)}
                  placeholder="Paste context snippet here..."
                  className="w-full bg-black/20 border border-white/5 rounded px-2 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none resize-none min-h-[60px]"
                />
              ) : (
                <div className="flex items-center gap-2 bg-black/20 border border-white/5 rounded px-2 py-1.5">
                  <input
                    type="text"
                    value={item.value}
                    onChange={(e) => handleUpdateItem(item.id, e.target.value)}
                    placeholder="Path/to/file"
                    className="flex-1 bg-transparent border-none text-xs text-foreground focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const { open } = await import('@tauri-apps/plugin-dialog');
                        const selected = await open({
                          multiple: false,
                          directory: false,
                        });

                        if (selected && typeof selected === 'string') {
                          let relPath = selected;
                          if (rootPath && selected.startsWith(rootPath)) {
                            relPath = selected.substring(rootPath.length);
                            if (relPath.startsWith('/') || relPath.startsWith('')) {
                              relPath = relPath.substring(1);
                            }
                          }
                          handleUpdateItem(item.id, relPath);
                        }
                      } catch (err) {
                        console.error('Failed to open file dialog:', err);
                      }
                    }}
                    className="text-foreground-muted hover:text-foreground transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">folder_open</span>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
