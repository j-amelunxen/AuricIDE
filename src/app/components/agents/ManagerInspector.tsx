'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import {
  instructionsChangedSince,
  instructionsPreview,
  MANAGER_MEMORY_SECTIONS,
  MANAGER_OKF_FIX,
} from '@/lib/agents/supervisorManagers';
import { useStore } from '@/lib/store';
import type { AgentInfo } from '@/lib/tauri/agents';
import { copyToClipboard } from '@/lib/tauri/clipboard';
import { machineDependencies } from '@/lib/tauri/machine';
import {
  managerInstructions,
  managerMemory,
  managerValidate,
  type ManagerMemorySummary,
  type OkfState,
  type SupervisorManager,
} from '@/lib/tauri/supervisorManagers';
import type { SupervisorRun } from '@/lib/tauri/supervisorRuns';
import { knowledgeFilePath, MEMORY_INDEX_FILE } from './managerFiles';
import { formatSessionAge } from './sessionAge';

interface ManagerInspectorProps {
  manager: SupervisorManager;
  run: SupervisorRun;
  /** The supervisor working in the manager's folder, if any. */
  liveSupervisor: AgentInfo | undefined;
  folderOpen: boolean;
  /** Bumped by whoever validated the memory elsewhere, so the summary is read again. */
  reloadToken: number;
  onOpen: () => void;
  onAsk: () => void;
  /** Opens a file of the manager's folder; the rail makes it a tab, Settings opens it in the default app. */
  onOpenFile: (path: string) => void;
  onEditInstructions: () => void;
  /** Ends the running session and resumes the folder. The caller confirms. */
  onRestart: () => void;
  onToggleFolder: () => void;
  /** The folder's files, drawn under the facts while the folder is open (the rail). */
  files?: ReactNode;
  /**
   * An inline Ask field at the foot (the rail). It takes the place of the
   * Ask… button, which opens the same Ask as a sheet everywhere else.
   */
  composer?: ReactNode;
}

/** Why the okf half of the check is not running, per state that means that. */
const OKF_OFF_REASON: Partial<Record<OkfState, string>> = {
  missing: 'okf is not installed.',
  outdated: 'okf is too old.',
  unrecognised: 'okf answered in a way we do not recognise.',
  failed: 'okf could not run.',
};
/** A tool that was never there is news about the machine, not a fault; the rest is a problem. */
const OKF_PROBLEM_STATES: OkfState[] = ['outdated', 'unrecognised', 'failed'];
/** Only these have a command that helps. */
const OKF_FIXABLE: OkfState[] = ['missing', 'outdated'];

const TEXT_BUTTON =
  'rounded px-1 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40';
const ICON_BUTTON =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground';

const ACTION_BUTTON =
  'rounded-md border border-border-dark px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-white/5';

const PLURAL_EXCEPTIONS: Record<string, string> = { Person: 'People' };

const plural = (word: string, count: number) =>
  count === 1 ? word : (PLURAL_EXCEPTIONS[word] ?? `${word}s`);

const SECTION_TYPES = Object.values(MANAGER_MEMORY_SECTIONS);

/** "Decisions 12 · Facts 20", in the order of the layout, empty types left out. */
function conceptBreakdown(concepts: Record<string, number>): string {
  return SECTION_TYPES.filter((type) => (concepts[type] ?? 0) > 0)
    .map((type) => `${plural(type, concepts[type])} ${concepts[type]}`)
    .join(' · ');
}

const totalConcepts = (concepts: Record<string, number>) =>
  Object.values(concepts).reduce((sum, count) => sum + count, 0);

const errorSentence = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function Row({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <dt className="w-[4.25rem] shrink-0 pt-px text-[11px] text-foreground-muted">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-start gap-1.5 text-xs text-foreground">
        <div className="min-w-0 flex-1">{children}</div>
        {action}
      </dd>
    </div>
  );
}

/** A row's content that opens a file: a plain button, so it reads and tabs like one. */
function RowButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="block w-full min-w-0 rounded text-left transition-colors hover:text-primary"
    >
      {children}
    </button>
  );
}

/**
 * A status line exists only because it asks for something. A real problem is
 * amber with a warning; information is a calm muted line with its action beside it.
 */
function StatusLine({
  tone,
  children,
  actions,
}: {
  tone: 'info' | 'problem';
  children: ReactNode;
  actions?: ReactNode;
}) {
  const problem = tone === 'problem';
  return (
    <div
      className={`flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] ${
        problem
          ? 'rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-200'
          : 'px-0.5 text-foreground-muted'
      }`}
    >
      <span className="flex min-w-0 items-start gap-1">
        <AuricIcon
          name={problem ? 'warning' : 'info'}
          aria-hidden="true"
          className="mt-px shrink-0 text-[13px]"
        />
        <span className="min-w-0">{children}</span>
      </span>
      {actions}
    </div>
  );
}

