import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { wikiLinkPlugin, wikiLinkExtension } from './wikiLinkExtension';

describe('wikiLinkExtension', () => {
  describe('exports', () => {
    it('exports wikiLinkPlugin as defined', () => {
      expect(wikiLinkPlugin).toBeDefined();
    });

    it('exports wikiLinkExtension as defined', () => {
      expect(wikiLinkExtension).toBeDefined();
    });

    it('wikiLinkExtension is an array of extensions', () => {
      expect(Array.isArray(wikiLinkExtension)).toBe(true);
      expect(wikiLinkExtension.length).toBeGreaterThan(0);
    });

    it('wikiLinkPlugin is a ViewPlugin instance', () => {
      // ViewPlugin.fromClass returns an object with an extension property
      expect(wikiLinkPlugin).toHaveProperty('extension');
    });
  });

  describe('decorations', () => {
    it('applies syntax-wikilink class to wiki-link ranges', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'Check [[My Link]] here',
        extensions: [wikiLinkExtension],
      });
      const view = new EditorView({ state, parent });

      const marks = parent.querySelectorAll('.syntax-wikilink');
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0].textContent).toContain('[[My Link]]');

      view.destroy();
      document.body.removeChild(parent);
    });

    it('does not decorate text without wiki-links', () => {
      const parent = document.createElement('div');
      document.body.appendChild(parent);

      const state = EditorState.create({
        doc: 'No links here at all',
        extensions: [wikiLinkExtension],
      });
      const view = new EditorView({ state, parent });

      const marks = parent.querySelectorAll('.syntax-wikilink');
      expect(marks.length).toBe(0);

      view.destroy();
      document.body.removeChild(parent);
    });
  });
});
