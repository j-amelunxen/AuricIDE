'use client';

import { useState, useEffect } from 'react';
import type { AgentConfig, PermissionMode } from '@/lib/tauri/agents';
import { listProviders, FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import { InfoTooltip } from '../ui/InfoTooltip';
import { GUIDANCE } from '@/lib/ui/descriptions';

interface SpawnAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawn: (config: AgentConfig) => void;
  initialTask?: string;
  spawnedByTicketId?: string | null;
  initialRepoPath?: string;
  recentPaths?: string[];
}

export function SpawnAgentDialog({
  isOpen,
  onClose,
  onSpawn,
  initialTask = '',
  spawnedByTicketId = null,
  initialRepoPath = '',
  recentPaths = [],
}: SpawnAgentDialogProps) {
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [task, setTask] = useState(initialTask);
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
    }
  }, [isOpen, initialTask, initialRepoPath]);

  // Sync model/permission defaults when provider changes
  useEffect(() => {
    setModel(currentProvider.defaultModel);
    setPermissionMode(currentProvider.defaultPermissionMode as PermissionMode);
  }, [currentProvider]);

  if (!isOpen) return null;

  const handleDeploy = () => {
    const folderName = repoPath ? repoPath.split('/').pop() : '';
    const name = folderName ? `Agent (${folderName})` : 'Agent';
    onSpawn({
      name,
      model,
      task,
      cwd: repoPath || undefined,
      permissionMode,
      provider: selectedProviderId,
      headless: headless || undefined,
      spawnedByTicketId: spawnedByTicketId ?? undefined,
    });
    setRepoPath('');
    setTask('');
    setModel(currentProvider.defaultModel);
    setPermissionMode(currentProvider.defaultPermissionMode as PermissionMode);
    onClose();
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
    >
      <div
        className="glass-card w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#0a0a10] p-6 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">rocket_launch</span>
          <h2 className="text-sm font-bold tracking-tight text-foreground uppercase">
            Deploy New Agent
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
              <select
                data-testid="recent-dirs"
                value=""
                onChange={(e) => {
                  if (e.target.value) setRepoPath(e.target.value);
                }}
                className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground-muted outline-none focus:border-primary/50 transition-colors appearance-none"
              >
                <option value="">Recent directories...</option>
                {recentPaths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
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
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors resize-none min-h-[100px]"
              placeholder="What should the agent achieve?"
            />
          </div>

          {providers.length > 1 && (
            <div className="space-y-1.5">
              <label
                htmlFor="provider-select"
                className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Provider
                <InfoTooltip description={GUIDANCE.agents.provider} label="i" />
              </label>
              <select
                id="provider-select"
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="model-select"
                className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Intelligence Model
                <InfoTooltip description={GUIDANCE.agents.model} label="i" />
              </label>
              <select
                id="model-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
              >
                {currentProvider.models.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="permission-mode"
                className="flex items-center text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Permission Mode
                <InfoTooltip description={GUIDANCE.agents.permissionMode} label="i" />
              </label>
              <select
                id="permission-mode"
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
                className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
              >
                {currentProvider.permissionModes.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
                — Agent runs unattended and exits after completion
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={!task.trim()}
              onClick={handleDeploy}
              className="rounded-lg bg-primary px-6 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(188,19,254,0.3)] hover:brightness-110 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
            >
              INITIALIZE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
