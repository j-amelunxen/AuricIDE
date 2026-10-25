'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatAgentDuration } from '@/lib/agents/duration';
import {
  MANAGER_INSTRUCTIONS_FILE,
  MANAGER_KNOWLEDGE_FOLDER,
  managerActivityMs,
  managerFolderFirst,
  mostRecentManagerKey,
  runsRailMemory,
} from '@/lib/agents/managerRail';
import { openManager, resumeSupervisor } from '@/lib/agents/openSupervisor';
import { runningSupervisors, supervisorUsingRunDir } from '@/lib/agents/supervisorLaunch';
import {
  keyFromName,
  splitSupervisorRuns,
  type SupervisorRunGroups,
} from '@/lib/agents/supervisorManagers';
import { buildRunTree, supervisorRunLabel, type RunTreeNode } from '@/lib/agents/supervisorRuns';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import { revealInFileManager } from '@/lib/tauri/opener';
import {
  managerArchive,
  managerCreate,
  managerRegistry,
  managerRemove,
  managerRename,
  managerRestore,
  managerValidate,
  type SupervisorManager,
} from '@/lib/tauri/supervisorManagers';
import {
  supervisorRunFiles,
  supervisorRunsList,
  type SupervisorRun,
} from '@/lib/tauri/supervisorRuns';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { ConfirmDialog } from '@/app/components/ui/ConfirmDialog';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';
import { ManagerAskComposer } from './ManagerAskComposer';
import { ManagerRow, MissingManagerRow, MoreActionsButton, type MenuPoint } from './ManagerRow';
import { PromoteManagerSheet } from './PromoteManagerSheet';
import { ManagerNameSheet } from './ManagerNameSheet';
import { managerMenu, missingManagerMenu, runMenu } from './runMenus';
import { useAskManager } from './useAskManager';

interface SupervisorRunsPanelProps {
  /** Opens a file in an editor tab, as the explorer does. */
  onOpenFile: (path: string) => void;
  /** Shows an agent's terminal. */
  onSelectAgent: (agentId: string) => void;
}

const ICON_BUTTON =
  'text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed';

/** Recent runs listed before "Show N more": enough for this week, not a wall of dates. */
const RECENT_RUNS_SHOWN = 12;

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
  onMenu: (point: MenuPoint) => void;
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
  onMenu,
  isFolderOpen,
  toggleFolder,
  onOpenFile,
}: RunRowProps) {
  const isOpen = tree !== undefined;
  const label = supervisorRunLabel(run.name);
  const files = `${run.fileCount}${run.truncated ? '+' : ''} file${run.fileCount === 1 ? '' : 's'}`;
  const changed = ago(run.modifiedAtMs, now);
  return (
    <li data-testid="run-row">
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          onMenu({ x: event.clientX, y: event.clientY });
        }}
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
        <MoreActionsButton label={`More actions for ${label}`} revealed={isOpen} onOpen={onMenu} />
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

type NameSheet =
  | { kind: 'promote'; run: SupervisorRun }
  | { kind: 'rename'; manager: SupervisorManager }
  | { kind: 'create' };

type Confirmation = {
  kind: 'archive' | 'remove' | 'restart';
  manager: SupervisorManager;
  live?: AgentInfo;
};

interface OpenMenu extends MenuPoint {
  options: ContextMenuOption[];
}

interface Registry {
  managers: SupervisorManager[];
  error: string | null;
}

type ManagedRun = SupervisorRunGroups['managers'][number];

const NO_REGISTRY: Registry = { managers: [], error: null };

/** The registry can be out of reach (browser mode); the runs still say who the managers are. */
const readRegistry = (): Promise<Registry> => managerRegistry().catch((): Registry => NO_REGISTRY);

/** The manager to unfold on first show; the live fleet is read now, as the data lands. */
function mostRecentManager(runs: SupervisorRun[], managers: SupervisorManager[]): string | null {
  const live = runningSupervisors(useStore.getState().agents);
  return mostRecentManagerKey(
    splitSupervisorRuns(runs).managers.map((run) => ({
      key: run.manager.key,
      name: run.manager.name,
      running: supervisorUsingRunDir(live, run.path) !== undefined,
      activityMs: managerActivityMs(
        managers.find((m) => m.key === run.manager.key) ?? { lastLaunch: null },
        run.modifiedAtMs
      ),
    }))
  );
}

