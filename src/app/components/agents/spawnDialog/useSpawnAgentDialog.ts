'use client';

import { useState, useEffect, useRef } from 'react';
import type { PermissionMode } from '@/lib/tauri/agents';
import { FALLBACK_CRUSH_PROVIDER } from '@/lib/tauri/providers';
import { useAllowedProviders } from '@/lib/hooks/useAllowedProviders';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { deriveAgentName } from '@/lib/agents/naming';
import { loadSpawnDefaults, mergeSpawnPreset, saveSpawnDefaults } from '@/lib/agents/spawnDefaults';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import type { GitRepoRef } from '@/lib/tauri/git';
import { discoverGitRepos } from '@/lib/tauri/git';
import { needsWorktreeRepoPicker, worktreeSourceRepos } from '@/lib/git/agentWorktree';
import { composeTaskWithAttachments } from '@/lib/agents/spawnAttachments';
import { useStore } from '@/lib/store';
import { useProjectSkills } from '@/lib/hooks/useProjectSkills';
import {
  initialQuickAccessSelection,
  sortQuickAccessProjects,
  spawnCwdTargets,
  ticketAndGoalForCwd,
} from '@/lib/agents/spawnTargets';
import { YOLO_ELEVATE_ACK_KEY, type SpawnAgentDialogProps } from './types';
import { useWorktreeState } from './useWorktreeState';
import { useDragAndDropAttachments } from './useDragAndDropAttachments';

