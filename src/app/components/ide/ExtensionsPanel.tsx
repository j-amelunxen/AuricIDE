'use client';

const internalExtensions = [
  {
    id: 'markdown-core',
    name: 'Markdown Core',
    description: 'Gfm, math, and table support',
    version: '1.0.0',
  },
  {
    id: 'mermaid',
    name: 'Mermaid.js',
    description: 'Visual diagrams and flowcharts',
    version: '1.1.0',
  },
  {
    id: 'git-gutter',
    name: 'Git Gutter',
    description: 'Diff indicators in editor',
    version: '0.9.5',
  },
  {
    id: 'ai-agents',
    name: 'Auric Agents',
    description: 'Agentic workflow integration',
    version: '0.5.0',
  },
];

export function ExtensionsPanel() {
  return (
    <div className="flex h-full flex-col bg-panel-bg">
      <h2 className="p-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted border-b border-border-dark">
        Extensions
      </h2>
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-4">
          <h3 className="text-[10px] font-bold text-foreground-muted uppercase tracking-widest">
            Installed
          </h3>
          {internalExtensions.map((ext) => (
            <div
              key={ext.id}
              className="group p-2 rounded hover:bg-white/5 transition-colors cursor-default"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">{ext.name}</span>
                <span className="text-[10px] text-foreground-muted">v{ext.version}</span>
              </div>
              <p className="text-[10px] text-foreground-muted mt-1 leading-tight">
                {ext.description}
              </p>
              <div className="mt-2 flex gap-2">
                <button className="text-[9px] px-1.5 py-0.5 rounded bg-border-dark text-foreground-muted hover:text-foreground">
                  Disable
                </button>
                <button className="text-[9px] px-1.5 py-0.5 rounded bg-border-dark text-foreground-muted hover:text-foreground">
                  Uninstall
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