/** Wide enough for "Remove Project Manager…" without a truncation. */
const MENU_WIDTH = 232;

const CONFIRMATIONS: Record<
  Confirmation['kind'],
  {
    title: (name: string) => string;
    message: string;
    confirmLabel: string;
    variant: 'destroy' | 'discard' | 'elevate';
  }
> = {
  archive: {
    title: (name) => `Archive ${name}?`,
    message:
      'It leaves Quick Access and the menu bar. Its folder, instructions and memory stay, and a running session keeps running until you stop it.',
    confirmLabel: 'Archive',
    variant: 'discard',
  },
  remove: {
    title: (name) => `Remove ${name}?`,
    message:
      'The Project Manager is forgotten. Its folder stays and becomes an ordinary run. Nothing on disk is deleted.',
    confirmLabel: 'Remove',
    variant: 'destroy',
  },
  restart: {
    title: (name) => `Restart ${name}?`,
    message:
      'Its running session ends and the folder is opened again with the current instructions. Agents it started keep running.',
    confirmLabel: 'Restart',
    variant: 'elevate',
  },
};

/**
 * The confirmation for archiving, removing or restarting a manager. Quick
 * Access and Settings use it too, so one consequence is worded once.
 */
export function ManagerConfirmDialog({
  kind,
  name,
  onConfirm,
  onCancel,
}: {
  kind: Confirmation['kind'];
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const wording = CONFIRMATIONS[kind];
  return (
    <ConfirmDialog
      title={wording.title(name)}
      message={wording.message}
      confirmLabel={wording.confirmLabel}
      variant={wording.variant}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

const detailOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const byName = (a: SupervisorManager, b: SupervisorManager) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.key.localeCompare(b.key);

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-muted/70">
      {children}
    </h3>
  );
}

/** The section title, with the one way to make a Project Manager without an earlier run. */
function ManagersHeader({
  onCreate,
  blockedReason,
}: {
  onCreate: () => void;
  blockedReason: string | undefined;
}) {
  return (
    <div className="flex items-center justify-between pr-3">
      <SectionTitle>Project Managers</SectionTitle>
      <button
        type="button"
        onClick={blockedReason === undefined ? onCreate : undefined}
        aria-disabled={blockedReason !== undefined || undefined}
        aria-describedby={blockedReason === undefined ? undefined : 'new-manager-reason'}
        aria-label="New Project Manager…"
        title={blockedReason ?? 'New Project Manager…'}
        className={`${ICON_BUTTON} flex h-6 w-6 items-center justify-center ${
          blockedReason === undefined ? '' : 'cursor-not-allowed opacity-40'
        }`}
      >
        <AuricIcon name="add" aria-hidden="true" className="text-[16px]" />
      </button>
      {blockedReason !== undefined && (
        <span id="new-manager-reason" className="sr-only">
          {blockedReason}
        </span>
      )}
    </div>
  );
}

/**
 * The folders earlier supervisor runs left under `~/.auric/supervisors/`:
 * the history, the working notes, the transcripts. Most recently changed
 * first; a run unfolds into its files, newest on top, and can be resumed —
 * a new supervisor in that folder, told to catch up before it acts.
 *
 * Runs a human chose to keep are Project Managers:
 * pinned above the runs by name, each with an inspector, an archive and a menu.
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
  const killRunningAgent = useStore((s) => s.killRunningAgent);
  const showToast = useStore((s) => s.showToast);
  const [runs, setRuns] = useState<SupervisorRun[] | null>(null);
  const [registry, setRegistry] = useState<Registry>(NO_REGISTRY);
  const [error, setError] = useState<string | null>(null);
  /** Open runs by path: `null` while their files are read. */
  const [trees, setTrees] = useState<Record<string, RunTreeNode[] | null>>({});
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [resuming, setResuming] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [expandedManagers, setExpandedManagers] = useState<Set<string>>(
    () => new Set(runsRailMemory.expanded)
  );
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [allRunsShown, setAllRunsShown] = useState(false);
  const [memoryReads, setMemoryReads] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [nameSheet, setNameSheet] = useState<NameSheet | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const { ask, send, sheet: askSheet } = useAskManager({ onSelectAgent });
  /** Managers whose folder was opened on unfolding; a folder closed by hand stays closed. */
  const seededFolders = useRef(new Set<string>());
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
        showToast(`Could not read the run: ${detailOf(cause)}`, 'error');
        setTrees(({ [path]: _closed, ...rest }) => rest);
      }
    },
    [showToast]
  );

  const refresh = useCallback(
    () =>
      Promise.all([supervisorRunsList(), readRegistry()]).then(
        ([listed, known]) => {
          if (!runsRailMemory.defaultUnfolded) {
            runsRailMemory.defaultUnfolded = true;
            const key = mostRecentManager(listed, known.managers);
            if (key !== null) setExpandedManagers((current) => new Set(current).add(key));
          }
          setRuns(listed);
          setRegistry(known);
          setError(null);
          setNow(Date.now());
          for (const path of Object.keys(treesRef.current)) void loadTree(path);
        },
        (cause: unknown) => setError(detailOf(cause))
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

  const groups = useMemo(() => splitSupervisorRuns(runs ?? []), [runs]);
  // No run folder, so they are not in the runs list; the registry is the only place that knows them.
  const missing = useMemo(
    () => registry.managers.filter((manager) => manager.runMissing).sort(byName),
    [registry.managers]
  );
  const blockedReason = registry.error ?? undefined;

  // The rail remounts on every switch; the human's folding outlives it.
  useEffect(() => {
    runsRailMemory.expanded = expandedManagers;
  }, [expandedManagers]);

  // An unfolded manager shows its folder with the memory open, however it was unfolded.
  useEffect(() => {
    for (const run of groups.managers) {
      const key = run.manager.key;
      if (!expandedManagers.has(key) || seededFolders.current.has(key)) continue;
      seededFolders.current.add(key);
      setOpenFolders((current) => new Set(current).add(`${run.path}\0${MANAGER_KNOWLEDGE_FOLDER}`));
      setTrees((current) => (run.path in current ? current : { ...current, [run.path]: null }));
      void loadTree(run.path);
    }
  }, [expandedManagers, groups.managers, loadTree]);

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

  const toggleManager = (key: string) =>
    setExpandedManagers((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
        seededFolders.current.delete(key);
      } else next.add(key);
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

  /** The full record: the registry has `lastLaunch`, the run only the identity. */
  const managerOf = (run: ManagedRun): SupervisorManager =>
    registry.managers.find((m) => m.key === run.manager.key) ?? {
      ...run.manager,
      runDir: run.name,
      promotedAt: '',
      lastLaunch: null,
    };

  /** Runs a registry change, then reads everything again; a refusal is a toast. */
  const change = async (
    failure: string,
    action: () => Promise<unknown>,
    success?: string
  ): Promise<boolean> => {
    try {
      await action();
    } catch (cause) {
      showToast(`${failure}: ${detailOf(cause)}`, 'error');
      return false;
    }
    if (success) showToast(success, 'success');
    await refresh();
    return true;
  };

  const open = (manager: SupervisorManager) =>
    openManager(useStore.getState(), manager.key, {
      onNothingVisible: () => undefined,
      onShow: onSelectAgent,
    });

  const validateMemory = async (manager: SupervisorManager) => {
    setExpandedManagers((current) => new Set(current).add(manager.key));
    try {
      const { findings } = await managerValidate(manager.key);
      setMemoryReads((current) => ({ ...current, [manager.key]: (current[manager.key] ?? 0) + 1 }));
      showToast(
        findings.length === 0
          ? `${manager.name}: memory has no problems.`
          : `${manager.name}: memory has ${findings.length} ${findings.length === 1 ? 'problem' : 'problems'}.`,
        findings.length === 0 ? 'success' : 'info'
      );
    } catch (cause) {
      showToast(`Could not check the memory: ${detailOf(cause)}`, 'error');
    }
  };

  const restart = async (manager: SupervisorManager, running: AgentInfo) => {
    try {
      await killRunningAgent(running.id);
    } catch (cause) {
      showToast(`Could not stop ${manager.name}: ${detailOf(cause)}`, 'error');
      return;
    }
    await open(manager);
  };

  const confirmed = async ({ kind, manager, live: running }: Confirmation) => {
    setConfirmation(null);
    if (kind === 'archive') {
      await change(`Could not archive ${manager.name}`, () => managerArchive(manager.key));
    } else if (kind === 'remove') {
      await change(`Could not remove ${manager.name}`, () => managerRemove(manager.key));
    } else if (running) {
      await restart(manager, running);
    }
  };

  const showMenu = (point: MenuPoint, options: ContextMenuOption[]) =>
    setMenu({ ...point, options });

  const managerMenuFor = (run: ManagedRun) => {
    const manager = managerOf(run);
    const archived = run.manager.archivedAt !== null;
    return managerMenu(manager.name, archived, blockedReason, {
      open: () => void open(manager),
      ask: () => ask(manager),
      editInstructions: () =>
        onOpenFile(`${run.path.replace(/\/+$/, '')}/${MANAGER_INSTRUCTIONS_FILE}`),
      rename: () => setNameSheet({ kind: 'rename', manager }),
      showInFinder: () =>
        void revealInFileManager(run.path).catch((cause: unknown) =>
          showToast(`Could not show the folder: ${detailOf(cause)}`, 'error')
        ),
      validateMemory: () => void validateMemory(manager),
      archive: () => setConfirmation({ kind: 'archive', manager }),
      restore: () =>
        void change(`Could not restore ${manager.name}`, () => managerRestore(manager.key)),
      remove: () => setConfirmation({ kind: 'remove', manager }),
    });
  };

  const missingMenuFor = (manager: SupervisorManager) =>
    missingManagerMenu(manager.archivedAt !== null, blockedReason, {
      archive: () => setConfirmation({ kind: 'archive', manager }),
      restore: () =>
        void change(`Could not restore ${manager.name}`, () => managerRestore(manager.key)),
      remove: () => setConfirmation({ kind: 'remove', manager }),
    });

  const renderMissing = (manager: SupervisorManager) => (
    <MissingManagerRow
      key={manager.key}
      manager={manager}
      archived={manager.archivedAt !== null}
      onMenu={(point) => showMenu(point, missingMenuFor(manager))}
    />
  );

  const renderManager = (run: ManagedRun, archived: boolean) => {
    const manager = managerOf(run);
    const running = supervisorUsingRunDir(live, run.path);
    const tree = trees[run.path] ?? null;
    return (
      <ManagerRow
        key={run.path}
        manager={manager}
        run={run}
        now={now}
        liveSupervisor={running}
        archived={archived}
        expanded={!archived && expandedManagers.has(manager.key)}
        folderOpen={run.path in trees}
        files={
          <RunFiles
            tree={tree === null ? null : managerFolderFirst(tree)}
            isFolderOpen={(key) => openFolders.has(`${run.path}\0${key}`)}
            toggleFolder={(key) => toggleFolder(`${run.path}\0${key}`)}
            onOpenFile={onOpenFile}
            now={now}
          />
        }
        composer={
          <ManagerAskComposer
            name={manager.name}
            running={running !== undefined}
            blockedReason={blockedReason}
            onSend={(task) => send(manager, task)}
          />
        }
        reloadToken={memoryReads[manager.key] ?? 0}
        onToggle={() => toggleManager(manager.key)}
        onToggleFolder={() => toggleRun(run)}
        onMenu={(point) => showMenu(point, managerMenuFor(run))}
        onOpen={() => void open(manager)}
        onAsk={() => ask(manager)}
        onOpenFile={onOpenFile}
        onEditInstructions={() =>
          onOpenFile(`${run.path.replace(/\/+$/, '')}/${MANAGER_INSTRUCTIONS_FILE}`)
        }
        onRestart={() => running && setConfirmation({ kind: 'restart', manager, live: running })}
      />
    );
  };

  const missingActive = missing.filter((manager) => manager.archivedAt === null);
  const missingArchived = missing.filter((manager) => manager.archivedAt !== null);
  const archivedCount = groups.archived.length + missingArchived.length;
  const takenKeys = [
    ...registry.managers.map((m) => m.key),
    ...live.map((agent) => agent.supervisorKey).filter((key): key is string => !!key),
  ];

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
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          <ManagersHeader
            onCreate={() => setNameSheet({ kind: 'create' })}
            blockedReason={blockedReason}
          />
          <ul>
            {groups.managers.map((run) => renderManager(run, false))}
            {missingActive.map(renderMissing)}
          </ul>
          {archivedCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => setArchivedOpen((openNow) => !openNow)}
                aria-expanded={archivedOpen}
                className="flex w-full items-center gap-1 px-3 pb-1 pt-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-muted/70 transition-colors hover:text-foreground"
              >
                <AuricIcon
                  name={archivedOpen ? 'expand_more' : 'chevron_right'}
                  aria-hidden="true"
                  className="text-[13px]"
                />
                Archived ({archivedCount})
              </button>
              {archivedOpen && (
                <ul>
                  {groups.archived.map((run) => renderManager(run, true))}
                  {missingArchived.map(renderMissing)}
                </ul>
              )}
            </>
          )}
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
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
            <>
              <SectionTitle>Recent Runs</SectionTitle>
              <ul>
                {(allRunsShown ? groups.recent : groups.recent.slice(0, RECENT_RUNS_SHOWN)).map(
                  (run) => (
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
                      onMenu={(point) =>
                        showMenu(
                          point,
                          runMenu(blockedReason, () => setNameSheet({ kind: 'promote', run }))
                        )
                      }
                      // Folder keys are relative to their run; prefix them so two runs never share one.
                      isFolderOpen={(key) => openFolders.has(`${run.path}\0${key}`)}
                      toggleFolder={(key) => toggleFolder(`${run.path}\0${key}`)}
                      onOpenFile={onOpenFile}
                    />
                  )
                )}
              </ul>
              {!allRunsShown && groups.recent.length > RECENT_RUNS_SHOWN && (
                <button
                  type="button"
                  onClick={() => setAllRunsShown(true)}
                  className="mx-3 mt-1 rounded px-1 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  Show {groups.recent.length - RECENT_RUNS_SHOWN} more
                </button>
              )}
            </>
          )}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          options={menu.options}
          onClose={() => setMenu(null)}
          ariaLabel="Actions"
          width={MENU_WIDTH}
        />
      )}
      {nameSheet?.kind === 'promote' && (
        <PromoteManagerSheet
          run={nameSheet.run}
          liveSupervisor={supervisorUsingRunDir(live, nameSheet.run.path)}
          takenKeys={takenKeys}
          managers={registry.managers}
          registryError={registry.error}
          onPromoted={(promoted) => {
            setExpandedManagers((current) => new Set(current).add(promoted.key));
            showToast(`${promoted.name} is now a Project Manager.`, 'success');
            void refresh();
          }}
          onClose={() => setNameSheet(null)}
        />
      )}
      {nameSheet?.kind === 'rename' && (
        <ManagerNameSheet
          title="Rename Project Manager"
          confirmLabel="Rename"
          initialName={nameSheet.manager.name}
          addressFor={() => nameSheet.manager.key}
          managers={registry.managers}
          exceptKey={nameSheet.manager.key}
          blockedReason={blockedReason}
          onSubmit={async (name) => {
            await managerRename(nameSheet.manager.key, name);
            await refresh();
          }}
          onClose={() => setNameSheet(null)}
        />
      )}
      {nameSheet?.kind === 'create' && (
        <ManagerNameSheet
          title="New Project Manager"
          confirmLabel="Create"
          initialName=""
          addressFor={(name) => keyFromName(name, takenKeys)}
          managers={registry.managers}
          blockedReason={blockedReason}
          onSubmit={async (name) => {
            const created = await managerCreate(name);
            setExpandedManagers((current) => new Set(current).add(created.key));
            await refresh();
          }}
          onClose={() => setNameSheet(null)}
        >
          <p className="text-xs text-foreground-muted">
            It gets a folder of its own, an instructions file and a memory in knowledge/. Open it to
            put it to work.
          </p>
        </ManagerNameSheet>
      )}
      {askSheet}
      {confirmation && (
        <ManagerConfirmDialog
          kind={confirmation.kind}
          name={confirmation.manager.name}
          onConfirm={() => void confirmed(confirmation)}
          onCancel={() => setConfirmation(null)}
        />
      )}
    </div>
  );
}
