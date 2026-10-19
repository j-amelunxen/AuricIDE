'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatAgentDuration } from '@/lib/agents/duration';
import { resumeSupervisor } from '@/lib/agents/openSupervisor';
import { findRunningSupervisor } from '@/lib/agents/supervisorLaunch';
import { buildRunTree, supervisorRunLabel, type RunTreeNode } from '@/lib/agents/supervisorRuns';
import { useStore } from '@/lib/store';
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
  'text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-0.5 disabled:opacity-40 disabled:cursor-not-allowed';

function changedAgo(modifiedAtMs: number | null, now: number): string {
  return modifiedAtMs === null ? '' : `${formatAgentDuration(now - modifiedAtMs)} ago`;
}

function TreeRows({
  nodes,
  depth,
  open,
  toggle,
  onOpenFile,
}: {
  nodes: RunTreeNode[];
  depth: number;
  open: ReadonlySet<string>;
  toggle: (key: string) => void;
  onOpenFile: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const indent = { paddingLeft: `${1.75 + depth * 0.75}rem` };
        if (node.kind === 'file') {
          return (
            <button
              key={node.path}
              type="button"
              style={indent}
              onClick={() => onOpenFile(node.path)}
              title={node.path}
              className="flex w-full items-center gap-1.5 py-0.5 pr-3 text-left text-xs text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <AuricIcon name="description" aria-hidden="true" className="text-[13px] shrink-0" />
              <span className="flex-1 truncate">{node.name}</span>
            </button>
          );
        }
        const isOpen = open.has(node.key);
        return (
          <div key={node.key}>
            <button
              type="button"
              style={indent}
              onClick={() => toggle(node.key)}
              aria-expanded={isOpen}
              className="flex w-full items-center gap-1.5 py-0.5 pr-3 text-left text-xs text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground"
            >
              <AuricIcon
                name={isOpen ? 'folder_open' : 'folder'}
                aria-hidden="true"
                className="text-[13px] shrink-0"
              />
              <span className="flex-1 truncate">{node.name}</span>
            </button>
            {isOpen && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                open={open}
                toggle={toggle}
                onOpenFile={onOpenFile}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * The folders earlier supervisor runs left under `~/.auric/supervisors/`:
 * the history, the working notes, the transcripts. Most recently changed
 * first; a run unfolds into its files, newest on top, and can be resumed —
 * a new supervisor in that folder, told to catch up before it acts.
 *
 * Nothing watches the folder, so the list reads on mount and on refresh.
 */
export function SupervisorRunsPanel({ onOpenFile, onSelectAgent }: SupervisorRunsPanelProps) {
  const runningId = useStore((s) => findRunningSupervisor(s.agents)?.id ?? null);
  const spawnSupervisor = useStore((s) => s.spawnSupervisor);
  const showToast = useStore((s) => s.showToast);
  const [runs, setRuns] = useState<SupervisorRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tree, setTree] = useState<RunTreeNode[] | null>(null);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [resuming, setResuming] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(
    () =>
      supervisorRunsList().then(
        (listed) => {
          setRuns(listed);
          setError(null);
          setNow(Date.now());
        },
        (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
      ),
    []
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const expand = async (run: SupervisorRun) => {
    if (expanded === run.path) {
      setExpanded(null);
      return;
    }
    setExpanded(run.path);
    setTree(null);
    setOpenFolders(new Set());
    try {
      setTree(buildRunTree(await supervisorRunFiles(run.path)));
    } catch (cause) {
      showToast(
        `Could not read the run: ${cause instanceof Error ? cause.message : String(cause)}`,
        'error'
      );
      setExpanded(null);
    }
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

  const resumeBlocked = runningId !== null;

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
          className={ICON_BUTTON}
        >
          <AuricIcon name="refresh" aria-hidden="true" className="text-[16px]" />
        </button>
      </div>

      {error ? (
        <p role="alert" className="p-4 text-xs text-foreground-muted">
          Could not list the runs: {error}
        </p>
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
          {runs.map((run) => {
            const isOpen = expanded === run.path;
            const label = supervisorRunLabel(run.name);
            const files = `${run.fileCount}${run.truncated ? '+' : ''} file${
              run.fileCount === 1 ? '' : 's'
            }`;
            return (
              <li key={run.path}>
                <div
                  className={`group flex items-center gap-1.5 px-3 py-1 text-sm transition-colors ${
                    isOpen
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground-muted hover:bg-white/5 hover:text-foreground'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void expand(run)}
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
                      <span className="block truncate text-[10px] text-foreground-muted">
                        {[changedAgo(run.modifiedAtMs, now), files].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void resume(run)}
                    disabled={resumeBlocked || resuming !== null}
                    aria-label={`Resume supervisor run ${label}`}
                    title={
                      resumeBlocked
                        ? 'A supervisor is already running. Stop it to resume this run.'
                        : 'Resume: a new supervisor in this folder, caught up on what happened'
                    }
                    className={`${ICON_BUTTON} shrink-0`}
                  >
                    <AuricIcon
                      name={resuming === run.path ? 'progress_activity' : 'play_arrow'}
                      aria-hidden="true"
                      className={`text-[16px] ${
                        resuming === run.path ? 'animate-spin motion-reduce:animate-none' : ''
                      }`}
                    />
                  </button>
                </div>
                {isOpen &&
                  (tree === null ? (
                    <p className="py-1 pl-7 text-xs text-foreground-muted">Reading files…</p>
                  ) : tree.length === 0 ? (
                    <p className="py-1 pl-7 text-xs text-foreground-muted">This run is empty.</p>
                  ) : (
                    <TreeRows
                      nodes={tree}
                      depth={0}
                      open={openFolders}
                      toggle={toggleFolder}
                      onOpenFile={onOpenFile}
                    />
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
