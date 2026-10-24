'use client';

import { useEffect, useState } from 'react';
import type { SupervisorProjectPolicy } from '@/lib/config/supervisorPolicy';
import { setExtraMcpServer } from '@/lib/config/supervisorPolicyEdit';
import { extraMcpInspect, type McpFileInspection } from '@/lib/tauri/extraMcp';

interface Props {
  projectPath: string;
  entry: SupervisorProjectPolicy;
  onChange: (entry: SupervisorProjectPolicy) => void;
}

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Additional MCP servers for this project's agents: the picker lists what the project's own
 * `.mcp.json` holds (names and transport only, never commands or secrets) and stores the names
 * that are ticked. The definitions are read from the file when an agent starts, so editing the
 * file needs no change here. A name typed by hand is kept even when the file does not hold it
 * (yet); the agent then reports it as not started.
 */
export function SupervisorExtraMcp({ projectPath, entry, onChange }: Props) {
  const [found, setFound] = useState<McpFileInspection | null>(null);
  const [draft, setDraft] = useState('');
  const picked = entry.extraMcpServers;

  useEffect(() => {
    let cancelled = false;
    extraMcpInspect(projectPath)
      .then((result) => !cancelled && setFound(result))
      .catch(() => !cancelled && setFound({ fileFound: false, servers: [], error: null }));
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const known = new Set((found?.servers ?? []).map((s) => s.name));
  const manual = picked.filter((name) => !known.has(name));
  const draftValid = NAME_PATTERN.test(draft.trim());
  const id = `supervisor-extra-mcp-${projectPath}`;

  return (
    <fieldset className="space-y-2" data-testid={id}>
      <legend className="mb-1 text-[10px] font-semibold tracking-wide text-foreground-muted">
        Additional MCP servers
      </legend>
      <p className="text-[11px] text-foreground-muted">
        Agents of this project start with these servers from its .mcp.json, next to the built-in
        ones. A built-in name always wins.
      </p>
      {found?.error && (
        <p role="status" className="text-[11px] text-amber-400" data-testid={`${id}-error`}>
          {found.error}
        </p>
      )}
      {found && !found.fileFound && (
        <p className="text-[11px] text-foreground-muted" data-testid={`${id}-no-file`}>
          No .mcp.json in this project.
        </p>
      )}
      <ul className="space-y-1">
        {(found?.servers ?? []).map((server) => {
          const usable = server.problem === null;
          const checked = picked.includes(server.name);
          return (
            <li key={server.name}>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input
                  type="checkbox"
                  data-testid={`${id}-${server.name}`}
                  checked={checked}
                  disabled={!usable && !checked}
                  onChange={(e) =>
                    onChange(setExtraMcpServer(entry, server.name, e.target.checked))
                  }
                />
                <span>{server.name}</span>
                <span className="text-[10px] text-foreground-muted">{server.transport}</span>
                {!usable && (
                  <span className="text-[10px] text-amber-400">Not usable: {server.problem}</span>
                )}
              </label>
            </li>
          );
        })}
        {manual.map((name) => (
          <li key={name} className="flex items-center gap-2 text-xs text-foreground">
            <span data-testid={`${id}-manual-${name}`}>{name}</span>
            <span className="text-[10px] text-amber-400">not in .mcp.json</span>
            <button
              type="button"
              aria-label={`Remove ${name}`}
              onClick={() => onChange(setExtraMcpServer(entry, name, false))}
              className="text-[10px] text-foreground-muted hover:text-foreground"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <input
          type="text"
          aria-label="Server name from .mcp.json"
          data-testid={`${id}-draft`}
          value={draft}
          placeholder="Server name"
          onChange={(e) => setDraft(e.target.value)}
          className="rounded border border-border-dark bg-editor-bg px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          data-testid={`${id}-add`}
          disabled={!draftValid}
          onClick={() => {
            onChange(setExtraMcpServer(entry, draft, true));
            setDraft('');
          }}
          className="rounded border border-border-dark px-2 py-1 text-xs text-foreground disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </fieldset>
  );
}
