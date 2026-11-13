// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { wikiLinkHoverExtension } from './wikiLinkHoverExtension';

describe('wikiLinkHoverExtension', () => {
  it('is an array of extensions', () => {
    expect(Array.isArray(wikiLinkHoverExtension)).toBe(true);
    expect(wikiLinkHoverExtension.length).toBeGreaterThan(0);
  });
});
