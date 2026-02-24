import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  brokenLinksSetFacet,
  brokenLinkPlugin,
  wikiLinkBrokenExtension,
} from './wikiLinkBrokenExtension';

describe('wikiLinkBrokenExtension', () => {
  describe('exports', () => {
    it('exports brokenLinksSetFacet as defined', () => {
      expect(brokenLinksSetFacet).toBeDefined();
    });

    it('exports brokenLinkPlugin as defined', () => {
      expect(brokenLinkPlugin).toBeDefined();
    });

    it('exports wikiLinkBrokenExtension as an array', () => {
      expect(Array.isArray(wikiLinkBrokenExtension)).toBe(true);
      expect(wikiLinkBrokenExtension.length).toBeGreaterThan(0);
    });

    it('brokenLinkPlugin is a ViewPlugin instance', () => {
      expect(brokenLinkPlugin).toHaveProperty('extension');
    });
  });

  describe('decorations', () => {
    it('applies syntax-wikilink-broken class when facet has broken targets', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'Check [[My Link]] here',
        extensions: [wikiLinkBrokenExtension, brokenLinksSetFacet.of(new Set(['my-link.md']))],
      });
      const view = new EditorView({ state, parent });

      const marks = parent.querySelectorAll('.syntax-wikilink-broken');
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0].textContent).toContain('[[My Link]]');

      view.destroy();
      document.body.removeChild(parent);
    });

    it('does not apply decorations when facet is an empty set', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'Check [[My Link]] here',
        extensions: [wikiLinkBrokenExtension, brokenLinksSetFacet.of(new Set())],
      });
      const view = new EditorView({ state, parent });

      const marks = parent.querySelectorAll('.syntax-wikilink-broken');
      expect(marks.length).toBe(0);

      view.destroy();
      document.body.removeChild(parent);
    });

    it('does not apply decorations when links exist but none are broken', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'Check [[My Link]] and [[Other Link]] here',
        extensions: [
          wikiLinkBrokenExtension,
          brokenLinksSetFacet.of(new Set(['totally-unrelated.md'])),
        ],
      });
      const view = new EditorView({ state, parent });

      const marks = parent.querySelectorAll('.syntax-wikilink-broken');
      expect(marks.length).toBe(0);

      view.destroy();
      document.body.removeChild(parent);
    });

    it('decorates only the broken link when multiple links exist', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'See [[Good Link]] and [[Bad Link]] here',
        extensions: [wikiLinkBrokenExtension, brokenLinksSetFacet.of(new Set(['bad-link.md']))],
      });
      const view = new EditorView({ state, parent });

      const marks = parent.querySelectorAll('.syntax-wikilink-broken');
      expect(marks.length).toBe(1);
      expect(marks[0].textContent).toContain('[[Bad Link]]');

      view.destroy();
      document.body.removeChild(parent);
    });

    it('does not decorate text without wiki-links', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'No links here at all',
        extensions: [wikiLinkBrokenExtension, brokenLinksSetFacet.of(new Set(['some-file.md']))],
      });
      const view = new EditorView({ state, parent });

      const marks = parent.querySelectorAll('.syntax-wikilink-broken');
      expect(marks.length).toBe(0);

      view.destroy();
      document.body.removeChild(parent);
    });
  });
});
