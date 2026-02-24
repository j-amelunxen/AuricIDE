import { describe, expect, it } from 'vitest';
import { auricTheme, auricHighlightStyle } from './auricTheme';

describe('auricTheme', () => {
  it('exports a CodeMirror theme extension', () => {
    expect(auricTheme).toBeDefined();
  });

  it('exports a highlight style', () => {
    expect(auricHighlightStyle).toBeDefined();
  });
});
