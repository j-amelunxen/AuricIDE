import { describe, expect, it } from 'vitest';
import { repoForPath, relativeToRepo, repoLabel } from './repos';
import type { GitRepoRef } from '@/lib/tauri/git';

function repo(
  path: string,
  relativePath: string,
  name: string,
  kind: GitRepoRef['kind']
): GitRepoRef {
  return { path, relativePath, name, kind };
}

describe('repoForPath', () => {
  const workspace = repo('/w', '', 'w', 'root');
  const api = repo('/w/api', 'api', 'api', 'nested');
  const shared = repo('/w/libs/shared', 'libs/shared', 'shared', 'nested');
  const repos = [workspace, api, shared];

  it('resolves a file inside the root repo', () => {
    expect(repoForPath('/w/README.md', repos)).toBe(workspace);
  });

  it('resolves a file inside a nested repo to the deepest match', () => {
    expect(repoForPath('/w/api/src/main.rs', repos)).toBe(api);
  });

  it('resolves the repo root path itself', () => {
    expect(repoForPath('/w/api', repos)).toBe(api);
  });

  it('resolves a deeply nested repo over its shallower ancestor', () => {
    expect(repoForPath('/w/libs/shared/index.ts', repos)).toBe(shared);
  });

  it('does not let a sibling prefix collide', () => {
    // "/w/api" must not match "/w/api-gateway/x" — string-prefix, not path-prefix.
    const apiGateway = repo('/w/api-gateway', 'api-gateway', 'api-gateway', 'nested');
    expect(repoForPath('/w/api-gateway/x', [workspace, api, apiGateway])).toBe(apiGateway);
  });

  it('tolerates a trailing slash on repo paths', () => {
    const trailing = repo('/w/api/', 'api', 'api', 'nested');
    expect(repoForPath('/w/api/src/main.rs', [workspace, trailing])).toBe(trailing);
  });

  it('tolerates a trailing slash on the file path', () => {
    expect(repoForPath('/w/api/', repos)).toBe(api);
  });

  it('returns null when nothing matches', () => {
    expect(repoForPath('/elsewhere/file.ts', repos)).toBeNull();
  });

  it('returns null for an empty repo list', () => {
    expect(repoForPath('/w/README.md', [])).toBeNull();
  });
});

describe('relativeToRepo', () => {
  it('returns the empty string for the repo root itself', () => {
    expect(relativeToRepo('/w/api', '/w/api')).toBe('');
  });

  it('returns the path relative to the repo', () => {
    expect(relativeToRepo('/w/api/src/main.rs', '/w/api')).toBe('src/main.rs');
  });

  it('tolerates a trailing slash on the repo path', () => {
    expect(relativeToRepo('/w/api/src/main.rs', '/w/api/')).toBe('src/main.rs');
  });

  it('tolerates a trailing slash on the file path', () => {
    expect(relativeToRepo('/w/api/src/', '/w/api')).toBe('src');
  });
});

describe('repoLabel', () => {
  it('labels the root repo by its work-tree name', () => {
    expect(repoLabel(repo('/w', '', 'w', 'root'))).toBe('w');
  });

  it('labels a nested repo by its relative path', () => {
    expect(repoLabel(repo('/w/api', 'api', 'api', 'nested'))).toBe('api');
  });

  it('labels a deeper nested repo by its full relative path', () => {
    expect(repoLabel(repo('/w/libs/shared', 'libs/shared', 'shared', 'nested'))).toBe(
      'libs/shared'
    );
  });

  it('labels a submodule by its relative path too', () => {
    expect(repoLabel(repo('/w/vendor/lib', 'vendor/lib', 'lib', 'submodule'))).toBe('vendor/lib');
  });
});
