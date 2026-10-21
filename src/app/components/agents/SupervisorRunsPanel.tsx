'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAgentDuration } from '@/lib/agents/duration';
import { resumeSupervisor } from '@/lib/agents/openSupervisor';
import { runningSupervisors, supervisorUsingRunDir } from '@/lib/agents/supervisorLaunch';
import { buildRunTree, supervisorRunLabel, type RunTreeNode } from '@/lib/agents/supervisorRuns';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import {
  supervisorRunFiles,
  supervisorRunsList,
  type SupervisorRun,
} from '@/lib/tauri/supervisorRuns';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface SupervisorRunsPanelProps {
  /** Opens a file in an editor tab, as the explorer does. */
  onOpenFile: (path: string) => void;
  /** Shows an agent's terminal. */
  onSelectAgent: (agentId: string) => void;
}

const ICON_BUTTON =
  'text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed';

/** "Changed N ago" only moves by the minute, so the clock does too. */
const CLOCK_TICK_MS = 60_000;

const TREE_ROW =
  'flex w-full items-center gap-1.5 py-0.5 pr-3 text-left text-xs text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground';

/** How a supervisor is named to the user: the key it is addressed by, else its card name. */
const supervisorLabel = (agent: AgentInfo) => agent.supervisorKey || agent.name;

function ago(modifiedAtMs: number | null, now: number): string | null {
  return modifiedAtMs === null ? null : formatAgentDuration(now - modifiedAtMs);
}

/** A tree row's age, right-aligned. Read out through the row's title, not its name. */
function Age({ value }: { value: string | null }) {
  if (value === null) return null;
  return (
    <span aria-hidden="true" className="shrink-0 text-[11px] tabular-nums text-foreground-muted/70">
      {value}
    </span>
  );
}

