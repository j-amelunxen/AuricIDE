import type { RepoView } from './types';

export function RepoPicker({
  repos,
  activeRepoPath,
  onChange,
}: {
  repos: RepoView[];
  activeRepoPath: string | null;
  onChange?: (repoPath: string) => void;
}) {
  return (
    <div className="px-3 pb-2">
      <select
        data-testid="scm-repo-picker"
        aria-label="Repository"
        value={activeRepoPath ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
      >
        {repos.map((repo) => (
          <option key={repo.repoPath} value={repo.repoPath}>
            {repo.label}
          </option>
        ))}
      </select>
    </div>
  );
}
