'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsInput } from '../../ui/settings/SettingsInput';
import {
  addIgnoredRepo,
  isIgnoredRepoPath,
  relativePathForIgnore,
  removeIgnoredRepo,
} from '@/lib/config/ignoredRepos';
import { loadIgnoredRepos, saveIgnoredRepos } from '@/lib/config/projectConfig';

/**
 * Nested git work-trees this project hides. The list lives in the project
 * database so discovery, the dirty probe and this screen all read one source.
 */
export function GitContent() {
  const rootPath = useStore((s) => s.rootPath);
  const repos = useStore((s) => s.repos);
  const discoverAndRefreshGit = useStore((s) => s.discoverAndRefreshGit);
  const showToast = useStore((s) => s.showToast);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadIgnoredRepos(rootPath ?? '');
      if (cancelled) return;
      setIgnored(stored);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  const persist = useCallback(
    async (next: string[]) => {
      setIgnored(next);
      if (!rootPath) return;
      try {
        await saveIgnoredRepos(rootPath, next);
        await discoverAndRefreshGit(rootPath);
      } catch {
        showToast('Could not save ignored repositories', 'error');
      }
    },
    [rootPath, discoverAndRefreshGit, showToast]
  );

  const visibleNested = useMemo(
    () =>
      repos.filter(
        (repo) => repo.kind !== 'root' && !isIgnoredRepoPath(repo.relativePath, ignored)
      ),
    [repos, ignored]
  );

  const addDraft = () => {
    const next = addIgnoredRepo(ignored, draft);
    if (next.length === ignored.length) return;
    setDraft('');
    void persist(next);
  };

  if (!rootPath) {
    return (
      <div className="space-y-8">
        <SettingsSection title="Git" icon="visibility_off">
          <p className="text-xs text-foreground-muted leading-relaxed">
            Open a project to hide nested repositories you do not want to see.
          </p>
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SettingsSection title="Ignored repositories" icon="visibility_off">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Nested git repos on this list stay out of Source Control and do not light up Quick Access.
          A prefix such as <code>vendor</code> hides every repo under that folder. The opened folder
          itself cannot be ignored.
        </p>

        {loading ? (
          <p className="text-xs text-foreground-muted">Loading…</p>
        ) : ignored.length === 0 ? (
          <p data-testid="ignored-repos-empty" className="text-xs text-foreground-muted">
            No repositories are ignored.
          </p>
        ) : (
          <ul data-testid="ignored-repos-list" className="space-y-1">
            {ignored.map((path) => (
              <li
                key={path}
                className="flex items-center justify-between gap-2 rounded border border-white/5 bg-white/5 px-2 py-1.5"
              >
                <span className="min-w-0 truncate font-mono text-xs text-foreground">{path}</span>
                <button
                  type="button"
                  data-testid={`unignore-repo-${path}`}
                  onClick={() => void persist(removeIgnoredRepo(ignored, path))}
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-foreground-muted hover:bg-primary/10 hover:text-primary"
                >
                  Unignore
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <SettingsInput
              label="Add a path"
              value={draft}
              onChange={setDraft}
              placeholder="vendor"
              hint="Relative to the project root. vendor hides every repo under vendor/."
              mono
              testId="ignored-repo-input"
            />
          </div>
          <button
            type="button"
            data-testid="ignored-repo-add"
            onClick={addDraft}
            disabled={!draft.trim()}
            className="mb-[18px] rounded border border-border-dark bg-editor-bg px-2 py-1.5 text-xs text-foreground hover:border-primary disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </SettingsSection>

      {visibleNested.length > 0 && (
        <SettingsSection title="Visible nested repositories" icon="account_tree">
          <ul className="space-y-1">
            {visibleNested.map((repo) => (
              <li
                key={repo.path}
                className="flex items-center justify-between gap-2 rounded border border-white/5 bg-white/5 px-2 py-1.5"
              >
                <span className="min-w-0 truncate font-mono text-xs text-foreground">
                  {repo.relativePath}
                </span>
                <button
                  type="button"
                  data-testid={`ignore-visible-repo-${repo.relativePath}`}
                  onClick={() => {
                    const relative = relativePathForIgnore(rootPath, repo.path);
                    if (!relative) return;
                    void persist(addIgnoredRepo(ignored, relative));
                  }}
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-foreground-muted hover:bg-primary/10 hover:text-primary"
                >
                  Ignore
                </button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}
    </div>
  );
}