/** What the memory line says about how the bundle was checked, from the summary alone. */
function memoryCheckLabel(summary: ManagerMemorySummary): string {
  if (summary.findings.length > 0) {
    const count = summary.findings.length;
    return `${count} ${count === 1 ? 'problem' : 'problems'}`;
  }
  if (!summary.checkedAt) return 'not checked yet';
  return summary.okf === 'ok' ? 'checked with okf' : 'layout checked';
}

type Loaded<T> =
  { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

function useLoaded<T>(load: () => Promise<T>, reloadToken: number) {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    let current = true;
    load().then(
      (value) => current && setResult({ state: 'ready', value }),
      (cause: unknown) => current && setResult({ state: 'error', message: errorSentence(cause) })
    );
    return () => {
      current = false;
    };
    // The caller's `load` closes over the key; the token is what asks for another read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);
  return [result, setResult] as const;
}

/**
 * What a Project Manager has and what it needs, inline in the rail (and, later,
 * in Settings): the address, the instructions, the memory and the folder. A
 * status line appears only when something asks the human for an action.
 */
// code-gate: complexity-cyclomatic, complexity-function-length, complexity-parameter-count - one destructured props object; each branch is a status line or row shown only in its own state
export function ManagerInspector({
  manager,
  run,
  liveSupervisor,
  folderOpen,
  reloadToken,
  onOpen,
  onAsk,
  onOpenFile,
  onEditInstructions,
  onRestart,
  onToggleFolder,
  files,
  composer,
}: ManagerInspectorProps) {
  const showToast = useStore((s) => s.showToast);
  // The age moves by the minute and the inspector is short-lived: read once, not per render.
  const [mountedAt] = useState(() => Date.now());
  const [instructions] = useLoaded(() => managerInstructions(manager.key), reloadToken);
  const [memory, setMemory] = useLoaded(() => managerMemory(manager.key), reloadToken);
  const [instructionsChanged, setInstructionsChanged] = useState(false);
  const [showFindings, setShowFindings] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (instructions.state !== 'ready') return;
    let current = true;
    void instructionsChangedSince(manager.lastLaunch, instructions.value).then(
      (changed) => current && setInstructionsChanged(changed)
    );
    return () => {
      current = false;
    };
  }, [manager.lastLaunch, instructions]);

  const copy = useCallback(
    async (text: string, what: string) => {
      showToast(
        (await copyToClipboard(text)) ? `Copied the ${what}` : `Could not copy the ${what}`,
        'info'
      );
    },
    [showToast]
  );

  const checkAgain = async () => {
    setChecking(true);
    try {
      await machineDependencies({ refresh: true });
      setMemory({ state: 'ready', value: await managerValidate(manager.key) });
    } catch (cause) {
      showToast(`Could not check the memory: ${errorSentence(cause)}`, 'error');
    } finally {
      setChecking(false);
    }
  };

  const summary: ManagerMemorySummary | null = memory.state === 'ready' ? memory.value : null;
  const preview = instructions.state === 'ready' ? instructionsPreview(instructions.value) : null;
  const problems = summary?.findings ?? [];
  const okfOff = summary ? OKF_OFF_REASON[summary.okf] : undefined;
  const total = summary ? totalConcepts(summary.concepts) : 0;
  const session = summary?.lastSession ?? null;
  const promotedWhileRunning = liveSupervisor !== undefined && manager.lastLaunch === null;
  const changedWhileRunning = liveSupervisor !== undefined && instructionsChanged;

  return (
    <div className="flex flex-col gap-1 py-1.5 pl-6 pr-2">
      {promotedWhileRunning && (
        <StatusLine
          tone="info"
          actions={
            <button type="button" onClick={onRestart} className={TEXT_BUTTON}>
              Restart Now
            </button>
          }
        >
          Works as a Project Manager from its next start.
        </StatusLine>
      )}
      {changedWhileRunning && !promotedWhileRunning && (
        <StatusLine
          tone="info"
          actions={
            <button type="button" onClick={onRestart} className={TEXT_BUTTON}>
              Restart
            </button>
          }
        >
          Instructions changed since this session started.
        </StatusLine>
      )}
      {problems.length > 0 && (
        <>
          <StatusLine
            tone="problem"
            actions={
              <button
                type="button"
                onClick={() => setShowFindings((open) => !open)}
                aria-expanded={showFindings}
                className={TEXT_BUTTON}
              >
                {showFindings ? 'Hide' : 'Show'}
              </button>
            }
          >
            Memory check found {problems.length} {problems.length === 1 ? 'problem' : 'problems'}.
          </StatusLine>
          {showFindings && (
            <ul className="flex flex-col gap-0.5 pl-2 text-[11px] text-foreground-muted">
              {problems.map((finding, index) => (
                <li key={`${finding.code}:${finding.path ?? ''}:${index}`} className="break-words">
                  {finding.path ? `${finding.path}: ${finding.message}` : finding.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {okfOff && summary && (
        <StatusLine
          tone={OKF_PROBLEM_STATES.includes(summary.okf) ? 'problem' : 'info'}
          actions={
            <>
              {summary && OKF_FIXABLE.includes(summary.okf) && (
                <button
                  type="button"
                  onClick={() => void copy(MANAGER_OKF_FIX, 'install command')}
                  className={TEXT_BUTTON}
                >
                  Copy Command
                </button>
              )}
              <button
                type="button"
                onClick={() => void checkAgain()}
                disabled={checking}
                title={checking ? 'Checking…' : undefined}
                className={TEXT_BUTTON}
              >
                Check Again
              </button>
            </>
          }
        >
          Memory check off: {okfOff}
        </StatusLine>
      )}

      <dl className="flex flex-col">
        <Row
          label="Key"
          action={
            <button
              type="button"
              onClick={() => void copy(manager.key, 'address')}
              aria-label="Copy address"
              title="Copy address"
              className={ICON_BUTTON}
            >
              <AuricIcon name="content_copy" aria-hidden="true" className="text-[13px]" />
            </button>
          }
        >
          <span className="font-mono">{manager.key}</span>
        </Row>
        <Row
          label="Instructions"
          action={
            instructions.state === 'ready' && instructions.value !== null ? (
              <button
                type="button"
                onClick={onEditInstructions}
                aria-label="Edit instructions"
                title="Open INSTRUCTIONS.md"
                className={TEXT_BUTTON}
              >
                Edit
              </button>
            ) : undefined
          }
        >
          {instructions.state === 'error' ? (
            <span className="text-amber-200">{instructions.message}</span>
          ) : instructions.state === 'loading' ? (
            <span className="text-foreground-muted">Reading…</span>
          ) : instructions.value === null ? (
            <span className="text-foreground-muted">No instructions file</span>
          ) : preview ? (
            <span className="block truncate" title={preview}>
              {preview}
            </span>
          ) : (
            <span className="text-foreground-muted">Empty</span>
          )}
        </Row>
        <Row label="Memory">
          {memory.state === 'error' ? (
            <span className="text-amber-200">{memory.message}</span>
          ) : summary ? (
            <RowButton
              title="Open the memory index"
              onClick={() => onOpenFile(knowledgeFilePath(run.path, MEMORY_INDEX_FILE))}
            >
              <span className="block">
                {total} {total === 1 ? 'concept' : 'concepts'} · {memoryCheckLabel(summary)}
              </span>
              {total > 0 && (
                <span className="block text-[11px] text-foreground-muted">
                  {conceptBreakdown(summary.concepts)}
                </span>
              )}
            </RowButton>
          ) : (
            <span className="text-foreground-muted">Reading…</span>
          )}
        </Row>
        <Row label="Last session">
          {session ? (
            <RowButton
              title={`Open the session note: ${session.title}`}
              onClick={() => onOpenFile(knowledgeFilePath(run.path, session.path))}
            >
              <span className="block truncate" title={session.description}>
                {session.description}
              </span>
              <span className="block text-[11px] text-foreground-muted">
                {formatSessionAge(mountedAt - session.atMs)}
              </span>
            </RowButton>
          ) : summary ? (
            <span className="text-foreground-muted">No session note yet</span>
          ) : (
            <span className="text-foreground-muted">
              {memory.state === 'error' ? 'Not available' : 'Reading…'}
            </span>
          )}
        </Row>
        <div className="flex items-start gap-2 py-0.5">
          <dt className="w-[4.25rem] shrink-0 pt-px text-[11px] text-foreground-muted">Folder</dt>
          <dd className="min-w-0 flex-1 text-xs">
            <button
              type="button"
              onClick={onToggleFolder}
              aria-expanded={folderOpen}
              aria-label={`Folder ${run.name}`}
              title="Show the files in this folder"
              className="flex w-full items-center gap-1 rounded text-left font-mono text-foreground transition-colors hover:text-primary"
            >
              <span className="min-w-0 flex-1 truncate">{run.name}</span>
              <AuricIcon
                name={folderOpen ? 'expand_more' : 'chevron_right'}
                aria-hidden="true"
                className="shrink-0 text-[14px] text-foreground-muted"
              />
            </button>
          </dd>
        </div>
      </dl>
      {folderOpen && files}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onOpen} className={ACTION_BUTTON}>
          Open
        </button>
        {composer === undefined && (
          <button
            type="button"
            onClick={onAsk}
            aria-label={`Ask ${manager.name}…`}
            className={ACTION_BUTTON}
          >
            Ask…
          </button>
        )}
      </div>
      {composer}
    </div>
  );
}