function TreeRows({
  nodes,
  depth,
  isOpen,
  toggle,
  onOpenFile,
  now,
}: {
  nodes: RunTreeNode[];
  depth: number;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  onOpenFile: (path: string) => void;
  now: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const indent = { paddingLeft: `${1.75 + depth * 0.75}rem` };
        const age = ago(node.modifiedAtMs, now);
        const changed = age === null ? '' : `changed ${age} ago`;
        if (node.kind === 'file') {
          return (
            <button
              key={node.path}
              type="button"
              style={indent}
              onClick={() => onOpenFile(node.path)}
              title={changed ? `${node.path} · ${changed}` : node.path}
              className={TREE_ROW}
            >
              <AuricIcon name="description" aria-hidden="true" className="text-[13px] shrink-0" />
              <span className="flex-1 truncate">{node.name}</span>
              <Age value={age} />
            </button>
          );
        }
        const open = isOpen(node.key);
        return (
          <div key={node.key}>
            <button
              type="button"
              style={indent}
              onClick={() => toggle(node.key)}
              aria-expanded={open}
              title={changed || undefined}
              className={TREE_ROW}
            >
              <AuricIcon
                name={open ? 'folder_open' : 'folder'}
                aria-hidden="true"
                className="text-[13px] shrink-0"
              />
              <span className="flex-1 truncate">{node.name}</span>
              <Age value={age} />
            </button>
            {open && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                isOpen={isOpen}
                toggle={toggle}
                onOpenFile={onOpenFile}
                now={now}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** What the run's row offers: go to the supervisor live in it, or resume it. */
function RunAction({
  run,
  label,
  liveHere,
  resuming,
  revealed,
  onResume,
  onShow,
}: {
  run: SupervisorRun;
  label: string;
  liveHere: AgentInfo | undefined;
  resuming: string | null;
  /** Shown without hover: the row is open or this run is resuming. */
  revealed: boolean;
  onResume: () => void;
  onShow: (agentId: string) => void;
}) {
  if (liveHere) {
    // A run folder holds one live supervisor at a time; the useful move is to go there.
    return (
      <button
        type="button"
        onClick={() => onShow(liveHere.id)}
        aria-label={`Show ${supervisorLabel(liveHere)}`}
        title="Show the supervisor working in this run"
        className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
      >
        Show
      </button>
    );
  }
  const busy = resuming === run.path;
  return (
    <button
      type="button"
      onClick={onResume}
      disabled={resuming !== null}
      aria-label={`Resume supervisor run ${label}`}
      title="Resume: a new supervisor in this folder, caught up on what happened"
      // Revealed on hover, focus or an open row, so a long list is not a column of buttons.
      className={`${ICON_BUTTON} flex h-6 w-6 shrink-0 items-center justify-center ${
        revealed || busy ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
      }`}
    >
      <AuricIcon
        name={busy ? 'progress_activity' : 'history'}
        aria-hidden="true"
        className={`text-[16px] ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`}
      />
    </button>
  );
}

function RunFiles({
  tree,
  isFolderOpen,
  toggleFolder,
  onOpenFile,
  now,
}: {
  tree: RunTreeNode[] | null;
  isFolderOpen: (key: string) => boolean;
  toggleFolder: (key: string) => void;
  onOpenFile: (path: string) => void;
  now: number;
}) {
  if (tree === null) {
    return <p className="py-1 pl-7 text-xs text-foreground-muted">Reading files…</p>;
  }
  if (tree.length === 0) {
    return <p className="py-1 pl-7 text-xs text-foreground-muted">This run is empty.</p>;
  }
  return (
    <TreeRows
      nodes={tree}
      depth={0}
      isOpen={isFolderOpen}
      toggle={toggleFolder}
      onOpenFile={onOpenFile}
      now={now}
    />
  );
}

interface RunRowProps {
  run: SupervisorRun;
  now: number;
  /** The live supervisor working in this run, if any. */
  liveHere: AgentInfo | undefined;
  /** Its files; `undefined` while closed, `null` while they are read. */
  tree: RunTreeNode[] | null | undefined;
  resuming: string | null;
  onToggle: () => void;
  onResume: () => void;
  onShow: (agentId: string) => void;
  isFolderOpen: (key: string) => boolean;
  toggleFolder: (key: string) => void;
  onOpenFile: (path: string) => void;
}

function RunRow({
  run,
  now,
  liveHere,
  tree,
  resuming,
  onToggle,
  onResume,
  onShow,
  isFolderOpen,
  toggleFolder,
  onOpenFile,
}: RunRowProps) {
  const isOpen = tree !== undefined;
  const label = supervisorRunLabel(run.name);
  const files = `${run.fileCount}${run.truncated ? '+' : ''} file${run.fileCount === 1 ? '' : 's'}`;
  const changed = ago(run.modifiedAtMs, now);
  return (
    <li>
      <div
        className={`group flex items-center gap-1.5 px-3 py-1 text-sm transition-colors ${
          isOpen
            ? 'bg-primary/10 text-foreground'
            : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          title={run.path}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <AuricIcon
            name={isOpen ? 'expand_more' : 'chevron_right'}
            aria-hidden="true"
            className="text-[15px] shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{label}</span>
            <span className="block truncate text-[11px] text-foreground-muted">
              {/* Live, the supervisor's name is what the line is for; the count would only crowd it. */}
              {liveHere ? (
                <span className="text-primary">Running in {supervisorLabel(liveHere)}</span>
              ) : (
                [changed !== null && `${changed} ago`, files].filter(Boolean).join(' · ')
              )}
            </span>
          </span>
        </button>
        <RunAction
          run={run}
          label={label}
          liveHere={liveHere}
          resuming={resuming}
          revealed={isOpen}
          onResume={onResume}
          onShow={onShow}
        />
      </div>
      {tree !== undefined && (
        <RunFiles
          tree={tree}
          isFolderOpen={isFolderOpen}
          toggleFolder={toggleFolder}
          onOpenFile={onOpenFile}
          now={now}
        />
      )}
    </li>
  );
}

/**
 * The folders earlier supervisor runs left under `~/.auric/supervisors/`:
 * the history, the working notes, the transcripts. Most recently changed
 * first; a run unfolds into its files, newest on top, and can be resumed —
 * a new supervisor in that folder, told to catch up before it acts.
 *
 * Nothing watches the folder, so the list reads on mount, on refresh, when
 * the window comes back into focus and when a supervisor starts or ends.
 * Open runs stay open across a refresh and read their files again.
 */
export function SupervisorRunsPanel({ onOpenFile, onSelectAgent }: SupervisorRunsPanelProps) {
  const agents = useStore((s) => s.agents);
  // Derived here, not in the selector: a fresh array from a zustand v5 selector loops React.
  const live = useMemo(() => runningSupervisors(agents), [agents]);
  const liveKey = live.map((agent) => `${agent.id}:${agent.repoPath ?? ''}`).join('|');
  const spawnSupervisor = useStore((s) => s.spawnSupervisor);
  const showToast = useStore((s) => s.showToast);
  const [runs, setRuns] = useState<SupervisorRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Open runs by path: `null` while their files are read. */
  const [trees, setTrees] = useState<Record<string, RunTreeNode[] | null>>({});
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [resuming, setResuming] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Read by a refresh, which reloads whatever is open without re-subscribing to it.
  const treesRef = useRef(trees);
  useEffect(() => {
    treesRef.current = trees;
  }, [trees]);

  const loadTree = useCallback(
    async (path: string) => {
      try {
        const tree = buildRunTree(await supervisorRunFiles(path));
        setTrees((current) => (path in current ? { ...current, [path]: tree } : current));
      } catch (cause) {
        showToast(
          `Could not read the run: ${cause instanceof Error ? cause.message : String(cause)}`,
          'error'
        );
        setTrees(({ [path]: _closed, ...rest }) => rest);
      }
    },
    [showToast]
  );

  const refresh = useCallback(
    () =>
      supervisorRunsList().then(
        (listed) => {
          setRuns(listed);
          setError(null);
          setNow(Date.now());
          for (const path of Object.keys(treesRef.current)) void loadTree(path);
        },
        (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
      ),
    [loadTree]
  );

  useEffect(() => {
    void refresh();
  }, [refresh, liveKey]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const tick = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(tick);
    };
  }, [refresh]);

  const toggleRun = (run: SupervisorRun) => {
    if (run.path in trees) {
      setTrees(({ [run.path]: _closed, ...rest }) => rest);
      return;
    }
    setTrees((current) => ({ ...current, [run.path]: null }));
    void loadTree(run.path);
  };

  const toggleFolder = (key: string) =>
    setOpenFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const resume = async (run: SupervisorRun) => {
    if (resuming) return;
    setResuming(run.path);
    try {
      await resumeSupervisor({ spawnSupervisor, showToast }, run.path, {
        // The toast already names Settings → Supervisor; the rail has no route there.
        onNothingVisible: () => undefined,
        onShow: onSelectAgent,
      });
    } finally {
      setResuming(null);
    }
  };

  return (
    <div data-testid="supervisor-runs-panel" className="flex h-full flex-col bg-panel-bg">
      <div className="flex items-center justify-between p-3 border-b border-white/5 bg-white/2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-foreground-muted">
          Supervisor Runs
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          aria-label="Refresh supervisor runs"
          title="Refresh"
          className={`${ICON_BUTTON} p-0.5`}
        >
          <AuricIcon name="refresh" aria-hidden="true" className="text-[16px]" />
        </button>
      </div>

      {error ? (
        <div role="alert" className="flex flex-col items-start gap-2 p-4">
          <p className="text-xs text-foreground">Could not read the supervisor runs.</p>
          <p className="text-[11px] text-foreground-muted">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
          >
            Try again
          </button>
        </div>
      ) : runs === null ? (
        <p className="p-4 text-xs text-foreground-muted">Reading runs…</p>
      ) : runs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AuricIcon
            name="account_tree"
            aria-hidden="true"
            className="text-[28px] text-foreground-muted/60"
          />
          <p className="text-xs text-foreground-muted">
            No supervisor has run yet. Each run keeps its notes in a folder of its own, and they
            show up here.
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
          {runs.map((run) => (
            <RunRow
              key={run.path}
              run={run}
              now={now}
              liveHere={supervisorUsingRunDir(live, run.path)}
              tree={trees[run.path]}
              resuming={resuming}
              onToggle={() => toggleRun(run)}
              onResume={() => void resume(run)}
              onShow={onSelectAgent}
              // Folder keys are relative to their run; prefix them so two runs never share one.
              isFolderOpen={(key) => openFolders.has(`${run.path}\0${key}`)}
              toggleFolder={(key) => toggleFolder(`${run.path}\0${key}`)}
              onOpenFile={onOpenFile}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
