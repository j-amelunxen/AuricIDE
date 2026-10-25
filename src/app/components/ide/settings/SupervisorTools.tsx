'use client';

import { useEffect, useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { LearnMore, SETTINGS_HINT_CLASS } from '@/app/components/ui/settings/SettingsGroup';
import {
  isUnrestrictedTool,
  normalizeProjectPath,
  toolKeyProblem,
  type SupervisorToolPolicy,
} from '@/lib/config/supervisorPolicy';
import { supervisorResolveTool } from '@/lib/tauri/supervisorPolicy';
import { isExtraDir } from './SupervisorSkills';

type Tools = Record<string, SupervisorToolPolicy>;

/** The extra-folder lines that Rust would refuse. */
export function invalidToolEntries(tools: Tools): string[] {
  return Object.values(tools).flatMap((tool) => tool.dirs.filter((dir) => !isExtraDir(dir)));
}

function whyCannotAdd(key: string, tools: Tools): string | null {
  if (!key) return 'Enter a command name or the absolute path of a binary';
  const problem = toolKeyProblem(key);
  if (problem === 'path_not_absolute') return 'A path must be absolute: start it with /';
  if (problem) {
    return 'Use a plain command name like umi, or an absolute path without spaces, brackets, quotes or *';
  }
  return tools[key] ? 'This tool is allowed already' : null;
}

interface SupervisorToolsProps {
  tools: Tools;
  onChange: (tools: Tools) => void;
}

/**
 * CLI tools a supervisor run may call (ADR 0004), besides what skills bring.
 * Each is allowed as itself and with arguments, nothing else; a chained
 * command needs every part allowed.
 */
export function SupervisorTools({ tools, onChange }: SupervisorToolsProps) {
  const [newTool, setNewTool] = useState('');
  const allowed = Object.keys(tools).sort();
  const trimmed = newTool.trim();
  const key = trimmed.startsWith('/') ? normalizeProjectPath(trimmed) : trimmed;
  const addReason = whyCannotAdd(key, tools);

  const add = () => {
    if (addReason) return;
    onChange({ ...tools, [key]: { dirs: [] } });
    setNewTool('');
  };
  const remove = (tool: string) => {
    const next = { ...tools };
    delete next[tool];
    onChange(next);
  };
  const setDirs = (tool: string, text: string) =>
    onChange({ ...tools, [tool]: { dirs: text.split('\n') } });

  return (
    <SettingsSection title="Tools" icon="terminal">
      <div className="space-y-1">
        <p className={SETTINGS_HINT_CLASS}>
          Command-line tools the supervisor may run with any arguments, without asking. Allow only
          tools that are safe to run unattended.
        </p>
        <LearnMore>
          <p>
            Name a tool as the shell does (<code>umi</code>) or give the path to the binary. Each is
            allowed as itself and with arguments; a chained command needs every part allowed. Every
            other command is refused.
          </p>
        </LearnMore>
      </div>
      {allowed.length === 0 ? (
        <p className={SETTINGS_HINT_CLASS}>No tool is allowed.</p>
      ) : (
        <ul className="space-y-2">
          {allowed.map((tool) => (
            <ToolRow
              key={tool}
              tool={tool}
              dirs={tools[tool].dirs}
              onDirs={(text) => setDirs(tool, text)}
              onRemove={() => remove(tool)}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          data-testid="supervisor-tool-name"
          aria-label="Tool name or absolute path"
          placeholder="umi, or /opt/tools/bin/mytool"
          value={newTool}
          onChange={(e) => setNewTool(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-foreground"
        />
        <button
          type="button"
          data-testid="supervisor-tool-add"
          onClick={add}
          disabled={addReason !== null}
          title={addReason ?? undefined}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          Allow tool
        </button>
      </div>
    </SettingsSection>
  );
}

/** Where the tool is found now, so a typo shows up before a run does. */
function useToolLocation(tool: string): string {
  const [location, setLocation] = useState('checking…');
  useEffect(() => {
    let current = true;
    const isPath = tool.startsWith('/');
    const look = async () => {
      try {
        const found = await supervisorResolveTool(tool);
        if (!current) return;
        if (!found) setLocation(isPath ? 'file not found' : 'not found on PATH');
        else setLocation(isPath ? 'file found' : `found at ${found}`);
      } catch {
        if (current) setLocation('could not check');
      }
    };
    void look();
    return () => {
      current = false;
    };
  }, [tool]);
  return location;
}

interface ToolRowProps {
  tool: string;
  dirs: string[];
  onDirs: (text: string) => void;
  onRemove: () => void;
}

function ToolRow({ tool, dirs, onDirs, onRemove }: ToolRowProps) {
  const location = useToolLocation(tool);
  const invalidDirs = dirs.filter((dir) => !isExtraDir(dir));
  const id = `supervisor-tool-${tool.replace(/[^A-Za-z0-9]+/g, '-')}`;
  return (
    <li
      data-testid="supervisor-tool-row"
      className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3"
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-mono text-xs font-semibold text-foreground">
          {tool}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-foreground-muted">
          {location}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${tool}`}
          className="rounded px-2 py-0.5 text-[11px] text-foreground-muted transition-colors hover:text-foreground"
        >
          Remove
        </button>
      </div>
      {isUnrestrictedTool(tool) && (
        <p data-testid="supervisor-tool-warning" className="text-[11px] text-amber-400">
          This tool runs any code it is given, so allowing it allows everything a shell could do.
        </p>
      )}
      <label htmlFor={id} className="block text-[11px] text-foreground-muted">
        Extra folders it may read and write besides the run folder, one absolute path per line
      </label>
      <textarea
        id={id}
        rows={Math.max(1, dirs.length)}
        value={dirs.join('\n')}
        onChange={(e) => onDirs(e.target.value)}
        aria-invalid={invalidDirs.length > 0}
        className="w-full rounded border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-foreground"
      />
      {invalidDirs.length > 0 && (
        <p role="alert" className="text-[11px] text-red-400">
          A folder must be an absolute path other than /, without brackets, quotes or backslashes.
        </p>
      )}
    </li>
  );
}
