'use client';

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { buildControlAddCommand, buildMcpConfig, initMcpJson } from '@/lib/settings/mcpConfig';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { copyToClipboard } from '@/lib/tauri/clipboard';
import { mcpLaunchSpec, type McpLaunchSpec } from '@/lib/tauri/mcp';

type InitFeedback = { kind: 'success' | 'error'; message: string } | null;

export function McpSettingsContent() {
  const rootPath = useStore((s) => s.rootPath);
  const [copied, setCopied] = useState(false);
  const [initFeedback, setInitFeedback] = useState<InitFeedback>(null);
  const [resolvedLaunchSpec, setResolvedLaunchSpec] = useState<{
    projectPath: string;
    spec: McpLaunchSpec;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!rootPath) return;
    void mcpLaunchSpec(rootPath)
      .then((spec) => {
        if (!cancelled) setResolvedLaunchSpec({ projectPath: rootPath, spec });
      })
      .catch(() => {
        // The portable placeholder remains useful in browser-only development.
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const previewSpec = useMemo<McpLaunchSpec>(
    () =>
      resolvedLaunchSpec?.projectPath === rootPath
        ? resolvedLaunchSpec.spec
        : {
            command: 'auric-mcp',
            args: ['--project-root', rootPath || '<project>'],
          },
    [resolvedLaunchSpec, rootPath]
  );
  const configSnippet = JSON.stringify(buildMcpConfig(previewSpec), null, 2);
  // Only a resolved spec names the runtime this install ships; the placeholder
  // spec above has no runtime path to reuse.
  const controlCommand =
    resolvedLaunchSpec?.projectPath === rootPath
      ? buildControlAddCommand(resolvedLaunchSpec.spec)
      : 'claude mcp add --scope user auric-control -- node <runtime>/server.mjs --control';

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
    const ok = await copyToClipboard(configSnippet);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-primary-light">
          <AuricIcon name="hub" className="text-sm" />
          <h3 className="text-[10px] font-black uppercase tracking-widest">
            Project MCP configuration
          </h3>
        </div>

        <div className="space-y-2 pl-1">
          <p className="text-[10px] leading-relaxed text-foreground-muted">
            Every agent session is pinned to one project. Switching or closing the project in the UI
            does not retarget running agents.
          </p>
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
              <AuricIcon name={copied ? 'check' : 'content_copy'} className="text-[14px]" />
            </button>
          </div>
        </div>
      </section>

      <ControlCommandSection command={controlCommand} />
    </div>
  );
}

/** The Claude Code command that registers `auric-mcp --control` (docs/design-agent-control.md). */
function ControlCommandSection({ command }: { command: string }) {
  const showToast = useStore((s) => s.showToast);

  const handleCopy = async () => {
    const ok = await copyToClipboard(command);
    showToast(ok ? 'Command copied' : 'Could not copy the command', ok ? 'success' : 'error');
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-primary-light">
        <AuricIcon name="terminal" className="text-sm" />
        <h3 className="text-[10px] font-black uppercase tracking-widest">
          Control agents from outside
        </h3>
      </div>

      <div className="space-y-2 pl-1">
        <p className="text-[10px] leading-relaxed text-foreground-muted">
          Lets a Claude Code session outside the IDE list, read, type into, stop and start the
          agents running here, in every project. Typing can answer an agent&apos;s permission
          prompts, so the app refuses a socket connection whenever an agent it started is among the
          caller&apos;s parent processes, whichever agent CLI that is. The server also stops early
          when it sees the IDE&apos;s agent marker. This keeps agents from approving each
          other&apos;s prompts; it is no barrier against other programs running as you.
        </p>
        <div className="relative">
          <pre
            data-testid="mcp-control-command"
            className="whitespace-pre-wrap break-all rounded border border-white/5 bg-editor-bg p-3 pr-10 text-[10px] font-mono text-foreground"
          >
            {command}
          </pre>
          <button
            type="button"
            aria-label="Copy control command"
            title="Copy control command"
            onClick={handleCopy}
            className="absolute top-2 right-2 rounded border border-white/10 bg-black/60 p-1 text-foreground-muted hover:text-foreground transition-colors"
          >
            <AuricIcon name="content_copy" className="text-[14px]" />
          </button>
        </div>
      </div>
    </section>
  );
}
