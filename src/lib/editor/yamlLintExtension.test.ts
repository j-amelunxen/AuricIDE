import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yaml } from '@codemirror/lang-yaml';

const mockSetDiagnostics = vi.fn();

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ setDiagnostics: mockSetDiagnostics })),
  }),
}));

import {
  yamlLintExtension,
  currentFilePathFacetYaml,
  yamlLintSource,
  parseYamlErrors,
} from './yamlLintExtension';

describe('parseYamlErrors', () => {
  it('returns empty for valid YAML', () => {
    const errors = parseYamlErrors('key: value\nother: 123');
    expect(errors).toHaveLength(0);
  });

  it('returns empty for empty string', () => {
    const errors = parseYamlErrors('');
    expect(errors).toHaveLength(0);
  });

  it('returns empty for whitespace-only string', () => {
    const errors = parseYamlErrors('   \n  ');
    expect(errors).toHaveLength(0);
  });

  it('returns error for invalid YAML', () => {
    // Tab characters in YAML are forbidden in indentation
    const errors = parseYamlErrors('key: :\n  invalid: [unclosed');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatchObject({
      message: expect.any(String),
      line: expect.any(Number),
      column: expect.any(Number),
    });
  });

  it('includes line number in error', () => {
    const errors = parseYamlErrors('good: value\nbad: :\n  invalid: [unclosed');
    if (errors.length > 0) {
      expect(errors[0].line).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns error for unclosed bracket', () => {
    const errors = parseYamlErrors('items: [one, two');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('yamlLintExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports yamlLintExtension as defined', () => {
    expect(yamlLintExtension).toBeDefined();
  });

  it('exports currentFilePathFacetYaml as defined', () => {
    expect(currentFilePathFacetYaml).toBeDefined();
  });

  it('yamlLintSource returns no diagnostics for valid YAML', () => {
    const state = EditorState.create({
      doc: 'name: project\nversion: 1\ntags:\n  - foo\n  - bar',
      extensions: [yaml(), currentFilePathFacetYaml.of('')],
    });
    const view = new EditorView({ state });

    const diagnostics = yamlLintSource(view);

    expect(diagnostics).toHaveLength(0);
    view.destroy();
  });

  it('yamlLintSource returns diagnostic for invalid YAML', () => {
    const state = EditorState.create({
      doc: 'items: [one, two',
      extensions: [yaml(), currentFilePathFacetYaml.of('')],
    });
    const view = new EditorView({ state });

    const diagnostics = yamlLintSource(view);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe('error');
    view.destroy();
  });

  it('pushes diagnostics to store when filePath facet is set', () => {
    const state = EditorState.create({
      doc: 'items: [unclosed',
      extensions: [yaml(), currentFilePathFacetYaml.of('/path/to/file.yaml')],
    });
    const view = new EditorView({ state });

    yamlLintSource(view);

    expect(mockSetDiagnostics).toHaveBeenCalledWith(
      '/path/to/file.yaml',
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })])
    );
    view.destroy();
  });
});
