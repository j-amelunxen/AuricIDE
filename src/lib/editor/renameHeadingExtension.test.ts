import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { renameHeadingCallbackFacet } from './renameHeadingExtension';

describe('renameHeadingExtension', () => {
  it('facet defaults to a no-op function', () => {
    const state = EditorState.create({ doc: '' });
    const callback = state.facet(renameHeadingCallbackFacet);
    expect(typeof callback).toBe('function');
    // Should not throw
    callback('heading', 1);
  });
});
