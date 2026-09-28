import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fixtures from '../../lib/agents/agentControl.fixtures.json';
import { resolveMcpCliBinding, resolveMcpCliMode } from '../cli';

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

describe('resolveMcpCliMode', () => {
  it('starts the control server for exactly --control', () => {
    expect(resolveMcpCliMode(['--control'], {})).toEqual({ mode: 'control' });
  });

  it('refuses --control inside an agent the IDE spawned', () => {
    expect(() => resolveMcpCliMode(['--control'], { AURIC_AGENT_CWD: '/tmp/x' })).toThrow(
      /AURIC_AGENT_CWD/
    );
  });

  it('refuses --control under the IDE agent marker the fixtures name', () => {
    expect(() =>
      resolveMcpCliMode(['--control'], { [fixtures.environment.ideAgentMarker]: '1' })
    ).toThrow(new RegExp(fixtures.environment.ideAgentMarker));
  });

  it('refuses --control with extra arguments', () => {
    expect(() => resolveMcpCliMode(['--control', '--project-root', '/a'], {})).toThrow(
      /unsupported/i
    );
  });

  it('keeps the project binding for --project-root', () => {
    const root = mkdtempSync(join(tmpdir(), 'auric-mcp-mode-'));
    try {
      mkdirSync(join(root, '.auric'));
      writeFileSync(join(root, '.auric', 'project.db'), '');
      const mode = resolveMcpCliMode(['--project-root', root], { AURIC_AGENT_CWD: root });
      expect(mode).toMatchObject({ mode: 'project', projectRoot: realpathSync(root) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names both modes when the arguments fit neither', () => {
    expect(() => resolveMcpCliMode([], {})).toThrow(/--project-root.*--control/);
  });
});
