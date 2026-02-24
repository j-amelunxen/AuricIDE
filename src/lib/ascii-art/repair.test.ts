import { describe, it, expect } from 'vitest';
import { repairAsciiArt } from './repair';

// ---------------------------------------------------------------------------
// Reference diagrams (translated from Python test_ascii_fix.py)
// ---------------------------------------------------------------------------

const CORRECT = `\
┌─────────────────────────────────────────────────────────────────┐
│ Application Model (AM)                                          │
│ - Defines navigation and flows                                  │
│ - Contains scenes with match conditions                         │
│ - References Form Models and Overview Models in scenes          │
└──────────────────────┬──────────────────────────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        │                              │
        ▼                              ▼
┌───────────────────┐          ┌──────────────────┐
│ Form Model (FM)   │          │ Overview Model   │
│ - UI layout       │          │ (OM)             │
│ - Controls bind   │          │ - Table columns  │
│   to fields       │          │ - Columns bind   │
│ - Buttons/events  │          │   to fields      │
└────────┬──────────┘          └────────┬─────────┘
         │                              │
         └──────────────┬───────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ Document Model (DM) │
              │ - Field definitions │
              │ - Data types        │
              │ - Validation rules  │
              │ - Localization      │
              └─────────────────────┘`;

const BROKEN = `\
┌────────────────────────────────────────────────────────────┐
│ Application Model (AM)                                          │
│ - Defines navigation and flows                                  │
│ - Contains scenes with match conditions                         │||
│ - References Form Models and Overview Models in scenes          │
└──────────────────────┬───────────────────────────────────────┘
                       │
        ┌──────────────┴───────────────┐
        │                              │
        ▼                              ▼
┌───────────────────┐          ┌──────────────────┐
│ Form Model (FM)   │        │ Overview Model   │
│ - UI layout       │          │ (OM)             │
│ - Controls bind  │          │ - Table columns  │ │
│   to fields       │          │ - Columns bind   │
│ - Buttons/events  │          │   to fields      ││
└────────┬──────────┘          └────────┬─────────┘
         │                              │
         └──────────────┬───────────────┘
                        │
                        ▼
                ┌───────────────────  ──
              │ Document Model (DM) │
              │ - Field definitions │
              ││ - Data types
              │ - Validation rules  │
              │ - Localization      │
              └────#───────────────.  ──┘`;

// ---------------------------------------------------------------------------
// Unit tests (translated from test_ascii_fix.py)
// ---------------------------------------------------------------------------

describe('repairAsciiArt', () => {
  it('fixes broken diagram to correct', () => {
    expect(repairAsciiArt(BROKEN)).toBe(CORRECT);
  });

  it('correct stays correct (idempotency)', () => {
    expect(repairAsciiArt(CORRECT)).toBe(CORRECT);
  });

  it('removes extra │ at end of content line', () => {
    const broken = `\
┌─────────┐
│ hello   │ │
└─────────┘`;
    const expected = `\
┌─────────┐
│ hello   │
└─────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('removes duplicate │ at start of content line', () => {
    const broken = `\
┌─────────┐
││ hello   │
└─────────┘`;
    const expected = `\
┌─────────┐
│ hello   │
└─────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('fixes border width mismatch (too narrow borders)', () => {
    const broken = `\
┌──────┐
│ hello world │
└──────┘`;
    const expected = `\
┌─────────────┐
│ hello world │
└─────────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('replaces invalid chars in border with ─', () => {
    const broken = `\
┌────#──────.──┐
│ hello world  │
└──────────────┘`;
    const expected = `\
┌──────────────┐
│ hello world  │
└──────────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('fills spaces in horizontal borders with ─', () => {
    const broken = `\
┌──────  ──────┐
│ hello world  │
└──────────────┘`;
    const expected = `\
┌──────────────┐
│ hello world  │
└──────────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('adds missing right │ on content lines', () => {
    const broken = `\
┌──────────────┐
│ hello world
└──────────────┘`;
    const expected = `\
┌──────────────┐
│ hello world  │
└──────────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('adds missing ┐ corner', () => {
    const broken = `\
┌──────────────
│ hello world  │
└──────────────┘`;
    const expected = `\
┌──────────────┐
│ hello world  │
└──────────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('preserves ┬/┴ connectors in borders', () => {
    const broken = `\
┌───────┐
│ hello │
└───┬───┘
    │`;
    const expected = `\
┌───────┐
│ hello │
└───┬───┘
    │`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('realigns shifted border indentation', () => {
    const broken = `\
                ┌───────────────────  ──
              │ Document Model (DM) │
              │ - Field definitions │
              └─────────────────────┘`;
    const expected = `\
              ┌─────────────────────┐
              │ Document Model (DM) │
              │ - Field definitions │
              └─────────────────────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('fixes side-by-side boxes', () => {
    const broken = `\
┌───────┐     ┌───────┐
│ left  │   │ right │
│ box   │     │ box   │ │
└───────┘     └───────┘`;
    const expected = `\
┌───────┐     ┌───────┐
│ left  │     │ right │
│ box   │     │ box   │
└───────┘     └───────┘`;
    expect(repairAsciiArt(broken)).toBe(expected);
  });

  it('preserves non-box lines (connectors, arrows)', () => {
    const input = `\
┌───────┐
│ hello │
└───┬───┘
    │
    ▼
┌───────┐
│ world │
└───────┘`;
    expect(repairAsciiArt(input)).toBe(input);
  });
});
