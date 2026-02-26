import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { xml } from '@codemirror/lang-xml';

const mockSetDiagnostics = vi.fn();

vi.mock('@/lib/store', () => ({
  useStore: Object.assign(vi.fn(), {
    getState: vi.fn(() => ({ setDiagnostics: mockSetDiagnostics })),
  }),
}));

import {
  xmlLintExtension,
  currentFilePathFacetXml,
  xmlLintSource,
  parseXmlErrors,
} from './xmlLintExtension';

describe('parseXmlErrors', () => {
  it('returns empty for valid XML', () => {
    const errors = parseXmlErrors('<root><child/></root>');
    expect(errors).toHaveLength(0);
  });

  it('returns empty for empty string', () => {
    const errors = parseXmlErrors('');
    expect(errors).toHaveLength(0);
  });

  it('returns empty for whitespace-only string', () => {
    const errors = parseXmlErrors('   \n  ');
    expect(errors).toHaveLength(0);
  });

  it('returns error for unclosed tag', () => {
    const errors = parseXmlErrors('<root><child>');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatchObject({
      message: expect.any(String),
      line: expect.any(Number),
      column: expect.any(Number),
    });
  });

  it('returns error for mismatched tags', () => {
    const errors = parseXmlErrors('<a></b>');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('extracts line number when available', () => {
    // Multi-line XML to give parser a chance to report a specific line
    const errors = parseXmlErrors('<root>\n  <child>\n</root>');
    if (errors.length > 0) {
      expect(errors[0].line).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('xmlLintExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports xmlLintExtension as defined', () => {
    expect(xmlLintExtension).toBeDefined();
  });

  it('exports currentFilePathFacetXml as defined', () => {
    expect(currentFilePathFacetXml).toBeDefined();
  });

  it('xmlLintSource returns no diagnostics for valid XML', () => {
    const state = EditorState.create({
      doc: '<root><child attr="value"/></root>',
      extensions: [xml(), currentFilePathFacetXml.of('')],
    });
    const view = new EditorView({ state });

    const diagnostics = xmlLintSource(view);

    expect(diagnostics).toHaveLength(0);
    view.destroy();
  });

  it('xmlLintSource returns diagnostic for invalid XML', () => {
    const state = EditorState.create({
      doc: '<root><unclosed>',
      extensions: [xml(), currentFilePathFacetXml.of('')],
    });
    const view = new EditorView({ state });

    const diagnostics = xmlLintSource(view);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe('error');
    view.destroy();
  });

  it('pushes diagnostics to store when filePath facet is set', () => {
    const state = EditorState.create({
      doc: '<broken>',
      extensions: [xml(), currentFilePathFacetXml.of('/path/to/file.xml')],
    });
    const view = new EditorView({ state });

    xmlLintSource(view);

    expect(mockSetDiagnostics).toHaveBeenCalledWith(
      '/path/to/file.xml',
      expect.arrayContaining([expect.objectContaining({ severity: 'error' })])
    );
    view.destroy();
  });
});
