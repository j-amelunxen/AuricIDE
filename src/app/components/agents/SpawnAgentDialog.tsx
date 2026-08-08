'use client';

import { useState, useEffect, useRef } from 'react';
import type { AgentConfig, PermissionMode } from '@/lib/tauri/agents';
import type { PmGoal } from '@/lib/tauri/goals';
import { listProviders, FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import { InfoTooltip } from '../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { deriveAgentName } from '@/lib/agents/naming';

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
}

export function SpawnAgentDialog(props: SpawnAgentDialogProps) {
  if (!props.isOpen) return null;
  return <SpawnAgentDialogPanel {...props} />;
}

/** Dropdown affordance for `appearance-none` selects. */
function SelectChevron() {
  return (
    <span
      aria-hidden="true"
      className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-foreground-muted"
    >
      expand_more
    </span>
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
}: SpawnAgentDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [task, setTask] = useState(initialTask);
  /** -1 = composing a fresh prompt; >= 0 = showing promptHistory[historyIndex]. */
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [goalId, setGoalId] = useState<string>(initialGoalId ?? '');
  const [providers, setProviders] = useState<ProviderInfo[]>([FALLBACK_CRUSH_PROVIDER]);
  const [selectedProviderId, setSelectedProviderId] = useState(FALLBACK_CRUSH_PROVIDER.id);
  const [model, setModel] = useState(FALLBACK_CRUSH_PROVIDER.defaultModel);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    FALLBACK_CRUSH_PROVIDER.defaultPermissionMode as PermissionMode
  );
  const [headless, setHeadless] = useState(false);

  const currentProvider = providers.find((p) => p.id === selectedProviderId) ?? providers[0];

  useEffect(() => {
    listProviders()
      .then((fetched) => {
        if (fetched.length > 0) {
          setProviders(fetched);
          const defaultProvider = fetched[0];
          setSelectedProviderId(defaultProvider.id);
          setModel(defaultProvider.defaultModel);
          setPermissionMode(defaultProvider.defaultPermissionMode as PermissionMode);
        }
      })
      .catch(() => {
        // Browser mode fallback — keep FALLBACK_CLAUDE_PROVIDER
      });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setTask(initialTask);
      setRepoPath(initialRepoPath);
      setGoalId(initialGoalId ?? '');
      setHistoryIndex(-1);
    }
  }, [isOpen, initialTask, initialRepoPath, initialGoalId]);

  // The instruction is what the user came here to write — start there, with the
  // caret behind any prefilled text so a handed-over prompt can just be extended.
  useEffect(() => {
    const textarea = taskRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  // Sync model/permission defaults when provider changes
  useEffect(() => {
    setModel(currentProvider.defaultModel);
    setPermissionMode(currentProvider.defaultPermissionMode as PermissionMode);
  }, [currentProvider]);

  const handleDeploy = () => {
    const folderName = repoPath ? repoPath.split('/').pop() : '';
    // Named after the instruction, so a fleet in one repo doesn't turn into a
    // column of identical labels. Editable afterwards from the agent card.
    const name = deriveAgentName(task, folderName || undefined);
    onSpawn({
      name,
      model,
      task: task.trim() || 'wait',
      cwd: repoPath || undefined,
      permissionMode,
      provider: selectedProviderId,
      headless: headless || undefined,
      spawnedByTicketId: spawnedByTicketId ?? undefined,
      spawnedByGoalId: goalId || undefined,
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
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
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
          <span className="material-symbols-outlined text-primary">rocket_launch</span>
          <h2
            id="spawn-agent-title"
            className="text-sm font-bold tracking-tight text-foreground uppercase"
          >
            New Agent
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
              Instruction / Objective
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
                Serves Goal
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
                      {opt.label}
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
  );
}
