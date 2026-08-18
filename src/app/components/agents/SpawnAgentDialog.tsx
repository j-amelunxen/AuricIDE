'use client';

import { useState, useEffect, useRef } from 'react';
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
  const [useWorktree, setUseWorktree] = useState(false);
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
      setUseWorktree(false);
    }
  }

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

  const handleDeploy = async () => {
    if (!instruction) return;
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
      task: instruction,
      cwd: repoPath || undefined,
      permissionMode,
      provider: selectedProviderId,
      headless: headless || undefined,
      spawnedByTicketId: spawnedByTicketId ?? undefined,
      spawnedByGoalId: goalId || undefined,
      useWorktree: useWorktree || undefined,
    });
    setRepoPath('');
    setTask('');
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
          className="glass-card w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#0a0a10] p-6 shadow-2xl animate-in fade-in zoom-in duration-200"
          onClick={(e) => e.stopPropagation()}
        >
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
                  onChange={(e) => setRepoPath(e.target.value)}
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
              {promptHistory.length > 0 && (
                <p data-testid="prompt-history-hint" className="text-[10px] text-foreground-muted">
                  ↑ recalls an earlier prompt
                </p>
              )}
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
                onChange={(e) => setUseWorktree(e.target.checked)}
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
                disabled={!instruction || noProviderPermitted}
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
