'use client';

import { useState, useEffect, useRef, useCallback, type DragEvent } from 'react';
import type { AgentConfig, PermissionMode } from '@/lib/tauri/agents';
import type { PmGoal } from '@/lib/tauri/goals';
import { FALLBACK_CRUSH_PROVIDER } from '@/lib/tauri/providers';
import { useAllowedProviders } from '@/lib/hooks/useAllowedProviders';
import { InfoTooltip } from '../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { deriveAgentName } from '@/lib/agents/naming';
import {
  loadSpawnDefaults,
  mergeSpawnPreset,
  saveSpawnDefaults,
  type SpawnPreset,
} from '@/lib/agents/spawnDefaults';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import type { GitRepoRef } from '@/lib/tauri/git';
import { discoverGitRepos } from '@/lib/tauri/git';
import { repoLabel } from '@/lib/git/repos';
import { needsWorktreeRepoPicker, worktreeSourceRepos } from '@/lib/git/agentWorktree';
import { attachPathDrop, attachSavedImagePaste, saveTempImage } from '@/lib/terminal/imageInsert';
import {
  composeTaskWithAttachments,
  mergeAttachmentPaths,
  spawnAttachmentLabel,
} from '@/lib/agents/spawnAttachments';
import { useStore } from '@/lib/store';
import { isGitRepoRoot, workingDirectoryHasGitRepo } from '@/lib/git/worktreeDefault';

const YOLO_ELEVATE_ACK_KEY = 'auric.yolo-elevate-acknowledged';

interface SpawnAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawn: (config: AgentConfig) => void;
  initialTask?: string;
  spawnedByTicketId?: string | null;
  initialRepoPath?: string;
  recentPaths?: string[];
  /** Goals available for binding the agent's work to a goal. */
  goals?: PmGoal[];
  initialGoalId?: string | null;
  /** Previously used start prompts, newest first — recalled with ArrowUp. */
  promptHistory?: string[];
  /**
   * Launch choices pinned by the Quick Access skill that opened the dialog.
   * Takes precedence over the remembered defaults, but is validated the same
   * way: a provider or model that no longer exists degrades to the provider's
   * own defaults rather than breaking the launch.
   */
  presetDefaults?: SpawnPreset | null;
}

export function SpawnAgentDialog(props: SpawnAgentDialogProps) {
  if (!props.isOpen) return null;
  return <SpawnAgentDialogPanel {...props} />;
}

/** Dropdown affordance for `appearance-none` selects. */
function SelectChevron() {
  return (
    <AuricIcon
      name="expand_more"
      aria-hidden="true"
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-foreground-muted"
    />
  );
}

