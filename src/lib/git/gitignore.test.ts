import { describe, expect, it } from 'vitest';
import { appendGitignoreEntry, toGitignoreEntry } from './gitignore';

describe('toGitignoreEntry', () => {
  it('anchors a file at the project root so same-named files elsewhere stay tracked', () => {
    expect(toGitignoreEntry('/p', '/p/src/secret.ts', false)).toBe('/src/secret.ts');
  });

  it('marks directories with a trailing slash', () => {
    expect(toGitignoreEntry('/p', '/p/build', true)).toBe('/build/');
  });

  it('handles a top-level file', () => {
    expect(toGitignoreEntry('/p', '/p/.env', false)).toBe('/.env');
  });

  it('tolerates a trailing slash on the root path', () => {
    expect(toGitignoreEntry('/p/', '/p/build', true)).toBe('/build/');
  });

  it('rejects paths outside the project root', () => {
    expect(toGitignoreEntry('/p', '/other/file.ts', false)).toBeNull();
    // Sibling directory that merely shares the root's prefix
    expect(toGitignoreEntry('/p', '/project/file.ts', false)).toBeNull();
  });

  it('rejects the project root itself', () => {
    expect(toGitignoreEntry('/p', '/p', true)).toBeNull();
  });

  it('returns null without a project root', () => {
    expect(toGitignoreEntry(null, '/p/build', true)).toBeNull();
  });
});

describe('appendGitignoreEntry', () => {
  it('creates the first line for an empty file', () => {
    expect(appendGitignoreEntry('', '/build/')).toBe('/build/\n');
  });

  it('appends on a new line, keeping existing rules intact', () => {
    expect(appendGitignoreEntry('node_modules\n.env\n', '/build/')).toBe(
      'node_modules\n.env\n/build/\n'
    );
  });

  it('adds the missing newline when the file does not end with one', () => {
    expect(appendGitignoreEntry('node_modules', '/build/')).toBe('node_modules\n/build/\n');
  });

  it('returns null when the entry is already listed', () => {
    expect(appendGitignoreEntry('node_modules\n/build/\n', '/build/')).toBeNull();
  });

  it('treats a directory entry with and without trailing slash as the same rule', () => {
    expect(appendGitignoreEntry('/build\n', '/build/')).toBeNull();
  });

  it('ignores surrounding whitespace when checking for duplicates', () => {
    expect(appendGitignoreEntry('  /build/  \n', '/build/')).toBeNull();
  });

  it('does not mistake a comment mentioning the path for the rule itself', () => {
    expect(appendGitignoreEntry('# /build/ is generated\n', '/build/')).toBe(
      '# /build/ is generated\n/build/\n'
    );
  });
});
