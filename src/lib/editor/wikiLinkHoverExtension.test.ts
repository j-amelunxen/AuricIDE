import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  wikiLinkHoverExtension,
  previewFetcherFacet,
  navigateCallbackFacet,
} from './wikiLinkHoverExtension';

describe('wikiLinkHoverExtension', () => {
  it('exports wikiLinkHoverExtension as defined', () => {
    expect(wikiLinkHoverExtension).toBeDefined();
  });

  it('is an array of extensions', () => {
    expect(Array.isArray(wikiLinkHoverExtension)).toBe(true);
    expect(wikiLinkHoverExtension.length).toBeGreaterThan(0);
  });

  it('exports previewFetcherFacet', () => {
    expect(previewFetcherFacet).toBeDefined();
  });

  it('exports navigateCallbackFacet', () => {
    expect(navigateCallbackFacet).toBeDefined();
  });

  describe('EditorView integration', () => {
    it('can be added to an EditorView without error', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'See [[Test Link]] here',
        extensions: [
          wikiLinkHoverExtension,
          previewFetcherFacet.of(() => ({ exists: true, preview: 'Hello world' })),
          navigateCallbackFacet.of(() => {}),
        ],
      });
      const view = new EditorView({ state, parent });
      expect(view).toBeDefined();

      view.destroy();
      document.body.removeChild(parent);
    });
  });
});