function SpawnAgentDialogPanel({
  isOpen,
  onClose,
  onSpawn,
  initialTask = '',
  spawnedByTicketId = null,
  initialRepoPath = '',
  recentPaths = [],
  goals = [],
  initialGoalId = null,
  promptHistory = [],
  presetDefaults = null,
}: SpawnAgentDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'spawn', kind: 'tool', active: true, onEscape: onClose });
  const { confirm, confirmDialog } = useConfirm();
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [task, setTask] = useState(initialTask);
  /** -1 = composing a fresh prompt; >= 0 = showing promptHistory[historyIndex]. */
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [goalId, setGoalId] = useState<string>(initialGoalId ?? '');
  // Filtered by the policy of the repository this agent will run in — not the
  // open project, which may be a different one. Rust checks that same policy
  // before spawning, so offering by any other yardstick would promise launches
  // it then refuses.
  const { providers, blockedAll: noProviderPermitted } = useAllowedProviders(
    FALLBACK_CRUSH_PROVIDER,
    repoPath || undefined
  );
  const [selectedProviderId, setSelectedProviderId] = useState(FALLBACK_CRUSH_PROVIDER.id);
  const [model, setModel] = useState(FALLBACK_CRUSH_PROVIDER.defaultModel);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    FALLBACK_CRUSH_PROVIDER.defaultPermissionMode as PermissionMode
  );
  const [headless, setHeadless] = useState(
    () => loadSpawnDefaults(initialRepoPath)?.headless ?? false
  );
  const repos = useStore((s) => s.repos);
  const [worktreeOverride, setWorktreeOverride] = useState<boolean | null>(null);
  const [probedHasGit, setProbedHasGit] = useState<boolean | null>(null);
  const [worktreeForPath, setWorktreeForPath] = useState(initialRepoPath);
  const [discoveredRepos, setDiscoveredRepos] = useState<GitRepoRef[]>([]);
  const [worktreeRepoPath, setWorktreeRepoPath] = useState('');
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isDropTarget, setIsDropTarget] = useState(false);
  // The last launch's choices, applied once when their provider becomes
  // current — four decisions per agent become zero for a same-as-last-time
  // fleet, while an explicit provider switch still resets to that
  // provider's own defaults. A skill's preset is folded in here so it goes
  // through the same validate-against-the-current-offering pass; the panel
  // remounts on every open, so the ref is re-evaluated per launch.
  const savedDefaultsRef = useRef(
    mergeSpawnPreset(loadSpawnDefaults(initialRepoPath), presetDefaults)
  );

  // The fallback keeps the fields renderable when the policy permits nothing:
  // the dialog says so and refuses to deploy, rather than crashing on an empty
  // list.
  const currentProvider =
    providers.find((p) => p.id === selectedProviderId) ?? providers[0] ?? FALLBACK_CRUSH_PROVIDER;

  // Re-runs whenever the permitted set changes — including when the target
  // repository is switched to one with a different policy, where the selected
  // provider may no longer be allowed.
  useEffect(() => {
    if (providers.length === 0) return;
    const saved = savedDefaultsRef.current;
    const defaultProvider = providers.find((p) => p.id === saved?.providerId) ?? providers[0];
    setSelectedProviderId(defaultProvider.id);
    setModel(defaultProvider.defaultModel);
    setPermissionMode(defaultProvider.defaultPermissionMode as PermissionMode);
  }, [providers]);

  // Adjusted while rendering rather than in an effect: opening the dialog is a
  // reset of this render, so the previous launch's instruction never paints
  // before being replaced.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTask(initialTask);
      setRepoPath(initialRepoPath);
      setGoalId(initialGoalId ?? '');
      setHistoryIndex(-1);
      setWorktreeOverride(null);
      setProbedHasGit(null);
      setWorktreeForPath(initialRepoPath);
      setDiscoveredRepos([]);
      setWorktreeRepoPath('');
      setWorktreeError(null);
      setAttachments([]);
      setIsDropTarget(false);
    }
  }

  // A new working directory drops the previous toggle and the previous probe.
  if (worktreeForPath !== repoPath) {
    setWorktreeForPath(repoPath);
    setWorktreeOverride(null);
    setProbedHasGit(null);
  }

  const knownGitRepo = isGitRepoRoot(repoPath, repos);
  const useWorktree = worktreeOverride ?? (knownGitRepo || probedHasGit === true);

  // Only the disk probe lives here — known roots are derived above, so a
  // discovered repo never waits on IPC and never writes the same boolean back.
  useEffect(() => {
    if (knownGitRepo || !repoPath.trim()) return;
    let cancelled = false;
    void workingDirectoryHasGitRepo(repoPath).then((hasRepo) => {
      if (!cancelled) setProbedHasGit(hasRepo);
    });
    return () => {
      cancelled = true;
    };
  }, [knownGitRepo, repoPath]);

  // When the agent will run in a worktree, find the git repos under the
  // working directory so we can ask which one to branch — a workspace that
  // is not itself a repo used to throw from git_worktree_add.
  useEffect(() => {
    if (!useWorktree || !repoPath) return;
    let cancelled = false;
    void discoverGitRepos(repoPath)
      .then((foundRepos) => {
        if (cancelled) return;
        setDiscoveredRepos(foundRepos);
        const sources = worktreeSourceRepos(repoPath, foundRepos);
        if (sources.length === 0) {
          setWorktreeRepoPath('');
          setWorktreeError('This folder is not a git repository.');
          return;
        }
        setWorktreeError(null);
        if (needsWorktreeRepoPicker(repoPath, foundRepos)) {
          setWorktreeRepoPath((current) => {
            if (sources.some((source) => source.path === current)) return current;
            return sources.length === 1 ? sources[0].path : '';
          });
          return;
        }
        setWorktreeRepoPath('');
      })
      .catch(() => {
        if (cancelled) return;
        setDiscoveredRepos([]);
        setWorktreeRepoPath('');
        setWorktreeError('This folder is not a git repository.');
      });
    return () => {
      cancelled = true;
    };
  }, [useWorktree, repoPath]);

  const addAttachments = useCallback((paths: string[]) => {
    setAttachments((current) => mergeAttachmentPaths(current, paths));
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const detachDrop = attachPathDrop(el, addAttachments, setIsDropTarget);
    const detachPaste = attachSavedImagePaste(el, addAttachments);
    return () => {
      detachDrop();
      detachPaste();
    };
  }, [addAttachments, dialogRef]);

  // The instruction is what the user came here to write — start there, with the
  // caret behind any prefilled text so a handed-over prompt can just be extended.
  useEffect(() => {
    const textarea = taskRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  // Sync model/permission defaults when provider changes. The remembered
  // choices apply exactly once, and only if they still exist in the
  // provider's current offering — a renamed model must not resurrect.
  useEffect(() => {
    const saved = savedDefaultsRef.current;
    if (saved && saved.providerId === currentProvider.id) {
      savedDefaultsRef.current = null;
      setModel(
        currentProvider.models.some((m) => m.value === saved.model)
          ? saved.model
          : currentProvider.defaultModel
      );
      setPermissionMode(
        currentProvider.permissionModes.some((m) => m.value === saved.permissionMode)
          ? saved.permissionMode
          : (currentProvider.defaultPermissionMode as PermissionMode)
      );
      return;
    }
    setModel(currentProvider.defaultModel);
    setPermissionMode(currentProvider.defaultPermissionMode as PermissionMode);
  }, [currentProvider]);

  const instruction = task.trim();
  const worktreeSources = worktreeSourceRepos(repoPath, discoveredRepos);
  const showWorktreePicker = useWorktree && needsWorktreeRepoPicker(repoPath, discoveredRepos);

  const handleDeploy = async () => {
    if (!instruction) return;
    let resolvedWorktreeRepo: string | undefined;
    if (useWorktree) {
      if (!repoPath) {
        setWorktreeError('A git worktree needs a working directory.');
        return;
      }
      let repos = discoveredRepos;
      try {
        repos = await discoverGitRepos(repoPath);
      } catch {
        repos = [];
      }
      setDiscoveredRepos(repos);
      const sources = worktreeSourceRepos(repoPath, repos);
      if (sources.length === 0) {
        setWorktreeError('This folder is not a git repository.');
        return;
      }
      if (needsWorktreeRepoPicker(repoPath, repos)) {
        const chosen = sources.find((source) => source.path === worktreeRepoPath);
        if (!chosen) {
          setWorktreeError('Choose which repository to check the agent out from.');
          return;
        }
        resolvedWorktreeRepo = chosen.path;
      } else {
        resolvedWorktreeRepo = sources[0].path;
      }
    }
    if (permissionMode === 'yolo' && sessionStorage.getItem(YOLO_ELEVATE_ACK_KEY) !== '1') {
      const go = await confirm({
        title: 'Act without asking?',
        message: 'This agent can edit files and run commands without asking.',
        confirmLabel: 'Continue',
        variant: 'elevate',
      });
      if (!go) return;
      sessionStorage.setItem(YOLO_ELEVATE_ACK_KEY, '1');
    }
    const folderName = repoPath ? repoPath.split('/').pop() : '';
    // Named after the instruction, so a fleet in one repo doesn't turn into a
    // column of identical labels. Editable afterwards from the agent card.
    const name = deriveAgentName(task, folderName || undefined);
    // A preset is the project's opinion about one recurring task, not the
    // user's baseline. Letting it write remembered defaults would mean a skill
    // pinned to `plan` quietly redefines later hand-written launches in the project.
    if (!presetDefaults) {
      saveSpawnDefaults(
        {
          providerId: selectedProviderId,
          model,
          permissionMode,
          headless,
        },
        repoPath
      );
    }
    onSpawn({
      name,
      model,
      task: composeTaskWithAttachments(instruction, attachments),
      cwd: repoPath || undefined,
      permissionMode,
      provider: selectedProviderId,
      headless: headless || undefined,
      spawnedByTicketId: spawnedByTicketId ?? undefined,
      spawnedByGoalId: goalId || undefined,
      useWorktree: useWorktree || undefined,
      worktreeRepoPath:
        useWorktree && resolvedWorktreeRepo && resolvedWorktreeRepo !== repoPath
          ? resolvedWorktreeRepo
          : undefined,
      historyPrompt: attachments.length > 0 ? instruction : undefined,
    });
    setRepoPath('');
    setTask('');
    setAttachments([]);
    setModel(currentProvider.defaultModel);
    setPermissionMode(currentProvider.defaultPermissionMode as PermissionMode);
    onClose();
  };

  /**
   * Shell-style recall: ArrowUp walks back through previous prompts, ArrowDown
   * walks forward again. Only active while the field holds a recalled prompt or
   * nothing at all, so it never hijacks the arrow keys during real editing.
   */
  const handleTaskKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (promptHistory.length === 0) return;

    if (e.key === 'ArrowUp' && (historyIndex >= 0 || task === '')) {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, promptHistory.length - 1);
      setHistoryIndex(next);
      setTask(promptHistory[next]);
      return;
    }

    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setTask(next < 0 ? '' : promptHistory[next]);
    }
  };

  const handleBrowse = async () => {
    try {
      const mod = await import('@tauri-apps/plugin-dialog');
      const selected = await mod.open({ directory: true });
      if (selected) setRepoPath(selected as string);
    } catch {
      // no-op in browser mode
    }
  };

  const handleHtml5DragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDropTarget(true);
  };

  const handleHtml5DragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDropTarget(false);
  };

  const handleHtml5Drop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDropTarget(false);
    const files = Array.from(e.dataTransfer.files);
    const nativePaths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => !!path);
    if (nativePaths.length > 0) {
      addAttachments(nativePaths);
      return;
    }
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    Promise.all(images.map(saveTempImage))
      .then(addAttachments)
      .catch(() => {
        // Browser mode / IPC failure — nothing to attach
      });
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-tool-nested)] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter deploys from anywhere in the dialog — a plain Enter
          // stays available for writing a multi-line instruction.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleDeploy();
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="spawn-agent-title"
          className="glass-card relative w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#0a0a10] p-6 shadow-2xl animate-in fade-in zoom-in duration-200"
          onClick={(e) => e.stopPropagation()}
          onDragOver={handleHtml5DragOver}
          onDragLeave={handleHtml5DragLeave}
          onDrop={handleHtml5Drop}
        >
          {isDropTarget && (
            <div
              data-testid="spawn-drop-overlay"
              className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center rounded-xl border-2 border-primary/60 bg-primary/10"
            >
              <span className="rounded-full bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                Drop to attach
              </span>
            </div>
          )}
          <div className="mb-6 flex items-center gap-2">
            <AuricIcon name="rocket_launch" className="text-primary" />
            <h2
              id="spawn-agent-title"
              className="text-sm font-bold tracking-tight text-foreground uppercase"
            >
              Start agent
            </h2>
          </div>

          <div className="flex flex-col gap-5">
            <div className="space-y-1.5">
              <label
                htmlFor="repo-path"
                className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Working Directory
                <InfoTooltip description={GUIDANCE.pm.workingDirectory} label="i" />
              </label>
              <div className="flex gap-2">
                <input
                  id="repo-path"
                  type="text"
                  value={repoPath}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRepoPath(next);
                    if (!next) {
                      setDiscoveredRepos([]);
                      setWorktreeRepoPath('');
                      setWorktreeError(null);
                    }
                  }}
                  className="flex-1 rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                  placeholder="/path/to/repo"
                />
                <button
                  type="button"
                  onClick={handleBrowse}
                  className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-xs text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all"
                >
                  Browse
                </button>
              </div>
              {recentPaths.length > 0 && (
                <div className="relative">
                  <select
                    data-testid="recent-dirs"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setRepoPath(e.target.value);
                    }}
                    className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground-muted outline-none focus:border-primary/50 transition-colors appearance-none"
                  >
                    <option value="">Recent directories...</option>
                    {recentPaths.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="task-desc"
                className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                What should it do?
                <InfoTooltip description={GUIDANCE.agents.task} label="i" />
              </label>
              <textarea
                id="task-desc"
                ref={taskRef}
                value={task}
                onChange={(e) => {
                  setTask(e.target.value);
                  // Typing means the user owns this text now, not the history.
                  setHistoryIndex(-1);
                }}
                onKeyDown={handleTaskKeyDown}
                className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors resize-none min-h-[100px]"
                placeholder="What should the agent achieve?"
              />
              {attachments.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 pt-1">
                  {attachments.map((path) => (
                    <li
                      key={path}
                      className="flex items-center gap-1 rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-foreground"
                    >
                      <AuricIcon name="image" className="text-[12px] text-foreground-muted" />
                      <span className="max-w-[10rem] truncate">{spawnAttachmentLabel(path)}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${spawnAttachmentLabel(path)}`}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((candidate) => candidate !== path)
                          )
                        }
                        className="text-foreground-muted hover:text-foreground"
                      >
                        <AuricIcon name="close" className="text-[12px]" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] text-foreground-muted">
                Drop or paste an image — it goes out with the prompt
                {promptHistory.length > 0 && (
                  <span data-testid="prompt-history-hint"> · ↑ recalls an earlier prompt</span>
                )}
              </p>
            </div>

            {goals.length > 0 && (
              <div className="space-y-1.5">
                <label
                  htmlFor="goal-select"
                  className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
                >
                  For goal
                </label>
                <div className="relative">
                  <select
                    id="goal-select"
                    data-testid="spawn-goal-select"
                    value={goalId}
                    onChange={(e) => setGoalId(e.target.value)}
                    className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                  >
                    <option value="">None</option>
                    {goals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              </div>
            )}

            {providers.length > 1 && (
              <div className="space-y-1.5">
                <label
                  htmlFor="provider-select"
                  className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
                >
                  Provider
                  <InfoTooltip description={GUIDANCE.agents.provider} label="i" />
                </label>
                <div className="relative">
                  <select
                    id="provider-select"
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                    className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              </div>
            )}

            {/* Outside the picker on purpose: the picker only renders when
                there is a choice to make, which is never the case in exactly
                the situation this message explains. */}
            {noProviderPermitted && (
              <p role="alert" className="text-[11px] text-red-400">
                This project permits no agent provider. Change its provider policy under Settings →
                Project → Providers.
              </p>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="model-select"
                  className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
                >
                  Model
                  <InfoTooltip description={GUIDANCE.agents.model} label="i" />
                </label>
                <div className="relative">
                  <select
                    id="model-select"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                  >
                    {currentProvider.models.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="permission-mode"
                  className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
                >
                  Permission Mode
                  <InfoTooltip description={GUIDANCE.agents.permissionMode} label="i" />
                </label>
                <div className="relative">
                  <select
                    id="permission-mode"
                    value={permissionMode}
                    onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
                    className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                  >
                    {currentProvider.permissionModes.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.value === 'yolo' ? 'Act without asking' : opt.label}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              </div>
            </div>

            <p className="text-[10px] text-foreground-muted -mt-2">
              {currentProvider.permissionModes.find((o) => o.value === permissionMode)?.description}
            </p>

            <label className="flex items-center gap-2 cursor-pointer -mt-1">
              <input
                type="checkbox"
                checked={headless}
                onChange={(e) => setHeadless(e.target.checked)}
                className="accent-primary h-3.5 w-3.5"
              />
              <span className="flex items-center text-xs text-foreground-muted">
                Headless Mode
                <InfoTooltip description={GUIDANCE.agents.headless} label="i" />
                <span className="text-[10px] ml-1 opacity-60">
                  Agent runs unattended and exits after completion
                </span>
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer -mt-1">
              <input
                type="checkbox"
                checked={useWorktree}
                onChange={(e) => {
                  const on = e.target.checked;
                  setWorktreeOverride(on);
                  if (!on) {
                    setDiscoveredRepos([]);
                    setWorktreeRepoPath('');
                    setWorktreeError(null);
                  }
                }}
                disabled={!repoPath}
                className="accent-primary h-3.5 w-3.5"
              />
              <span className="flex items-center text-xs text-foreground-muted">
                New git worktree
                <InfoTooltip description={GUIDANCE.agents.worktree} label="i" />
                <span className="text-[10px] ml-1 opacity-60">
                  Isolated branch, leaves your checkout alone
                </span>
              </span>
            </label>

            {showWorktreePicker && (
              <div className="space-y-1.5 -mt-1">
                <label
                  htmlFor="worktree-repo"
                  className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
                >
                  Git repository
                  <InfoTooltip description={GUIDANCE.agents.worktreeRepo} label="i" />
                </label>
                <div className="relative">
                  <select
                    id="worktree-repo"
                    value={worktreeRepoPath}
                    onChange={(e) => {
                      setWorktreeRepoPath(e.target.value);
                      setWorktreeError(null);
                    }}
                    className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                  >
                    <option value="">Choose a repository…</option>
                    {worktreeSources.map((source) => (
                      <option key={source.path} value={source.path}>
                        {repoLabel(source)}
                        {source.kind === 'submodule' ? ' (submodule)' : ''}
                      </option>
                    ))}
                  </select>
                  <SelectChevron />
                </div>
              </div>
            )}

            {worktreeError && (
              <p role="alert" className="text-[11px] text-red-400 -mt-2">
                {worktreeError}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeploy}
                disabled={
                  !instruction ||
                  noProviderPermitted ||
                  (useWorktree && (!!worktreeError || (showWorktreePicker && !worktreeRepoPath)))
                }
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(var(--primary-rgb),0.3)] hover:brightness-110 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
              >
                Start Agent
                <span aria-hidden="true" className="text-[10px] font-medium opacity-70">
                  ⌘↵
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmDialog}
    </>
  );
}
