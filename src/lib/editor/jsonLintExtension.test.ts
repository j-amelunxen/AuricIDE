import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { json } from '@codemirror/lang-json';

const mockSetDiagnostics = vi.fn();

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ setDiagnostics: mockSetDiagnostics })),
  }),
}));

// Import after mocks are registered
import { jsonLintExtension, currentFilePathFacetJson, jsonLintSource } from './jsonLintExtension';

describe('jsonLintExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports jsonLintExtension as defined', () => {
    expect(jsonLintExtension).toBeDefined();
  });

  it('exports currentFilePathFacetJson as defined', () => {
    expect(currentFilePathFacetJson).toBeDefined();
  });

  it('jsonLintSource returns no diagnostics for valid JSON', async () => {
    const state = EditorState.create({
      doc: '{"key": "value", "num": 42}',
      extensions: [json(), currentFilePathFacetJson.of('')],
    });
    const view = new EditorView({ state });

    const diagnostics = await jsonLintSource(view);

    expect(diagnostics).toHaveLength(0);
    view.destroy();
  });

  it('jsonLintSource returns diagnostic for invalid JSON', async () => {
    const state = EditorState.create({
      doc: '{ "key": }',
      extensions: [json(), currentFilePathFacetJson.of('')],
    });
    const view = new EditorView({ state });

    const diagnostics = await jsonLintSource(view);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe('error');
    view.destroy();
  });

  it('pushes diagnostics to store when filePath facet is set', async () => {
    const state = EditorState.create({
      doc: '{ bad json }',
      extensions: [json(), currentFilePathFacetJson.of('/path/to/file.json')],
    });
    const view = new EditorView({ state });

    await jsonLintSource(view);

    expect(mockSetDiagnostics).toHaveBeenCalledWith(
      '/path/to/file.json',
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })])
    );
    view.destroy();
  });

  it('clears diagnostics for valid JSON when filePath facet is set', async () => {
    const state = EditorState.create({
      doc: '{"valid": true}',
      extensions: [json(), currentFilePathFacetJson.of('/path/to/file.json')],
    });
    const view = new EditorView({ state });

    await jsonLintSource(view);

    expect(mockSetDiagnostics).toHaveBeenCalledWith('/path/to/file.json', []);
    view.destroy();
  });
});
