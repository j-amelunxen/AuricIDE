import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  showReferencesFacet,
  findReferencesKeymap,
  type ShowReferencesCallback,
} from './findReferencesExtension';

describe('showReferencesFacet', () => {
  it('returns a no-op callback when no facet value is provided', () => {
    const state = EditorState.create({ extensions: [] });
    const callback = state.facet(showReferencesFacet);
    expect(typeof callback).toBe('function');
    // Should not throw
    callback('test', 'entity', []);
  });

  it('returns the provided callback', () => {
    const mockCallback: ShowReferencesCallback = vi.fn();
    const state = EditorState.create({
      extensions: [showReferencesFacet.of(mockCallback)],
    });
    const callback = state.facet(showReferencesFacet);
    expect(callback).toBe(mockCallback);
  });

  it('uses the first callback when multiple are provided', () => {
    const first: ShowReferencesCallback = vi.fn();
    const second: ShowReferencesCallback = vi.fn();
    const state = EditorState.create({
      extensions: [showReferencesFacet.of(first), showReferencesFacet.of(second)],
    });
    const callback = state.facet(showReferencesFacet);
    expect(callback).toBe(first);
  });
});

describe('findReferencesKeymap', () => {
  it('is an array of keybindings', () => {
    expect(Array.isArray(findReferencesKeymap)).toBe(true);
    expect(findReferencesKeymap.length).toBeGreaterThan(0);
  });

  it('includes Alt-F7 keybinding', () => {
    const altF7 = findReferencesKeymap.find((k) => k.key === 'Alt-F7');
    expect(altF7).toBeDefined();
    expect(typeof altF7!.run).toBe('function');
  });

  it('includes Shift-F12 keybinding', () => {
    const shiftF12 = findReferencesKeymap.find((k) => k.key === 'Shift-F12');
    expect(shiftF12).toBeDefined();
    expect(typeof shiftF12!.run).toBe('function');
  });
});

describe('findReferencesKeymap handler', () => {
  function createEditorView(doc: string, pos: number, callback?: ShowReferencesCallback) {
    const extensions = callback ? [showReferencesFacet.of(callback)] : [];
    const state = EditorState.create({
      doc,
      extensions,
      selection: { anchor: pos },
    });
    const container = document.createElement('div');
    return new EditorView({ state, parent: container });
  }

  it('detects entity when cursor is on a PascalCase word', () => {
    const callback = vi.fn();
    const doc = 'The DataPipeline handles data';
    //           0123456789...
    // DataPipeline starts at 4, cursor at 6
    const view = createEditorView(doc, 6, callback);

    const binding = findReferencesKeymap.find((k) => k.key === 'Alt-F7')!;
    binding.run!(view);

    expect(callback).toHaveBeenCalledWith('DataPipeline', 'entity', expect.any(Array));
    view.destroy();
  });

  it('detects heading when cursor is on a heading line', () => {
    const callback = vi.fn();
    const doc = '# My Heading\nSome text';
    // Cursor on position 5 (inside "My Heading")
    const view = createEditorView(doc, 5, callback);

    const binding = findReferencesKeymap.find((k) => k.key === 'Alt-F7')!;
    binding.run!(view);

    expect(callback).toHaveBeenCalledWith('My Heading', 'heading', expect.any(Array));
    view.destroy();
  });

  it('does not crash when no callback is provided', () => {
    const doc = 'Some text here';
    const view = createEditorView(doc, 5);

    const binding = findReferencesKeymap.find((k) => k.key === 'Alt-F7')!;
    expect(() => binding.run!(view)).not.toThrow();
    view.destroy();
  });
});