export function useSpawnAgentDialog({
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
  worktreeDefault = null,
}: SpawnAgentDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'spawn', kind: 'tool', active: true, onEscape: onClose });
  const { confirm, confirmDialog } = useConfirm();
  const taskRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const [repoPath, setRepoPath] = useState(initialRepoPath);
  const [task, setTask] = useState(initialTask);
  const { discovered } = useProjectSkills(repoPath || undefined);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [goalId, setGoalId] = useState<string>(initialGoalId ?? '');

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

  const starredProjects = useStore((s) => s.starredProjects);
  const [selectedPaths, setSelectedPaths] = useState(() =>
    initialQuickAccessSelection(starredProjects, initialRepoPath)
  );

  const worktree = useWorktreeState({
    repoPath,
    initialRepoPath,
    worktreeDefault,
    selectedPathsCount: selectedPaths.length,
  });

  const dnd = useDragAndDropAttachments(dialogRef);

  const savedDefaultsRef = useRef(
    mergeSpawnPreset(loadSpawnDefaults(initialRepoPath), presetDefaults)
  );

  const currentProvider =
    providers.find((p) => p.id === selectedProviderId) ?? providers[0] ?? FALLBACK_CRUSH_PROVIDER;

  useEffect(() => {
    if (providers.length === 0) return;
    const saved = savedDefaultsRef.current;
    const defaultProvider = providers.find((p) => p.id === saved?.providerId) ?? providers[0];
    setSelectedProviderId(defaultProvider.id);
    setModel(defaultProvider.defaultModel);
    setPermissionMode(defaultProvider.defaultPermissionMode as PermissionMode);
  }, [providers]);

  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTask(initialTask);
      setRepoPath(initialRepoPath);
      setSelectedPaths(initialQuickAccessSelection(starredProjects, initialRepoPath));
      setGoalId(initialGoalId ?? '');
      setHistoryIndex(-1);
      worktree.resetWorktree(initialRepoPath);
      dnd.resetAttachments();
    }
  }

  useEffect(() => {
    const textarea = taskRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

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
  const sortedQuickAccess = sortQuickAccessProjects(starredProjects);
  const cwdTargets = spawnCwdTargets(selectedPaths, starredProjects, repoPath);
  const fanoutCount = cwdTargets.length;
  const allPinnedSelected =
    sortedQuickAccess.length > 0 &&
    sortedQuickAccess.every((project) => selectedPaths.includes(project.path));

  const syncTypedPath = (next: string) => {
    setRepoPath(next);
    const match = starredProjects.find((project) => project.path === next);
    setSelectedPaths(match ? [match.path] : []);
    if (!next) {
      worktree.setDiscoveredRepos([]);
      worktree.setWorktreeRepoPath('');
      worktree.setWorktreeError(null);
    }
  };

  const toggleQuickAccess = (path: string) => {
    setSelectedPaths((current) => {
      const has = current.includes(path);
      const next = has ? current.filter((entry) => entry !== path) : [...current, path];
      if (!has) {
        setRepoPath(path);
      } else if (repoPath === path) {
        setRepoPath(next[0] ?? '');
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allPinnedSelected) {
      setSelectedPaths([]);
      return;
    }
    const allPaths = sortedQuickAccess.map((project) => project.path);
    setSelectedPaths(allPaths);
    if (!allPaths.includes(repoPath)) {
      setRepoPath(allPaths[0] ?? '');
    }
  };

  const handleDeploy = async () => {
    if (!instruction) return;
    const worktreeByCwd = new Map<string, string | undefined>();
    if (worktree.useWorktree) {
      for (const cwd of cwdTargets) {
        if (!cwd) {
          worktree.setWorktreeError('A git worktree needs a working directory.');
          return;
        }
        let foundRepos: GitRepoRef[];
        try {
          foundRepos = await discoverGitRepos(cwd);
        } catch {
          foundRepos = [];
        }
        if (cwdTargets.length === 1) worktree.setDiscoveredRepos(foundRepos);
        const sources = worktreeSourceRepos(cwd, foundRepos);
        if (sources.length === 0) {
          const folder = cwd.split('/').pop() || cwd;
          worktree.setWorktreeError(
            cwdTargets.length === 1
              ? 'This folder is not a git repository.'
              : `${folder} is not a git repository.`
          );
          return;
        }
        if (needsWorktreeRepoPicker(cwd, foundRepos)) {
          if (cwdTargets.length > 1) {
            worktree.setWorktreeError('A nested git repo has to be chosen one project at a time.');
            return;
          }
          const chosen = sources.find((source) => source.path === worktree.worktreeRepoPath);
          if (!chosen) {
            worktree.setWorktreeError('Choose which repository to check the agent out from.');
            return;
          }
          worktreeByCwd.set(cwd, chosen.path);
        } else {
          worktreeByCwd.set(cwd, sources[0].path);
        }
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
    if (!presetDefaults && fanoutCount <= 1) {
      saveSpawnDefaults(
        {
          providerId: selectedProviderId,
          model,
          permissionMode,
          headless,
        },
        cwdTargets[0] || repoPath
      );
    }
    const composedTask = composeTaskWithAttachments(instruction, dnd.attachments);
    for (const cwd of cwdTargets) {
      const folderName = cwd ? cwd.split('/').pop() : '';
      const name = deriveAgentName(task, folderName || undefined);
      const resolvedWorktreeRepo = worktreeByCwd.get(cwd);
      const binding = ticketAndGoalForCwd(
        cwd,
        initialRepoPath,
        spawnedByTicketId,
        goalId,
        fanoutCount > 1
      );
      await onSpawn({
        name,
        model,
        task: composedTask,
        cwd: cwd || undefined,
        permissionMode,
        provider: selectedProviderId,
        headless: headless || undefined,
        ...binding,
        useWorktree: worktree.useWorktree || undefined,
        worktreeRepoPath:
          worktree.useWorktree && resolvedWorktreeRepo && resolvedWorktreeRepo !== cwd
            ? resolvedWorktreeRepo
            : undefined,
        historyPrompt: dnd.attachments.length > 0 ? instruction : undefined,
      });
    }
    setRepoPath('');
    setTask('');
    setSelectedPaths([]);
    dnd.resetAttachments();
    setModel(currentProvider.defaultModel);
    setPermissionMode(currentProvider.defaultPermissionMode as PermissionMode);
    onClose();
  };

  const handleTaskKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.defaultPrevented) return;
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
      if (selected) syncTypedPath(selected as string);
    } catch {
      // no-op in browser mode
    }
  };

  const handleTaskChange = (next: string) => {
    setTask(next);
    setHistoryIndex(-1);
  };

  return {
    dialogRef,
    confirmDialog,
    repoPath,
    syncTypedPath,
    handleBrowse,
    recentPaths,
    sortedQuickAccess,
    selectedPaths,
    allPinnedSelected,
    toggleSelectAll,
    toggleQuickAccess,
    taskRef,
    task,
    handleTaskChange,
    handleTaskKeyDown,
    discovered,
    attachments: dnd.attachments,
    removeAttachment: dnd.removeAttachment,
    promptHistory,
    goals,
    goalId,
    setGoalId,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    noProviderPermitted,
    currentProvider,
    model,
    setModel,
    permissionMode,
    setPermissionMode,
    headless,
    setHeadless,
    useWorktree: worktree.useWorktree,
    handleUseWorktreeChange: worktree.handleUseWorktreeChange,
    showWorktreePicker: worktree.showWorktreePicker,
    worktreeSources: worktree.worktreeSources,
    worktreeRepoPath: worktree.worktreeRepoPath,
    handleWorktreeRepoChange: worktree.handleWorktreeRepoChange,
    worktreeError: worktree.worktreeError,
    instruction,
    fanoutCount,
    handleDeploy,
    isDropTarget: dnd.isDropTarget,
    handleHtml5DragOver: dnd.handleHtml5DragOver,
    handleHtml5DragLeave: dnd.handleHtml5DragLeave,
    handleHtml5Drop: dnd.handleHtml5Drop,
  };
}
