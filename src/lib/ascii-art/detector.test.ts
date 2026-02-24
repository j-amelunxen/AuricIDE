import { describe, it, expect } from 'vitest';
import { detectAsciiArt } from './detector';

describe('detectAsciiArt', () => {
  it('detects unicode box-drawing characters (≥ 2 chars)', () => {
    const text = '┌─────┐\n│ hi  │\n└─────┘';
    expect(detectAsciiArt(text)).toBe(true);
  });

  it('detects simple ASCII grid pattern across multiple lines', () => {
    const text = '+--+\n|  |\n+--+';
    expect(detectAsciiArt(text)).toBe(true);
  });

  it('detects ASCII grid with longer dashes', () => {
    const text = '+------+------+\n| foo  | bar  |\n+------+------+';
    expect(detectAsciiArt(text)).toBe(true);
  });

  it('does not detect plain prose text', () => {
    const text = 'Hello world\nThis is a paragraph\nwith multiple lines';
    expect(detectAsciiArt(text)).toBe(false);
  });

  it('does not detect single-line text even with box chars', () => {
    const text = '┌─────┐';
    expect(detectAsciiArt(text)).toBe(false);
  });

  it('does not detect single-line ASCII grid pattern', () => {
    const text = '+--+--+';
    expect(detectAsciiArt(text)).toBe(false);
  });

  it('does not detect empty string', () => {
    expect(detectAsciiArt('')).toBe(false);
  });

  it('does not detect text with only one unicode box char', () => {
    const text = '┌ something\nand more text';
    expect(detectAsciiArt(text)).toBe(false);
  });

  it('detects mixed ASCII art with text labels inside', () => {
    const text = '+----------+\n| Component|\n+----------+';
    expect(detectAsciiArt(text)).toBe(true);
  });

  it('detects unicode double-line box drawing', () => {
    const text = '╔═══╗\n║   ║\n╚═══╝';
    expect(detectAsciiArt(text)).toBe(true);
  });

  it('detects pipe-and-dash box without + junctions', () => {
    const text = '|--------|\n| hello  |\n|--------|';
    expect(detectAsciiArt(text)).toBe(true);
  });

  it('detects pipe-and-dash box with leading whitespace', () => {
    const text = '  |--------|\n  | hello  |\n  |--------|';
    expect(detectAsciiArt(text)).toBe(true);
  });

  it('does not detect markdown tables as ASCII art', () => {
    const text = '| Col1 | Col2 |\n| ---- | ---- |\n| val  | val  |';
    expect(detectAsciiArt(text)).toBe(false);
  });

  it('does not detect markdown tables with alignment markers', () => {
    const text = '| Left | Center | Right |\n|:-----|:------:|------:|\n| a    | b      | c     |';
    expect(detectAsciiArt(text)).toBe(false);
  });
});
