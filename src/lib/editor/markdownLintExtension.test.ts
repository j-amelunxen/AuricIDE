import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  markdownLintExtension,
  lintConfigFacet,
  fileListForLintFacet,
  headingIndexForLintFacet,
  currentFilePathFacet,
} from './markdownLintExtension';
import type { LintConfig } from '@/lib/store/diagnosticsSlice';

describe('markdownLintExtension', () => {
  it('exports markdownLintExtension as defined', () => {
    expect(markdownLintExtension).toBeDefined();
  });

  it('exports lintConfigFacet as defined', () => {
    expect(lintConfigFacet).toBeDefined();
  });

  it('exports fileListForLintFacet as defined', () => {
    expect(fileListForLintFacet).toBeDefined();
  });

  it('exports headingIndexForLintFacet as defined', () => {
    expect(headingIndexForLintFacet).toBeDefined();
  });

  it('exports currentFilePathFacet as defined', () => {
    expect(currentFilePathFacet).toBeDefined();
  });

  it('can be added to an EditorView without error', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const config: LintConfig = { enabled: true, disabledRules: new Set() };

    const state = EditorState.create({
      doc: '# Test\n\nSome markdown.\n',
      extensions: [
        markdownLintExtension,
        lintConfigFacet.of(config),
        fileListForLintFacet.of([]),
        headingIndexForLintFacet.of(new Map()),
        currentFilePathFacet.of('/test.md'),
      ],
    });
    const view = new EditorView({ state, parent });
    expect(view).toBeDefined();

    view.destroy();
    document.body.removeChild(parent);
  });

  it('lintConfigFacet combines to first value', () => {
    const config: LintConfig = { enabled: false, disabledRules: new Set(['rule1']) };
    const state = EditorState.create({
      doc: '',
      extensions: [lintConfigFacet.of(config)],
    });
    const result = state.facet(lintConfigFacet);
    expect(result.enabled).toBe(false);
    expect(result.disabledRules.has('rule1')).toBe(true);
  });

  it('lintConfigFacet defaults to enabled config', () => {
    const state = EditorState.create({ doc: '', extensions: [] });
    const result = state.facet(lintConfigFacet);
    expect(result.enabled).toBe(true);
    expect(result.disabledRules.size).toBe(0);
  });

  it('fileListForLintFacet defaults to empty array', () => {
    const state = EditorState.create({ doc: '', extensions: [] });
    expect(state.facet(fileListForLintFacet)).toEqual([]);
  });

  it('headingIndexForLintFacet defaults to empty map', () => {
    const state = EditorState.create({ doc: '', extensions: [] });
    expect(state.facet(headingIndexForLintFacet).size).toBe(0);
  });

  it('currentFilePathFacet defaults to empty string', () => {
    const state = EditorState.create({ doc: '', extensions: [] });
    expect(state.facet(currentFilePathFacet)).toBe('');
  });
});
