import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { renameHeadingCallbackFacet, renameHeadingExtension } from './renameHeadingExtension';

describe('renameHeadingExtension', () => {
  it('exports renameHeadingCallbackFacet', () => {
    expect(renameHeadingCallbackFacet).toBeDefined();
  });

  it('exports renameHeadingExtension', () => {
    expect(renameHeadingExtension).toBeDefined();
  });

  it('facet defaults to a no-op function', () => {
    const state = EditorState.create({ doc: '' });
    const callback = state.facet(renameHeadingCallbackFacet);
    expect(typeof callback).toBe('function');
    // Should not throw
    callback('heading', 1);
  });

  it('facet receives custom callback', () => {
    let captured: { title: string; line: number } | null = null;
    const state = EditorState.create({
      doc: '# My Heading',
      extensions: [
        renameHeadingCallbackFacet.of((title, line) => {
          captured = { title, line };
        }),
      ],
    });
    const callback = state.facet(renameHeadingCallbackFacet);
    callback('My Heading', 1);
    expect(captured).toEqual({ title: 'My Heading', line: 1 });
  });
});
