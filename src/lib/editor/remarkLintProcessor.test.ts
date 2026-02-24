import { describe, expect, it } from 'vitest';
import { runRemarkLint } from './remarkLintProcessor';
import type { LintConfig } from '@/lib/store/diagnosticsSlice';

const defaultConfig: LintConfig = {
  enabled: true,
  disabledRules: new Set(),
};

const disabledConfig: LintConfig = {
  enabled: false,
  disabledRules: new Set(),
};

describe('remarkLintProcessor', () => {
  it('returns empty array for empty content', async () => {
    const result = await runRemarkLint('', defaultConfig, [], new Map(), '/test.md');
    expect(result).toEqual([]);
  });

  it('returns empty when linting is disabled', async () => {
    const result = await runRemarkLint(
      '# Bad markdown with issues\n\n\n\n',
      disabledConfig,
      [],
      new Map(),
      '/test.md'
    );
    expect(result).toEqual([]);
  });

  it('detects missing final newline', async () => {
    const result = await runRemarkLint('# Hello', defaultConfig, [], new Map(), '/test.md');
    const finalNewlineIssue = result.find((d) => d.ruleId === 'remark-lint:final-newline');
    expect(finalNewlineIssue).toBeDefined();
  });

  it('returns diagnostics with line and column info', async () => {
    const result = await runRemarkLint('# Hello', defaultConfig, [], new Map(), '/test.md');
    for (const diag of result) {
      expect(diag.line).toBeGreaterThan(0);
      expect(diag.column).toBeGreaterThan(0);
      expect(diag.message).toBeTruthy();
      expect(diag.ruleId).toBeTruthy();
    }
  });

  it('detects broken local links', async () => {
    const md = '[link](./missing.md)\n';
    const result = await runRemarkLint(
      md,
      defaultConfig,
      ['/project/test.md'],
      new Map(),
      '/project/test.md'
    );
    const brokenLink = result.find((d) => d.ruleId === 'remark-lint:broken-links');
    expect(brokenLink).toBeDefined();
    expect(brokenLink!.severity).toBe('error');
  });

  it('filters out disabled rules', async () => {
    const md = '# Hello';
    const config: LintConfig = {
      enabled: true,
      disabledRules: new Set(['remark-lint:final-newline']),
    };
    const result = await runRemarkLint(md, config, [], new Map(), '/test.md');
    const finalNewlineIssue = result.find((d) => d.ruleId === 'remark-lint:final-newline');
    expect(finalNewlineIssue).toBeUndefined();
  });

  it('assigns severity based on rule', async () => {
    const result = await runRemarkLint(
      '[broken](./nope.md)\n',
      defaultConfig,
      ['/test.md'],
      new Map(),
      '/test.md'
    );
    for (const diag of result) {
      expect(['error', 'warning', 'info']).toContain(diag.severity);
    }
  });

  it('processes valid markdown without issues', async () => {
    const result = await runRemarkLint(
      '# Title\n\nSome paragraph.\n',
      defaultConfig,
      [],
      new Map(),
      '/test.md'
    );
    expect(result).toEqual([]);
  });
});
