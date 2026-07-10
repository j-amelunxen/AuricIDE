'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { buildMcpConfig, initMcpJson } from '@/lib/settings/mcpConfig';
import { SettingsToggle } from '../ui/settings/SettingsToggle';

type InitFeedback = { kind: 'success' | 'error'; message: string } | null;

export function McpSettingsContent() {
  const rootPath = useStore((s) => s.rootPath);
  const mcpServerRunning = useStore((s) => s.mcpServerRunning);
  const mcpAutoStart = useStore((s) => s.mcpAutoStart);
  const mcpPid = useStore((s) => s.mcpPid);
  const setMcpAutoStart = useStore((s) => s.setMcpAutoStart);
  const startMcpServer = useStore((s) => s.startMcpServer);
  const stopMcpServer = useStore((s) => s.stopMcpServer);
  const [copied, setCopied] = useState(false);
  const [initFeedback, setInitFeedback] = useState<InitFeedback>(null);

  const configSnippet = JSON.stringify(buildMcpConfig(rootPath || '<project>'), null, 2);

  const handleToggle = async () => {
    if (!rootPath) return;
    if (mcpServerRunning) {
      await stopMcpServer();
    } else {
      await startMcpServer(rootPath);
    }
  };

  const handleInitMcpJson = async () => {
    if (!rootPath) return;
    try {
      const result = await initMcpJson(rootPath);
      setInitFeedback({
        kind: 'success',
        message: result === 'created' ? '.mcp.json created' : '.mcp.json updated',
      });
    } catch (err) {
      setInitFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
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
          <SettingsToggle
            label="Auto-Start MCP Server"
            description="Start MCP server when project opens"
            checked={mcpAutoStart}
            onChange={setMcpAutoStart}
            testId="mcp-autostart-toggle"
          />

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
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] text-foreground-muted opacity-60">
              Write this configuration to <span className="font-mono">.mcp.json</span> in the
              project root, or copy it manually:
            </p>
            <button
              data-testid="mcp-init-button"
              onClick={handleInitMcpJson}
              disabled={!rootPath}
              className="shrink-0 rounded border border-primary/20 bg-primary/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-light transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Init .mcp.json
            </button>
          </div>
          {initFeedback && (
            <p
              data-testid="mcp-init-feedback"
              className={`text-[10px] ${
                initFeedback.kind === 'success' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {initFeedback.message}
            </p>
          )}
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
