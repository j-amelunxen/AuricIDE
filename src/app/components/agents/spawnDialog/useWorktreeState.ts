'use client';

import { useState, useEffect } from 'react';
import type { GitRepoRef } from '@/lib/tauri/git';
import { discoverGitRepos } from '@/lib/tauri/git';
import { needsWorktreeRepoPicker, worktreeSourceRepos } from '@/lib/git/agentWorktree';
import { useStore } from '@/lib/store';
import {
  isGitRepoRoot,
  resolveUseWorktree,
  workingDirectoryHasGitRepo,
} from '@/lib/git/worktreeDefault';

interface UseWorktreeStateProps {
  repoPath: string;
  initialRepoPath: string;
  worktreeDefault?: boolean | null;
  selectedPathsCount: number;
}

export function useWorktreeState({
  repoPath,
  initialRepoPath,
  worktreeDefault = null,
  selectedPathsCount,
}: UseWorktreeStateProps) {
  const repos = useStore((s) => s.repos);
  const [worktreeOverride, setWorktreeOverride] = useState<boolean | null>(null);
  const [probedHasGit, setProbedHasGit] = useState<boolean | null>(null);
  const [worktreeForPath, setWorktreeForPath] = useState(initialRepoPath);
  const [discoveredRepos, setDiscoveredRepos] = useState<GitRepoRef[]>([]);
  const [worktreeRepoPath, setWorktreeRepoPath] = useState('');
  const [worktreeError, setWorktreeError] = useState<string | null>(null);

  // A new working directory drops the previous toggle and the previous probe.
  if (worktreeForPath !== repoPath) {
    setWorktreeForPath(repoPath);
    setWorktreeOverride(null);
    setProbedHasGit(null);
  }

  const knownGitRepo = isGitRepoRoot(repoPath, repos);
  const useWorktree = resolveUseWorktree({
    override: worktreeOverride,
    // The pin was made for the folder the launch named. Once the user picks
    // another one, the box goes back to following the folder — the same rule
    // that drops their own toggle above.
    pinned: repoPath === initialRepoPath ? worktreeDefault : null,
    hasGitRepo: knownGitRepo || probedHasGit === true,
  });

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

  const worktreeSources = worktreeSourceRepos(repoPath, discoveredRepos);
  const showWorktreePicker =
    useWorktree && selectedPathsCount <= 1 && needsWorktreeRepoPicker(repoPath, discoveredRepos);

  const handleUseWorktreeChange = (on: boolean) => {
    setWorktreeOverride(on);
    if (!on) {
      setDiscoveredRepos([]);
      setWorktreeRepoPath('');
      setWorktreeError(null);
    }
  };

  const handleWorktreeRepoChange = (path: string) => {
    setWorktreeRepoPath(path);
    setWorktreeError(null);
  };

  const resetWorktree = (path: string) => {
    setWorktreeOverride(null);
    setProbedHasGit(null);
    setWorktreeForPath(path);
    setDiscoveredRepos([]);
    setWorktreeRepoPath('');
    setWorktreeError(null);
  };

  return {
    useWorktree,
    worktreeOverride,
    worktreeRepoPath,
    worktreeError,
    worktreeSources,
    showWorktreePicker,
    discoveredRepos,
    setDiscoveredRepos,
    setWorktreeRepoPath,
    setWorktreeError,
    handleUseWorktreeChange,
    handleWorktreeRepoChange,
    resetWorktree,
  };
}
