'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';

export function McpSettingsContent() {
  const rootPath = useStore((s) => s.rootPath);
  const mcpServerRunning = useStore((s) => s.mcpServerRunning);
  const mcpAutoStart = useStore((s) => s.mcpAutoStart);
  const mcpPid = useStore((s) => s.mcpPid);
  const setMcpAutoStart = useStore((s) => s.setMcpAutoStart);
  const startMcpServer = useStore((s) => s.startMcpServer);
  const stopMcpServer = useStore((s) => s.stopMcpServer);
  const [copied, setCopied] = useState(false);

  const configSnippet = JSON.stringify(
    {
      mcpServers: {
        'auric-pm': {
          command: 'npx',
          args: [
            'tsx',
            `${rootPath || '<project>'}/src/mcp/server.ts`,
            `${rootPath || '<project>'}/.auric/project.db`,
          ],
        },
      },
    },
    null,
    2
  );

  const handleToggle = async () => {
    if (!rootPath) return;
    if (mcpServerRunning) {
      await stopMcpServer();
    } else {
      await startMcpServer(rootPath);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(configSnippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available in some contexts
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-primary-light">
          <span className="material-symbols-outlined text-sm">hub</span>
          <h3 className="text-[10px] font-black uppercase tracking-widest">MCP Server</h3>
        </div>

        <div className="space-y-3 pl-1">
          <label className="flex items-center justify-between group cursor-pointer">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-foreground group-hover:text-primary-light transition-colors">
                Auto-Start MCP Server
              </span>
              <span className="text-[9px] text-foreground-muted opacity-60">
                Start MCP server when project opens
              </span>
            </div>
            <input
              type="checkbox"
              data-testid="mcp-autostart-toggle"
              checked={mcpAutoStart}
              onChange={(e) => setMcpAutoStart(e.target.checked)}
              className="w-3 h-3 rounded border-white/10 bg-black/40 text-primary focus:ring-primary/50"
            />
          </label>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                data-testid="mcp-status-indicator"
                className={`w-2 h-2 rounded-full ${
                  mcpServerRunning
                    ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
                    : 'bg-foreground-muted'
                }`}
              />
              <span className="text-xs text-foreground">
                {mcpServerRunning ? `Running (PID: ${mcpPid})` : 'Stopped'}
              </span>
            </div>
            <button
              data-testid="mcp-toggle-button"
              onClick={handleToggle}
              className={`rounded border px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                mcpServerRunning
                  ? 'border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'border-primary/20 bg-primary/10 text-primary-light hover:bg-primary/20'
              }`}
            >
              {mcpServerRunning ? 'Stop' : 'Start'}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-4 pt-4 border-t border-white/5">
        <div className="flex items-center gap-2 text-primary-light">
          <span className="material-symbols-outlined text-sm">code</span>
          <h3 className="text-[10px] font-black uppercase tracking-widest">Agent Configuration</h3>
        </div>

        <div className="space-y-2 pl-1">
          <p className="text-[9px] text-foreground-muted opacity-60">
            Add this to your Claude Code MCP configuration:
          </p>
          <div className="relative">
            <pre
              data-testid="mcp-config-snippet"
              className="rounded border border-white/5 bg-editor-bg p-3 text-[10px] font-mono text-foreground overflow-x-auto"
            >
              {configSnippet}
            </pre>
            <button
              data-testid="mcp-copy-button"
              onClick={handleCopy}
              className="absolute top-2 right-2 rounded border border-white/10 bg-black/60 p-1 text-foreground-muted hover:text-foreground transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">
                {copied ? 'check' : 'content_copy'}
              </span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
