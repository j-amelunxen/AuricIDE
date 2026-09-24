import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMcpCliBinding } from '../cli';

describe('resolveMcpCliBinding', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'auric-mcp-cli-'));
    dirs.push(root);
    mkdirSync(join(root, '.auric'));
    writeFileSync(join(root, '.auric', 'project.db'), '');
    return root;
  }

  it('derives one database from the canonical project root', () => {
    const root = project();
    const binding = resolveMcpCliBinding(['--project-root', root]);

    const canonicalRoot = realpathSync(root);
    expect(binding.projectRoot).toBe(canonicalRoot);
    expect(binding.databasePath).toBe(join(canonicalRoot, '.auric', 'project.db'));
  });

  it('rejects an uninitialised project instead of creating a new database', () => {
    const root = mkdtempSync(join(tmpdir(), 'auric-mcp-empty-'));
    dirs.push(root);

    expect(() => resolveMcpCliBinding(['--project-root', root])).toThrow(/not initialized/i);
  });

  it('rejects missing and contradictory arguments', () => {
    expect(() => resolveMcpCliBinding([])).toThrow(/--project-root/i);
    expect(() =>
      resolveMcpCliBinding(['--project-root', '/a', '--database', '/b/project.db'])
    ).toThrow(/unsupported/i);
  });

  it('rejects a project database symlink that escapes the project root', () => {
    const root = project();
    const outsideRoot = mkdtempSync(join(tmpdir(), 'auric-mcp-outside-'));
    dirs.push(outsideRoot);
    const outside = join(outsideRoot, 'other.db');
    writeFileSync(outside, '');
    rmSync(join(root, '.auric', 'project.db'));
    symlinkSync(outside, join(root, '.auric', 'project.db'));

    expect(() => resolveMcpCliBinding(['--project-root', root])).toThrow(/escapes/i);
  });
});
